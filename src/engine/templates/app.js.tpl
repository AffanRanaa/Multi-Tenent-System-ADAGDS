'use strict';

/**
 * Front-end for {{APP_NAME}}.
 * Renders the configuration-driven UI by fetching this app's own /api/info.
 */

function renderList(elementId, entries) {
  const list = document.getElementById(elementId);
  list.innerHTML = '';
  for (const [key, value] of entries) {
    const item = document.createElement('li');
    const keyNode = document.createElement('span');
    keyNode.textContent = key;
    const valueNode = document.createElement('span');
    if (typeof value === 'boolean') {
      valueNode.textContent = value ? 'enabled' : 'disabled';
      valueNode.className = value ? 'flag-on' : 'flag-off';
    } else {
      valueNode.textContent = String(value);
    }
    item.append(keyNode, valueNode);
    list.appendChild(item);
  }
}

async function load() {
  try {
    const response = await fetch('api/info');
    const info = await response.json();
    renderList('features', Object.entries(info.features));
    renderList('environment', Object.entries(info.environment));
    renderList('dataSource', Object.entries(info.dataSource));
    document.getElementById('served-at').textContent = 'Served at ' + info.servedAt;
  } catch (err) {
    console.error('Failed to load app info', err);
  }
}

load();
