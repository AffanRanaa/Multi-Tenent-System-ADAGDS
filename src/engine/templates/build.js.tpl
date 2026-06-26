'use strict';

/**
 * Build script for {{APP_NAME}}.
 * Validates that this independent project is complete and runnable.
 * Dependency-free so the app stays fully self-contained.
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_FILES = [
  'src/server.js',
  'src/config.js',
  'config/app.config.json',
  'public/index.html',
  'public/styles.css',
  'public/app.js',
];

let ok = true;

for (const relativePath of REQUIRED_FILES) {
  if (!fs.existsSync(path.join(__dirname, relativePath))) {
    console.error('[build] MISSING: ' + relativePath);
    ok = false;
  }
}

try {
  JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'app.config.json'), 'utf8'));
} catch (err) {
  console.error('[build] invalid app.config.json: ' + err.message);
  ok = false;
}

if (!ok) {
  console.error('[build] FAILED for {{APP_NAME}}');
  process.exit(1);
}

console.log('[build] {{APP_NAME}} build OK - start with: npm start');
