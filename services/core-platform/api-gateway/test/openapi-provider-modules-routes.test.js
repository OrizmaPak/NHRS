const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('openapi spec contains provider module routes', () => {
  const openapiPath = path.resolve(__dirname, '../../../../docs/openapi.json');
  const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
  const paths = spec.paths || {};

  assert.ok(paths['/encounters/{nin}']);
  assert.ok(paths['/encounters/{nin}'].post);
  assert.ok(paths['/encounters/{nin}'].get);
  assert.ok(paths['/encounters/id/{encounterId}']);
  assert.ok(paths['/encounters/id/{encounterId}'].get);
  assert.ok(paths['/encounters/id/{encounterId}'].patch);

  assert.ok(paths['/labs/{nin}/results']);
  assert.ok(paths['/labs/{nin}/results'].post);
  assert.ok(paths['/labs/{nin}/results'].get);
  assert.ok(paths['/labs/results/id/{resultId}']);
  assert.ok(paths['/labs/results/id/{resultId}'].get);
  assert.ok(paths['/labs/results/id/{resultId}'].patch);

  assert.ok(paths['/pharmacy/{nin}/dispenses']);
  assert.ok(paths['/pharmacy/{nin}/dispenses'].post);
  assert.ok(paths['/pharmacy/{nin}/dispenses'].get);
  assert.ok(paths['/pharmacy/dispenses/id/{dispenseId}']);
  assert.ok(paths['/pharmacy/dispenses/id/{dispenseId}'].get);
  assert.ok(paths['/pharmacy/dispenses/id/{dispenseId}'].patch);

  assert.ok(paths['/doctors/register']);
  assert.ok(paths['/doctors/register'].post);
  assert.ok(paths['/doctors/search']);
  assert.ok(paths['/doctors/search'].get);
  assert.ok(paths['/doctors/{doctorId}']);
  assert.ok(paths['/doctors/{doctorId}'].get);
  assert.ok(paths['/licenses/{doctorId}/verify']);
  assert.ok(paths['/licenses/{doctorId}/verify'].post);
  assert.ok(paths['/licenses/{doctorId}/suspend']);
  assert.ok(paths['/licenses/{doctorId}/suspend'].post);
  assert.ok(paths['/licenses/{doctorId}/revoke']);
  assert.ok(paths['/licenses/{doctorId}/revoke'].post);
  assert.ok(paths['/licenses/{doctorId}/reinstate']);
  assert.ok(paths['/licenses/{doctorId}/reinstate'].post);
});
