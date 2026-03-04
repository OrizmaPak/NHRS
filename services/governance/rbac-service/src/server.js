const fastify = require('fastify')({ logger: true });
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const { evaluatePermission, mergeRules } = require('./engine');

const serviceName = 'rbac-service';
const port = Number(process.env.PORT) || 8090;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_rbac_db';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const cacheTtlSec = Number(process.env.RBAC_CACHE_TTL_SEC) || 60;
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';

let dbReady = false;
let redisReady = false;
let mongoClient;
let redisClient;
let db;

const collections = {
  permissions: () => db.collection('permissions'),
  roles: () => db.collection('roles'),
  userAccess: () => db.collection('user_access'),
  roleAssignments: () => db.collection('user_role_assignments'),
};

const systemPermissions = [
  { key: 'nin.profile.read', name: 'Read NIN profile', scope: 'app', module: 'auth', actions: ['read'], isSystem: true },
  { key: 'auth.contact.phone.write', name: 'Write phone contact', scope: 'app', module: 'auth', actions: ['update'], isSystem: true },
  { key: 'auth.contact.email.write', name: 'Write email contact', scope: 'app', module: 'auth', actions: ['update'], isSystem: true },
  { key: 'auth.password.change', name: 'Change password', scope: 'app', module: 'auth', actions: ['update'], isSystem: true },
  { key: 'rbac.app.manage', name: 'Manage app RBAC', scope: 'app', module: 'rbac', actions: ['create', 'read', 'update', 'delete'], isSystem: true },
  { key: 'rbac.org.manage', name: 'Manage org RBAC', scope: 'org', module: 'rbac', actions: ['create', 'read', 'update', 'delete'], isSystem: true },
  { key: 'org.manage', name: 'Manage organization', scope: 'org', module: 'providers', actions: ['create', 'read', 'update', 'delete'], isSystem: true },
  { key: 'lab.results.write', name: 'Write lab results', scope: 'org', module: 'lab', actions: ['create', 'update'], isSystem: true },
  { key: 'audit.read', name: 'Read audit logs', scope: 'app', module: 'audit', actions: ['read'], isSystem: true },
  { key: 'auth.me.read', name: 'Read own profile', scope: 'app', module: 'auth', actions: ['read'], isSystem: true },
  { key: 'profile.me.read', name: 'Read own profile record', scope: 'app', module: 'profile', actions: ['read'], isSystem: true },
  { key: 'profile.me.update', name: 'Update own profile record', scope: 'app', module: 'profile', actions: ['update'], isSystem: true },
  { key: 'profile.search', name: 'Search profiles', scope: 'org', module: 'profile', actions: ['read'], isSystem: true },
  { key: 'profile.user.read', name: 'Read user profile', scope: 'org', module: 'profile', actions: ['read'], isSystem: true },
  { key: 'profile.placeholder.create', name: 'Create profile placeholder', scope: 'org', module: 'profile', actions: ['create'], isSystem: true },
  { key: 'profile.nin.refresh.request', name: 'Request NIN refresh for profile', scope: 'app', module: 'profile', actions: ['create'], isSystem: true },
  { key: 'org.create', name: 'Create organization', scope: 'app', module: 'organization', actions: ['create'], isSystem: true },
  { key: 'org.read', name: 'Read organization', scope: 'app', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.update', name: 'Update organization', scope: 'app', module: 'organization', actions: ['update'], isSystem: true },
  { key: 'org.owner.assign', name: 'Assign organization owner', scope: 'app', module: 'organization', actions: ['update'], isSystem: true },
  { key: 'org.search', name: 'Search organizations', scope: 'app', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.branch.create', name: 'Create branch', scope: 'org', module: 'organization', actions: ['create'], isSystem: true },
  { key: 'org.branch.read', name: 'Read branch', scope: 'org', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.branch.update', name: 'Update branch', scope: 'org', module: 'organization', actions: ['update'], isSystem: true },
  { key: 'org.branch.delete', name: 'Delete branch', scope: 'org', module: 'organization', actions: ['delete'], isSystem: true },
  { key: 'org.member.add', name: 'Add org member', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.read', name: 'Read org member', scope: 'org', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'org.member.update', name: 'Update org member', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.member.status.change', name: 'Change org member status', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.member.branch.assign', name: 'Assign member to branch', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.branch.update', name: 'Update member branch assignment', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.member.branch.remove', name: 'Remove member branch assignment', scope: 'org', module: 'membership', actions: ['delete'], isSystem: true },
  { key: 'org.member.transfer', name: 'Transfer member branch assignment', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.history.read', name: 'Read membership history', scope: 'org', module: 'membership', actions: ['read'], isSystem: true },
];

const systemRoles = [
  {
    name: 'citizen',
    description: 'Default citizen role',
    scope: 'app',
    organizationId: null,
    isSystem: true,
    permissions: [
      { permissionKey: 'auth.me.read', effect: 'allow' },
      { permissionKey: 'auth.password.change', effect: 'allow' },
      { permissionKey: 'auth.contact.phone.write', effect: 'allow' },
      { permissionKey: 'auth.contact.email.write', effect: 'allow' },
      { permissionKey: 'nin.profile.read', effect: 'allow' },
      { permissionKey: 'profile.me.read', effect: 'allow' },
      { permissionKey: 'profile.me.update', effect: 'allow' },
      { permissionKey: 'profile.nin.refresh.request', effect: 'allow' },
      { permissionKey: 'org.create', effect: 'allow' },
      { permissionKey: 'org.read', effect: 'allow' },
      { permissionKey: 'org.search', effect: 'allow' },
    ],
  },
  {
    name: 'platform_admin',
    description: 'Platform administrator',
    scope: 'app',
    organizationId: null,
    isSystem: true,
    permissions: [{ permissionKey: '*', effect: 'allow' }],
  },
  {
    name: 'auditor',
    description: 'Read-only auditor',
    scope: 'app',
    organizationId: null,
    isSystem: true,
    permissions: [
      { permissionKey: 'audit.read', effect: 'allow' },
      { permissionKey: 'nin.profile.read', effect: 'allow' },
    ],
  },
  {
    name: 'org_admin',
    description: 'Organization admin',
    scope: 'org',
    organizationId: '__template__',
    isSystem: true,
    permissions: [
      { permissionKey: 'rbac.org.manage', effect: 'allow' },
      { permissionKey: 'org.manage', effect: 'allow' },
      { permissionKey: 'org.read', effect: 'allow' },
      { permissionKey: 'org.update', effect: 'allow' },
      { permissionKey: 'org.owner.assign', effect: 'allow' },
      { permissionKey: 'org.search', effect: 'allow' },
      { permissionKey: 'org.branch.create', effect: 'allow' },
      { permissionKey: 'org.branch.read', effect: 'allow' },
      { permissionKey: 'org.branch.update', effect: 'allow' },
      { permissionKey: 'org.branch.delete', effect: 'allow' },
      { permissionKey: 'org.member.add', effect: 'allow' },
      { permissionKey: 'org.member.read', effect: 'allow' },
      { permissionKey: 'org.member.update', effect: 'allow' },
      { permissionKey: 'org.member.status.change', effect: 'allow' },
      { permissionKey: 'org.member.branch.assign', effect: 'allow' },
      { permissionKey: 'org.member.branch.update', effect: 'allow' },
      { permissionKey: 'org.member.branch.remove', effect: 'allow' },
      { permissionKey: 'org.member.transfer', effect: 'allow' },
      { permissionKey: 'org.member.history.read', effect: 'allow' },
      { permissionKey: 'nin.profile.read', effect: 'allow' },
      { permissionKey: 'lab.results.write', effect: 'allow' },
      { permissionKey: 'profile.search', effect: 'allow' },
      { permissionKey: 'profile.user.read', effect: 'allow' },
      { permissionKey: 'profile.placeholder.create', effect: 'allow' },
    ],
  },
  {
    name: 'staff',
    description: 'Organization staff',
    scope: 'org',
    organizationId: '__template__',
    isSystem: true,
    permissions: [
      { permissionKey: 'nin.profile.read', effect: 'allow' },
      { permissionKey: 'lab.results.write', effect: 'deny' },
      { permissionKey: 'profile.search', effect: 'allow' },
      { permissionKey: 'profile.user.read', effect: 'allow' },
      { permissionKey: 'profile.placeholder.create', effect: 'allow' },
      { permissionKey: 'org.branch.read', effect: 'allow' },
      { permissionKey: 'org.member.read', effect: 'allow' },
      { permissionKey: 'org.member.history.read', effect: 'allow' },
    ],
  },
  {
    name: 'staff_readonly',
    description: 'Read-only staff',
    scope: 'org',
    organizationId: '__template__',
    isSystem: true,
    permissions: [
      { permissionKey: 'nin.profile.read', effect: 'allow' },
      { permissionKey: 'lab.results.write', effect: 'deny' },
      { permissionKey: 'profile.search', effect: 'allow' },
      { permissionKey: 'profile.user.read', effect: 'allow' },
      { permissionKey: 'org.branch.read', effect: 'allow' },
      { permissionKey: 'org.member.read', effect: 'allow' },
    ],
  },
];

function emitAuditEvent(event) {
  setImmediate(async () => {
    try {
      await fetch(`${auditApiBaseUrl}/internal/audit/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (err) {
      fastify.log.warn({ err, eventType: event?.eventType }, 'RBAC audit emit failed');
    }
  });
}

function normalizeOrgId(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function parseAuthHeader(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

async function getCacheVersion() {
  if (!redisReady) {
    return '0';
  }
  const val = await redisClient.get('rbac:version');
  return val || '0';
}

async function bumpCacheVersion() {
  if (!redisReady) {
    return;
  }
  await redisClient.incr('rbac:version');
}

async function requireAuth(req, reply) {
  const token = parseAuthHeader(req);
  if (!token) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    req.auth = {
      userId: String(payload.sub),
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      tokenPayload: payload,
    };
  } catch (_err) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
}

async function requireInternal(req, reply) {
  const incoming = req.headers['x-internal-token'];
  if (!incoming || incoming !== internalServiceToken) {
    return reply.code(401).send({ message: 'Unauthorized internal call' });
  }
}

async function connect() {
  if (!mongoUri) {
    fastify.log.warn('MONGODB_URI missing; RBAC service running in degraded mode');
    return;
  }

  try {
    mongoClient = new MongoClient(mongoUri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    await mongoClient.connect();
    db = mongoClient.db(dbName);
    await db.command({ ping: 1 });
    dbReady = true;
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed; RBAC service in degraded mode');
  }

  try {
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => fastify.log.error({ err }, 'Redis error'));
    await redisClient.connect();
    redisReady = true;
  } catch (err) {
    fastify.log.warn({ err }, 'Redis connection failed; continuing without cache');
  }

  if (!dbReady) {
    return;
  }

  await Promise.all([
    collections.permissions().createIndex({ key: 1, scope: 1, organizationId: 1 }, { unique: true }),
    collections.roles().createIndex({ name: 1, scope: 1, organizationId: 1 }, { unique: true }),
    collections.userAccess().createIndex({ userId: 1, scope: 1, organizationId: 1 }, { unique: true }),
    collections.roleAssignments().createIndex({ userId: 1, scope: 1, organizationId: 1 }, { unique: true }),
  ]);

  for (const perm of systemPermissions) {
    await collections.permissions().updateOne(
      { key: perm.key, scope: perm.scope, organizationId: null },
      {
        $set: {
          key: perm.key,
          name: perm.name,
          description: perm.description || perm.name,
          scope: perm.scope,
          module: perm.module,
          actions: perm.actions,
          isSystem: true,
          organizationId: null,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  }

  for (const role of systemRoles.filter((r) => r.scope === 'app')) {
    await collections.roles().updateOne(
      { name: role.name, scope: 'app', organizationId: null },
      {
        $set: {
          name: role.name,
          description: role.description,
          scope: 'app',
          organizationId: null,
          permissions: role.permissions,
          isSystem: true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
  }

  if (redisReady) {
    await redisClient.setNX('rbac:version', '1');
  }

  fastify.log.info({ dbName, redisReady }, 'RBAC service initialized');
}

function assertDependencyReady(reply) {
  if (!dbReady) {
    reply.code(503).send({ message: 'RBAC storage unavailable' });
    return false;
  }
  return true;
}

async function getRoleDocsByIds(roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    return [];
  }
  const objectIds = roleIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (objectIds.length === 0) {
    return [];
  }
  return collections.roles().find({ _id: { $in: objectIds } }).toArray();
}

async function getUserScopeArtifacts(userId, organizationId) {
  const orgId = normalizeOrgId(organizationId);

  const appAssignment = await collections.roleAssignments().findOne({
    userId,
    scope: 'app',
    organizationId: null,
  });
  const orgAssignment = orgId
    ? await collections.roleAssignments().findOne({ userId, scope: 'org', organizationId: orgId })
    : null;

  const appRoles = await getRoleDocsByIds(appAssignment?.roleIds || []);
  const orgRoles = await getRoleDocsByIds(orgAssignment?.roleIds || []);

  const appOverridesDoc = await collections.userAccess().findOne({
    userId,
    scope: 'app',
    organizationId: null,
  });

  const orgOverridesDoc = orgId
    ? await collections.userAccess().findOne({ userId, scope: 'org', organizationId: orgId })
    : null;

  const roleRules = [
    ...appRoles.flatMap((r) => r.permissions || []),
    ...orgRoles.flatMap((r) => r.permissions || []),
  ];

  const overrideRules = [
    ...(appOverridesDoc?.overrides || []),
    ...(orgOverridesDoc?.overrides || []),
  ];

  return {
    appRoles,
    orgRoles,
    roleRules,
    overrideRules,
    appAssignment,
    orgAssignment,
    appOverridesDoc,
    orgOverridesDoc,
  };
}

async function computeCheckResult({ userId, permissionKey, organizationId }) {
  const orgId = normalizeOrgId(organizationId);

  const cacheVersion = await getCacheVersion();
  const cacheKey = `rbac:check:v${cacheVersion}:${userId}:${orgId || 'app'}:${permissionKey}`;
  if (redisReady) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return { ...JSON.parse(cached), fromCache: true };
    }
  }

  const artifacts = await getUserScopeArtifacts(userId, orgId);

  const result = evaluatePermission({
    permissionKey,
    roleRules: artifacts.roleRules,
    overrideRules: artifacts.overrideRules,
  });

  const response = {
    allowed: result.allowed,
    reason: result.reason,
    effectiveFrom: result.effectiveFrom,
    matchedRules: {
      roleRules: result.matchedRules.roleRules,
      overrideRules: result.matchedRules.overrideRules,
      roleNames: [...artifacts.appRoles, ...artifacts.orgRoles].map((r) => r.name),
    },
    organizationId: orgId,
  };

  if (redisReady) {
    await redisClient.set(cacheKey, JSON.stringify(response), { EX: cacheTtlSec });
  }

  return response;
}

async function isPlatformAdmin(userId) {
  const result = await computeCheckResult({ userId, permissionKey: 'rbac.app.manage', organizationId: null });
  return result.allowed;
}

async function isOrgAdmin(userId, organizationId) {
  const result = await computeCheckResult({ userId, permissionKey: 'rbac.org.manage', organizationId });
  return result.allowed;
}

async function ensureDefaultOrgRoles(organizationId) {
  const templates = systemRoles.filter((r) => r.scope === 'org' && r.organizationId === '__template__');
  const ensured = [];
  for (const role of templates) {
    await collections.roles().updateOne(
      { name: role.name, scope: 'org', organizationId },
      {
        $set: {
          name: role.name,
          description: role.description,
          scope: 'org',
          organizationId,
          permissions: role.permissions,
          isSystem: true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    const created = await collections.roles().findOne({ name: role.name, scope: 'org', organizationId });
    if (created) ensured.push(created);
  }
  return ensured;
}

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  redisReady,
  dbName,
}));

fastify.get('/rbac/me/scope', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }

  const userId = req.auth.userId;
  const appArtifacts = await getUserScopeArtifacts(userId, null);
  const orgAssignments = await collections.roleAssignments().find({ userId, scope: 'org' }).toArray();

  const appScopePermissions = mergeRules(appArtifacts.roleRules, appArtifacts.overrideRules);
  const orgScopePermissions = [];

  for (const assignment of orgAssignments) {
    const orgArtifacts = await getUserScopeArtifacts(userId, assignment.organizationId);
    orgScopePermissions.push({
      organizationId: assignment.organizationId,
      permissions: mergeRules(orgArtifacts.roleRules, orgArtifacts.overrideRules),
      roles: orgArtifacts.orgRoles.map((r) => ({ id: String(r._id), name: r.name })),
      overrides: orgArtifacts.orgOverridesDoc?.overrides || [],
    });
  }

  return reply.send({
    userId,
    appScopePermissions,
    orgScopePermissions,
    rolesUsed: {
      app: appArtifacts.appRoles.map((r) => ({ id: String(r._id), name: r.name })),
      org: orgScopePermissions.map((s) => ({ organizationId: s.organizationId, roles: s.roles })),
    },
    overridesUsed: {
      app: appArtifacts.appOverridesDoc?.overrides || [],
      org: orgScopePermissions.map((s) => ({ organizationId: s.organizationId, overrides: s.overrides })),
    },
  });
});

fastify.post('/rbac/check', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }

  const { permissionKey, organizationId = null, resource = null } = req.body || {};
  if (!permissionKey) {
    return reply.code(400).send({ message: 'permissionKey is required' });
  }

  const result = await computeCheckResult({
    userId: req.auth.userId,
    permissionKey,
    organizationId,
  });

  return reply.send({
    userId: req.auth.userId,
    ...result,
    resource,
  });
});

fastify.post('/internal/rbac/bootstrap-org/:organizationId', { preHandler: requireInternal }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }

  const { organizationId } = req.params;
  const ownerUserId = req.body?.ownerUserId ? String(req.body.ownerUserId) : null;
  const roles = await ensureDefaultOrgRoles(organizationId);

  if (ownerUserId) {
    const orgAdminRole = roles.find((r) => r.name === 'org_admin');
    if (orgAdminRole?._id) {
      await collections.roleAssignments().updateOne(
        { userId: ownerUserId, scope: 'org', organizationId },
        {
          $set: {
            userId: ownerUserId,
            scope: 'org',
            organizationId,
            roleIds: [String(orgAdminRole._id)],
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
    }
  }

  await bumpCacheVersion();
  return reply.send({
    message: 'Organization RBAC defaults bootstrapped',
    organizationId,
    roleNames: roles.map((r) => r.name),
    ownerUserId,
  });
});

fastify.post('/rbac/app/permissions', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Platform admin required' });
  }

  const { key, name, description, module, actions = [] } = req.body || {};
  if (!key || !name || !module) {
    return reply.code(400).send({ message: 'key, name, module are required' });
  }

  await collections.permissions().updateOne(
    { key, scope: 'app', organizationId: null },
    {
      $set: {
        key,
        name,
        description: description || name,
        module,
        actions: Array.isArray(actions) ? actions : [],
        scope: 'app',
        organizationId: null,
        isSystem: false,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_PERMISSION_CREATED',
    action: 'rbac.app.permission.upsert',
    resource: { type: 'permission', id: key },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app', module },
  });
  return reply.code(201).send({ message: 'Permission upserted' });
});

fastify.get('/rbac/app/permissions', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Platform admin required' });
  }
  const permissions = await collections.permissions().find({ scope: 'app', organizationId: null }).toArray();
  return reply.send({ permissions });
});

fastify.post('/rbac/app/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Platform admin required' });
  }
  const { name, description, permissions = [] } = req.body || {};
  if (!name) {
    return reply.code(400).send({ message: 'name is required' });
  }

  await collections.roles().updateOne(
    { name, scope: 'app', organizationId: null },
    {
      $set: {
        name,
        description: description || name,
        permissions: Array.isArray(permissions) ? permissions : [],
        scope: 'app',
        organizationId: null,
        isSystem: false,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_ROLE_CREATED',
    action: 'rbac.app.role.upsert',
    resource: { type: 'role', id: name },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app' },
  });
  return reply.code(201).send({ message: 'Role upserted' });
});

fastify.get('/rbac/app/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Platform admin required' });
  }
  const roles = await collections.roles().find({ scope: 'app', organizationId: null }).toArray();
  return reply.send({ roles });
});

fastify.patch('/rbac/app/roles/:roleId', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Platform admin required' });
  }
  const { roleId } = req.params;
  if (!ObjectId.isValid(roleId)) {
    return reply.code(400).send({ message: 'Invalid roleId' });
  }

  const update = {};
  if (req.body?.name) update.name = req.body.name;
  if (req.body?.description) update.description = req.body.description;
  if (Array.isArray(req.body?.permissions)) update.permissions = req.body.permissions;
  update.updatedAt = new Date();

  await collections.roles().updateOne({ _id: new ObjectId(roleId), scope: 'app' }, { $set: update });
  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_ROLE_UPDATED',
    action: 'rbac.app.role.update',
    resource: { type: 'role', id: roleId },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app' },
  });
  return reply.send({ message: 'Role updated' });
});

fastify.delete('/rbac/app/roles/:roleId', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Platform admin required' });
  }
  const { roleId } = req.params;
  if (!ObjectId.isValid(roleId)) {
    return reply.code(400).send({ message: 'Invalid roleId' });
  }

  await collections.roles().deleteOne({ _id: new ObjectId(roleId), scope: 'app', isSystem: { $ne: true } });
  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_ROLE_DELETED',
    action: 'rbac.app.role.delete',
    resource: { type: 'role', id: roleId },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app' },
  });
  return reply.send({ message: 'Role deleted' });
});

fastify.post('/rbac/app/users/:userId/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Platform admin required' });
  }

  const { userId } = req.params;
  const { roleIds = [] } = req.body || {};
  await collections.roleAssignments().updateOne(
    { userId, scope: 'app', organizationId: null },
    {
      $set: {
        userId,
        scope: 'app',
        organizationId: null,
        roleIds: Array.isArray(roleIds) ? roleIds : [],
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_PERMISSION_ASSIGNED',
    action: 'rbac.app.assign.roles',
    resource: { type: 'user', id: userId },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app', roleIds: Array.isArray(roleIds) ? roleIds : [] },
  });
  return reply.send({ message: 'App roles assigned' });
});

fastify.post('/rbac/app/users/:userId/overrides', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Platform admin required' });
  }

  const { userId } = req.params;
  const { overrides = [] } = req.body || {};

  await collections.userAccess().updateOne(
    { userId, scope: 'app', organizationId: null },
    {
      $set: {
        userId,
        scope: 'app',
        organizationId: null,
        overrides: Array.isArray(overrides) ? overrides : [],
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_USER_OVERRIDE_APPLIED',
    action: 'rbac.app.user.overrides',
    resource: { type: 'user', id: userId },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app', overrides: Array.isArray(overrides) ? overrides.length : 0 },
  });
  return reply.send({ message: 'App overrides updated' });
});

fastify.get('/rbac/app/users/:userId/access', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Platform admin required' });
  }

  const { userId } = req.params;
  const artifacts = await getUserScopeArtifacts(userId, null);
  return reply.send({
    userId,
    scope: 'app',
    roles: artifacts.appRoles,
    assignment: artifacts.appAssignment,
    overrides: artifacts.appOverridesDoc?.overrides || [],
    effectivePermissions: mergeRules(artifacts.roleRules, artifacts.overrideRules),
  });
});

fastify.post('/rbac/org/:organizationId/permissions', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId)) && !(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const { key, name, description, module, actions = [] } = req.body || {};
  if (!key || !name || !module) {
    return reply.code(400).send({ message: 'key, name, module are required' });
  }

  await collections.permissions().updateOne(
    { key, scope: 'org', organizationId },
    {
      $set: {
        key,
        name,
        description: description || name,
        module,
        actions: Array.isArray(actions) ? actions : [],
        scope: 'org',
        organizationId,
        isSystem: false,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_PERMISSION_CREATED',
    action: 'rbac.org.permission.upsert',
    resource: { type: 'permission', id: key },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org', module },
  });
  return reply.code(201).send({ message: 'Org permission upserted' });
});

fastify.get('/rbac/org/:organizationId/permissions', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId)) && !(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const permissions = await collections.permissions().find({ scope: 'org', organizationId }).toArray();
  return reply.send({ permissions });
});

fastify.post('/rbac/org/:organizationId/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId)) && !(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const { name, description, permissions = [] } = req.body || {};
  if (!name) {
    return reply.code(400).send({ message: 'name is required' });
  }

  await collections.roles().updateOne(
    { name, scope: 'org', organizationId },
    {
      $set: {
        name,
        description: description || name,
        permissions: Array.isArray(permissions) ? permissions : [],
        scope: 'org',
        organizationId,
        isSystem: false,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_ROLE_CREATED',
    action: 'rbac.org.role.upsert',
    resource: { type: 'role', id: name },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org' },
  });
  return reply.code(201).send({ message: 'Org role upserted' });
});

fastify.get('/rbac/org/:organizationId/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId)) && !(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }
  const roles = await collections.roles().find({ scope: 'org', organizationId }).toArray();
  return reply.send({ roles });
});

fastify.patch('/rbac/org/:organizationId/roles/:roleId', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, roleId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId)) && !(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }
  if (!ObjectId.isValid(roleId)) {
    return reply.code(400).send({ message: 'Invalid roleId' });
  }

  const update = {};
  if (req.body?.name) update.name = req.body.name;
  if (req.body?.description) update.description = req.body.description;
  if (Array.isArray(req.body?.permissions)) update.permissions = req.body.permissions;
  update.updatedAt = new Date();

  await collections.roles().updateOne(
    { _id: new ObjectId(roleId), scope: 'org', organizationId },
    { $set: update }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_ROLE_UPDATED',
    action: 'rbac.org.role.update',
    resource: { type: 'role', id: roleId },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org' },
  });
  return reply.send({ message: 'Org role updated' });
});

fastify.delete('/rbac/org/:organizationId/roles/:roleId', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, roleId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId)) && !(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }
  if (!ObjectId.isValid(roleId)) {
    return reply.code(400).send({ message: 'Invalid roleId' });
  }

  await collections.roles().deleteOne({ _id: new ObjectId(roleId), scope: 'org', organizationId, isSystem: { $ne: true } });
  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_ROLE_DELETED',
    action: 'rbac.org.role.delete',
    resource: { type: 'role', id: roleId },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org' },
  });
  return reply.send({ message: 'Org role deleted' });
});

fastify.post('/rbac/org/:organizationId/users/:userId/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, userId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId)) && !(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const { roleIds = [] } = req.body || {};
  await collections.roleAssignments().updateOne(
    { userId, scope: 'org', organizationId },
    {
      $set: {
        userId,
        scope: 'org',
        organizationId,
        roleIds: Array.isArray(roleIds) ? roleIds : [],
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_PERMISSION_ASSIGNED',
    action: 'rbac.org.assign.roles',
    resource: { type: 'user', id: userId },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org', roleIds: Array.isArray(roleIds) ? roleIds : [] },
  });
  return reply.send({ message: 'Org roles assigned' });
});

fastify.post('/rbac/org/:organizationId/users/:userId/overrides', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, userId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId)) && !(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const { overrides = [] } = req.body || {};
  await collections.userAccess().updateOne(
    { userId, scope: 'org', organizationId },
    {
      $set: {
        userId,
        scope: 'org',
        organizationId,
        overrides: Array.isArray(overrides) ? overrides : [],
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_USER_OVERRIDE_APPLIED',
    action: 'rbac.org.user.overrides',
    resource: { type: 'user', id: userId },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org', overrides: Array.isArray(overrides) ? overrides.length : 0 },
  });
  return reply.send({ message: 'Org overrides updated' });
});

fastify.get('/rbac/org/:organizationId/users/:userId/access', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, userId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId)) && !(await isPlatformAdmin(req.auth.userId))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const artifacts = await getUserScopeArtifacts(userId, organizationId);
  return reply.send({
    userId,
    scope: 'org',
    organizationId,
    roles: artifacts.orgRoles,
    assignment: artifacts.orgAssignment,
    overrides: artifacts.orgOverridesDoc?.overrides || [],
    effectivePermissions: mergeRules(artifacts.roleRules, artifacts.overrideRules),
  });
});

const start = async () => {
  try {
    await connect();
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  try {
    if (redisClient) {
      await redisClient.quit();
    }
    if (mongoClient) {
      await mongoClient.close();
    }
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
