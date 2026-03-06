const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('openapi spec contains ui theme routes', () => {
  const openapiPath = path.resolve(__dirname, '../../../../docs/openapi.json');
  const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
  const paths = spec.paths || {};

  assert.ok(paths['/ui/theme/platform']);
  assert.ok(paths['/ui/theme/platform'].get);
  assert.ok(paths['/ui/theme/effective']);
  assert.ok(paths['/ui/theme/effective'].get);
  assert.ok(paths['/ui/theme']);
  assert.ok(paths['/ui/theme'].get);
  assert.ok(paths['/ui/theme'].post);
  assert.ok(paths['/ui/theme/{id}']);
  assert.ok(paths['/ui/theme/{id}'].patch);
  assert.ok(paths['/ui/theme/{id}'].delete);
  assert.ok(paths['/ui/theme/{id}/logo']);
  assert.ok(paths['/ui/theme/{id}/logo'].post);
});
