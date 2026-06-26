'use strict';

const { WORKER_STATE } = require('../constants');
const logger = require('../common/logger');

const SCOPE = 'scheduler';

/**
 * Resource-Aware Scheduling System (Requirement 7).
 * Decides the optimal parallel execution level and selects workers for jobs.
 */

/**
 * Compute the optimal number of builds to run concurrently.
 * Bounded by the work available, the live worker pool, and (cores - 1) so the
 * master/coordinator always retains a core.
 *
 * @param {object} snapshot resource snapshot
 * @param {number} decidedApps number of apps to generate
 * @param {number} workerCount number of live workers
 * @returns {number} parallelism level (>= 1)
 */
function computeParallelism(snapshot, decidedApps, workerCount) {
  const cpuBound = Math.max(snapshot.cpuCores - 1, 1);
  const parallelism = Math.max(1, Math.min(decidedApps, workerCount, cpuBound));
  logger.info(SCOPE, `Optimal parallel execution level = ${parallelism}`, {
    decidedApps,
    workerCount,
    cpuBound,
  });
  return parallelism;
}

/**
 * Pick the next idle worker for a job. Returns null when every worker is busy.
 * @param {object[]} workers worker descriptors carrying a `state` field
 * @returns {object|null}
 */
function pickIdleWorker(workers) {
  return workers.find((worker) => worker.state === WORKER_STATE.IDLE) || null;
}

module.exports = { computeParallelism, pickIdleWorker };
