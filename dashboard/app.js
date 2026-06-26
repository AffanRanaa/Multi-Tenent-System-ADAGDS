'use strict';

/**
 * ADAGDS control dashboard.
 * Connects over WebSocket and renders live state, decisions and logs
 * (Requirement 12).
 */

let socket = null;
let reconnectTimer = null;

// ---------------------------------------------------------------- helpers ---

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function kvRow(parent, key, value) {
  const row = el('div', 'kv-row');
  row.append(el('span', 'kv-key', key));
  row.append(el('span', 'kv-val', String(value)));
  parent.appendChild(row);
}

function tag(text, kind) {
  return el('span', `tag tag-${kind}`, text);
}

function clear(node) {
  node.innerHTML = '';
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// -------------------------------------------------------------- rendering ---

function renderResources(snapshot) {
  const box = document.getElementById('resources');
  clear(box);
  if (!snapshot) {
    box.append(el('p', 'empty', 'No snapshot yet — click "Refresh Resources".'));
    return;
  }
  kvRow(box, 'CPU cores', snapshot.cpuCores);
  kvRow(box, 'CPU load', `${snapshot.cpuLoadPct} %`);
  kvRow(box, 'Memory free / total', `${snapshot.freeMemGB} / ${snapshot.totalMemGB} GB`);
  kvRow(box, 'GPU', snapshot.gpu && snapshot.gpu.detected ? snapshot.gpu.model : 'not detected');
  kvRow(box, 'Healthy workers', snapshot.healthyWorkers);
  kvRow(box, 'Mode', snapshot.simulated ? 'SIMULATED low-resource' : 'live');
}

function renderDecision(decision, tenantCount) {
  const box = document.getElementById('decision');
  clear(box);
  if (!decision) {
    const count = tenantCount || 0;
    box.append(el('p', 'empty',
      `${count} tenant config(s) available. Click "Start Generation".`));
    return;
  }
  const big = el('div', 'decision-big');
  big.append(el('span', 'decision-num', decision.decided));
  big.append(el('span', 'decision-label', 'applications to generate'));
  box.append(big);

  const limits = el('div', 'kv');
  kvRow(limits, 'Ceiling — memory', decision.limits.maxByMemory);
  kvRow(limits, 'Ceiling — CPU', decision.limits.maxByCpu);
  kvRow(limits, 'Ceiling — workers', decision.limits.maxByWorkers);
  kvRow(limits, 'Requested count', decision.limits.requested);
  kvRow(limits, 'Mode', decision.manualMode ? 'manual appCount' : 'auto');
  kvRow(limits, 'Binding constraint', decision.bindingConstraint);
  kvRow(limits, 'Parallel execution', `${window.__parallelism || '-'}`);
  box.append(limits);
  box.append(el('p', 'reasoning', decision.reasoning));
}

function renderProgress(jobs, stats) {
  const total = stats ? stats.total : 0;
  const done = stats ? stats.completed : 0;
  const failed = stats ? stats.failed : 0;
  const pct = total > 0 ? Math.round(((done + failed) / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = `${pct}%`;
  document.getElementById('progress-count').textContent =
    total > 0 ? `${done} done · ${failed} failed · ${total} total` : '';

  const box = document.getElementById('jobs');
  clear(box);
  if (!jobs || jobs.length === 0) {
    box.append(el('p', 'empty', 'No build jobs yet.'));
    return;
  }
  for (const job of jobs) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', `${job.appName} — ${job.tenantId}`));
    const sub = `${job.id} · attempt ${job.attempts} · ` +
      `${job.workerId || 'unassigned'} · ${job.durationMs}ms`;
    main.append(el('span', 'row-sub', sub));
    row.append(main);
    row.append(tag(job.state.replace('_', ' '), job.state));
    box.append(row);
  }
}

function renderWorkers(workers) {
  const box = document.getElementById('workers');
  clear(box);
  document.getElementById('worker-count').textContent =
    workers && workers.length ? `${workers.length} node(s)` : '';
  if (!workers || workers.length === 0) {
    box.append(el('p', 'empty', 'No workers registered yet.'));
    return;
  }
  for (const worker of workers) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', worker.id));
    main.append(el('span', 'row-sub',
      `:${worker.port} · ok ${worker.jobsCompleted} · fail ${worker.jobsFailed} · ` +
      `${worker.memRssMB}MB`));
    row.append(main);

    const right = el('div', 'row-right');
    right.append(tag(worker.state, worker.state));
    if (worker.state !== 'dead') {
      const kill = el('button', 'btn btn-danger', 'Kill');
      kill.onclick = () => postJson('/api/kill-worker', { workerId: worker.id });
      right.append(kill);
    }
    row.append(right);
    box.append(row);
  }
}

function renderDeployments(deployments) {
  const box = document.getElementById('deployments');
  clear(box);
  if (!deployments || deployments.length === 0) {
    box.append(el('p', 'empty', 'No deployments yet.'));
    return;
  }
  for (const dep of deployments) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', `${dep.appName} — ${dep.tenantId}`));
    main.append(el('span', 'row-sub', dep.note));
    row.append(main);

    const right = el('div', 'row-right');
    if (dep.launched) {
      const link = el('a', 'app-link', `open ${dep.endpoint}`);
      link.href = `${dep.endpoint}/`;
      link.target = '_blank';
      right.append(link);
    }
    right.append(tag(dep.status.replace('_', ' '), dep.status));
    row.append(right);
    box.append(row);
  }
}

