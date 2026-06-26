'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  loadTenants,
  validateTenant,
  loadSystemConfig,
} = require('../../src/common/config-loader');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function validTenant() {
  return {
    id: 'tenant-99',
    name: 'Test Tenant',
    slug: 'test-app',
    version: '1.0.0',
    features: { auth: true },
    environment: { stage: 'production', region: 'us-east-1', logLevel: 'info' },
    dataSource: { type: 'rest', endpoint: 'https://api.test' },
    theme: { primaryColor: '#000', accentColor: '#fff', layout: 'grid', logoText: 'T' },
  };
}

test('accepts a well-formed tenant specification', () => {
  assert.doesNotThrow(() => validateTenant(validTenant(), 'tenant-99.json'));
});

test('rejects a tenant missing a required field', () => {
  const bad = validTenant();
  delete bad.dataSource;
  assert.throws(() => validateTenant(bad, 'bad.json'), /dataSource/);
});

test('rejects a tenant with an invalid slug', () => {
  const bad = validTenant();
  bad.slug = 'Not A Slug';
  assert.throws(() => validateTenant(bad, 'bad.json'), /slug/);
});

test('loads every bundled tenant config (10-20 range)', () => {
  const tenants = loadTenants(path.join(PROJECT_ROOT, 'config', 'tenants'));
  assert.ok(tenants.length >= 10 && tenants.length <= 20);
  for (const tenant of tenants) {
    assert.ok(tenant.id && tenant.slug && tenant.theme);
  }
});

test('bundled tenant configs are sorted and unique by id', () => {
  const tenants = loadTenants(path.join(PROJECT_ROOT, 'config', 'tenants'));
  const ids = tenants.map((t) => t.id);
  assert.deepStrictEqual(ids, [...ids].sort());
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('loads the system configuration file', () => {
  const config = loadSystemConfig(path.join(PROJECT_ROOT, 'config', 'system.json'));
  assert.ok(config.paths && config.deployment);
});
