const fastify = require('fastify')({ logger: true });
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const { evaluatePermission, mergeRules } = require('./engine');
const { buildEventEnvelope, createOutboxRepository, deliverOutboxBatch } = require('../../../../libs/shared/src/outbox');
const { enforceProductionSecrets } = require('../../../../libs/shared/src/env');
const { setStandardErrorHandler } = require('../../../../libs/shared/src/errors');

const serviceName = 'rbac-service';
const port = Number(process.env.PORT) || 8090;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_rbac_db';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const cacheTtlSec = Number(process.env.RBAC_CACHE_TTL_SEC) || 60;
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 50;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;

let dbReady = false;
let redisReady = false;
let mongoClient;
let redisClient;
let db;
let outboxRepo = null;
let outboxTimer = null;

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
  { key: 'org.list', name: 'List organizations', scope: 'app', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.read', name: 'Read organization', scope: 'app', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.update', name: 'Update organization', scope: 'app', module: 'organization', actions: ['update'], isSystem: true },
  { key: 'org.owner.assign', name: 'Assign organization owner', scope: 'app', module: 'organization', actions: ['update'], isSystem: true },
  { key: 'org.search', name: 'Search organizations', scope: 'app', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.branch.create', name: 'Create branch', scope: 'org', module: 'organization', actions: ['create'], isSystem: true },
  { key: 'org.branch.read', name: 'Read branch', scope: 'org', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.branch.update', name: 'Update branch', scope: 'org', module: 'organization', actions: ['update'], isSystem: true },
  { key: 'org.branch.delete', name: 'Delete branch', scope: 'org', module: 'organization', actions: ['delete'], isSystem: true },
  { key: 'org.member.add', name: 'Add org member', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.invite', name: 'Invite org member', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.read', name: 'Read org member', scope: 'org', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'org.member.list', name: 'List org members', scope: 'org', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'org.member.update', name: 'Update org member', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.member.status.update', name: 'Change org member status', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.branch.assign', name: 'Assign branches to membership', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.branch.assignment.update', name: 'Update branch assignment', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.member.branch.assign', name: 'Assign member to branch', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.branch.update', name: 'Update member branch assignment', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.member.branch.remove', name: 'Remove member branch assignment', scope: 'org', module: 'membership', actions: ['delete'], isSystem: true },
  { key: 'org.member.transfer', name: 'Transfer member branch assignment', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.history.read', name: 'Read membership history', scope: 'org', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'membership.user.read', name: 'Read memberships by user', scope: 'app', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'membership.user.history.read', name: 'Read user movement history', scope: 'app', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'records.me.read', name: 'Read own timeline records', scope: 'app', module: 'records', actions: ['read'], isSystem: true },
  { key: 'records.nin.read', name: 'Read timeline records by NIN', scope: 'org', module: 'records', actions: ['read'], isSystem: true },
  { key: 'records.symptoms.create', name: 'Create own symptom record', scope: 'app', module: 'records', actions: ['create'], isSystem: true },
  { key: 'records.entry.create', name: 'Create provider timeline entry', scope: 'org', module: 'records', actions: ['create'], isSystem: true },
  { key: 'records.entry.update', name: 'Update timeline entry', scope: 'app', module: 'records', actions: ['update'], isSystem: true },
  { key: 'records.entry.hide', name: 'Hide timeline entry', scope: 'app', module: 'records', actions: ['update'], isSystem: true },
  { key: 'doctor.register', name: 'Register doctor profile', scope: 'app', module: 'doctor-registry', actions: ['create'], isSystem: true },
  { key: 'doctor.read', name: 'Read doctor profile', scope: 'app', module: 'doctor-registry', actions: ['read'], isSystem: true },
  { key: 'doctor.verify', name: 'Verify doctor license', scope: 'app', module: 'doctor-registry', actions: ['update'], isSystem: true },
  { key: 'doctor.suspend', name: 'Suspend doctor license', scope: 'app', module: 'doctor-registry', actions: ['update'], isSystem: true },
  { key: 'doctor.revoke', name: 'Revoke doctor license', scope: 'app', module: 'doctor-registry', actions: ['update'], isSystem: true },
  { key: 'doctor.reinstate', name: 'Reinstate doctor license', scope: 'app', module: 'doctor-registry', actions: ['update'], isSystem: true },
  { key: 'emergency.request.create', name: 'Create emergency request', scope: 'app', module: 'emergency', actions: ['create'], isSystem: true },
  { key: 'emergency.request.read', name: 'Read emergency request', scope: 'app', module: 'emergency', actions: ['read'], isSystem: true },
  { key: 'emergency.request.update_status', name: 'Update emergency request status', scope: 'org', module: 'emergency', actions: ['update'], isSystem: true },
  { key: 'emergency.response.create', name: 'Create emergency response', scope: 'org', module: 'emergency', actions: ['create'], isSystem: true },
  { key: 'emergency.room.read', name: 'Read emergency room', scope: 'app', module: 'emergency', actions: ['read'], isSystem: true },
  { key: 'emergency.room.message.create', name: 'Create emergency room message', scope: 'app', module: 'emergency', actions: ['create'], isSystem: true },
  { key: 'emergency.inventory.upsert', name: 'Upsert provider inventory', scope: 'org', module: 'emergency', actions: ['update'], isSystem: true },
  { key: 'emergency.inventory.search', name: 'Search provider inventory', scope: 'app', module: 'emergency', actions: ['read'], isSystem: true },
  { key: 'taskforce.unit.create', name: 'Create taskforce unit', scope: 'app', module: 'governance', actions: ['create'], isSystem: true },
  { key: 'taskforce.unit.read', name: 'Read taskforce units', scope: 'app', module: 'governance', actions: ['read'], isSystem: true },
  { key: 'taskforce.unit.update', name: 'Update taskforce unit', scope: 'app', module: 'governance', actions: ['update'], isSystem: true },
  { key: 'taskforce.member.manage', name: 'Manage taskforce members', scope: 'app', module: 'governance', actions: ['create', 'update', 'delete'], isSystem: true },
  { key: 'governance.case.create', name: 'Create governance case', scope: 'app', module: 'governance', actions: ['create'], isSystem: true },
  { key: 'governance.case.read', name: 'Read governance cases', scope: 'app', module: 'governance', actions: ['read'], isSystem: true },
  { key: 'governance.case.update_status', name: 'Update governance case status', scope: 'app', module: 'governance', actions: ['update'], isSystem: true },
  { key: 'governance.correction.propose', name: 'Propose governance correction', scope: 'app', module: 'governance', actions: ['create'], isSystem: true },
  { key: 'governance.correction.approve', name: 'Approve governance correction', scope: 'app', module: 'governance', actions: ['update'], isSystem: true },
  { key: 'governance.correction.reject', name: 'Reject governance correction', scope: 'app', module: 'governance', actions: ['update'], isSystem: true },
  { key: 'governance.case.escalate', name: 'Escalate governance case', scope: 'app', module: 'governance', actions: ['update'], isSystem: true },
  { key: 'governance.case.room.read', name: 'Read governance case room', scope: 'app', module: 'governance', actions: ['read'], isSystem: true },
  { key: 'governance.case.room.message.create', name: 'Create governance case room message', scope: 'app', module: 'governance', actions: ['create'], isSystem: true },
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
      { permissionKey: 'records.me.read', effect: 'allow' },
      { permissionKey: 'records.symptoms.create', effect: 'allow' },
      { permissionKey: 'records.entry.update', effect: 'allow' },
      { permissionKey: 'records.entry.hide', effect: 'allow' },
      { permissionKey: 'doctor.register', effect: 'allow' },
      { permissionKey: 'emergency.request.create', effect: 'allow' },
      { permissionKey: 'emergency.request.read', effect: 'allow' },
      { permissionKey: 'emergency.room.read', effect: 'allow' },
      { permissionKey: 'emergency.room.message.create', effect: 'allow' },
      { permissionKey: 'emergency.inventory.search', effect: 'allow' },
      { permissionKey: 'governance.case.create', effect: 'allow' },
      { permissionKey: 'governance.case.read', effect: 'allow' },
      { permissionKey: 'governance.case.room.read', effect: 'allow' },
      { permissionKey: 'governance.case.room.message.create', effect: 'allow' },
    ],
  },
  {
    name: 'super',
    description: 'Super administrator',
    scope: 'app',
    organizationId: null,
    isSystem: true,
    permissions: [{ permissionKey: '*', effect: 'allow' }],
  },
];

