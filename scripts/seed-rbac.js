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
    ],
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
