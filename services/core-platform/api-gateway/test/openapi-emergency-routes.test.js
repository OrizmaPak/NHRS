const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const openapiPath = path.resolve(__dirname, '../../../..', 'docs/openapi.json');

test('openapi spec contains emergency routes', () => {
  const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
  const paths = spec.paths || {};

  assert.ok(paths['/emergency/requests']);
  assert.ok(paths['/emergency/requests'].post);
  assert.ok(paths['/emergency/requests'].get);
  assert.ok(paths['/emergency/requests/{requestId}']);
  assert.ok(paths['/emergency/requests/{requestId}'].get);
  assert.ok(paths['/emergency/requests/{requestId}/status']);
  assert.ok(paths['/emergency/requests/{requestId}/status'].patch);
  assert.ok(paths['/emergency/requests/{requestId}/responses']);
  assert.ok(paths['/emergency/requests/{requestId}/responses'].post);
  assert.ok(paths['/emergency/requests/{requestId}/responses'].get);
  assert.ok(paths['/emergency/requests/{requestId}/room']);
  assert.ok(paths['/emergency/rooms/{roomId}/messages']);
  assert.ok(paths['/emergency/rooms/{roomId}/messages'].post);
  assert.ok(paths['/emergency/rooms/{roomId}/messages'].get);
  assert.ok(paths['/emergency/inventory/me']);
  assert.ok(paths['/emergency/inventory/me'].put);
  assert.ok(paths['/emergency/inventory/search']);
  assert.ok(paths['/emergency/inventory/search'].get);
});
