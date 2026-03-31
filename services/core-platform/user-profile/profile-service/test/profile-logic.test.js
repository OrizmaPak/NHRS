const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeOnboarding,
  pickEditableProfileFields,
  pickMissingSelfProfileFields,
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

test('self editable patch only fills missing supported profile fields', () => {
  const patch = pickMissingSelfProfileFields(
    {
      displayName: 'Existing Name',
      otherName: null,
      dob: null,
      gender: 'female',
      nationality: null,
      stateOfOrigin: 'Lagos',
      localGovernment: null,
      address: {
        country: 'Nigeria',
        state: null,
        line1: null,
      },
    },
    {
      displayName: 'New Name',
      otherName: 'Brewster',
      dob: '1990-01-01',
      gender: 'male',
      nationality: 'Nigeria',
      stateOfOrigin: 'Oyo',
      localGovernment: 'Ibadan North',
      address: {
        country: 'Ghana',
        state: 'Oyo',
        line1: '12 Health Avenue',
      },
    },
  );

  assert.equal(patch.displayName, undefined);
  assert.equal(patch.otherName, 'Brewster');
  assert.equal(patch.dob, '1990-01-01');
  assert.equal(patch.gender, undefined);
  assert.equal(patch.nationality, 'Nigeria');
  assert.equal(patch.stateOfOrigin, undefined);
  assert.equal(patch.localGovernment, 'Ibadan North');
  assert.deepEqual(patch.address, {
    state: 'Oyo',
    line1: '12 Health Avenue',
  });
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
