'use strict';

const fs = require('fs');
const path = require('path');
const { DEPLOY_BASE_PORT } = require('../constants');
const logger = require('../common/logger');

const SCOPE = 'scaffolder';
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Files that every generated project must contain to count as complete.
const VERIFY_FILES = [
  'package.json',
  '.env',
  'README.md',
  'build.js',
  'src/server.js',
  'src/config.js',
  'config/app.config.json',
  'public/index.html',
  'public/styles.css',
  'public/app.js',
];

// Template cache — each template file is read from disk only once per process.
const templateCache = new Map();

function loadTemplate(name) {
  if (!templateCache.has(name)) {
    templateCache.set(name, fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8'));
  }
  return templateCache.get(name);
}

/**
 * Substitute {{KEY}} placeholders in a template. Throws on an unknown
 * placeholder so template/data mismatches fail loudly during a build.
 * @param {string} template
 * @param {object} vars
 * @returns {string}
 */
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (vars[key] === undefined) {
      throw new Error(`Missing template variable: ${key}`);
    }
    return String(vars[key]);
  });
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Runtime port for a generated app, derived from its 1-based index. */
function portForIndex(appIndex) {
  return DEPLOY_BASE_PORT + (appIndex - 1);
}

/**
 * Generate a FULLY INDEPENDENT project codebase for one tenant (Requirement 5).
 *
 * Writes to "<appName>.tmp" first, then atomically renames to "<appName>", so a
 * crash mid-write never leaves a half-built project behind (partial-build
 * recovery, Requirement 11).
 *
 * @param {object} tenant validated tenant spec
 * @param {object} options
 * @param {string} options.outputRoot absolute path to the /output directory
 * @param {number} options.appIndex 1-based application index
 * @returns {object} { appName, appDir, port, tenantId, fileCount }
 */
function generate(tenant, { outputRoot, appIndex }) {
  const appName = `app${appIndex}`;
  const port = portForIndex(appIndex);
  const finalDir = path.join(outputRoot, appName);
  const tmpDir = `${finalDir}.tmp`;

  // Partial-build recovery: clear leftovers from any previous failed attempt.
  removeDir(tmpDir);
  removeDir(finalDir);

  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'public'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });

  const vars = {
    APP_NAME: tenant.name,
    SLUG: tenant.slug,
    VERSION: tenant.version || '1.0.0',
    TENANT_ID: tenant.id,
    LOGO_TEXT: tenant.theme.logoText,
    LAYOUT: tenant.theme.layout,
    PRIMARY_COLOR: tenant.theme.primaryColor,
    ACCENT_COLOR: tenant.theme.accentColor,
    FONT_FAMILY: tenant.theme.fontFamily || 'system-ui, sans-serif',
    STAGE: tenant.environment.stage,
    LOG_LEVEL: tenant.environment.logLevel,
    PORT: port,
  };

  // Isolated configuration baked into the project (Requirement 6).
  const appConfig = {
    ...tenant,
    runtime: { appName, port, generatedAt: new Date().toISOString() },
  };

  const writes = [
    ['package.json', render(loadTemplate('package.json.tpl'), vars)],
    ['.env', render(loadTemplate('env.tpl'), vars)],
    ['README.md', render(loadTemplate('readme.tpl'), vars)],
    ['build.js', render(loadTemplate('build.js.tpl'), vars)],
    [path.join('src', 'server.js'), render(loadTemplate('server.js.tpl'), vars)],
    [path.join('src', 'config.js'), loadTemplate('config.js.tpl')],
    [path.join('config', 'app.config.json'), JSON.stringify(appConfig, null, 2)],
    [path.join('public', 'index.html'), render(loadTemplate('index.html.tpl'), vars)],
    [path.join('public', 'styles.css'), render(loadTemplate('styles.css.tpl'), vars)],
    [path.join('public', 'app.js'), render(loadTemplate('app.js.tpl'), vars)],
  ];

  for (const [relativePath, content] of writes) {
    fs.writeFileSync(path.join(tmpDir, relativePath), content);
  }

  // Atomic publish: a complete project appears at finalDir in a single step.
  fs.renameSync(tmpDir, finalDir);

  logger.info(SCOPE, `Generated independent project ${appName}`, {
    tenantId: tenant.id,
    appDir: finalDir,
    port,
    fileCount: writes.length,
  });

  return { appName, appDir: finalDir, port, tenantId: tenant.id, fileCount: writes.length };
}

