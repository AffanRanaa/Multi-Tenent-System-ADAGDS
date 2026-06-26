'use strict';

const os = require('os');
const logger = require('../common/logger');

const SCOPE = 'resource-analyzer';
const BYTES_PER_GB = 1024 ** 3;

// systeminformation is loaded defensively: cross-platform CPU load and GPU
// detection are valuable but optional (Requirement 7). If the package is
// missing the analyzer degrades gracefully instead of crashing.
let si = null;
try {
  si = require('systeminformation');
} catch (err) {
  logger.warn(SCOPE, 'systeminformation unavailable — GPU/load detection limited', {
    error: err.message,
  });
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Read the current CPU load percentage.
 * Uses systeminformation because os.loadavg() always reports 0 on Windows.
 * @returns {Promise<number>} load percentage in the range 0-100
 */
async function readCpuLoadPct() {
  if (!si) return 0;
  try {
    const load = await si.currentLoad();
    return round(load.currentLoad || 0);
  } catch (err) {
    logger.warn(SCOPE, 'CPU load read failed — assuming 0%', { error: err.message });
    return 0;
  }
}

/**
 * Detect a GPU. Optional per Requirement 7 — absence is not an error.
 * @returns {Promise<object>} { detected, model, vramMB }
 */
async function detectGpu() {
  if (!si) return { detected: false, model: null, vramMB: null };
  try {
    const graphics = await si.graphics();
    const controller = (graphics.controllers || []).find((c) => c.model);
    if (!controller) return { detected: false, model: null, vramMB: null };
    return { detected: true, model: controller.model, vramMB: controller.vram || null };
  } catch (err) {
    logger.warn(SCOPE, 'GPU detection failed', { error: err.message });
    return { detected: false, model: null, vramMB: null };
  }
}

/**
 * Produce a full resource snapshot consumed by the decision engine and scheduler.
 *
 * @param {object} [options]
 * @param {number} [options.healthyWorkers=0] count of live worker nodes
 * @param {object} [options.systemConfig={}] parsed system.json
 * @returns {Promise<object>} resource snapshot
 */
async function analyze({ healthyWorkers = 0, systemConfig = {} } = {}) {
  // Demo hook: forceLowResources lets the adaptive engine be shown reducing load.
  if (systemConfig.forceLowResources) {
    const sim = systemConfig.simulatedLowResources || {};
    const snapshot = {
      simulated: true,
      cpuCores: sim.cpuCores || 2,
      cpuLoadPct: sim.cpuLoadPct || 90,
      totalMemGB: round((sim.freeMemGB || 1) * 2),
      freeMemGB: round(sim.freeMemGB || 1),
      gpu: { detected: false, model: null, vramMB: null },
      healthyWorkers,
      capturedAt: new Date().toISOString(),
    };
    logger.warn(SCOPE, 'forceLowResources enabled — using simulated low-resource snapshot', snapshot);
    return snapshot;
  }

  const [cpuLoadPct, gpu] = await Promise.all([readCpuLoadPct(), detectGpu()]);
  const snapshot = {
    simulated: false,
    cpuCores: os.cpus().length,
    cpuLoadPct,
    totalMemGB: round(os.totalmem() / BYTES_PER_GB),
    freeMemGB: round(os.freemem() / BYTES_PER_GB),
    gpu,
    healthyWorkers,
    capturedAt: new Date().toISOString(),
  };
  logger.info(SCOPE, 'Resource snapshot captured', snapshot);
  return snapshot;
}

module.exports = { analyze, readCpuLoadPct, detectGpu };
