const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('openapi spec contains required profile GET endpoints', () => {
  const openapiPath = path.resolve(__dirname, '../../../../docs/openapi.json');
  const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
  const paths = spec.paths || {};

  assert.ok(paths['/profile/me']);
  assert.ok(paths['/profile/me'].get);
  assert.ok(paths['/profile/me/status']);
  assert.ok(paths['/profile/me/status'].get);
  assert.ok(paths['/profile/search']);
  assert.ok(paths['/profile/search'].get);
  assert.ok(paths['/profile/{userId}']);
  assert.ok(paths['/profile/{userId}'].get);
  assert.ok(paths['/profile/by-nin/{nin}']);
  assert.ok(paths['/profile/by-nin/{nin}'].get);
});
