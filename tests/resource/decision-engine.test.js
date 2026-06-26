'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { decideAppCount, clamp } = require('../../src/resource/decision-engine');

/** Build a resource snapshot with sensible defaults. */
function snapshot(overrides = {}) {
  return {
    simulated: false,
    cpuCores: 8,
    cpuLoadPct: 20,
    totalMemGB: 16,
    freeMemGB: 12,
    gpu: { detected: false },
    healthyWorkers: 4,
    ...overrides,
  };
}

test('clamp keeps a value within the inclusive range', () => {
  assert.strictEqual(clamp(5, 1, 10), 5);
  assert.strictEqual(clamp(-3, 1, 10), 1);
  assert.strictEqual(clamp(99, 1, 10), 10);
});

test('decides the tenant count when resources are abundant', () => {
  const result = decideAppCount(
    snapshot({ freeMemGB: 64, cpuCores: 32, healthyWorkers: 8 }),
    15,
  );
  assert.strictEqual(result.decided, 15);
  assert.strictEqual(result.bindingConstraint, 'requested');
});

test('honours an explicit requested app count', () => {
  const result = decideAppCount(
    snapshot({ freeMemGB: 64, cpuCores: 32, healthyWorkers: 8 }),
    15,
    5,
  );
  assert.strictEqual(result.decided, 5);
  assert.strictEqual(result.manualMode, true);
  assert.strictEqual(result.bindingConstraint, 'requested');
});

test('an explicit count is still capped by MAX_APPS and resources', () => {
  const result = decideAppCount(
    snapshot({ freeMemGB: 256, cpuCores: 64, healthyWorkers: 20 }),
    15,
    99,
  );
  assert.strictEqual(result.decided, 20);
});

test('never exceeds the MAX_APPS ceiling of 20', () => {
  const result = decideAppCount(
    snapshot({ freeMemGB: 256, cpuCores: 64, healthyWorkers: 20 }),
    50,
  );
  assert.strictEqual(result.decided, 20);
});

test('memory becomes the binding constraint when free memory is scarce', () => {
  // freeMemGB 1.2 / PER_APP_MEM_GB 0.4 = 3
  const result = decideAppCount(snapshot({ freeMemGB: 1.2 }), 15);
  assert.strictEqual(result.limits.maxByMemory, 3);
  assert.strictEqual(result.decided, 3);
  assert.strictEqual(result.bindingConstraint, 'maxByMemory');
});

test('high CPU load halves the planned workload', () => {
  const normal = decideAppCount(snapshot({ cpuLoadPct: 10 }), 15);
  const loaded = decideAppCount(snapshot({ cpuLoadPct: 95 }), 15);
  assert.strictEqual(loaded.highLoad, true);
  assert.ok(loaded.decided < normal.decided);
});

test('always builds at least one app, even with zero workers', () => {
  const result = decideAppCount(snapshot({ healthyWorkers: 0 }), 15);
  assert.strictEqual(result.limits.maxByWorkers, 0);
  assert.strictEqual(result.decided, 1);
});

test('result carries human-readable reasoning for monitoring', () => {
  const result = decideAppCount(snapshot(), 15);
  assert.match(result.reasoning, /Decided to generate/);
});
