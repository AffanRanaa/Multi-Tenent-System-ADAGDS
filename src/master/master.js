'use strict';

const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const logger = require('../common/logger');
const { loadTenants, loadSystemConfig } = require('../common/config-loader');
const { clamp } = require('../resource/decision-engine');
const FaultManager = require('./fault-manager');
const Coordinator = require('./coordinator');
const DashboardServer = require('./dashboard-server');
const deployer = require('./deployer');
const {
  MASTER_PORT,
  WORKER_BASE_PORT,
  MIN_WORKERS,
  MAX_WORKERS,
} = require('../constants');

const SCOPE = 'master';
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const INITIAL_SNAPSHOT_DELAY_MS = 2500;

/** Decide how many worker nodes to spawn (Requirement 3). */
function resolveWorkerCount(systemConfig) {
  const configured = systemConfig.worker && systemConfig.worker.count;
  if (typeof configured === 'number') {
    return clamp(configured, MIN_WORKERS, MAX_WORKERS);
  }
  const byCpu = Math.max(os.cpus().length - 1, MIN_WORKERS);
  return Math.min(byCpu, MAX_WORKERS);
}

/** Spawn one worker node as an independent child process. */
function spawnWorker(index, { outputRoot, logsDir, faultManager }) {
  const workerId = `worker-${index + 1}`;
  const workerPort = WORKER_BASE_PORT + index;

  const child = spawn(
    process.execPath,
    [path.join(__dirname, '..', 'worker', 'worker.js')],
    {
      env: {
        ...process.env,
        WORKER_ID: workerId,
        WORKER_PORT: String(workerPort),
        MASTER_HOST: '127.0.0.1',
        MASTER_PORT: String(MASTER_PORT),
        OUTPUT_ROOT: outputRoot,
        LOG_DIR: logsDir,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  faultManager.attachChild(workerId, { child, host: '127.0.0.1', port: workerPort });
  child.on('exit', (code) => {
    logger.warn(SCOPE, `Worker process ${workerId} exited`, { code });
    faultManager.markDead(workerId, `process exited (code ${code})`);
  });
  logger.info(SCOPE, `Spawned ${workerId} on port ${workerPort}`);
}

/** Drain workers, deployed apps and servers cleanly on exit. */
function installShutdownHandlers({ faultManager, dashboard }) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn(SCOPE, `Received ${signal} — shutting down ADAGDS`);
    deployer.shutdownAll();
    for (const worker of faultManager.workers.values()) {
      if (worker.child) worker.child.kill('SIGTERM');
    }
    faultManager.stopMonitor();
    dashboard.stop();
    setTimeout(() => process.exit(0), 300);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error(SCOPE, 'Uncaught exception in master', { error: err.message });
  });
  process.on('unhandledRejection', (err) => {
    logger.error(SCOPE, 'Unhandled rejection in master', { error: String(err) });
  });
}

async function main() {
  const logsDir = path.join(PROJECT_ROOT, 'logs');
  const outputRoot = path.join(PROJECT_ROOT, 'output');
  logger.configure(logsDir, 'master.log');
  logger.info(SCOPE, 'ADAGDS master node starting');

  const systemConfig = loadSystemConfig(path.join(PROJECT_ROOT, 'config', 'system.json'));
  const tenants = loadTenants(path.join(PROJECT_ROOT, 'config', 'tenants'));
  logger.info(SCOPE, `Loaded ${tenants.length} tenant configuration(s)`);

  const faultManager = new FaultManager();
  const coordinator = new Coordinator({
    faultManager,
    tenants,
    systemConfig,
    outputRoot,
    projectRoot: PROJECT_ROOT,
  });
  const dashboard = new DashboardServer({
    coordinator,
    faultManager,
    port: MASTER_PORT,
    projectRoot: PROJECT_ROOT,
  });

  dashboard.start();
  faultManager.startMonitor();
  installShutdownHandlers({ faultManager, dashboard });

  const workerCount = resolveWorkerCount(systemConfig);
  logger.decision(SCOPE, `Spawning ${workerCount} worker node process(es)`, {
    cpuCores: os.cpus().length,
  });
  for (let index = 0; index < workerCount; index += 1) {
    spawnWorker(index, { outputRoot, logsDir, faultManager });
  }

  // Populate an initial resource snapshot for the dashboard once workers boot.
  setTimeout(() => {
    coordinator.refreshSnapshot().catch((err) => {
      logger.warn(SCOPE, 'Initial snapshot failed', { error: err.message });
    });
  }, INITIAL_SNAPSHOT_DELAY_MS);

  logger.info(SCOPE, `ADAGDS ready — open the dashboard at http://localhost:${MASTER_PORT}`);
}

main().catch((err) => {
  logger.error(SCOPE, 'Master failed to start', { error: err.message });
  process.exit(1);
});
