'use strict';

/**
 * Renders DOCUMENTATION.md to a styled DOCUMENTATION.pdf.
 * Converts markdown -> HTML with `marked`, then prints it via headless Edge.
 *
 * Usage: node tools/generate-pdf.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { marked } = require('marked');

const ROOT = path.join(__dirname, '..');
const MD_PATH = path.join(ROOT, 'DOCUMENTATION.md');
const HTML_PATH = path.join(ROOT, 'DOCUMENTATION.html');
const PDF_PATH = path.join(ROOT, 'DOCUMENTATION.pdf');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

// Print-optimised stylesheet for the PDF.
const STYLE = `
  @page { size: A4; margin: 18mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Arial, sans-serif;
    font-size: 11px; line-height: 1.55; color: #1e293b; margin: 0;
  }
  h1 {
    font-size: 22px; color: #0f172a; border-bottom: 3px solid #2563eb;
    padding-bottom: 6px; margin: 18px 0 10px;
  }
  h2 {
    font-size: 16px; color: #1d4ed8; margin: 22px 0 8px;
    border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; page-break-after: avoid;
  }
  h3 { font-size: 13px; color: #334155; margin: 14px 0 6px; page-break-after: avoid; }
  h4 { font-size: 12px; color: #334155; margin: 10px 0 4px; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0 6px 18px; }
  li { margin: 2px 0; }
  a { color: #2563eb; text-decoration: none; }
  code {
    font-family: "Consolas", monospace; font-size: 10px;
    background: #f1f5f9; color: #be123c; padding: 1px 4px; border-radius: 3px;
  }
  pre {
    background: #0f172a; color: #e2e8f0; padding: 10px 12px;
    border-radius: 6px; overflow-x: auto; page-break-inside: avoid;
  }
  pre code { background: transparent; color: #e2e8f0; padding: 0; font-size: 9.5px; }
  table {
    border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10px;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; vertical-align: top;
  }
  th { background: #e0e7ff; color: #1e293b; }
  tr:nth-child(even) td { background: #f8fafc; }
  hr { border: none; border-top: 1px solid #cbd5e1; margin: 16px 0; }
  blockquote {
    border-left: 3px solid #2563eb; margin: 8px 0; padding: 4px 12px;
    background: #f1f5f9; color: #475569;
  }
  strong { color: #0f172a; }
`;

function findEdge() {
  const found = EDGE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Microsoft Edge not found — cannot render the PDF.');
  return found;
}

function main() {
  const markdown = fs.readFileSync(MD_PATH, 'utf8');
  const body = marked.parse(markdown);
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `<title>ADAGDS Documentation</title><style>${STYLE}</style></head>` +
    `<body>${body}</body></html>`;
  fs.writeFileSync(HTML_PATH, html);
  console.log(`HTML written: ${HTML_PATH}`);

  const edge = findEdge();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adagds-edge-'));
  try {
    execFileSync(
      edge,
      [
        '--headless',
        '--disable-gpu',
        '--no-pdf-header-footer',
        `--user-data-dir=${userDataDir}`,
        `--print-to-pdf=${PDF_PATH}`,
        `file:///${HTML_PATH.replace(/\\/g, '/')}`,
      ],
      { stdio: 'inherit' },
    );
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const sizeKB = Math.round(fs.statSync(PDF_PATH).size / 1024);
  console.log(`PDF written: ${PDF_PATH} (${sizeKB} KB)`);
}

main();