function renderFaults(faults) {
  const box = document.getElementById('faults');
  clear(box);
  if (!faults || faults.length === 0) {
    box.append(el('p', 'empty', 'No fault events — system healthy.'));
    return;
  }
  for (const event of [...faults].reverse()) {
    const row = el('div', 'row');
    const main = el('div', 'row-main');
    main.append(el('span', 'row-title', `${event.workerId} declared dead`));
    main.append(el('span', 'row-sub',
      `${event.reason}${event.heldJob ? ` · re-queued ${event.heldJob}` : ''}`));
    row.append(main);
    row.append(tag('fault', 'failed'));
    box.append(row);
  }
}

function setPhase(phase) {
  const node = document.getElementById('phase');
  node.textContent = (phase || 'idle').replace('_', ' ');
  node.className = `phase phase-${phase || 'idle'}`;
}

function renderDatasetBanner(dataset) {
  const banner = document.getElementById('dataset-banner');
  banner.innerHTML = '';
  if (!dataset) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const text = el('span', 'dataset-text');
  text.append(
    'Dataset loaded: ',
    el('strong', null, dataset.name),
    ` — ${dataset.recordCount.toLocaleString()} records. `
      + 'Start Generation will split it across the app count you choose.',
  );
  const clearBtn = el('button', 'btn btn-danger', 'Clear dataset');
  clearBtn.onclick = () => postJson('/api/clear-dataset');
  banner.append(text, clearBtn);
}

function renderState(state) {
  if (!state) return;
  window.__parallelism = state.parallelism;
  setPhase(state.phase);
  renderDatasetBanner(state.dataset);
  renderResources(state.snapshot);
  renderDecision(state.decision, state.tenantCount);
  renderProgress(state.jobs, state.jobStats);
  renderWorkers(state.workers);
  renderDeployments(state.deployments);
  renderFaults(state.faultEvents);

  const startBtn = document.getElementById('btn-start');
  startBtn.disabled = state.running;
  startBtn.textContent = state.running ? 'Generating…' : 'Start Generation';
}

// -------------------------------------------------------------------- log ---

