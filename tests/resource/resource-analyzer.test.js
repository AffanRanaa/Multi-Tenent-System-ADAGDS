'use strict';

const test = require('node:test');
const assert = require('node:assert');
const analyzer = require('../../src/resource/resource-analyzer');

test('forceLowResources yields a deterministic simulated snapshot', async () => {
  const systemConfig = {
    forceLowResources: true,
    simulatedLowResources: { cpuCores: 2, cpuLoadPct: 93, freeMemGB: 0.8 },
  };
  const snap = await analyzer.analyze({ healthyWorkers: 3, systemConfig });
  assert.strictEqual(snap.simulated, true);
  assert.strictEqual(snap.cpuCores, 2);
  assert.strictEqual(snap.cpuLoadPct, 93);
  assert.strictEqual(snap.freeMemGB, 0.8);
  assert.strictEqual(snap.healthyWorkers, 3);
});

test('live analyze returns a complete numeric snapshot', async () => {
  const snap = await analyzer.analyze({ healthyWorkers: 0, systemConfig: {} });
  assert.strictEqual(snap.simulated, false);
  assert.ok(snap.cpuCores >= 1);
  assert.strictEqual(typeof snap.cpuLoadPct, 'number');
  assert.ok(snap.totalMemGB > 0);
  assert.strictEqual(typeof snap.freeMemGB, 'number');
  assert.ok(snap.gpu && typeof snap.gpu.detected === 'boolean');
});
