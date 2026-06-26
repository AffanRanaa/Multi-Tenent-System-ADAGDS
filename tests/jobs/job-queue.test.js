'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Job = require('../../src/jobs/job');
const JobQueue = require('../../src/jobs/job-queue');
const { JOB_STATE } = require('../../src/constants');

function fakeTenant(id) {
  return {
    id,
    name: id,
    slug: id,
    features: {},
    environment: {},
    dataSource: {},
    theme: {},
  };
}

test('addJobs registers jobs and reports aggregate stats', () => {
  const queue = new JobQueue();
  queue.addJobs([
    new Job({ tenant: fakeTenant('t1'), appIndex: 1 }),
    new Job({ tenant: fakeTenant('t2'), appIndex: 2 }),
  ]);
  const stats = queue.stats();
  assert.strictEqual(stats.total, 2);
  assert.strictEqual(stats.pending, 2);
});

test('nextPending returns jobs in FIFO order', () => {
  const queue = new JobQueue();
  const first = new Job({ tenant: fakeTenant('a'), appIndex: 1 });
  const second = new Job({ tenant: fakeTenant('b'), appIndex: 2 });
  queue.addJobs([first, second]);
  assert.strictEqual(queue.nextPending(), first);
  first.markAssigned('worker-1');
  assert.strictEqual(queue.nextPending(), second);
});

test('isDrained is false while work remains and true when all jobs are terminal', () => {
  const queue = new JobQueue();
  const job = new Job({ tenant: fakeTenant('x'), appIndex: 1 });
  queue.addJobs([job]);
  assert.strictEqual(queue.isDrained(), false);
  job.markAssigned('w1');
  assert.strictEqual(queue.isDrained(), false);
  job.markCompleted({ ok: true });
  assert.strictEqual(queue.isDrained(), true);
});

test('a failed job still counts the queue as drained', () => {
  const queue = new JobQueue();
  const job = new Job({ tenant: fakeTenant('x'), appIndex: 1 });
  queue.addJobs([job]);
  job.markAssigned('w1');
  job.markFailed('boom');
  assert.strictEqual(queue.isDrained(), true);
  assert.strictEqual(queue.stats().failed, 1);
});

test('resetForRetry returns a job to pending without losing attempt count', () => {
  const job = new Job({ tenant: fakeTenant('x'), appIndex: 1 });
  job.markAssigned('w1');
  assert.strictEqual(job.attempts, 1);
  job.resetForRetry();
  assert.strictEqual(job.state, JOB_STATE.PENDING);
  assert.strictEqual(job.attempts, 1);
});

test('persists queue state to disk when a path is configured (no job loss)', () => {
  const file = path.join(os.tmpdir(), `adagds-queue-${Date.now()}.json`);
  const queue = new JobQueue(file);
  queue.addJobs([new Job({ tenant: fakeTenant('x'), appIndex: 1 })]);
  assert.strictEqual(fs.existsSync(file), true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(saved.jobs.length, 1);
  fs.rmSync(file, { force: true });
});
