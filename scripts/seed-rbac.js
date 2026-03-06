const { MongoClient, ServerApiVersion } = require('mongodb');

const mongoUri = process.env.GOVERNANCE_MONGODB_URI || process.env.MONGODB_URI;
const dbName = process.env.RBAC_DB_NAME || process.env.DB_NAME || 'nhrs_rbac_db';

if (!mongoUri) {
  throw new Error('Missing GOVERNANCE_MONGODB_URI or MONGODB_URI');
}

const permissions = [
  { key: 'nin.profile.read', name: 'Read NIN profile', module: 'auth', scope: 'app', actions: ['read'] },
  { key: 'auth.me.read', name: 'Read own profile', module: 'auth', scope: 'app', actions: ['read'] },
  { key: 'auth.password.change', name: 'Change password', module: 'auth', scope: 'app', actions: ['update'] },
  { key: 'auth.contact.phone.write', name: 'Write phone', module: 'auth', scope: 'app', actions: ['update'] },
  { key: 'auth.contact.email.write', name: 'Write email', module: 'auth', scope: 'app', actions: ['update'] },
  { key: 'rbac.app.manage', name: 'Manage app RBAC', module: 'rbac', scope: 'app', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'rbac.org.manage', name: 'Manage org RBAC', module: 'rbac', scope: 'org', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'org.manage', name: 'Manage org', module: 'providers', scope: 'org', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'lab.results.write', name: 'Write lab result', module: 'lab', scope: 'org', actions: ['create', 'update'] },
  { key: 'audit.read', name: 'Read audit logs', module: 'audit', scope: 'app', actions: ['read'] },
  { key: 'org.create', name: 'Create organization', module: 'organization', scope: 'app', actions: ['create'] },
  { key: 'org.list', name: 'List organizations', module: 'organization', scope: 'app', actions: ['read'] },
  { key: 'org.read', name: 'Read organization', module: 'organization', scope: 'app', actions: ['read'] },
  { key: 'org.update', name: 'Update organization', module: 'organization', scope: 'app', actions: ['update'] },
  { key: 'org.owner.assign', name: 'Assign organization owner', module: 'organization', scope: 'app', actions: ['update'] },
  { key: 'org.search', name: 'Search organizations', module: 'organization', scope: 'app', actions: ['read'] },
  { key: 'org.branch.create', name: 'Create branch', module: 'organization', scope: 'org', actions: ['create'] },
  { key: 'org.branch.read', name: 'Read branch', module: 'organization', scope: 'org', actions: ['read'] },
  { key: 'org.branch.update', name: 'Update branch', module: 'organization', scope: 'org', actions: ['update'] },
  { key: 'org.branch.delete', name: 'Delete branch', module: 'organization', scope: 'org', actions: ['delete'] },
  { key: 'org.member.add', name: 'Add org member', module: 'membership', scope: 'org', actions: ['create'] },
  { key: 'org.member.invite', name: 'Invite org member', module: 'membership', scope: 'org', actions: ['create'] },
  { key: 'org.member.read', name: 'Read org member', module: 'membership', scope: 'org', actions: ['read'] },
  { key: 'org.member.list', name: 'List org members', module: 'membership', scope: 'org', actions: ['read'] },
  { key: 'org.member.update', name: 'Update org member', module: 'membership', scope: 'org', actions: ['update'] },
  { key: 'org.member.status.update', name: 'Change org member status', module: 'membership', scope: 'org', actions: ['update'] },
  { key: 'org.branch.assign', name: 'Assign branches to membership', module: 'membership', scope: 'org', actions: ['create'] },
  { key: 'org.branch.assignment.update', name: 'Update branch assignment', module: 'membership', scope: 'org', actions: ['update'] },
  { key: 'org.member.branch.assign', name: 'Assign member to branch', module: 'membership', scope: 'org', actions: ['create'] },
  { key: 'org.member.branch.update', name: 'Update member branch assignment', module: 'membership', scope: 'org', actions: ['update'] },
  { key: 'org.member.branch.remove', name: 'Remove member branch assignment', module: 'membership', scope: 'org', actions: ['delete'] },
  { key: 'org.member.transfer', name: 'Transfer member', module: 'membership', scope: 'org', actions: ['create'] },
  { key: 'org.member.history.read', name: 'Read membership history', module: 'membership', scope: 'org', actions: ['read'] },
  { key: 'membership.user.read', name: 'Read memberships by user', module: 'membership', scope: 'app', actions: ['read'] },
  { key: 'membership.user.history.read', name: 'Read user movement history', module: 'membership', scope: 'app', actions: ['read'] },
  { key: 'records.me.read', name: 'Read own timeline records', module: 'records', scope: 'app', actions: ['read'] },
  { key: 'records.nin.read', name: 'Read timeline records by NIN', module: 'records', scope: 'org', actions: ['read'] },
  { key: 'records.symptoms.create', name: 'Create own symptom record', module: 'records', scope: 'app', actions: ['create'] },
  { key: 'records.entry.create', name: 'Create provider timeline entry', module: 'records', scope: 'org', actions: ['create'] },
  { key: 'records.entry.update', name: 'Update timeline entry', module: 'records', scope: 'app', actions: ['update'] },
  { key: 'records.entry.hide', name: 'Hide timeline entry', module: 'records', scope: 'app', actions: ['update'] },
  { key: 'doctor.register', name: 'Register doctor profile', module: 'doctor-registry', scope: 'app', actions: ['create'] },
  { key: 'doctor.read', name: 'Read doctor profile', module: 'doctor-registry', scope: 'app', actions: ['read'] },
  { key: 'doctor.verify', name: 'Verify doctor license', module: 'doctor-registry', scope: 'app', actions: ['update'] },
  { key: 'doctor.suspend', name: 'Suspend doctor license', module: 'doctor-registry', scope: 'app', actions: ['update'] },
  { key: 'doctor.revoke', name: 'Revoke doctor license', module: 'doctor-registry', scope: 'app', actions: ['update'] },
  { key: 'doctor.reinstate', name: 'Reinstate doctor license', module: 'doctor-registry', scope: 'app', actions: ['update'] },
  { key: 'ui.theme.read', name: 'Read UI themes', module: 'ui-theme', scope: 'app', actions: ['read'] },
  { key: 'ui.theme.write', name: 'Write UI themes', module: 'ui-theme', scope: 'app', actions: ['create', 'update'] },
  { key: 'ui.theme.delete', name: 'Delete UI themes', module: 'ui-theme', scope: 'app', actions: ['delete'] },
];