function emitAuditEvent(event) {
  if (!outboxRepo) return;
  outboxRepo.enqueueOutboxEvent(buildEventEnvelope({
    eventType: event.eventType || 'AUDIT_EVENT',
    sourceService: serviceName,
    aggregateType: event.resource?.type || 'rbac',
    aggregateId: event.resource?.id || event.userId || null,
    payload: event,
    trace: {
      requestId: event.metadata?.requestId || null,
      userId: event.userId || null,
      orgId: event.organizationId || null,
      branchId: event.metadata?.branchId || null,
    },
    destination: 'audit',
  })).catch((err) => {
    fastify.log.warn({ err, eventType: event?.eventType }, 'RBAC outbox enqueue failed');
  });
}

function normalizeOrgId(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizeRoleName(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRoleAlias(value) {
  const normalized = normalizeRoleName(value);
  if (!normalized) return '';
  if (['superadmin', 'super_admin', 'super admin'].includes(normalized)) return 'super';
  return normalized;
}

function rolesMatch(left, right) {
  const l = normalizeRoleAlias(left);
  const r = normalizeRoleAlias(right);
  return Boolean(l) && Boolean(r) && l === r;
}

function parseActiveAppRoleFromContext(context = {}) {
  const contextId = String(context.activeContextId || '').trim().toLowerCase();
  const contextType = String(context.activeContextType || '').trim().toLowerCase();
  const contextName = String(context.activeContextName || '').trim().toLowerCase();
  const explicit = normalizeRoleAlias(context.activeRole || context.activeRoleName);
  if (explicit) return explicit;
  if (contextId === 'app:super') return 'super';
  if (contextId === 'app:citizen') return 'citizen';
  if (contextId.startsWith('app:role:')) {
    return normalizeRoleAlias(contextId.replace('app:role:', ''));
  }
  if (contextType === 'platform' && contextName) {
    return normalizeRoleAlias(contextName);
  }
  return null;
}

function filterAppRolesByActiveRole(roles = [], activeRoleName = null) {
  const roleName = normalizeRoleAlias(activeRoleName);
  if (!roleName) return roles;
  return roles.filter((role) => rolesMatch(role?.name, roleName));
}

function filterOverridesByActiveRole(overrides = [], activeRoleName = null) {
  const roleName = normalizeRoleAlias(activeRoleName);
  if (!roleName) return overrides;
  return (Array.isArray(overrides) ? overrides : []).filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const scopedRole = normalizeRoleAlias(entry.roleName || entry.role || entry.contextRole);
    if (!scopedRole) return true;
    return rolesMatch(scopedRole, roleName);
  });
}

