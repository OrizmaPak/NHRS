const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('openapi spec contains health records index routes', () => {
  const openapiPath = path.resolve(__dirname, '../../../../docs/openapi.json');
  const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
  const paths = spec.paths || {};

  assert.ok(paths['/records/me']);
  assert.ok(paths['/records/me'].get);
  assert.ok(paths['/records/me/symptoms']);
  assert.ok(paths['/records/me/symptoms'].post);
  assert.ok(paths['/records/{nin}']);
  assert.ok(paths['/records/{nin}'].get);
  assert.ok(paths['/records/{nin}/entries']);
  assert.ok(paths['/records/{nin}/entries'].post);
  assert.ok(paths['/records/entries/{entryId}']);
  assert.ok(paths['/records/entries/{entryId}'].patch);
  assert.ok(paths['/records/entries/{entryId}/hide']);
  assert.ok(paths['/records/entries/{entryId}/hide'].post);
});
