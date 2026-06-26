'use strict';

const EventEmitter = require('events');
const {
  WORKER_STATE,
  HEARTBEAT_MS,
  HEARTBEAT_CHECK_MS,
  MAX_MISSED_HEARTBEATS,
} = require('../constants');
const logger = require('../common/logger');
const { requestJson } = require('../common/messaging');

const SCOPE = 'fault-manager';
const DEAD_AFTER_MS = HEARTBEAT_MS * MAX_MISSED_HEARTBEATS;

/**
 * Fault Tolerance System (Requirement 11).
 *
 * Owns the worker registry and worker liveness. Detects dead workers two ways —
 * missed heartbeats and child-process exit — and emits 'worker-dead' so the
 * coordinator can re-queue any job the worker was holding (no job loss).
 */
class FaultManager extends EventEmitter {
  constructor() {
    super();
    this.workers = new Map();
    this.faultEvents = [];
    this._monitor = null;
  }

  /** Pre-register a worker with its child-process handle, before it boots. */
  attachChild(workerId, { child, host, port }) {
    this.workers.set(workerId, {
      id: workerId,
      host,
      port,
      child,
      state: WORKER_STATE.STARTING,
      lastBeatAt: Date.now(),
      currentJobId: null,
      jobsCompleted: 0,
      jobsFailed: 0,
      memRssMB: 0,
    });
  }

  /** Worker confirmed it is listening (HTTP /api/worker/register). */
  registerWorker({ workerId, host, port }) {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.host = host || worker.host;
      worker.port = port || worker.port;
      if (worker.state === WORKER_STATE.STARTING) worker.state = WORKER_STATE.IDLE;
      worker.lastBeatAt = Date.now();
    } else {
      // A worker we did not spawn (e.g. a real remote node) — accept it.
      this.workers.set(workerId, {
        id: workerId,
        host,
        port,
        child: null,
        state: WORKER_STATE.IDLE,
        lastBeatAt: Date.now(),
        currentJobId: null,
        jobsCompleted: 0,
        jobsFailed: 0,
        memRssMB: 0,
      });
    }
    logger.info(SCOPE, `Worker registered: ${workerId}`, { host, port });
    this.emit('change');
  }

  /** Record a heartbeat, auto-registering an unknown worker defensively. */
  recordHeartbeat(beat) {
    let worker = this.workers.get(beat.workerId);
    if (!worker) {
      this.registerWorker(beat);
      worker = this.workers.get(beat.workerId);
    }
    if (worker.state === WORKER_STATE.DEAD) return;
    worker.lastBeatAt = Date.now();
    if (typeof beat.jobsCompleted === 'number') worker.jobsCompleted = beat.jobsCompleted;
    if (typeof beat.jobsFailed === 'number') worker.jobsFailed = beat.jobsFailed;
    if (typeof beat.memRssMB === 'number') worker.memRssMB = beat.memRssMB;
    if (worker.state === WORKER_STATE.STARTING) worker.state = WORKER_STATE.IDLE;
  }

  markBusy(workerId, jobId) {
    const worker = this.workers.get(workerId);
    if (worker && worker.state !== WORKER_STATE.DEAD) {
      worker.state = WORKER_STATE.BUSY;
      worker.currentJobId = jobId;
      this.emit('change');
    }
  }

  markIdle(workerId) {
    const worker = this.workers.get(workerId);
    if (worker && worker.state !== WORKER_STATE.DEAD) {
      worker.state = WORKER_STATE.IDLE;
      worker.currentJobId = null;
      this.emit('change');
    }
  }

  markDead(workerId, reason) {
    const worker = this.workers.get(workerId);
    if (!worker || worker.state === WORKER_STATE.DEAD) return;
    const heldJob = worker.currentJobId;
    worker.state = WORKER_STATE.DEAD;
    worker.currentJobId = null;
    this.faultEvents.push({ ts: new Date().toISOString(), workerId, reason, heldJob });
    logger.warn(SCOPE, `Worker declared DEAD: ${workerId} (${reason})`, { heldJob });
    this.emit('worker-dead', { workerId, heldJob, reason });
    this.emit('change');
  }

  liveWorkers() {
    return [...this.workers.values()].filter((w) => w.state !== WORKER_STATE.DEAD);
  }

  idleWorkers() {
    return [...this.workers.values()].filter((w) => w.state === WORKER_STATE.IDLE);
  }

  healthyCount() {
    return this.liveWorkers().length;
  }

  /** Forcefully kill a worker — used by the dashboard fault-simulation button. */
  async killWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker || worker.state === WORKER_STATE.DEAD) return false;
    logger.warn(SCOPE, `Fault simulation: killing worker ${workerId}`);
    if (worker.child) {
      worker.child.kill('SIGKILL'); // the child 'exit' handler then calls markDead
    } else {
      await requestJson({ host: worker.host, port: worker.port, path: '/shutdown', method: 'POST' })
        .catch(() => { /* best effort */ });
      this.markDead(workerId, 'kill requested');
    }
    return true;
  }

  startMonitor() {
    if (this._monitor) return;
    this._monitor = setInterval(() => this._sweep(), HEARTBEAT_CHECK_MS);
    this._monitor.unref();
    logger.info(SCOPE, 'Heartbeat monitor started', { deadAfterMs: DEAD_AFTER_MS });
  }

  stopMonitor() {
    if (this._monitor) clearInterval(this._monitor);
    this._monitor = null;
  }

  _sweep() {
    const now = Date.now();
    for (const worker of this.workers.values()) {
      if (worker.state === WORKER_STATE.DEAD || worker.state === WORKER_STATE.STARTING) continue;
      if (now - worker.lastBeatAt > DEAD_AFTER_MS) {
        this.markDead(worker.id, `missed heartbeats for ${now - worker.lastBeatAt}ms`);
      }
    }
  }

  /** Plain-object view for the dashboard. */
  snapshot() {
    return {
      workers: [...this.workers.values()].map((w) => ({
        id: w.id,
        host: w.host,
        port: w.port,
        state: w.state,
        currentJobId: w.currentJobId,
        jobsCompleted: w.jobsCompleted,
        jobsFailed: w.jobsFailed,
        memRssMB: w.memRssMB,
      })),
      faultEvents: this.faultEvents.slice(-20),
    };
  }
}

module.exports = FaultManager;