function sanitizeOverrideRules(overrides = []) {
  if (!Array.isArray(overrides)) return [];
  return overrides
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const permissionKey = String(entry.permissionKey || entry.key || '').trim();
      if (!permissionKey) return null;
      const effect = String(entry.effect || entry.value || '').trim().toLowerCase() === 'deny' ? 'deny' : 'allow';
      const roleName = normalizeRoleAlias(entry.roleName || entry.role || entry.contextRole);
      const rule = { permissionKey, effect };
      if (roleName) {
        rule.roleName = roleName;
      }
      return rule;
    })
    .filter(Boolean);
}

function isLockedAppRoleName(name) {
  return String(name || '').trim().toLowerCase() === 'super';
}

async function findAppRoleByAnyIdentifier(roleIdentifier) {
  const value = String(roleIdentifier || '').trim();
  if (!value) return null;
  if (ObjectId.isValid(value)) {
    const byId = await collections.roles().findOne({ _id: new ObjectId(value), scope: 'app', organizationId: null });
    if (byId) return byId;
  }
  return collections.roles().findOne({ name: value, scope: 'app', organizationId: null });
}

async function resolveRoleNamesFromIds(roleIds = [], scope = 'app', organizationId = null) {
  const ids = Array.isArray(roleIds) ? roleIds : [];
  if (ids.length === 0) return [];
  const byIdObjectIds = ids
    .filter((id) => ObjectId.isValid(String(id)))
    .map((id) => new ObjectId(String(id)));
  const byIdRows = byIdObjectIds.length > 0
    ? await collections.roles().find({ _id: { $in: byIdObjectIds }, scope, organizationId }).toArray()
    : [];

  const unresolvedNames = ids
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .filter((id) => !ObjectId.isValid(id));

  const byNameRows = unresolvedNames.length > 0
    ? await collections.roles().find({ name: { $in: unresolvedNames }, scope, organizationId }).toArray()
    : [];

  return Array.from(new Set([...byIdRows, ...byNameRows].map((role) => String(role.name || '').trim().toLowerCase()).filter(Boolean)));
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
    outboxRepo = createOutboxRepository(db);
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
    outboxRepo.createIndexes(),
  ]);

  // Compatibility cleanup for older schema versions that used `code` instead of `key`.
  // This prevents duplicate-key failures on legacy `code_1` unique index during bootstrapping.
  try {
    const permissionIndexes = await collections.permissions().indexes();
    if (permissionIndexes.some((idx) => idx.name === 'code_1')) {
      await collections.permissions().dropIndex('code_1');
    }
  } catch (err) {
    fastify.log.warn({ err }, 'Failed to cleanup legacy RBAC permission indexes');
  }

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

  // Remove legacy system-seeded roles so only citizen/super remain as defaults.
  await collections.roles().deleteMany({
    isSystem: true,
    $or: [
      { scope: 'org' },
      { scope: 'app', name: { $nin: ['citizen', 'super'] } },
    ],
  });

  if (redisReady) {
    await redisClient.setNX('rbac:version', '1');
  }

  fastify.log.info({ dbName, redisReady }, 'RBAC service initialized');
}