const roles = [
  {
    name: 'citizen',
    scope: 'app',
    organizationId: null,
    permissions: [
      { permissionKey: 'auth.me.read', effect: 'allow' },
      { permissionKey: 'auth.password.change', effect: 'allow' },
      { permissionKey: 'auth.contact.phone.write', effect: 'allow' },
      { permissionKey: 'auth.contact.email.write', effect: 'allow' },
      { permissionKey: 'nin.profile.read', effect: 'allow' },
      { permissionKey: 'records.me.read', effect: 'allow' },
      { permissionKey: 'records.symptoms.create', effect: 'allow' },
      { permissionKey: 'records.entry.update', effect: 'allow' },
      { permissionKey: 'records.entry.hide', effect: 'allow' },
      { permissionKey: 'doctor.register', effect: 'allow' },
    ],
    isSystem: true,
  },
  {
    name: 'app_admin',
    scope: 'app',
    organizationId: null,
    permissions: [{ permissionKey: '*', effect: 'allow' }],
    isSystem: true,
  },
  {
    name: 'platform_admin',
    scope: 'app',
    organizationId: null,
    permissions: [{ permissionKey: '*', effect: 'allow' }],
    isSystem: true,
  },
  {
    name: 'auditor',
    scope: 'app',
    organizationId: null,
    permissions: [{ permissionKey: 'audit.read', effect: 'allow' }],
    isSystem: true,
  },
  {
    name: 'regulator',
    scope: 'app',
    organizationId: null,
    permissions: [
      { permissionKey: 'doctor.read', effect: 'allow' },
      { permissionKey: 'doctor.verify', effect: 'allow' },
      { permissionKey: 'doctor.suspend', effect: 'allow' },
      { permissionKey: 'doctor.revoke', effect: 'allow' },
      { permissionKey: 'doctor.reinstate', effect: 'allow' },
    ],
    isSystem: true,
  },
  {
    name: 'government_admin',
    scope: 'app',
    organizationId: null,
    permissions: [
      { permissionKey: 'ui.theme.read', effect: 'allow' },
      { permissionKey: 'ui.theme.write', effect: 'allow' },
    ],
    isSystem: true,
  },
  {
    name: 'taskforce_admin',
    scope: 'app',
    organizationId: null,
    permissions: [
      { permissionKey: 'ui.theme.read', effect: 'allow' },
      { permissionKey: 'ui.theme.write', effect: 'allow' },
    ],
    isSystem: true,
  },
  {
    name: 'taskforce_lead',
    scope: 'app',
    organizationId: null,
    permissions: [
      { permissionKey: 'ui.theme.read', effect: 'allow' },
      { permissionKey: 'ui.theme.write', effect: 'allow' },
    ],
    isSystem: true,
  },
  {
    name: 'org_owner',
    scope: 'org',
    organizationId: '__template__',
    permissions: [
      { permissionKey: 'org.read', effect: 'allow' },
      { permissionKey: 'org.list', effect: 'allow' },
      { permissionKey: 'org.update', effect: 'allow' },
      { permissionKey: 'org.owner.assign', effect: 'allow' },
      { permissionKey: 'org.branch.create', effect: 'allow' },
      { permissionKey: 'org.branch.read', effect: 'allow' },
      { permissionKey: 'org.branch.update', effect: 'allow' },
      { permissionKey: 'org.branch.delete', effect: 'allow' },
      { permissionKey: 'org.member.add', effect: 'allow' },
      { permissionKey: 'org.member.invite', effect: 'allow' },
      { permissionKey: 'org.member.read', effect: 'allow' },
      { permissionKey: 'org.member.list', effect: 'allow' },
      { permissionKey: 'org.member.update', effect: 'allow' },
      { permissionKey: 'org.member.status.update', effect: 'allow' },
      { permissionKey: 'org.branch.assign', effect: 'allow' },
      { permissionKey: 'org.branch.assignment.update', effect: 'allow' },
      { permissionKey: 'org.member.branch.assign', effect: 'allow' },
      { permissionKey: 'org.member.branch.update', effect: 'allow' },
      { permissionKey: 'org.member.branch.remove', effect: 'allow' },
      { permissionKey: 'org.member.transfer', effect: 'allow' },
      { permissionKey: 'org.member.history.read', effect: 'allow' },
      { permissionKey: 'records.nin.read', effect: 'allow' },
      { permissionKey: 'records.entry.create', effect: 'allow' },
      { permissionKey: 'ui.theme.read', effect: 'allow' },
      { permissionKey: 'ui.theme.write', effect: 'allow' },
    ],
    isSystem: true,
  },
  {
    name: 'org_staff',
    scope: 'org',
    organizationId: '__template__',
    permissions: [
      { permissionKey: 'org.list', effect: 'allow' },
      { permissionKey: 'org.read', effect: 'allow' },
      { permissionKey: 'org.branch.read', effect: 'allow' },
      { permissionKey: 'org.member.read', effect: 'allow' },
      { permissionKey: 'org.member.list', effect: 'allow' },
      { permissionKey: 'membership.user.read', effect: 'allow' },
      { permissionKey: 'membership.user.history.read', effect: 'allow' },
      { permissionKey: 'records.nin.read', effect: 'allow' },
      { permissionKey: 'ui.theme.read', effect: 'allow' },
    ],
    isSystem: true,
  },
];

async function main() {
  const client = new MongoClient(mongoUri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();
  const db = client.db(dbName);

  const permCol = db.collection('permissions');
  const roleCol = db.collection('roles');

  await permCol.createIndex({ key: 1, scope: 1, organizationId: 1 }, { unique: true });
  await roleCol.createIndex({ name: 1, scope: 1, organizationId: 1 }, { unique: true });

  for (const p of permissions) {
    await permCol.updateOne(
      { key: p.key, scope: p.scope, organizationId: null },
      {
        $set: {
          key: p.key,
          name: p.name,
          description: p.name,
          scope: p.scope,
          organizationId: null,
          module: p.module,
          actions: p.actions,
          isSystem: true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  }

  for (const r of roles) {
    await roleCol.updateOne(
      { name: r.name, scope: r.scope, organizationId: r.organizationId },
      {
        $set: {
          ...r,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  }

  console.log(`Seeded RBAC defaults in ${dbName}`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

