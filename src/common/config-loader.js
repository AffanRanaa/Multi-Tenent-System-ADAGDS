'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Loads and validates the JSON configuration that drives the whole system:
 * the tenant specifications (Requirement 2) and the system tunables.
 */

const REQUIRED_TENANT_FIELDS = ['id', 'name', 'slug', 'features', 'environment', 'dataSource', 'theme'];
const REQUIRED_THEME_FIELDS = ['primaryColor', 'accentColor', 'layout', 'logoText'];
const REQUIRED_DATASOURCE_FIELDS = ['type', 'endpoint'];
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validate a single tenant specification, throwing a descriptive error on failure.
 * @param {object} tenant parsed JSON object
 * @param {string} sourceFile originating file name (for error messages)
 * @returns {object} the validated tenant
 */
function validateTenant(tenant, sourceFile) {
  if (!tenant || typeof tenant !== 'object' || Array.isArray(tenant)) {
    throw new Error(`Tenant config ${sourceFile} is not a JSON object`);
  }
  for (const field of REQUIRED_TENANT_FIELDS) {
    if (tenant[field] === undefined) {
      throw new Error(`Tenant config ${sourceFile} is missing required field "${field}"`);
    }
  }
  if (typeof tenant.slug !== 'string' || !SLUG_PATTERN.test(tenant.slug)) {
    throw new Error(`Tenant ${tenant.id} has an invalid slug "${tenant.slug}" (kebab-case required)`);
  }
  for (const field of REQUIRED_THEME_FIELDS) {
    if (tenant.theme[field] === undefined) {
      throw new Error(`Tenant ${tenant.id} theme is missing "${field}"`);
    }
  }
  for (const field of REQUIRED_DATASOURCE_FIELDS) {
    if (tenant.dataSource[field] === undefined) {
      throw new Error(`Tenant ${tenant.id} dataSource is missing "${field}"`);
    }
  }
  return tenant;
}

/**
 * Load and validate every tenant JSON config in a directory.
 * @param {string} tenantsDir absolute path to the tenants directory
 * @returns {object[]} validated tenant specs sorted by id
 */
function loadTenants(tenantsDir) {
  if (!fs.existsSync(tenantsDir)) {
    throw new Error(`Tenants directory not found: ${tenantsDir}`);
  }
  const files = fs.readdirSync(tenantsDir).filter((file) => file.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`No tenant JSON configs found in ${tenantsDir}`);
  }

  const tenants = files.map((file) => {
    const fullPath = path.join(tenantsDir, file);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (err) {
      throw new Error(`Tenant config ${file} contains invalid JSON: ${err.message}`);
    }
    return validateTenant(parsed, file);
  });

  const seenIds = new Set();
  for (const tenant of tenants) {
    if (seenIds.has(tenant.id)) {
      throw new Error(`Duplicate tenant id detected: ${tenant.id}`);
    }
    seenIds.add(tenant.id);
  }

  return tenants.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Load the system configuration file (tunables and feature flags).
 * @param {string} systemConfigPath absolute path to system.json
 * @returns {object}
 */
function loadSystemConfig(systemConfigPath) {
  if (!fs.existsSync(systemConfigPath)) {
    throw new Error(`System config not found: ${systemConfigPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(systemConfigPath, 'utf8'));
  } catch (err) {
    throw new Error(`System config contains invalid JSON: ${err.message}`);
  }
}

module.exports = { loadTenants, validateTenant, loadSystemConfig };
