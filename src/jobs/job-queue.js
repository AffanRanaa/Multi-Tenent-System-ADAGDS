'use strict';

const fs = require('fs');
const path = require('path');
const { JOB_STATE } = require('../constants');
const logger = require('../common/logger');

const SCOPE = 'job-queue';

// States in which a job still represents outstanding work.
const ACTIVE_STATES = [JOB_STATE.PENDING, JOB_STATE.ASSIGNED, JOB_STATE.IN_PROGRESS];

/**
 * Job queue with full lifecycle tracking and crash-safe persistence.
 *
 * Every state change is flushed to disk so an interrupted run can be inspected
 * and recovered — this is the "no job loss" guarantee of Requirement 11.
 */
class JobQueue {
  /**
   * @param {string|null} [persistPath] absolute path to the state file
   */
  constructor(persistPath = null) {
    this.jobs = [];
    this.persistPath = persistPath;
  }

  /** Register all jobs for this run. */
  addJobs(jobs) {
    this.jobs.push(...jobs);
    this.commit();
  }

  /** Next pending job in FIFO order, or null when none are waiting. */
  nextPending() {
    return this.jobs.find((job) => job.state === JOB_STATE.PENDING) || null;
  }

  /** All jobs currently in the given state. */
  byState(state) {
    return this.jobs.filter((job) => job.state === state);
  }

  /** True once no job is pending, assigned, or in progress. */
  isDrained() {
    return !this.jobs.some((job) => ACTIVE_STATES.includes(job.state));
  }

  /** Aggregate counts per state — used by the dashboard and final report. */
  stats() {
    const counts = {};
    for (const state of Object.values(JOB_STATE)) {
      counts[state] = this.byState(state).length;
    }
    return { total: this.jobs.length, ...counts };
  }

  /** Plain-object view of every job. */
  snapshot() {
    return this.jobs.map((job) => job.toJSON());
  }

  /** Flush the current state to disk. Call after any externally-driven change. */
  commit() {
    if (!this.persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(
        this.persistPath,
        JSON.stringify({ savedAt: new Date().toISOString(), jobs: this.snapshot() }, null, 2),
      );
    } catch (err) {
      logger.error(SCOPE, 'Failed to persist job queue state', { error: err.message });
    }
  }
}

module.exports = JobQueue;
