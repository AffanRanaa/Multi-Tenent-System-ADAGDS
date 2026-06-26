'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

/**
 * Minimal .env loader — keeps this app dependency-free (express only).
 */
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}
loadEnv();

const config = require('./config');

const app = express();
const PORT = process.env.PORT || config.runtime.port;
const recordsPath = path.join(__dirname, '..', 'data', 'records.json');

app.use(express.static(path.join(__dirname, '..', 'public')));

// This app's own slice of the dataset — read straight from a file, no database.
app.get('/api/records', (req, res) => {
  res.sendFile(recordsPath);
});

app.get('/api/info', (req, res) => {
  res.json({
    app: config.identity,
    dataSource: config.dataSource,
    theme: config.theme,
    servedAt: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: config.identity.id,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.listen(PORT, () => {
  console.log(`[{{APP_NAME}}] running at http://localhost:${PORT}`);
});
