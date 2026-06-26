'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scaffolder = require('../../src/engine/scaffolder');

function tenant() {
  return {
    id: 'tenant-test',
    name: 'Scaffold Test',
    slug: 'scaffold-test',
    version: '2.1.0',
    features: { auth: true, darkMode: false },
    environment: { stage: 'production', region: 'us-east-1', logLevel: 'info' },
    dataSource: { type: 'rest', endpoint: 'https://api.test', cacheTtlSeconds: 30 },
    theme: {
      primaryColor: '#123456',
      accentColor: '#abcdef',
      layout: 'sidebar',
      fontFamily: 'Inter, sans-serif',
      logoText: 'ST',
    },
  };
}

test('render substitutes placeholders and rejects unknown ones', () => {
  assert.strictEqual(scaffolder.render('Hi {{NAME}}', { NAME: 'A' }), 'Hi A');
  assert.throws(() => scaffolder.render('{{MISSING}}', {}), /Missing template variable/);
});

test('generates a complete, verifiable, independent project', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adagds-out-'));
  try {
    const result = scaffolder.generate(tenant(), { outputRoot, appIndex: 1 });
    assert.strictEqual(result.appName, 'app1');

    const verification = scaffolder.verify(result.appDir);
    assert.strictEqual(verification.ok, true, JSON.stringify(verification.missing));

    // package.json is valid and declares only express (no shared dependency).
    const pkg = JSON.parse(fs.readFileSync(path.join(result.appDir, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.name, 'scaffold-test');
    assert.deepStrictEqual(Object.keys(pkg.dependencies), ['express']);

    // The tenant config is baked in — isolated configuration space.
    const appConfig = JSON.parse(
      fs.readFileSync(path.join(result.appDir, 'config', 'app.config.json'), 'utf8'),
    );
    assert.strictEqual(appConfig.id, 'tenant-test');
    assert.strictEqual(appConfig.runtime.appName, 'app1');

    // The theme colour reached the generated stylesheet.
    const css = fs.readFileSync(path.join(result.appDir, 'public', 'styles.css'), 'utf8');
    assert.match(css, /#123456/);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('regenerating overwrites a previous build with no leftover temp dir', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adagds-out-'));
  try {
    scaffolder.generate(tenant(), { outputRoot, appIndex: 2 });
    const second = scaffolder.generate(tenant(), { outputRoot, appIndex: 2 });
    assert.strictEqual(scaffolder.verify(second.appDir).ok, true);
    assert.strictEqual(fs.existsSync(`${second.appDir}.tmp`), false);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('portForIndex assigns sequential, unique ports', () => {
  assert.strictEqual(scaffolder.portForIndex(2) - scaffolder.portForIndex(1), 1);
});
