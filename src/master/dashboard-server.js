'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { createProxyMiddleware } = require('http-proxy-middleware');
const logger = require('../common/logger');
const deployer = require('./deployer');

const SCOPE = 'dashboard';
const MAX_LOG_BUFFER = 200;

/**
 * Master HTTP surface (Requirement 12 + 10):
 *  - serves the live monitoring dashboard
 *  - exposes the master API (worker callbacks, control, state)
 *  - streams state and logs over WebSocket
 *  - reverse-proxies deployed apps so each gets a unique endpoint (/appN)
 */
class DashboardServer {
  constructor({ coordinator, faultManager, port, projectRoot }) {
    this.coordinator = coordinator;
    this.faultManager = faultManager;
    this.port = port;
    this.projectRoot = projectRoot;

    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.clients = new Set();
    this.logBuffer = [];

    this._bufferLogs();
    this._buildRoutes();
    this._wireWebSocket();
    this._wireEvents();
  }

  _bufferLogs() {
    logger.on('log', (entry) => {
      this.logBuffer.push(entry);
      if (this.logBuffer.length > MAX_LOG_BUFFER) this.logBuffer.shift();
    });
  }

  _buildRoutes() {
    const { app } = this;

    // --- Reverse proxy for deployed apps (Requirement 10) ---
    // Registered first so proxied traffic is never touched by the JSON parser.
    const appProxy = createProxyMiddleware({
      target: 'http://127.0.0.1:1', // overridden per-request by `router`
      changeOrigin: true,
      logLevel: 'silent',
      pathRewrite: { '^/app\\d+': '' },
      router: (req) => {
        const match = req.url.match(/^\/(app\d+)(?:\/|$)/);
        if (!match) return undefined;
        const info = deployer.getLaunched().get(match[1]);
        return info ? `http://127.0.0.1:${info.port}` : undefined;
      },
    });

    app.use((req, res, next) => {
      // Redirect "/appN" -> "/appN/" so the app's relative asset URLs resolve.
      const exact = req.url.match(/^\/(app\d+)$/);
      if (exact && deployer.getLaunched().has(exact[1])) {
        return res.redirect(302, `/${exact[1]}/`);
      }
      const nested = req.url.match(/^\/(app\d+)\//);
      if (nested && deployer.getLaunched().has(nested[1])) {
        return appProxy(req, res, next);
      }
      return next();
    });

    app.use(express.json({ limit: '2mb' }));

    // --- Worker node callbacks ---
    app.post('/api/worker/register', (req, res) => {
      this.faultManager.registerWorker(req.body || {});
      res.json({ ok: true });
    });
    app.post('/api/worker/heartbeat', (req, res) => {
      this.faultManager.recordHeartbeat(req.body || {});
      res.json({ ok: true });
    });
    app.post('/api/worker/report', (req, res) => {
      this.coordinator.handleWorkerReport(req.body || {});
      res.json({ ok: true });
    });

    // --- Control + state ---
    app.post('/api/start', (req, res) => {
      const { appCount } = req.body || {};
      const requestedCount = typeof appCount === 'number' ? appCount : null;
      this.coordinator.runPipeline({ requestedCount });
      res.json({ started: true });
    });

    // Upload a tenant JSON config from the dashboard.
    app.post('/api/upload-tenant', (req, res) => {
      try {
        const result = this.coordinator.addTenant(req.body || {});
        res.json({ ok: true, ...result });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    // Upload a large dataset file to be split across N generated apps.
    app.post('/api/upload-data', express.text({ limit: '64mb', type: '*/*' }), (req, res) => {
      try {
        const name = typeof req.query.name === 'string' ? req.query.name : 'dataset';
        const result = this.coordinator.setDataset(req.body || '', name);
        res.json({ ok: true, ...result });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    // Discard the active dataset.
    app.post('/api/clear-dataset', (req, res) => {
      this.coordinator.clearDataset();
      res.json({ ok: true });
    });
    app.get('/api/state', (req, res) => {
      res.json(this.coordinator.getState());
    });
    app.get('/api/analyze', async (req, res) => {
      try {
        const snapshot = await this.coordinator.refreshSnapshot();
        res.json(snapshot);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
    app.post('/api/kill-worker', async (req, res) => {
      const { workerId } = req.body || {};
      const ok = await this.faultManager.killWorker(workerId);
      res.json({ ok });
    });

    // --- Static dashboard UI ---
    app.use(express.static(path.join(this.projectRoot, 'dashboard')));

    // --- JSON error handler ---
    // Body-parser failures (oversized or malformed) reply with JSON so the
    // dashboard always shows a clear message instead of an HTML error page.
    app.use((err, req, res, next) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      const status = err.status || err.statusCode || 500;
      let message = err.message;
      if (err.type === 'entity.too.large') {
        message = 'Uploaded file is too large — please choose a smaller file.';
      } else if (err.type === 'entity.parse.failed') {
        message = 'The uploaded file is not valid JSON.';
      }
      logger.warn(SCOPE, `Request error on ${req.method} ${req.url}`, { error: err.message });
      res.status(status).json({ ok: false, error: message });
    });
  }

  _wireWebSocket() {
    this.wss.on('connection', (socket) => {
      this.clients.add(socket);
      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', () => this.clients.delete(socket));
      this._sendTo(socket, { type: 'state', data: this.coordinator.getState() });
      this._sendTo(socket, { type: 'logs', data: this.logBuffer });
    });
  }

  _wireEvents() {
    this.coordinator.on('state', (state) => this._broadcast({ type: 'state', data: state }));
    this.faultManager.on('change', () => {
      this._broadcast({ type: 'state', data: this.coordinator.getState() });
    });
    logger.on('log', (entry) => this._broadcast({ type: 'log', data: entry }));
  }

  _sendTo(socket, message) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  _broadcast(message) {
    const payload = JSON.stringify(message);
    for (const socket of this.clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  start() {
    this.server.listen(this.port, () => {
      logger.info(SCOPE, `Dashboard + master API listening on http://localhost:${this.port}`);
    });
  }

  stop() {
    for (const socket of this.clients) socket.close();
    this.wss.close();
    this.server.close();
  }
}

module.exports = DashboardServer;
