'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Each generated app owns and reads its own configuration file.
 * This is the isolated configuration space required by Requirement 6 —
 * no shared runtime state with any other generated application.
 */
const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'app.config.json'), 'utf8'),
);

module.exports = {
  identity: { id: raw.id, name: raw.name, slug: raw.slug, version: raw.version },
  features: raw.features,
  environment: raw.environment,
  dataSource: raw.dataSource,
  theme: raw.theme,
  runtime: raw.runtime,
};
