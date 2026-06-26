'use strict';

const {
  MIN_APPS,
  MAX_APPS,
  PER_APP_MEM_GB,
  CPU_APPS_PER_CORE,
  APPS_PER_WORKER,
  HIGH_LOAD_PCT,
} = require('../constants');
const logger = require('../common/logger');

const SCOPE = 'decision-engine';

// Guards integer division against floating-point error (e.g. 1.2 / 0.4 = 2.999…).
const FLOAT_EPSILON = 1e-9;

/** Clamp a value into an inclusive range. */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Adaptive Workload Decision Engine (Requirement 8).
 *
 * Decides how many applications to generate by taking the smallest ceiling
 * across every resource dimension, applying CPU-load back-pressure, and
 * clamping into the allowed [MIN_APPS, MAX_APPS] range. Deterministic given
 * its inputs, which keeps it fully unit-testable.
 *
 * @param {object} snapshot resource snapshot from the analyzer
 * @param {number} tenantCount number of available tenant configs
 * @param {number|null} [requestedCount] explicit app count from system.json
 *        ("appCount"); when omitted the system auto-decides from tenantCount
 * @returns {object} { decided, inputs, limits, highLoad, bindingConstraint, reasoning }
 */
function decideAppCount(snapshot, tenantCount, requestedCount = null) {
  const maxByMemory = Math.floor(snapshot.freeMemGB / PER_APP_MEM_GB + FLOAT_EPSILON);
  const maxByCpu = Math.floor(snapshot.cpuCores * CPU_APPS_PER_CORE);
  const maxByWorkers = Math.max(snapshot.healthyWorkers, 0) * APPS_PER_WORKER;

  // "requested" is the demand: an explicit appCount when set, otherwise the
  // number of available tenant configs (fully automatic mode).
  const manualMode = typeof requestedCount === 'number' && requestedCount > 0;
  const requested = manualMode ? requestedCount : tenantCount;

  const limits = { maxByMemory, maxByCpu, maxByWorkers, requested };

  // The binding constraint is the smallest ceiling across demand and resources.
  let candidate = Math.min(maxByMemory, maxByCpu, maxByWorkers, requested);

  // High CPU load is a back-pressure signal — halve the planned workload.
  const highLoad = snapshot.cpuLoadPct > HIGH_LOAD_PCT;
  if (highLoad) {
    candidate = Math.floor(candidate / 2);
  }

  const decided = clamp(candidate, MIN_APPS, MAX_APPS);

  const bindingConstraint = Object.entries(limits)
    .reduce((min, [key, value]) => (value < min.value ? { key, value } : min), {
      key: 'none',
      value: Infinity,
    }).key;

  const reasoning =
    `Decided to generate ${decided} application(s) ` +
    `[${manualMode ? 'manual appCount' : 'auto'} mode]. ` +
    `Ceilings -> memory:${maxByMemory}, cpu:${maxByCpu}, ` +
    `workers:${maxByWorkers}, requested:${requested}. ` +
    `Binding constraint: ${bindingConstraint}. ` +
    (highLoad
      ? `CPU load ${snapshot.cpuLoadPct}% exceeds ${HIGH_LOAD_PCT}% -> workload halved. `
      : '') +
    `Result clamped to [${MIN_APPS}, ${MAX_APPS}].`;

  const result = {
    decided,
    manualMode,
    inputs: { tenantCount, requestedCount, ...snapshot },
    limits,
    highLoad,
    bindingConstraint,
    reasoning,
  };

  logger.decision(SCOPE, reasoning, { decided, limits, highLoad });
  return result;
}

module.exports = { decideAppCount, clamp };
