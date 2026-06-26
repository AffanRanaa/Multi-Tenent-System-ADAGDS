'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const Job = require('../jobs/job');
const JobQueue = require('../jobs/job-queue');
const { loadTenants, validateTenant } = require('../common/config-loader');
const { splitIntoChunks } = require('../common/chunker');
const appEngine = require('../engine/app-engine');
const analyzer = require('../resource/resource-analyzer');
const { decideAppCount } = require('../resource/decision-engine');
const { computeParallelism, pickIdleWorker } = require('../resource/scheduler');
const deployer = require('./deployer');
const logger = require('../common/logger');
const { requestJson } = require('../common/messaging');
const {
  PHASE,
  JOB_STATE,
  MAX_RETRIES,
  RETRY_BACKOFF_BASE_MS,
  GUARANTEED_MIN_BUILDS,
  DEFAULT_DATASET_APPS,
} = require('../constants');

const SCOPE = 'coordinator';

/**
 * Master coordinator — runs the full ADAGDS pipeline:
 * analyze -> decide -> schedule -> dispatch in parallel -> guarantee -> deploy.
 * Distributes build jobs across worker nodes and falls back to local builds
 * when no worker is available (Requirements 3, 4, 8, 9).
 */
class Coordinator extends EventEmitter {
  constructor({ faultManager, tenants, systemConfig, outputRoot, projectRoot }) {
    super();
    this.faultManager = faultManager;
    this.tenants = tenants;
    this.systemConfig = systemConfig;
    this.outputRoot = outputRoot;
    this.projectRoot = projectRoot;
    this.tenantsDir = path.join(projectRoot, 'config', 'tenants');
    this.queuePath = path.join(projectRoot, 'logs', 'queue-state.json');
    this.chunksDir = path.join(projectRoot, 'logs', 'chunks');
    this.dataset = null;

    this.phase = PHASE.IDLE;
    this.snapshot = null;
    this.decision = null;
    this.parallelism = 0;
    this.queue = new JobQueue(this.queuePath);
    this.deployments = [];
    this.inFlight = 0;
    this.running = false;
    this._requestedOverride = null;
    this._generationResolve = null;
    this._localDrainActive = false;

    this.faultManager.on('worker-dead', (event) => this._onWorkerDead(event));
  }

  // ---------------------------------------------------------------- public ---

  /** Capture a resource snapshot for pre-run display on the dashboard. */
  async refreshSnapshot() {
    this.snapshot = await analyzer.analyze({
      healthyWorkers: this.faultManager.healthyCount(),
      systemConfig: this.systemConfig,
    });
    this._emitState();
    return this.snapshot;
  }

  /**
   * Run the entire pipeline. Safe against accidental double invocation.
   * @param {object} [options]
   * @param {number|null} [options.requestedCount] explicit app count from the
   *        dashboard; overrides the `appCount` value in system.json for this run
   */
  async runPipeline({ requestedCount = null } = {}) {
    if (this.running) {
      logger.warn(SCOPE, 'Pipeline already running — ignoring duplicate start request');
      return;
    }
    this.running = true;
    this._requestedOverride =
      typeof requestedCount === 'number' && requestedCount > 0 ? requestedCount : null;

    // Each run starts from a clean slate so re-runs are fully independent.
    this.queue = new JobQueue(this.queuePath);
    this.deployments = [];
    this.inFlight = 0;
    this.decision = null;

    try {
      await this._analyzeAndDecide();
      await this._runGeneration();
      await this._enforceMinimumGuarantee();
      await this._deploy();
      this.phase = PHASE.DONE;
      logger.decision(SCOPE, 'ADAGDS run complete', this.queue.stats());
    } catch (err) {
      logger.error(SCOPE, 'Pipeline failed', { error: err.message });
    } finally {
      this.running = false;
      this._emitState();
    }
  }