async function flushOutboxOnce() {
  if (!outboxRepo) return;
  await deliverOutboxBatch({
    outboxRepo,
    logger: fastify.log,
    batchSize: outboxBatchSize,
    maxAttempts: outboxMaxAttempts,
    handlers: {
      audit: async (event) => {
        const res = await fetch(`${auditApiBaseUrl}/internal/audit/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ eventId: event.eventId, ...event.payload, createdAt: event.createdAt }),
        });
        if (!res.ok) throw new Error(`audit delivery failed: ${res.status}`);
      },
    },
  });
}

function startOutboxWorker() {
  if (outboxTimer) return;
  outboxTimer = setInterval(() => { void flushOutboxOnce(); }, outboxIntervalMs);
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

async function getRoleDocsByNames(roleNames, scope = 'app', organizationId = null) {
  if (!Array.isArray(roleNames) || roleNames.length === 0) {
    return [];
  }
  const names = roleNames
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  const expanded = new Set(names);
  for (const name of names) {
    if (name === 'superadmin' || name === 'super_admin' || name === 'super admin') {
      expanded.add('super');
    }
  }
  const expandedNames = Array.from(expanded);
  if (expandedNames.length === 0) {
    return [];
  }
  return collections.roles().find({ name: { $in: expandedNames }, scope, organizationId }).toArray();
}

async function getUserScopeArtifacts(userId, organizationId, fallbackRoleNames = [], options = {}) {
  const orgId = normalizeOrgId(organizationId);
  const activeAppRoleName = normalizeRoleAlias(options.activeAppRoleName);

  const appAssignment = await collections.roleAssignments().findOne({
    userId,
    scope: 'app',
    organizationId: null,
  });
  const orgAssignment = orgId
    ? await collections.roleAssignments().findOne({ userId, scope: 'org', organizationId: orgId })
    : null;

  const appRolesByAssignment = await getRoleDocsByIds(appAssignment?.roleIds || []);
  const appRolesByToken = await getRoleDocsByNames(fallbackRoleNames, 'app', null);
  const appRoleMap = new Map();
  for (const role of [...appRolesByAssignment, ...appRolesByToken]) {
    appRoleMap.set(String(role._id), role);
  }
  let appRoles = Array.from(appRoleMap.values());
  if (appRoles.length === 0) {
    const citizenRole = await collections.roles().findOne({ name: 'citizen', scope: 'app', organizationId: null });
    if (citizenRole) {
      appRoles.push(citizenRole);
    }
  }
  appRoles = filterAppRolesByActiveRole(appRoles, activeAppRoleName);
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

  const filteredAppOverrides = filterOverridesByActiveRole(appOverridesDoc?.overrides || [], activeAppRoleName);
  const overrideRules = [
    ...filteredAppOverrides,
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
    activeAppRoleName: activeAppRoleName || null,
    filteredAppOverrides,
  };
}

async function computeCheckResult({
  userId,
  permissionKey,
  organizationId,
  branchId = null,
  fallbackRoleNames = [],
  activeAppRoleName = null,
}) {
  const orgId = normalizeOrgId(organizationId);
  const branchScope = branchId ? String(branchId) : 'all';
  const roleScope = normalizeRoleAlias(activeAppRoleName) || 'all-roles';

  const cacheVersion = await getCacheVersion();
  const cacheKey = `rbac:check:v${cacheVersion}:${userId}:${orgId || 'app'}:${branchScope}:${roleScope}:${permissionKey}`;
  if (redisReady) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return { ...JSON.parse(cached), fromCache: true };
    }
  }

  const artifacts = await getUserScopeArtifacts(userId, orgId, fallbackRoleNames, { activeAppRoleName });

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
      activeAppRoleName: artifacts.activeAppRoleName,
    },
    organizationId: orgId,
    branchId: branchId ? String(branchId) : null,
  };

  if (redisReady) {
    await redisClient.set(cacheKey, JSON.stringify(response), { EX: cacheTtlSec });
  }

  return response;
}

async function isPlatformAdmin(userId, fallbackRoleNames = []) {
  const lowered = Array.isArray(fallbackRoleNames)
    ? fallbackRoleNames.map((role) => String(role || '').trim().toLowerCase())
    : [];
  if (lowered.includes('super') || lowered.includes('superadmin') || lowered.includes('super_admin') || lowered.includes('super admin')) {
    return true;
  }
  const result = await computeCheckResult({
    userId,
    permissionKey: 'rbac.app.manage',
    organizationId: null,
    fallbackRoleNames,
  });
  return result.allowed;
}

async function isOrgAdmin(userId, organizationId, fallbackRoleNames = []) {
  const result = await computeCheckResult({
    userId,
    permissionKey: 'rbac.org.manage',
    organizationId,
    fallbackRoleNames,
  });
  return result.allowed;
}

async function ensureDefaultOrgRoles(organizationId) {
  // No auto-generated org roles. Org-specific roles must be created explicitly by administrators.
  void organizationId;
  return [];
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
  const appArtifacts = await getUserScopeArtifacts(userId, null, req.auth.roles);
  const orgAssignments = await collections.roleAssignments().find({ userId, scope: 'org' }).toArray();

  const appScopePermissions = mergeRules(appArtifacts.roleRules, appArtifacts.overrideRules);
  const orgScopePermissions = [];

  for (const assignment of orgAssignments) {
    const orgArtifacts = await getUserScopeArtifacts(userId, assignment.organizationId, req.auth.roles);
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

  const { permissionKey, organizationId = null, branchId = null, resource = null } = req.body || {};
  if (!permissionKey) {
    return reply.code(400).send({ message: 'permissionKey is required' });
  }

  const activeAppRoleName = parseActiveAppRoleFromContext(req.body || {});

  const result = await computeCheckResult({
    userId: req.auth.userId,
    permissionKey,
    organizationId,
    branchId,
    fallbackRoleNames: req.auth.roles,
    activeAppRoleName,
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
    await collections.roleAssignments().updateOne(
      { userId: ownerUserId, scope: 'org', organizationId },
      {
        $set: {
          userId: ownerUserId,
          scope: 'org',
          organizationId,
          roleIds: [],
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
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
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
    return reply.code(403).send({ message: 'Forbidden' });
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
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const permissions = await collections.permissions().find({ scope: 'app', organizationId: null }).toArray();
  return reply.send({ permissions });
});

fastify.post('/rbac/app/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const { name, description, permissions = [] } = req.body || {};
  if (!name) {
    return reply.code(400).send({ message: 'name is required' });
  }
  if (isLockedAppRoleName(name)) {
    return reply.code(403).send({ message: 'SUPER_ROLE_LOCKED' });
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
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const roles = await collections.roles().find({ scope: 'app', organizationId: null }).toArray();
  return reply.send({ roles });
});

fastify.patch('/rbac/app/roles/:roleId', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const { roleId } = req.params;
  if (!ObjectId.isValid(roleId)) {
    return reply.code(400).send({ message: 'Invalid roleId' });
  }
  const existingRole = await collections.roles().findOne({ _id: new ObjectId(roleId), scope: 'app', organizationId: null });
  if (!existingRole) {
    return reply.code(404).send({ message: 'Role not found' });
  }
  if (isLockedAppRoleName(existingRole.name) || isLockedAppRoleName(req.body?.name)) {
    return reply.code(403).send({ message: 'SUPER_ROLE_LOCKED' });
  }

  const update = {};
  if (req.body?.name) update.name = req.body.name;
  if (req.body?.description) update.description = req.body.description;
  if (Array.isArray(req.body?.permissions)) update.permissions = req.body.permissions;
  update.updatedAt = new Date();

  await collections.roles().updateOne({ _id: new ObjectId(roleId), scope: 'app', organizationId: null }, { $set: update });
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
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const roleIdParam = String(req.params.roleId || '').trim();
  if (!roleIdParam) {
    return reply.code(400).send({ message: 'roleId is required' });
  }

  const role = await findAppRoleByAnyIdentifier(roleIdParam);
  if (!role) {
    return reply.code(404).send({ message: 'Role not found' });
  }
  if (isLockedAppRoleName(role.name)) {
    return reply.code(403).send({ message: 'SUPER_ROLE_LOCKED' });
  }

  const roleObjectId = role._id instanceof ObjectId ? role._id : null;
  const roleObjectIdString = roleObjectId ? String(roleObjectId) : null;
  const roleName = String(role.name || '').trim();

  await collections.roles().deleteOne({ _id: role._id, scope: 'app' });

  const pullCandidates = [roleName];
  if (roleObjectIdString) {
    pullCandidates.push(roleObjectIdString);
    pullCandidates.push(new ObjectId(roleObjectIdString));
  }

  const roleAssignmentsUpdate = await collections.roleAssignments().updateMany(
    { scope: 'app' },
    { $pull: { roleIds: { $in: pullCandidates } }, $set: { updatedAt: new Date() } },
  );
  const userOverridesUpdate = roleName
    ? await collections.userAccess().updateMany(
      { scope: 'app', organizationId: null },
      { $pull: { overrides: { roleName } }, $set: { updatedAt: new Date() } },
    )
    : { modifiedCount: 0 };

  let authUsersUpdated = 0;
  if (roleName) {
    try {
      const authSyncResponse = await fetch(`${authApiBaseUrl}/internal/users/roles/remove`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': internalServiceToken,
        },
        body: JSON.stringify({ roleName }),
      });
      if (authSyncResponse.ok) {
        const payload = await authSyncResponse.json().catch(() => ({}));
        authUsersUpdated = Number(payload?.matchedUsers || payload?.modifiedUsers || 0);
      } else {
        fastify.log.warn({ status: authSyncResponse.status, roleName }, 'Auth role cleanup call failed');
      }
    } catch (err) {
      fastify.log.warn({ err, roleName }, 'Auth role cleanup call failed');
    }
  }

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_ROLE_DELETED',
    action: 'rbac.app.role.delete',
    resource: { type: 'role', id: roleObjectIdString || roleName },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: {
      scope: 'app',
      roleName: roleName || null,
      assignmentDocsUpdated: roleAssignmentsUpdate.modifiedCount || 0,
      overrideDocsUpdated: userOverridesUpdate.modifiedCount || 0,
      authUsersUpdated,
    },
  });
  return reply.send({
    message: 'Role deleted',
    roleName: roleName || null,
    assignmentDocsUpdated: roleAssignmentsUpdate.modifiedCount || 0,
    overrideDocsUpdated: userOverridesUpdate.modifiedCount || 0,
    authUsersUpdated,
  });
});

fastify.post('/rbac/app/users/:userId/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const { userId } = req.params;
  const { roleIds = [] } = req.body || {};
  const resolvedRoleNames = await resolveRoleNamesFromIds(roleIds, 'app', null);
  if (resolvedRoleNames.includes('super')) {
    return reply.code(403).send({ message: 'SUPER_ROLE_ASSIGNMENT_BLOCKED' });
  }
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
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const { userId } = req.params;
  const { overrides = [] } = req.body || {};
  const sanitizedOverrides = sanitizeOverrideRules(overrides);

  await collections.userAccess().updateOne(
    { userId, scope: 'app', organizationId: null },
    {
      $set: {
        userId,
        scope: 'app',
        organizationId: null,
        overrides: sanitizedOverrides,
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
    metadata: { scope: 'app', overrides: sanitizedOverrides.length },
  });
  return reply.send({ message: 'App overrides updated' });
});

fastify.get('/rbac/app/users/:userId/access', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { userId } = req.params;
  const isSelf = String(req.auth.userId) === String(userId);
  const platformAdmin = await isPlatformAdmin(req.auth.userId, req.auth.roles);
  if (!platformAdmin && !isSelf) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const activeAppRoleName = parseActiveAppRoleFromContext({
    ...req.query,
    ...req.body,
  });
  const artifacts = await getUserScopeArtifacts(userId, null, [], { activeAppRoleName });
  return reply.send({
    userId,
    scope: 'app',
    roles: artifacts.appRoles,
    assignment: artifacts.appAssignment,
    overrides: activeAppRoleName ? artifacts.filteredAppOverrides : (artifacts.appOverridesDoc?.overrides || []),
    effectivePermissions: mergeRules(artifacts.roleRules, artifacts.overrideRules),
    activeRole: artifacts.activeAppRoleName,
  });
});

fastify.post('/rbac/org/:organizationId/permissions', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
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
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
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
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
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
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
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
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
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
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
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
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
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
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const { overrides = [] } = req.body || {};
  const sanitizedOverrides = sanitizeOverrideRules(overrides);
  await collections.userAccess().updateOne(
    { userId, scope: 'org', organizationId },
    {
      $set: {
        userId,
        scope: 'org',
        organizationId,
        overrides: sanitizedOverrides,
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
    metadata: { scope: 'org', overrides: sanitizedOverrides.length },
  });
  return reply.send({ message: 'Org overrides updated' });
});

fastify.get('/rbac/org/:organizationId/users/:userId/access', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, userId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles))) {
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
    enforceProductionSecrets({
      nodeEnv: process.env.NODE_ENV,
      internalServiceToken,
      jwtSecret,
      nhrsContextSecret,
      mongodbUri: mongoUri,
    });
    await connect();
    startOutboxWorker();
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  try {
    if (outboxTimer) {
      clearInterval(outboxTimer);
    }
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
process.on('unhandledRejection', (reason) => {
  const logger = (typeof fastify !== 'undefined' && fastify && fastify.log) ? fastify.log : console;
  logger.error({ err: reason }, 'Unhandled promise rejection; service will keep running in degraded mode');
});

process.on('uncaughtException', (err) => {
  const logger = (typeof fastify !== 'undefined' && fastify && fastify.log) ? fastify.log : console;
  logger.error({ err }, 'Uncaught exception; service will keep running in degraded mode');
});

setStandardErrorHandler(fastify);

start();


