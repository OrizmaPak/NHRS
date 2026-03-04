const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('openapi spec contains organization and membership routes', () => {
  const openapiPath = path.resolve(__dirname, '../../../../docs/openapi.json');
  const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
  const paths = spec.paths || {};

  assert.ok(paths['/orgs']);
  assert.ok(paths['/orgs'].post);
  assert.ok(paths['/orgs/{orgId}']);
  assert.ok(paths['/orgs/{orgId}'].get);
  assert.ok(paths['/orgs/{orgId}/branches']);
  assert.ok(paths['/orgs/{orgId}/branches'].post);
  assert.ok(paths['/orgs/{orgId}/members']);
  assert.ok(paths['/orgs/{orgId}/members'].post);
  assert.ok(paths['/orgs/{orgId}/members/{memberId}/transfer']);
  assert.ok(paths['/orgs/{orgId}/members/{memberId}/transfer'].post);
});
