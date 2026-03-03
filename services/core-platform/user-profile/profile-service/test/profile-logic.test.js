const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeOnboarding,
  pickEditableProfileFields,
  buildProfileUpsertFromEnsure,
  mergeProfileView,
} = require('../src/profile-logic');

test('profile ensure creation builds onboarding and status', () => {
  const doc = buildProfileUpsertFromEnsure({
    userId: 'u1',
    nin: '90000000001',
    phoneVerified: true,
    emailVerified: false,
    hasSetPassword: true,
  });
  assert.equal(doc.userId, 'u1');
  assert.equal(doc.nin, '90000000001');
  assert.equal(doc.onboarding.hasSetPassword, true);
  assert.equal(doc.onboarding.hasVerifiedPhone, true);
  assert.equal(typeof doc.onboarding.completenessScore, 'number');
});

test('editable fields restriction ignores forbidden fields', () => {
  const editable = pickEditableProfileFields({
    displayName: 'Test User',
    nin: 'should-not-pass',
    firstName: 'forbidden',
    preferences: { notificationChannels: ['sms', 'invalid'], language: 'en' },
  });
  assert.equal(editable.displayName, 'Test User');
  assert.equal(editable.nin, undefined);
  assert.equal(editable.firstName, undefined);
  assert.deepEqual(editable.preferences.notificationChannels, ['sms']);
});

test('merge profile view includes nin and roles summary', () => {
  const merged = mergeProfileView({
    profile: { userId: 'u2', displayName: 'U2' },
    ninSummary: { nin: '90000000002' },
    rolesSummary: { appScopePermissions: [{ permissionKey: 'profile.me.read' }] },
    membershipSummary: { organizations: [] },
  });
  assert.equal(merged.profile.userId, 'u2');
  assert.equal(merged.ninSummary.nin, '90000000002');
  assert.equal(Array.isArray(merged.rolesSummary.appScopePermissions), true);
});

test('compute onboarding returns deterministic next progress shape', () => {
  const out = computeOnboarding({
    onboarding: { hasSetPassword: true, hasVerifiedPhone: true, hasVerifiedEmail: false },
    displayName: 'Name',
  });
  assert.equal(Array.isArray(out.completedSteps), true);
  assert.equal(typeof out.completenessScore, 'number');
});
