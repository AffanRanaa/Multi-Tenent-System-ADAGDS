'use strict';

const fs = require('fs');
const path = require('path');
const scaffolder = require('./scaffolder');
const logger = require('../common/logger');

const SCOPE = 'app-engine';

/**
 * Shared Application Generation Engine (Requirements 1 & 4).
 *
 * The single base codebase every worker uses to build apps. `buildApp`
 * generates one fully independent project, verifies it, and returns a
 * structured result with timing for monitoring (Requirement 12).
 *
 * @param {object} tenant validated tenant spec
 * @param {object} options
 * @param {string} options.outputRoot absolute path to /output
 * @param {number} options.appIndex 1-based application index
 * @returns {object} build result
 */
function buildApp(tenant, { outputRoot, appIndex }) {
  const startedAt = Date.now();
  logger.info(SCOPE, `Build started for ${tenant.id}`, { appIndex });

  const generated = scaffolder.generate(tenant, { outputRoot, appIndex });
  const verification = scaffolder.verify(generated.appDir);

  if (!verification.ok) {
    throw new Error(
      `Build verification failed for ${generated.appName}: missing ${verification.missing.join(', ')}`,
    );
  }

  const durationMs = Date.now() - startedAt;
  const result = {
    ok: true,
    appName: generated.appName,
    appDir: generated.appDir,
    port: generated.port,
    tenantId: generated.tenantId,
    fileCount: generated.fileCount,
    durationMs,
  };

  logger.info(SCOPE, `Build completed for ${generated.appName}`, {
    durationMs,
    port: generated.port,
  });
  return result;
}

/**
 * Build one independent DATA APP for a slice of a dataset (split-across-N-apps).
 *
 * @param {object} tenant synthetic tenant spec for this slice
 * @param {object} options
 * @param {string} options.outputRoot absolute path to /output
 * @param {number} options.appIndex 1-based application index
 * @param {string} options.dataChunkPath absolute path to this slice's JSON file
 * @returns {object} build result
 */
function buildDataApp(tenant, { outputRoot, appIndex, dataChunkPath }) {
  const startedAt = Date.now();
  logger.info(SCOPE, `Data-app build started for ${tenant.id}`, { appIndex });

  const generated = scaffolder.generateDataApp(tenant, { outputRoot, appIndex, dataChunkPath });
  const verification = scaffolder.verify(generated.appDir);
  if (!verification.ok) {
    throw new Error(
      `Build verification failed for ${generated.appName}: missing ${verification.missing.join(', ')}`,
    );
  }
  if (!fs.existsSync(path.join(generated.appDir, 'data', 'records.json'))) {
    throw new Error(`Data file missing for ${generated.appName}`);
  }

  const durationMs = Date.now() - startedAt;
  const result = {
    ok: true,
    appName: generated.appName,
    appDir: generated.appDir,
    port: generated.port,
    tenantId: generated.tenantId,
    fileCount: generated.fileCount,
    durationMs,
  };
  logger.info(SCOPE, `Data-app build completed for ${generated.appName}`, { durationMs });
  return result;
}

module.exports = { buildApp, buildDataApp };