  /** Full state object consumed by the dashboard. */
  getState() {
    const faults = this.faultManager.snapshot();
    return {
      phase: this.phase,
      running: this.running,
      tenantCount: this.tenants.length,
      snapshot: this.snapshot,
      decision: this.decision,
      parallelism: this.parallelism,
      jobs: this.queue.snapshot(),
      jobStats: this.queue.stats(),
      deployments: this.deployments,
      workers: faults.workers,
      faultEvents: faults.faultEvents,
      dataset: this.dataset,
    };
  }

  // -------------------------------------------------------- pipeline steps ---

  async _analyzeAndDecide() {
    this.phase = PHASE.ANALYZING;
    this._emitState();

    this.snapshot = await analyzer.analyze({
      healthyWorkers: this.faultManager.healthyCount(),
      systemConfig: this.systemConfig,
    });

    const jobs = this.dataset ? this._planDatasetJobs() : this._planTenantJobs();
    this.parallelism = computeParallelism(
      this.snapshot,
      jobs.length,
      Math.max(this.faultManager.healthyCount(), 1),
    );
    this.queue.addJobs(jobs);
    logger.decision(SCOPE, `Created ${jobs.length} build job(s)`, {
      parallelism: this.parallelism,
      mode: this.dataset ? 'dataset-split' : 'tenant-config',
    });
    this._emitState();
  }

  /** Plan jobs in normal tenant-config mode (one app per tenant config). */
  _planTenantJobs() {
    this.decision = decideAppCount(
      this.snapshot,
      this.tenants.length,
      this._resolveRequestedCount(),
    );
    // If more apps are requested than tenant configs exist, configs are reused
    // cyclically — each app is still its own independent project.
    const jobs = [];
    for (let index = 1; index <= this.decision.decided; index += 1) {
      const tenant = this.tenants[(index - 1) % this.tenants.length];
      jobs.push(new Job({ tenant, appIndex: index }));
    }
    return jobs;
  }

