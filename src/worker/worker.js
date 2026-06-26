'use strict';

const express = require('express');
const path = require('path');
const os = require('os');
const logger = require('../common/logger');
const { requestJson } = require('../common/messaging');
const appEngine = require('../engine/app-engine');
const { HEARTBEAT_MS, MASTER_PORT } = require('../constants');

const SCOPE = 'worker';

// --- Configuration from environment (set by the master when it spawns a worker,
// or by the operator when running `npm run start:worker` as a real node) ---
const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const WORKER_PORT = Number(process.env.WORKER_PORT || 5001);
const MASTER_HOST = process.env.MASTER_HOST || '127.0.0.1';
const MASTER_PORT_RESOLVED = Number(process.env.MASTER_PORT || MASTER_PORT);
const OUTPUT_ROOT = process.env.OUTPUT_ROOT || path.join(process.cwd(), 'output');
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

logger.configure(LOG_DIR, `${WORKER_ID}.log`);

let jobsCompleted = 0;
let jobsFailed = 0;
let busy = false;

/** Fire-and-forget report to the master; never throws (master owns retries). */
function reportToMaster(pathName, body) {
  return requestJson({
    host: MASTER_HOST,
    port: MASTER_PORT_RESOLVED,
    path: pathName,
    method: 'POST',
    body,
  }).catch((err) => {
    logger.warn(SCOPE, `Could not reach master at ${pathName}`, { error: err.message });
  });
}

/**
 * Execute one build job, then report success or failure to the master.
 * Failures are reported (not thrown) — the master decides whether to retry.
 */
async function processJob(job, outputRoot) {
  busy = true;
  logger.info(SCOPE, `Processing ${job.id} for tenant ${job.tenant.id}`, {
    appIndex: job.appIndex,
  });
  try {
    const result = job.dataChunkPath
      ? appEngine.buildDataApp(job.tenant, {
        outputRoot,
        appIndex: job.appIndex,
        dataChunkPath: job.dataChunkPath,
      })
      : appEngine.buildApp(job.tenant, { outputRoot, appIndex: job.appIndex });
    jobsCompleted += 1;
    await reportToMaster('/api/worker/report', {
      workerId: WORKER_ID,
      jobId: job.id,
      ok: true,
      result,
    });
  } catch (err) {
    jobsFailed += 1;
    logger.error(SCOPE, `Build failed for ${job.id}`, { error: err.message });
    await reportToMaster('/api/worker/report', {
      workerId: WORKER_ID,
      jobId: job.id,
      ok: false,
      error: err.message,
    });
  } finally {
    busy = false;
  }
}

/** Periodically tell the master this worker is alive (Requirement 11). */
function startHeartbeat() {
  setInterval(() => {
    reportToMaster('/api/worker/heartbeat', {
      workerId: WORKER_ID,
      host: '127.0.0.1',
      port: WORKER_PORT,
      busy,
      jobsCompleted,
      jobsFailed,
      memRssMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    });
  }, HEARTBEAT_MS).unref();
}

function buildApp_() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({ workerId: WORKER_ID, busy, jobsCompleted, jobsFailed });
  });

  // Accept a job: acknowledge immediately, then build asynchronously.
  app.post('/job', (req, res) => {
    const { job, outputRoot } = req.body || {};
    if (!job || !job.tenant) {
      res.status(400).json({ accepted: false, error: 'Invalid job payload' });
      return;
    }
    res.json({ accepted: true, workerId: WORKER_ID, jobId: job.id });
    processJob(job, outputRoot || OUTPUT_ROOT);
  });

  // Graceful shutdown — used by clean teardown and fault simulation.
  app.post('/shutdown', (req, res) => {
    logger.warn(SCOPE, `Shutdown requested for ${WORKER_ID}`);
    res.json({ stopping: true });
    setTimeout(() => process.exit(0), 100);
  });

  return app;
}

function start() {
  const app = buildApp_();
  app.listen(WORKER_PORT, async () => {
    logger.info(SCOPE, `${WORKER_ID} listening on port ${WORKER_PORT}`);
    await reportToMaster('/api/worker/register', {
      workerId: WORKER_ID,
      host: '127.0.0.1',
      port: WORKER_PORT,
      cpuCores: os.cpus().length,
    });
    startHeartbeat();
  });
}

process.on('uncaughtException', (err) => {
  logger.error(SCOPE, 'Uncaught exception in worker', { error: err.message });
});
process.on('unhandledRejection', (err) => {
  logger.error(SCOPE, 'Unhandled rejection in worker', { error: String(err) });
});

start();