/**
 * Generate a fully independent DATA APP for one slice of a dataset.
 * Same isolation guarantees as `generate`, plus a bundled `data/records.json`
 * file that the app serves itself — no database required.
 *
 * @param {object} tenant synthetic tenant spec for this slice
 * @param {object} options
 * @param {string} options.outputRoot absolute path to the /output directory
 * @param {number} options.appIndex 1-based application index
 * @param {string} options.dataChunkPath absolute path to this slice's JSON file
 * @returns {object} { appName, appDir, port, tenantId, fileCount }
 */
function generateDataApp(tenant, { outputRoot, appIndex, dataChunkPath }) {
  const appName = `app${appIndex}`;
  const port = portForIndex(appIndex);
  const finalDir = path.join(outputRoot, appName);
  const tmpDir = `${finalDir}.tmp`;

  removeDir(tmpDir);
  removeDir(finalDir);

  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'public'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });

  const vars = {
    APP_NAME: tenant.name,
    SLUG: tenant.slug,
    VERSION: tenant.version || '1.0.0',
    TENANT_ID: tenant.id,
    LOGO_TEXT: tenant.theme.logoText,
    LAYOUT: tenant.theme.layout,
    PRIMARY_COLOR: tenant.theme.primaryColor,
    ACCENT_COLOR: tenant.theme.accentColor,
    FONT_FAMILY: tenant.theme.fontFamily || 'system-ui, sans-serif',
    STAGE: tenant.environment.stage,
    LOG_LEVEL: tenant.environment.logLevel,
    PORT: port,
  };

  const appConfig = {
    ...tenant,
    runtime: { appName, port, generatedAt: new Date().toISOString() },
  };

  const writes = [
    ['package.json', render(loadTemplate('package.json.tpl'), vars)],
    ['.env', render(loadTemplate('env.tpl'), vars)],
    ['README.md', render(loadTemplate('readme.tpl'), vars)],
    ['build.js', render(loadTemplate('build.js.tpl'), vars)],
    [path.join('src', 'server.js'), render(loadTemplate('data-server.js.tpl'), vars)],
    [path.join('src', 'config.js'), loadTemplate('config.js.tpl')],
    [path.join('config', 'app.config.json'), JSON.stringify(appConfig, null, 2)],
    [path.join('public', 'index.html'), render(loadTemplate('data-index.html.tpl'), vars)],
    [path.join('public', 'styles.css'), render(loadTemplate('data-styles.css.tpl'), vars)],
    [path.join('public', 'app.js'), loadTemplate('data-app.js.tpl')],
  ];

  for (const [relativePath, content] of writes) {
    fs.writeFileSync(path.join(tmpDir, relativePath), content);
  }
  // Bundle this app's own slice of the dataset.
  fs.copyFileSync(dataChunkPath, path.join(tmpDir, 'data', 'records.json'));

  fs.renameSync(tmpDir, finalDir);

  logger.info(SCOPE, `Generated independent data app ${appName}`, {
    tenantId: tenant.id,
    appDir: finalDir,
    port,
  });

  return { appName, appDir: finalDir, port, tenantId: tenant.id, fileCount: writes.length + 1 };
}

/**
 * Verify a generated project contains every required file and a valid config.
 * @param {string} appDir absolute path to the generated app
 * @returns {{ ok: boolean, missing: string[] }}
 */
function verify(appDir) {
  const missing = VERIFY_FILES.filter(
    (relativePath) => !fs.existsSync(path.join(appDir, relativePath)),
  );
  if (missing.length === 0) {
    try {
      JSON.parse(fs.readFileSync(path.join(appDir, 'config', 'app.config.json'), 'utf8'));
    } catch (err) {
      return { ok: false, missing: [`config/app.config.json (invalid JSON: ${err.message})`] };
    }
  }
  return { ok: missing.length === 0, missing };
}

module.exports = { generate, generateDataApp, verify, render, portForIndex };
