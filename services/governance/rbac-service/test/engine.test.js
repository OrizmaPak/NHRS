const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePermission, mergeRules, matchesPermission } = require('../src/engine');

test('matches exact permission', () => {
  assert.equal(matchesPermission('nin.profile.read', 'nin.profile.read'), true);
});

test('matches wildcard permission', () => {
  assert.equal(matchesPermission('nin.*', 'nin.profile.read'), true);
});

test('does not match unrelated permission', () => {
  assert.equal(matchesPermission('records.read', 'nin.profile.read'), false);
});

test('role allow grants when no override', () => {
  const result = evaluatePermission({
    permissionKey: 'nin.profile.read',
    roleRules: [{ permissionKey: 'nin.profile.read', effect: 'allow' }],
    overrideRules: [],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.effectiveFrom, 'role');
});

test('role deny blocks when no override', () => {
  const result = evaluatePermission({
    permissionKey: 'nin.profile.read',
    roleRules: [{ permissionKey: 'nin.profile.read', effect: 'deny' }],
    overrideRules: [],
  });
  assert.equal(result.allowed, false);
  assert.equal(result.effectiveFrom, 'role');
});

test('deny override blocks role allow', () => {
  const result = evaluatePermission({
    permissionKey: 'nin.profile.read',
    roleRules: [{ permissionKey: 'nin.profile.read', effect: 'allow' }],
    overrideRules: [{ permissionKey: 'nin.profile.read', effect: 'deny' }],
  });
  assert.equal(result.allowed, false);
  assert.equal(result.effectiveFrom, 'override');
});

test('allow override grants over role deny', () => {
  const result = evaluatePermission({
    permissionKey: 'lab.results.write',
    roleRules: [{ permissionKey: 'lab.results.write', effect: 'deny' }],
    overrideRules: [{ permissionKey: 'lab.results.write', effect: 'allow' }],
  });
  assert.equal(result.allowed, true);
  assert.equal(result.effectiveFrom, 'override');
});

test('specific override beats wildcard role', () => {
  const result = evaluatePermission({
    permissionKey: 'records.encounter.create',
    roleRules: [{ permissionKey: 'records.*', effect: 'allow' }],
    overrideRules: [{ permissionKey: 'records.encounter.create', effect: 'deny' }],
  });
  assert.equal(result.allowed, false);
});

test('mergeRules applies overrides last', () => {
  const merged = mergeRules(
    [{ permissionKey: 'nin.profile.read', effect: 'allow' }],
    [{ permissionKey: 'nin.profile.read', effect: 'deny' }]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].effect, 'deny');
  assert.equal(merged[0].source, 'override');
});

test('no matching rules denies by default', () => {
  const result = evaluatePermission({ permissionKey: 'unknown.permission', roleRules: [], overrideRules: [] });
  assert.equal(result.allowed, false);
});