  /** Plan jobs in dataset mode: split the dataset across N independent apps. */
  _planDatasetJobs() {
    const requested = this._resolveRequestedCount();
    const demand = requested || DEFAULT_DATASET_APPS;
    this.decision = decideAppCount(this.snapshot, demand, requested);

    const records = JSON.parse(fs.readFileSync(this.dataset.path, 'utf8'));
    const chunks = splitIntoChunks(records, this.decision.decided);

    // Fresh staging area for this run's data slices.
    fs.rmSync(this.chunksDir, { recursive: true, force: true });
    fs.mkdirSync(this.chunksDir, { recursive: true });

    const jobs = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const appIndex = index + 1;
      const chunkPath = path.join(this.chunksDir, `chunk-${appIndex}.json`);
      fs.writeFileSync(chunkPath, JSON.stringify(chunks[index]));
      const job = new Job({
        tenant: this._datasetTenant(appIndex, chunks.length),
        appIndex,
      });
      job.dataChunkPath = chunkPath;
      job.recordCount = chunks[index].length;
      jobs.push(job);
    }
    logger.decision(
      SCOPE,
      `Dataset "${this.dataset.name}" (${records.length} records) `
        + `split across ${jobs.length} app(s)`,
    );
    return jobs;
  }

  /** Build a synthetic tenant spec for one dataset slice. */
  _datasetTenant(appIndex, totalApps) {
    const palette = [
      ['#4f46e5', '#06b6d4'], ['#059669', '#14b8a6'], ['#d97706', '#f59e0b'],
      ['#dc2626', '#f43f5e'], ['#7c3aed', '#a855f7'], ['#0284c7', '#38bdf8'],
      ['#db2777', '#ec4899'], ['#16a34a', '#34d399'],
    ];
    const [primaryColor, accentColor] = palette[(appIndex - 1) % palette.length];
    return {
      id: `dataset-app-${appIndex}`,
      name: `${this.dataset.name} — Part ${appIndex}/${totalApps}`,
      slug: `dataset-app-${appIndex}`,
      version: '1.0.0',
      features: { search: true, darkMode: true },
      environment: { stage: 'production', region: 'local', logLevel: 'info' },
      dataSource: { type: 'file', endpoint: 'data/records.json' },
      theme: {
        primaryColor,
        accentColor,
        layout: 'grid',
        fontFamily: 'Inter, system-ui, sans-serif',
        logoText: this.dataset.name.slice(0, 14),
      },
    };
  }

  /**
   * Resolve the requested app count: a dashboard override for this run takes
   * precedence, otherwise the `appCount` value from system.json.
   */
  _resolveRequestedCount() {
    if (typeof this._requestedOverride === 'number' && this._requestedOverride > 0) {
      return this._requestedOverride;
    }
    const value = this.systemConfig.appCount;
    return typeof value === 'number' && value > 0 ? value : null;
  }

  /**
   * Register a new tenant configuration uploaded from the dashboard.
   * Validates it, saves it into config/tenants/, and reloads the tenant list.
   * @param {object} tenant the uploaded tenant specification
   * @returns {object} { id, name, tenantCount }
   */
  addTenant(tenant) {
    validateTenant(tenant, 'uploaded configuration');
    if (this.tenants.some((existing) => existing.id === tenant.id)) {
      throw new Error(`A tenant with id "${tenant.id}" already exists`);
    }
    if (this.tenants.some((existing) => existing.slug === tenant.slug)) {
      throw new Error(`A tenant with slug "${tenant.slug}" already exists`);
    }
    const file = path.join(this.tenantsDir, `${tenant.slug}.json`);
    fs.writeFileSync(file, `${JSON.stringify(tenant, null, 2)}\n`);
    this.reloadTenants();
    logger.info(SCOPE, `Uploaded new tenant config: ${tenant.id} (${tenant.name})`);
    return { id: tenant.id, name: tenant.name, tenantCount: this.tenants.length };
  }

  /** Re-read every tenant config from disk and refresh the dashboard. */
  reloadTenants() {
    this.tenants = loadTenants(this.tenantsDir);
    this._emitState();
  }

  /**
   * Store an uploaded dataset. The next run splits it across N data apps.
   * @param {string} rawText the raw JSON file contents
   * @param {string} name original file name
   * @returns {object} { name, recordCount }
   */
  setDataset(rawText, name) {
    let records;
    try {
      records = JSON.parse(rawText);
    } catch (err) {
      throw new Error('Data file is not valid JSON');
    }
    if (!Array.isArray(records)) {
      throw new Error('Data file must be a JSON array of records');
    }
    if (records.length === 0) {
      throw new Error('Data file is empty');
    }
    const dataDir = path.join(this.projectRoot, 'config', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const datasetPath = path.join(dataDir, 'active-dataset.json');
    fs.writeFileSync(datasetPath, rawText);
    this.dataset = { name: name || 'dataset', recordCount: records.length, path: datasetPath };
    logger.decision(SCOPE, `Dataset loaded: ${this.dataset.name} (${records.length} records)`);
    this._emitState();
    return { name: this.dataset.name, recordCount: records.length };
  }

  /** Discard the active dataset — generation reverts to tenant-config mode. */
  clearDataset() {
    this.dataset = null;
    logger.info(SCOPE, 'Dataset cleared — reverted to tenant-config mode');
    this._emitState();
  }

  _runGeneration() {
    this.phase = PHASE.GENERATING;
    this._emitState();
    return new Promise((resolve) => {
      this._generationResolve = resolve;
      this._tick();
    });
  }

  /** Central scheduler: dispatch where possible, fall back to local builds. */
  _tick() {
    if (this.phase !== PHASE.GENERATING) return;

    if (this.queue.isDrained()) {
      const resolve = this._generationResolve;
      this._generationResolve = null;
      if (resolve) resolve();
      return;
    }

    this._dispatchToWorkers();

    const pendingCount = this.queue.byState(JOB_STATE.PENDING).length;
    if (pendingCount > 0 && this.faultManager.healthyCount() === 0 && this.inFlight === 0) {
      logger.warn(SCOPE, 'No live workers available — falling back to local builds');
      this._drainLocally();
    }
  }

  _dispatchToWorkers() {
    while (this.inFlight < this.parallelism) {
      const job = this.queue.nextPending();
      if (!job) break;
      const worker = pickIdleWorker(this.faultManager.idleWorkers());
      if (!worker) break;
      this._assign(job, worker);
    }
  }

  _assign(job, worker) {
    job.markAssigned(worker.id);
    this.faultManager.markBusy(worker.id, job.id);
    this.inFlight += 1;
    this.queue.commit();
    logger.info(SCOPE, `Dispatched ${job.id} -> ${worker.id}`, { appName: job.appName });
    this._emitState();

    requestJson({
      host: worker.host,
      port: worker.port,
      path: '/job',
      method: 'POST',
      body: {
        job: {
          id: job.id,
          tenant: job.tenant,
          appIndex: job.appIndex,
          dataChunkPath: job.dataChunkPath,
        },
        outputRoot: this.outputRoot,
      },
    })
      .then(() => {
        job.markInProgress();
        this.queue.commit();
        this._emitState();
      })
      .catch((err) => {
        logger.error(SCOPE, `Dispatch to ${worker.id} failed`, {
          jobId: job.id,
          error: err.message,
        });
        this.inFlight = Math.max(0, this.inFlight - 1);
        // markDead emits 'worker-dead', whose handler re-queues the job.
        this.faultManager.markDead(worker.id, `dispatch failed: ${err.message}`);
      });
  }

  /** Handle a build result reported by a worker (HTTP /api/worker/report). */
  handleWorkerReport({ workerId, jobId, ok, result, error }) {
    const job = this.queue.jobs.find((j) => j.id === jobId);
    if (!job) {
      logger.warn(SCOPE, `Report for unknown job ${jobId} from ${workerId}`);
      return;
    }
    if (job.state === JOB_STATE.COMPLETED || job.state === JOB_STATE.FAILED) {
      return; // late or duplicate report — ignore
    }

    this.inFlight = Math.max(0, this.inFlight - 1);
    this.faultManager.markIdle(workerId);

    if (ok) {
      job.markCompleted(result);
      logger.info(SCOPE, `Job ${jobId} completed by ${workerId}`, {
        durationMs: job.durationMs(),
      });
    } else {
      logger.error(SCOPE, `Job ${jobId} failed on ${workerId}`, { error });
      this._retryOrFail(job, error);
    }
    this.queue.commit();
    this._emitState();
    this._tick();
  }

  _onWorkerDead({ workerId, heldJob }) {
    if (this.phase !== PHASE.GENERATING) return;
    if (heldJob) {
      const job = this.queue.jobs.find((j) => j.id === heldJob);
      if (job && (job.state === JOB_STATE.ASSIGNED || job.state === JOB_STATE.IN_PROGRESS)) {
        this.inFlight = Math.max(0, this.inFlight - 1);
        logger.warn(SCOPE, `Re-queuing ${heldJob} — lost with worker ${workerId}`);
        this._retryOrFail(job, `worker ${workerId} died`);
        this.queue.commit();
      }
    }
    this._emitState();
    this._tick();
  }

  /**
   * Retry a job after a back-off, or mark it permanently failed once the retry
   * budget is exhausted. The job is held in its current state during the
   * back-off so the queue is never prematurely considered drained.
   */
  _retryOrFail(job, error) {
    if (job.attempts < MAX_RETRIES) {
      const backoff = RETRY_BACKOFF_BASE_MS * 2 ** (job.attempts - 1);
      logger.warn(SCOPE, `Will retry ${job.id} in ${backoff}ms`, {
        attempt: job.attempts,
        maxRetries: MAX_RETRIES,
      });
      setTimeout(() => {
        if (this.phase !== PHASE.GENERATING) return;
        job.resetForRetry();
        this.queue.commit();
        this._emitState();
        this._tick();
      }, backoff);
    } else {
      job.markFailed(error || 'maximum retries exceeded');
      logger.error(SCOPE, `Job ${job.id} permanently failed after ${job.attempts} attempts`);
    }
  }

  /** Build every remaining pending job in-process (used when no worker is up). */
  async _drainLocally() {
    if (this._localDrainActive) return;
    this._localDrainActive = true;
    let job = this.queue.nextPending();
    while (job) {
      await this._buildLocally(job);
      job = this.queue.nextPending();
    }
    this._localDrainActive = false;
    this._tick();
  }

  async _buildLocally(job) {
    job.markAssigned('master-local');
    job.markInProgress();
    this.queue.commit();
    this._emitState();
    try {
      const result = job.dataChunkPath
        ? appEngine.buildDataApp(job.tenant, {
          outputRoot: this.outputRoot,
          appIndex: job.appIndex,
          dataChunkPath: job.dataChunkPath,
        })
        : appEngine.buildApp(job.tenant, {
          outputRoot: this.outputRoot,
          appIndex: job.appIndex,
        });
      job.markCompleted(result);
      logger.info(SCOPE, `Local fallback build OK: ${job.appName}`);
    } catch (err) {
      job.markFailed(err.message);
      logger.error(SCOPE, `Local fallback build failed: ${job.appName}`, { error: err.message });
    }
    this.queue.commit();
    this._emitState();
  }

  /**
   * Mandatory Minimum Execution Guarantee (Requirement 9): ensure at least
   * GUARANTEED_MIN_BUILDS apps are successfully built, using local builds.
   */
  async _enforceMinimumGuarantee() {
    const completedCount = () => this.queue.byState(JOB_STATE.COMPLETED).length;
    const target = Math.min(GUARANTEED_MIN_BUILDS, this.tenants.length);
    if (completedCount() >= target) return;

    this.phase = PHASE.MIN_GUARANTEE;
    logger.decision(
      SCOPE,
      `Minimum-execution guarantee engaged: ${completedCount()} app(s) built, ` +
        `building locally until ${target} succeed`,
    );
    this._emitState();

    // Retry permanently-failed jobs locally first.
    for (const job of this.queue.byState(JOB_STATE.FAILED)) {
      if (completedCount() >= target) break;
      job.resetForRetry();
      await this._buildLocally(job);
    }
    // Still short — create extra jobs from not-yet-used tenants (tenant mode).
    let nextIndex = this.queue.jobs.length + 1;
    while (!this.dataset && completedCount() < target && nextIndex <= this.tenants.length) {
      const job = new Job({ tenant: this.tenants[nextIndex - 1], appIndex: nextIndex });
      this.queue.addJobs([job]);
      await this._buildLocally(job);
      nextIndex += 1;
    }
  }

  /** Deploy and launch generated apps (Requirement 10). */
  async _deploy() {
    this.phase = PHASE.DEPLOYING;
    this._emitState();

    const apps = this.queue
      .byState(JOB_STATE.COMPLETED)
      .map((job) => job.result)
      .filter(Boolean);

    // Launch every generated app by default; a number in system.json caps it.
    const deployConfig = this.systemConfig.deployment || {};
    const configuredLaunch = deployConfig.autoLaunchCount;
    this.deployments = await deployer.deployAndLaunch(apps, {
      autoLaunchCount: typeof configuredLaunch === 'number' ? configuredLaunch : apps.length,
      runNpmInstall: deployConfig.runNpmInstall !== false,
    });
    this.emit('deployments', this.deployments);
    this._emitState();
  }

  _emitState() {
    this.emit('state', this.getState());
  }
}

module.exports = Coordinator;
