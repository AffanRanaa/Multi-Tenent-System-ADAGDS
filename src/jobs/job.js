'use strict';

const { JOB_STATE } = require('../constants');

let sequence = 0;

/**
 * A single build job: generate one independent application for one tenant.
 *
 * Carries everything a worker needs (tenant, appIndex) plus the bookkeeping the
 * coordinator and fault manager rely on (attempts, timing, assigned worker).
 */
class Job {
  /**
   * @param {object} params
   * @param {object} params.tenant validated tenant spec
   * @param {number} params.appIndex 1-based application index
   */
  constructor({ tenant, appIndex }) {
    sequence += 1;
    this.id = `job-${String(sequence).padStart(3, '0')}`;
    this.tenant = tenant;
    this.appIndex = appIndex;
    this.appName = `app${appIndex}`;
    this.state = JOB_STATE.PENDING;
    this.attempts = 0;
    this.workerId = null;
    this.result = null;
    this.error = null;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.finishedAt = null;
    // Set only for dataset-split jobs: path to this app's slice of the dataset.
    this.dataChunkPath = null;
    this.recordCount = null;
  }

  markAssigned(workerId) {
    this.state = JOB_STATE.ASSIGNED;
    this.workerId = workerId;
    this.attempts += 1;
    this.startedAt = Date.now();
  }

  markInProgress() {
    this.state = JOB_STATE.IN_PROGRESS;
  }

  markCompleted(result) {
    this.state = JOB_STATE.COMPLETED;
    this.result = result;
    this.finishedAt = Date.now();
  }

  markFailed(error) {
    this.state = JOB_STATE.FAILED;
    this.error = error;
    this.finishedAt = Date.now();
  }

  /** Return the job to the queue so it can be retried by another worker. */
  resetForRetry() {
    this.state = JOB_STATE.PENDING;
    this.workerId = null;
    this.startedAt = null;
  }

  durationMs() {
    if (!this.startedAt) return 0;
    return (this.finishedAt || Date.now()) - this.startedAt;
  }

  /** Plain-object snapshot for persistence and the dashboard. */
  toJSON() {
    return {
      id: this.id,
      tenantId: this.tenant.id,
      appName: this.appName,
      appIndex: this.appIndex,
      state: this.state,
      attempts: this.attempts,
      workerId: this.workerId,
      error: this.error,
      recordCount: this.recordCount,
      durationMs: this.durationMs(),
      result: this.result,
    };
  }
}

module.exports = Job;
