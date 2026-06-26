'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

/**
 * Minimal .env loader — keeps this app dependency-free (express only) while
 * still honouring real environment variables (Requirement 5).
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

// Serve the themed, configuration-driven UI.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Tenant-aware API: exposes the configuration that drives this isolated app.
app.get('/api/info', (req, res) => {
  res.json({
    app: config.identity,
    features: config.features,
    environment: config.environment,
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
