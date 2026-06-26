'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const logger = require('../common/logger');
const { requestJson } = require('../common/messaging');
const { DEPLOY_READY_TIMEOUT_MS } = require('../constants');

const SCOPE = 'deployer';
const NPM_INSTALL_TIMEOUT_MS = 120000;
const READY_POLL_INTERVAL_MS = 400;

// Registry of launched app processes so the reverse proxy can route to them
// and the master can shut them down cleanly.
const launched = new Map(); // appName -> { child, port }

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Install an app's dependencies so it can run standalone (Requirement 5). */
function installDependencies(appDir) {
  return new Promise((resolve) => {
    logger.info(SCOPE, `Installing dependencies in ${path.basename(appDir)}`);
    const child = spawn('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: appDir,
      shell: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, reason: 'npm install timed out' });
    }, NPM_INSTALL_TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true } : { ok: false, reason: `npm install exited ${code}` });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: err.message });
    });
  });
}

/** Poll an app's /health endpoint until it responds or the timeout elapses. */
async function waitUntilReady(port) {
  const deadline = Date.now() + DEPLOY_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await requestJson({ host: '127.0.0.1', port, path: '/health', timeoutMs: 1500 });
      return true;
    } catch {
      await delay(READY_POLL_INTERVAL_MS);
    }
  }
  return false;
}

/** Spawn an independent app process listening on its assigned port. */
function launchApp(app) {
  const child = spawn(process.execPath, [path.join('src', 'server.js')], {
    cwd: app.appDir,
    env: { ...process.env, PORT: String(app.port) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  launched.set(app.appName, { child, port: app.port });
  child.on('exit', (code) => {
    logger.warn(SCOPE, `Deployed app ${app.appName} exited`, { code });
    launched.delete(app.appName);
  });
  return child;
}

/**
 * Make sure an app has its dependencies installed, trying — in order:
 *  1. an existing `node_modules`,
 *  2. a fast recursive copy of an already-installed app's `node_modules`
 *     (every generated app needs the identical `express` dependency),
 *  3. a real `npm install`.
 *
 * Cloning keeps launching many apps fast: one real install, then quick copies.
 * Each app still gets its **own** node_modules — no shared runtime dependency.
 *
 * @param {object} app build result
 * @param {object} state shared `{ templateModules }` across the deploy run
 * @param {boolean} runNpmInstall whether a real install is permitted
 * @returns {Promise<boolean>} true when the app has its dependencies
 */
async function ensureDependencies(app, state, runNpmInstall) {
  const expressDir = path.join(app.appDir, 'node_modules', 'express');
  if (fs.existsSync(expressDir)) {
    if (!state.templateModules) {
      state.templateModules = path.join(app.appDir, 'node_modules');
    }
    return true;
  }

  if (state.templateModules && fs.existsSync(state.templateModules)) {
    try {
      fs.cpSync(state.templateModules, path.join(app.appDir, 'node_modules'), { recursive: true });
      if (fs.existsSync(expressDir)) {
        logger.info(SCOPE, `Cloned dependencies into ${app.appName}`);
        return true;
      }
    } catch (err) {
      logger.warn(SCOPE, `Could not clone dependencies for ${app.appName}`, {
        error: err.message,
      });
    }
  }

  if (!runNpmInstall) return false;
  const result = await installDependencies(app.appDir);
  if (result.ok || fs.existsSync(expressDir)) {
    state.templateModules = path.join(app.appDir, 'node_modules');
    return true;
  }
  logger.warn(SCOPE, `Dependency install failed for ${app.appName}`, { reason: result.reason });
  return false;
}

/**
 * Deploy generated apps and launch the first `autoLaunchCount` of them, each on
 * a unique endpoint (Requirement 10). Apps beyond the launch count are still
 * deployed (folders exist) and listed for manual start.
 *
 * @param {object[]} apps build results from completed jobs
 * @param {object} options
 * @param {number} options.autoLaunchCount apps to auto-launch
 * @param {boolean} options.runNpmInstall whether to install deps before launch
 * @returns {Promise<object[]>} one deployment descriptor per app
 */
async function deployAndLaunch(apps, { autoLaunchCount, runNpmInstall }) {
  // On a re-run, stop apps launched previously so their ports are free.
  if (launched.size > 0) {
    shutdownAll();
    await delay(1000);
  }

  const deployments = [];
  const state = { templateModules: null };

  for (let index = 0; index < apps.length; index += 1) {
    const app = apps[index];
    const shouldLaunch = index < autoLaunchCount;
    const descriptor = {
      appName: app.appName,
      tenantId: app.tenantId,
      port: app.port,
      appDir: app.appDir,
      endpoint: `/${app.appName}`,
      directUrl: `http://localhost:${app.port}`,
      launched: false,
      status: 'generated',
      note: 'Generated — run `npm install && npm start` in its folder to launch.',
    };

    if (!shouldLaunch) {
      deployments.push(descriptor);
      continue;
    }

    const depsReady = await ensureDependencies(app, state, runNpmInstall);
    if (!depsReady) {
      descriptor.status = 'deploy_failed';
      descriptor.note = 'Dependencies unavailable — install manually, then `npm start`.';
      deployments.push(descriptor);
      continue;
    }

    launchApp(app);
    const live = await waitUntilReady(app.port);
    descriptor.launched = live;
    descriptor.status = live ? 'running' : 'launch_timeout';
    descriptor.note = live
      ? `Live at http://localhost:${app.port}`
      : 'Launched but did not become ready in time.';
    logger.decision(SCOPE, `Deployment: ${app.appName} -> ${descriptor.status}`, {
      endpoint: descriptor.endpoint,
      port: app.port,
    });
    deployments.push(descriptor);
  }

  return deployments;
}

/** Kill every launched app process — called on master shutdown. */
function shutdownAll() {
  for (const [appName, info] of launched.entries()) {
    if (info.child) info.child.kill('SIGTERM');
    logger.info(SCOPE, `Stopped deployed app ${appName}`);
  }
  launched.clear();
}

/** Live registry of launched apps — consumed by the reverse proxy. */
function getLaunched() {
  return launched;
}

module.exports = { deployAndLaunch, shutdownAll, getLaunched };
