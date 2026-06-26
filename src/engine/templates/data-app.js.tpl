'use strict';

/**
 * Front-end for an ADAGDS data app.
 * Fetches this app's own slice of the dataset and renders each record.
 */

const LONG_TEXT = 30; // strings longer than this render as text, not as a tag
let allRecords = [];

/** The longest string field is treated as the record's main content. */
function mainKeyOf(record) {
  let key = null;
  let longest = -1;
  for (const [field, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.length > longest) {
      longest = value.length;
      key = field;
    }
  }
  return key;
}

function buildCard(record) {
  const card = document.createElement('article');
  card.className = 'record';
  const mainKey = mainKeyOf(record);
  const tags = [];

  if (mainKey) {
    const main = document.createElement('p');
    main.className = 'record-text';
    main.setAttribute('dir', 'auto');
    main.textContent = record[mainKey];
    card.appendChild(main);
  }

  for (const [field, value] of Object.entries(record)) {
    if (field === mainKey || value === null || typeof value === 'object') continue;
    const text = String(value);
    if (typeof value === 'string' && text.length > LONG_TEXT) {
      const sub = document.createElement('p');
      sub.className = 'record-sub';
      sub.setAttribute('dir', 'auto');
      sub.textContent = text;
      card.appendChild(sub);
    } else {
      tags.push(`${field}: ${text}`);
    }
  }

  if (tags.length > 0) {
    const meta = document.createElement('div');
    meta.className = 'record-meta';
    for (const tag of tags) {
      const span = document.createElement('span');
      span.className = 'record-tag';
      span.textContent = tag;
      meta.appendChild(span);
    }
    card.appendChild(meta);
  }
  return card;
}

function renderRecords(records) {
  const box = document.getElementById('records');
  box.innerHTML = '';
  if (records.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No matching records.';
    box.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const record of records) {
    fragment.appendChild(buildCard(record));
  }
  box.appendChild(fragment);
}

async function load() {
  try {
    const response = await fetch('api/records');
    allRecords = await response.json();
    document.getElementById('count-badge').textContent = `${allRecords.length} records`;
    document.getElementById('served-at').textContent = 'ADAGDS data app';
    renderRecords(allRecords);
  } catch (err) {
    console.error('Failed to load records', err);
    document.getElementById('count-badge').textContent = 'load failed';
  }
}

document.getElementById('search').addEventListener('input', (event) => {
  const query = event.target.value.toLowerCase().trim();
  if (!query) {
    renderRecords(allRecords);
    return;
  }
  renderRecords(
    allRecords.filter((record) => JSON.stringify(record).toLowerCase().includes(query)),
  );
});

load();