function appendLog(entry) {
  const box = document.getElementById('log');
  const line = el('div', `log-line log-${entry.level}`);
  const time = (entry.ts || '').substring(11, 19);
  line.append(el('span', 'log-time', `${time} `));
  line.append(el('span', 'log-scope', `${entry.scope} `));
  line.append(document.createTextNode(`${entry.level.toUpperCase()} ${entry.message}`));
  box.appendChild(line);
  while (box.childElementCount > 300) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

function renderLogs(entries) {
  const box = document.getElementById('log');
  clear(box);
  (entries || []).forEach(appendLog);
}

// ------------------------------------------------------------- websocket ----

function setConnected(up) {
  const pill = document.getElementById('conn');
  pill.textContent = up ? 'live' : 'disconnected — retrying…';
  pill.className = `conn ${up ? 'conn-up' : 'conn-down'}`;
}

function connect() {
  socket = new WebSocket(`ws://${location.host}`);

  socket.onopen = () => setConnected(true);
  socket.onclose = () => {
    setConnected(false);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  };
  socket.onerror = () => socket.close();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') renderState(message.data);
    else if (message.type === 'log') appendLog(message.data);
    else if (message.type === 'logs') renderLogs(message.data);
  };
}

// ------------------------------------------------------------ controls -----

/** Briefly show a feedback message in the top-right corner. */
function showToast(message, ok) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-show ${ok ? 'toast-ok' : 'toast-err'}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.className = 'toast';
  }, 6000);
}

/** Start a generation run, using the optional app-count from the input box. */
function startGeneration() {
  const raw = document.getElementById('app-count').value.trim();
  const appCount = raw === '' ? null : Number(raw);
  postJson('/api/start', { appCount });
}

/** Read a chosen JSON file and upload it to the master as a tenant config. */
function uploadTenantFile(file) {
  const MAX_UPLOAD_BYTES = 256 * 1024; // a tenant config is only a few KB
  if (file.size > MAX_UPLOAD_BYTES) {
    showToast(
      `That file is ${(file.size / 1048576).toFixed(1)} MB. A tenant config is a `
        + 'small JSON file (a few KB) — please pick a config file.',
      false,
    );
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    let tenant;
    try {
      tenant = JSON.parse(reader.result);
    } catch (err) {
      showToast(`Invalid JSON file: ${err.message}`, false);
      return;
    }
    try {
      const result = await postJson('/api/upload-tenant', tenant);
      if (result.ok) {
        showToast(`Uploaded "${result.name}" — ${result.tenantCount} configs available`, true);
      } else {
        showToast(`Upload rejected: ${result.error}`, false);
      }
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, false);
    }
  };
  reader.readAsText(file);
}

/** Read a chosen JSON dataset file and upload it for split-across-N generation. */
function uploadDataFile(file) {
  const MAX_DATA_BYTES = 64 * 1024 * 1024;
  if (file.size > MAX_DATA_BYTES) {
    showToast(`That file is ${(file.size / 1048576).toFixed(0)} MB — the limit is 64 MB.`, false);
    return;
  }
  showToast(`Uploading ${file.name} (${(file.size / 1048576).toFixed(1)} MB)…`, true);
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const response = await fetch(
        `/api/upload-data?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: reader.result },
      );
      const result = await response.json();
      if (result.ok) {
        showToast(
          `Dataset "${result.name}" loaded — ${result.recordCount.toLocaleString()} records`,
          true,
        );
      } else {
        showToast(`Data upload rejected: ${result.error}`, false);
      }
    } catch (err) {
      showToast(`Data upload failed: ${err.message}`, false);
    }
  };
  reader.readAsText(file);
}

// ----------------------------------------------------------------- wiring ---

document.getElementById('btn-start').onclick = startGeneration;
document.getElementById('btn-refresh').onclick = () => fetch('/api/analyze');
document.getElementById('btn-upload').onclick = () =>
  document.getElementById('file-input').click();
document.getElementById('file-input').onchange = (event) => {
  const file = event.target.files[0];
  if (file) uploadTenantFile(file);
  event.target.value = '';
};
document.getElementById('btn-upload-data').onclick = () =>
  document.getElementById('file-data-input').click();
document.getElementById('file-data-input').onchange = (event) => {
  const file = event.target.files[0];
  if (file) uploadDataFile(file);
  event.target.value = '';
};

connect();
