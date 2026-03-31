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
  { key: 'care.workspace.read', name: 'Access patient care workspace', module: 'care', scope: 'org', actions: ['read'] },
  { key: 'profile.search', name: 'Search profiles', module: 'profile', scope: 'org', actions: ['read'] },
    { key: 'profile.user.read', name: 'Read user profile', module: 'profile', scope: 'org', actions: ['read'] },
    { key: 'profile.user.update', name: 'Update user profile', module: 'profile', scope: 'org', actions: ['update'] },
    { key: 'profile.placeholder.create', name: 'Register patient into organization care register', module: 'care', scope: 'org', actions: ['create'] },
  { key: 'org.manage', name: 'Manage org', module: 'providers', scope: 'org', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'lab.results.write', name: 'Write lab result', module: 'lab', scope: 'org', actions: ['create', 'update'] },
  { key: 'audit.read', name: 'Read audit logs', module: 'audit', scope: 'app', actions: ['read'] },
  { key: 'profile.search', name: 'Search profiles', module: 'profile', scope: 'app', actions: ['read'] },
  { key: 'profile.user.read', name: 'Read user profile', module: 'profile', scope: 'app', actions: ['read'] },
  { key: 'profile.user.update', name: 'Update user profile', module: 'profile', scope: 'app', actions: ['update'] },
  { key: 'ui.theme.read', name: 'Read UI themes', module: 'ui-theme', scope: 'app', actions: ['read'] },
  { key: 'ui.theme.write', name: 'Write UI themes', module: 'ui-theme', scope: 'app', actions: ['create', 'update'] },
  { key: 'ui.theme.delete', name: 'Delete UI themes', module: 'ui-theme', scope: 'app', actions: ['delete'] },
  { key: 'org.create', name: 'Create organization', module: 'organization', scope: 'app', actions: ['create'] },
  { key: 'org.list', name: 'List organizations', module: 'organization', scope: 'app', actions: ['read'] },
  { key: 'org.deleted.read', name: 'Read deleted organizations', module: 'organization', scope: 'app', actions: ['read'] },
  { key: 'org.read', name: 'Read organization', module: 'organization', scope: 'app', actions: ['read'] },
  { key: 'org.update', name: 'Update organization', module: 'organization', scope: 'app', actions: ['update'] },
  { key: 'org.owner.assign', name: 'Assign organization owner', module: 'organization', scope: 'app', actions: ['update'] },
  { key: 'org.search', name: 'Search organizations', module: 'organization', scope: 'app', actions: ['read'] },
  { key: 'integrations.view', name: 'View integrations', module: 'integrations', scope: 'app', actions: ['read'] },
  { key: 'api.keys.manage', name: 'Manage API keys', module: 'integrations', scope: 'app', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'global.services.manage', name: 'Manage global services catalog', module: 'catalog', scope: 'app', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'global.services.create', name: 'Create global service', module: 'catalog', scope: 'app', actions: ['create'] },
  { key: 'global.services.update', name: 'Update global service', module: 'catalog', scope: 'app', actions: ['update'] },
  { key: 'global.services.delete', name: 'Delete global service', module: 'catalog', scope: 'app', actions: ['delete'] },
  { key: 'admin.settings.manage', name: 'Manage admin system settings', module: 'admin', scope: 'app', actions: ['read', 'update'] },
  { key: 'analytics.view', name: 'View analytics dashboards', module: 'analytics', scope: 'app', actions: ['read'] },
  { key: 'reports.view', name: 'View reports', module: 'reports', scope: 'app', actions: ['read'] },
  { key: 'compliance.view', name: 'View compliance dashboards', module: 'compliance', scope: 'app', actions: ['read'] },
  { key: 'institution.dashboard.view', name: 'View institution dashboard', module: 'institution', scope: 'app', actions: ['read'] },
  { key: 'sync.monitor.view', name: 'View sync monitor', module: 'integrations', scope: 'app', actions: ['read'] },
  { key: 'notifications.view', name: 'View notifications', module: 'system', scope: 'app', actions: ['read'] },
  { key: 'alerts.view', name: 'View alerts', module: 'system', scope: 'app', actions: ['read'] },
  { key: 'system.activity.view', name: 'View system activity', module: 'system', scope: 'app', actions: ['read'] },
  { key: 'system.monitoring.view', name: 'View system monitoring', module: 'system', scope: 'app', actions: ['read'] },
  { key: 'system.configuration.manage', name: 'Manage system configuration', module: 'system', scope: 'app', actions: ['read', 'update'] },
  { key: 'system.observability.view', name: 'View system observability', module: 'system', scope: 'app', actions: ['read'] },
  { key: 'system.health.view', name: 'View system health', module: 'system', scope: 'app', actions: ['read'] },
  { key: 'dev.tools.view', name: 'View developer tools', module: 'system', scope: 'app', actions: ['read'] },
  { key: 'global.services.manage', name: 'Manage global services catalog', module: 'catalog', scope: 'org', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'global.services.create', name: 'Create global service', module: 'catalog', scope: 'org', actions: ['create'] },
  { key: 'global.services.update', name: 'Update global service', module: 'catalog', scope: 'org', actions: ['update'] },
  { key: 'global.services.delete', name: 'Delete global service', module: 'catalog', scope: 'org', actions: ['delete'] },
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
  { key: 'encounters.read', name: 'Read encounters', module: 'encounters', scope: 'org', actions: ['read'] },
  { key: 'encounters.create', name: 'Create encounter', module: 'encounters', scope: 'org', actions: ['create'] },
  { key: 'encounters.update', name: 'Update encounter', module: 'encounters', scope: 'org', actions: ['update'] },
  { key: 'encounters.finalize', name: 'Finalize encounter', module: 'encounters', scope: 'org', actions: ['update'] },
  { key: 'labs.read', name: 'Read lab workflows', module: 'labs', scope: 'org', actions: ['read'] },
  { key: 'labs.create', name: 'Create lab request', module: 'labs', scope: 'org', actions: ['create'] },
  { key: 'labs.update', name: 'Update lab result', module: 'labs', scope: 'org', actions: ['update'] },
  { key: 'labs.complete', name: 'Complete lab result', module: 'labs', scope: 'org', actions: ['update'] },
  { key: 'pharmacy.read', name: 'Read pharmacy workflows', module: 'pharmacy', scope: 'org', actions: ['read'] },
  { key: 'pharmacy.create', name: 'Create prescription', module: 'pharmacy', scope: 'org', actions: ['create'] },
  { key: 'pharmacy.update', name: 'Update prescription', module: 'pharmacy', scope: 'org', actions: ['update'] },
  { key: 'pharmacy.dispense', name: 'Dispense prescription', module: 'pharmacy', scope: 'org', actions: ['update'] },
  { key: 'records.symptoms.create', name: 'Create own symptom record', module: 'records', scope: 'app', actions: ['create'] },
  { key: 'records.entry.create', name: 'Create provider timeline entry', module: 'records', scope: 'org', actions: ['create'] },
  { key: 'records.entry.update', name: 'Update timeline entry', module: 'records', scope: 'app', actions: ['update'] },
  { key: 'records.entry.hide', name: 'Hide timeline entry', module: 'records', scope: 'app', actions: ['update'] },
  { key: 'doctor.search', name: 'Search doctor registry', module: 'doctor-registry', scope: 'app', actions: ['read'] },
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

  const orgWorkspacePermissions = [
    { key: 'auth.me.read', name: 'Read own profile', module: 'auth', scope: 'org', actions: ['read'] },
    { key: 'care.workspace.read', name: 'Access patient care workspace', module: 'care', scope: 'org', actions: ['read'] },
    { key: 'profile.search', name: 'Search patient profiles', module: 'profile', scope: 'org', actions: ['read'] },
    { key: 'profile.user.read', name: 'Read patient profile', module: 'profile', scope: 'org', actions: ['read'] },
    { key: 'profile.user.update', name: 'Update user profile', module: 'profile', scope: 'org', actions: ['update'] },
    { key: 'profile.placeholder.create', name: 'Register patient into organization care register', module: 'care', scope: 'org', actions: ['create'] },
    { key: 'records.nin.read', name: 'Read patient timeline by NIN', module: 'records', scope: 'org', actions: ['read'] },
  { key: 'encounters.read', name: 'Read encounters', module: 'encounters', scope: 'org', actions: ['read'] },
  { key: 'labs.read', name: 'Read lab workflows', module: 'labs', scope: 'org', actions: ['read'] },
  { key: 'pharmacy.read', name: 'Read pharmacy workflows', module: 'pharmacy', scope: 'org', actions: ['read'] },
  { key: 'ui.theme.read', name: 'Read UI themes', module: 'ui-theme', scope: 'org', actions: ['read'] },
  { key: 'ui.theme.write', name: 'Write UI themes', module: 'ui-theme', scope: 'org', actions: ['create', 'update'] },
  { key: 'ui.theme.delete', name: 'Delete UI themes', module: 'ui-theme', scope: 'org', actions: ['delete'] },
  { key: 'integrations.view', name: 'View integrations', module: 'integrations', scope: 'org', actions: ['read'] },
  { key: 'api.keys.manage', name: 'Manage API keys', module: 'integrations', scope: 'org', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'rbac.org.manage', name: 'Manage org RBAC', module: 'rbac', scope: 'org', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'org.list', name: 'List organizations', module: 'organization', scope: 'org', actions: ['read'] },
  { key: 'org.read', name: 'Read organization', module: 'organization', scope: 'org', actions: ['read'] },
  { key: 'org.update', name: 'Update organization', module: 'organization', scope: 'org', actions: ['update'] },
  { key: 'org.owner.assign', name: 'Assign organization owner', module: 'organization', scope: 'org', actions: ['update'] },
  { key: 'global.services.manage', name: 'Manage global services catalog', module: 'catalog', scope: 'org', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'global.services.create', name: 'Create global service', module: 'catalog', scope: 'org', actions: ['create'] },
  { key: 'global.services.update', name: 'Update global service', module: 'catalog', scope: 'org', actions: ['update'] },
  { key: 'global.services.delete', name: 'Delete global service', module: 'catalog', scope: 'org', actions: ['delete'] },
];

