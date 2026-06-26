'use strict';

const http = require('http');
const { HTTP_TIMEOUT_MS } = require('../constants');

/**
 * Minimal JSON-over-HTTP client used for all master <-> worker communication.
 * Every request has an enforced timeout so a stalled node can never hang the
 * coordinator (resilience standard: never leave external calls open-ended).
 *
 * @param {object} options
 * @param {string} options.host
 * @param {number} options.port
 * @param {string} options.path
 * @param {string} [options.method='GET']
 * @param {object|null} [options.body] JSON-serialisable request payload
 * @param {number} [options.timeoutMs]
 * @returns {Promise<object>} parsed JSON response body
 */
function requestJson({ host, port, path, method = 'GET', body = null, timeoutMs = HTTP_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;

    const req = http.request(
      {
        host,
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status} from ${host}:${port}${path}`));
            return;
          }
          if (!raw) { resolve({}); return; }
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(new Error(`Invalid JSON response from ${host}:${port}${path}: ${err.message}`));
          }
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request to ${host}:${port}${path} timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { requestJson };
