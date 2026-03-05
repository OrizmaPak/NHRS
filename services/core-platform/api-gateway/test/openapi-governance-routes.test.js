const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const openapiPath = path.resolve(__dirname, '../../../..', 'docs/openapi.json');

test('openapi spec contains governance taskforce routes', () => {
  const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
  const paths = spec.paths || {};

  assert.ok(paths['/taskforce/units']);
  assert.ok(paths['/taskforce/units'].post);
  assert.ok(paths['/taskforce/units'].get);
  assert.ok(paths['/taskforce/units/{unitId}']);
  assert.ok(paths['/taskforce/units/{unitId}'].patch);
  assert.ok(paths['/taskforce/units/{unitId}/members']);
  assert.ok(paths['/taskforce/units/{unitId}/members'].post);
  assert.ok(paths['/taskforce/units/{unitId}/members'].get);
  assert.ok(paths['/taskforce/units/{unitId}/members/{memberId}']);
  assert.ok(paths['/taskforce/units/{unitId}/members/{memberId}'].delete);

  assert.ok(paths['/cases']);
  assert.ok(paths['/cases'].post);
  assert.ok(paths['/cases'].get);
  assert.ok(paths['/cases/{caseId}']);
  assert.ok(paths['/cases/{caseId}'].get);
  assert.ok(paths['/cases/{caseId}/status']);
  assert.ok(paths['/cases/{caseId}/status'].patch);
  assert.ok(paths['/cases/{caseId}/corrections/propose']);
  assert.ok(paths['/cases/{caseId}/corrections/approve']);
  assert.ok(paths['/cases/{caseId}/corrections/reject']);
  assert.ok(paths['/cases/{caseId}/room']);
  assert.ok(paths['/case-rooms/{roomId}/messages']);
  assert.ok(paths['/case-rooms/{roomId}/messages'].post);
  assert.ok(paths['/case-rooms/{roomId}/messages'].get);
  assert.ok(paths['/cases/{caseId}/escalate']);
});