for (const permission of orgWorkspacePermissions) {
  if (!permissions.some((entry) => entry.key === permission.key && entry.scope === permission.scope)) {
    permissions.push(permission);
  }
}

const explicitOrgWorkspaceRoleRules = [
  'auth.me.read',
    'care.workspace.read',
    'profile.search',
    'profile.user.read',
    'profile.user.update',
    'profile.placeholder.create',
    'records.nin.read',
  'encounters.read',
  'labs.read',
  'pharmacy.read',
  'ui.theme.write',
  'integrations.view',
  'api.keys.manage',
  'rbac.org.manage',
  'org.list',
  'org.read',
  'org.update',
  'org.owner.assign',
  'global.services.manage',
  'global.services.create',
  'global.services.update',
  'global.services.delete',
  'org.branch.create',
  'org.branch.read',
  'org.branch.update',
  'org.branch.delete',
  'org.member.add',
  'org.member.invite',
  'org.member.read',
  'org.member.list',
  'org.member.update',
  'org.member.status.update',
  'org.branch.assign',
  'org.branch.assignment.update',
  'org.member.branch.assign',
  'org.member.branch.update',
  'org.member.branch.remove',
  'org.member.transfer',
  'org.member.history.read',
].map((permissionKey) => ({ permissionKey, effect: 'allow' }));

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
    permissions: explicitOrgWorkspaceRoleRules,
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

