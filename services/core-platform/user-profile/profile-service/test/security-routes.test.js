const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('GET /profile/me enforces profile.me.read permission', () => {
  const serverPath = path.resolve(__dirname, '../src/server.js');
  const source = fs.readFileSync(serverPath, 'utf8');
  const routeBlockPattern = /fastify\.get\('\/profile\/me'[\s\S]*?async \(req, reply\) => \{[\s\S]*?enforcePermission\(req, reply, 'profile\.me\.read'\)/;
  assert.equal(routeBlockPattern.test(source), true);
});
