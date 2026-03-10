const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { buildEventEnvelope, createOutboxRepository, deliverOutboxBatch } = require('../../../../libs/shared/src/outbox');
const { createContextVerificationHook } = require('../../../../libs/shared/src/nhrs-context');
const { enforceProductionSecrets } = require('../../../../libs/shared/src/env');
const { setStandardErrorHandler } = require('../../../../libs/shared/src/errors');

const serviceName = 'membership-service';
const port = Number(process.env.PORT) || 8103;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_membership_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 20;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;

let dbReady = false;
let mongoClient;
let db;
let fetchClient = (...args) => fetch(...args);
let outboxRepo = null;
let outboxTimer = null;

const collections = {
  memberships: () => db.collection('org_memberships'),
  assignments: () => db.collection('branch_assignments'),
  events: () => db.collection('membership_audit_log'),
  archives: () => db.collection('org_membership_archives'),
};
const SUPER_ROLE_ALIASES = new Set(['super', 'superadmin', 'super_admin', 'super admin', 'platform_admin', 'app_admin']);

function now() {
  return new Date();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}

function parseBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

async function callJson(url, options = {}) {
  const res = await fetchClient(url, options);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_err) {
      body = { message: text };
    }
  }
  return { ok: res.ok, status: res.status, body };
}

function emitAuditEvent(event) {
  if (!outboxRepo) return;
  outboxRepo.enqueueOutboxEvent(buildEventEnvelope({
    eventType: event.eventType || 'AUDIT_EVENT',
    sourceService: serviceName,
    aggregateType: event.resource?.type || 'membership',
    aggregateId: event.resource?.id || event.metadata?.membershipId || null,
    payload: event,
    trace: {
      requestId: event.metadata?.requestId || null,
      userId: event.userId || null,
      orgId: event.organizationId || null,
      branchId: event.metadata?.branchId || null,
    },
    destination: 'audit',
  })).catch((err) => {
    fastify.log.warn({ err, eventType: event?.eventType }, 'Membership outbox enqueue failed');
  });
}

async function requireAuth(req, reply) {
  const token = parseBearerToken(req);
  if (!token) return reply.code(401).send({ message: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.auth = {
      userId: String(payload.sub),
      token,
      roles: Array.isArray(payload.roles) ? payload.roles.map((entry) => String(entry || '').trim().toLowerCase()) : [],
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

async function requireInternalOrAuth(req, reply) {
  const internal = req.headers['x-internal-token'];
  if (internal && internal === internalServiceToken) {
    req.internal = true;
    return;
  }
  return requireAuth(req, reply);
}

async function enforcePermission(req, reply, permissionKey, organizationId = null, branchId = null) {
  const checked = await callJson(`${rbacApiBaseUrl}/rbac/check`, {
    method: 'POST',
    headers: {
      authorization: req.headers.authorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      permissionKey,
      organizationId,
      branchId,
      activeContextId: req.headers['x-active-context-id'] || null,
      activeContextName: req.headers['x-active-context-name'] || null,
      activeContextType: req.headers['x-active-context-type'] || null,
    }),
  });

  if (!checked.ok || !checked.body?.allowed) {
    reply.code(checked.status === 401 ? 401 : 403).send({ message: 'Forbidden' });
    return true;
  }
  return false;
}

function validateCoverageType(type) {
  return ['primary', 'secondary', 'floating'].includes(type);
}

function hasCrossBranchRole(roles) {
  const elevated = new Set(['org_owner', 'org_admin', 'regional_manager', 'supervisor']);
  return Array.isArray(roles) && roles.some((role) => elevated.has(String(role).trim().toLowerCase()));
}

function hasSuperContext(req) {
  const contextName = String(req.headers['x-active-context-name'] || '').trim().toLowerCase();
  const contextId = String(req.headers['x-active-context-id'] || '').trim().toLowerCase();
  const contextType = String(req.headers['x-active-context-type'] || '').trim().toLowerCase();
  if (contextType === 'super') return true;
  if (['super', 'superadmin', 'super admin', 'platform admin', 'app admin'].includes(contextName)) return true;
  if (['app:super', 'super', 'superadmin', 'super_admin'].includes(contextId)) return true;
  return false;
}

function hasSuperRole(req) {
  return Array.isArray(req.auth?.roles) && req.auth.roles.some((role) => SUPER_ROLE_ALIASES.has(String(role || '').trim().toLowerCase()));
}

async function resolveRequesterScope(req, organizationId) {
  if (hasSuperRole(req) || hasSuperContext(req)) {
    return { all: true, branchIds: new Set(), institutionIds: new Set(), membershipId: null };
  }
  const membership = await collections.memberships().findOne({
    organizationId,
    userId: req.auth?.userId,
    status: 'active',
  });
  if (!membership) {
    return { all: false, branchIds: new Set(), institutionIds: new Set(), membershipId: null };
  }
  if (hasCrossBranchRole(membership.roles)) {
    return { all: true, branchIds: new Set(), institutionIds: new Set(), membershipId: membership.membershipId };
  }
  const assignments = await collections.assignments().find({
    organizationId,
    membershipId: membership.membershipId,
    status: 'active',
  }).toArray();
  const branchIds = new Set(
    assignments.map((entry) => String(entry?.branchId || '').trim()).filter(Boolean),
  );
  const institutionIds = new Set(
    assignments.map((entry) => String(entry?.institutionId || '').trim()).filter(Boolean),
  );
  return { all: false, branchIds, institutionIds, membershipId: membership.membershipId };
}

function toMembershipSummary(membership, assignments) {
  return {
    organizationId: membership.organizationId,
    organizationName: membership.organizationName || null,
    membershipId: membership.membershipId,
    membershipStatus: membership.status,
    roles: Array.isArray(membership.roles) ? membership.roles : [],
    branches: assignments.map((assignment) => ({
      branchId: assignment.branchId,
      institutionId: assignment.institutionId || null,
      branchName: assignment.branchName || null,
      roles: assignment.roles || [],
      departments: assignment.departments || [],
      assignedAt: assignment.assignedAt || assignment.activeFrom || null,
      removedAt: assignment.removedAt || assignment.activeTo || null,
    })),
  };
}

async function ensureNinExists(nin, authorization) {
  const ninRes = await callJson(`${authApiBaseUrl}/nin/${nin}`, {
    method: 'GET',
    headers: {
      authorization,
      'content-type': 'application/json',
    },
  });
  if (!ninRes.ok || !ninRes.body) {
    return null;
  }
  return ninRes.body;
}

async function writeEvent(payload) {
  await collections.events().insertOne({
    eventId: crypto.randomUUID(),
    createdAt: now(),
    ...payload,
  });
}

async function connect() {
  if (!mongoUri) {
    fastify.log.warn('Missing MONGODB_URI; membership-service running in degraded mode');
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

    await Promise.all([
      collections.memberships().createIndex({ membershipId: 1 }, { unique: true }),
      collections.memberships().createIndex({ organizationId: 1, nin: 1 }, { unique: true }),
      collections.memberships().createIndex({ userId: 1, organizationId: 1 }),
      collections.assignments().createIndex({ assignmentId: 1 }, { unique: true }),
      collections.assignments().createIndex({ organizationId: 1, membershipId: 1 }),
      collections.assignments().createIndex({ organizationId: 1, institutionId: 1, branchId: 1, status: 1 }),
      collections.events().createIndex({ membershipId: 1, timestamp: -1 }),
      collections.events().createIndex({ organizationId: 1, timestamp: -1 }),
      collections.archives().createIndex({ organizationId: 1, archivedAt: -1 }),
      collections.archives().createIndex({ organizationId: 1, restoredAt: 1 }),
      outboxRepo.createIndexes(),
    ]);
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed');
  }
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
        const res = await fetchClient(`${auditApiBaseUrl}/internal/audit/events`, {
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

fastify.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  if (!dbReady) {
    return reply.code(503).send({ message: 'Membership storage unavailable' });
  }
});

fastify.addHook('onRequest', createContextVerificationHook({
  secret: nhrsContextSecret,
  requiredMatcher: (req) => req.url.startsWith('/orgs/') || req.url.startsWith('/users/'),
}));

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  dbName,
}));

fastify.post('/orgs/:orgId/members', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Add organization member by NIN',
    security: [{ bearerAuth: [] }],
    params: { type: 'object', required: ['orgId'], properties: { orgId: { type: 'string' } } },
    body: {
      type: 'object',
      required: ['nin'],
      properties: {
        nin: { type: 'string', pattern: '^\\d{11}$' },
        initialRoles: { type: 'array', items: { type: 'string' } },
        initialBranchAssignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              branchId: { type: 'string' },
              institutionId: { type: 'string' },
              roles: { type: 'array', items: { type: 'string' } },
              departments: { type: 'array', items: { type: 'string' } },
              isPrimary: { type: 'boolean' },
              coverageType: { type: 'string', enum: ['primary', 'secondary', 'floating'] },
              activeFrom: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      503: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.add', orgId);
  if (denied) return;

  const nin = String(req.body.nin);
  const ninRecord = await ensureNinExists(nin, req.headers.authorization);
  if (!ninRecord) {
    return reply.code(503).send({ message: 'Fetching from NIN is currently not available.' });
  }

  const existing = await collections.memberships().findOne({ organizationId: orgId, nin });
  if (existing) {
    return reply.send({ membership: existing, created: false });
  }

  const membershipId = crypto.randomUUID();
  const membership = {
    membershipId,
    organizationId: orgId,
    userId: null,
    nin,
    addedByUserId: req.auth.userId,
    status: 'invited',
    activeFrom: now(),
    activeTo: null,
    metadata: { notes: null, initialRoles: req.body.initialRoles || [] },
    createdAt: now(),
    updatedAt: now(),
  };
  await collections.memberships().insertOne(membership);

  const initialAssignments = Array.isArray(req.body.initialBranchAssignments) ? req.body.initialBranchAssignments : [];
  for (const assignment of initialAssignments) {
    const branchId = assignment?.branchId ? String(assignment.branchId).trim() : null;
    const institutionId = assignment?.institutionId ? String(assignment.institutionId).trim() : null;
    if (!branchId && !institutionId) {
      // Skip invalid assignment payload without institution/branch scope.
      // Membership can still be created as org-level membership.
      continue;
    }
    const assignmentId = crypto.randomUUID();
    await collections.assignments().insertOne({
      assignmentId,
      membershipId,
      organizationId: orgId,
      institutionId,
      branchId,
      roles: Array.isArray(assignment.roles) ? assignment.roles : [],
      departments: Array.isArray(assignment.departments) ? assignment.departments : [],
      isPrimary: assignment.isPrimary === true,
      coverageType: validateCoverageType(assignment.coverageType) ? assignment.coverageType : 'secondary',
      activeFrom: assignment.startDate ? new Date(assignment.startDate) : now(),
      activeTo: null,
      assignedAt: assignment.startDate ? new Date(assignment.startDate) : now(),
      removedAt: null,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    });
  }

  await writeEvent({
    organizationId: orgId,
    membershipId,
    userId: null,
    nin,
    eventType: 'ORG_MEMBER_ADDED',
    from: null,
    to: { status: 'invited' },
    performedByUserId: req.auth.userId,
    reason: null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_ADDED',
    action: 'org.member.add',
    permissionKey: 'org.member.add',
    resource: { type: 'membership', id: membershipId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { nin, initialAssignments: initialAssignments.length },
  });

  return reply.code(201).send({ membership, created: true });
});

fastify.get('/orgs/:orgId/members', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'List organization members',
    security: [{ bearerAuth: [] }],
    params: { type: 'object', required: ['orgId'], properties: { orgId: { type: 'string' } } },
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        status: { type: 'string' },
        q: { type: 'string' },
        includeAssignments: { type: 'boolean' },
        branchId: { type: 'string' },
        institutionId: { type: 'string' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.read', orgId);
  if (denied) return;

  const scope = await resolveRequesterScope(req, orgId);
  if (!scope.all && !scope.membershipId) {
    return reply.send({ page: 1, limit: 20, total: 0, items: [] });
  }

  const {
    page = 1,
    limit = 20,
    status,
    q,
    includeAssignments = false,
    branchId = null,
    institutionId = null,
  } = req.query || {};
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const filter = { organizationId: orgId };
  if (status) filter.status = status;
  if (q) {
    filter.$or = [
      { nin: { $regex: String(q), $options: 'i' } },
      { userId: { $regex: String(q), $options: 'i' } },
    ];
  }
  if (!scope.all && scope.membershipId) {
    filter.membershipId = scope.membershipId;
  }

  const requiresAssignmentFilter =
    includeAssignments === true ||
    includeAssignments === 'true' ||
    Boolean(branchId) ||
    Boolean(institutionId) ||
    (!scope.all && (scope.branchIds.size > 0 || scope.institutionIds.size > 0));

  if (!requiresAssignmentFilter) {
    const [items, total] = await Promise.all([
      collections.memberships().find(filter).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
      collections.memberships().countDocuments(filter),
    ]);
    return reply.send({ page: safePage, limit: safeLimit, total, items });
  }

  const allMemberships = await collections.memberships().find(filter).toArray();
  if (allMemberships.length === 0) {
    return reply.send({ page: safePage, limit: safeLimit, total: 0, items: [] });
  }
  const membershipIds = allMemberships.map((entry) => entry.membershipId);
  const assignmentFilter = {
    organizationId: orgId,
    membershipId: { $in: membershipIds },
    status: 'active',
  };
  if (branchId) assignmentFilter.branchId = String(branchId).trim();
  if (institutionId) assignmentFilter.institutionId = String(institutionId).trim();
  const allAssignments = await collections.assignments().find(assignmentFilter).toArray();
  const assignmentsByMembership = new Map();
  for (const assignment of allAssignments) {
    const key = String(assignment?.membershipId || '');
    if (!key) continue;
    if (!assignmentsByMembership.has(key)) assignmentsByMembership.set(key, []);
    assignmentsByMembership.get(key).push(assignment);
  }

  const visibleMemberships = allMemberships.filter((membership) => {
    if (scope.all) return true;
    if (membership.membershipId === scope.membershipId) return true;
    const assignments = assignmentsByMembership.get(membership.membershipId) || [];
    if (assignments.length === 0) return false;
    if (scope.branchIds.size > 0) {
      if (assignments.some((entry) => scope.branchIds.has(String(entry?.branchId || '').trim()))) {
        return true;
      }
    }
    if (scope.institutionIds.size > 0) {
      if (assignments.some((entry) => scope.institutionIds.has(String(entry?.institutionId || '').trim()))) {
        return true;
      }
    }
    return false;
  });

  const total = visibleMemberships.length;
  const pagedMemberships = visibleMemberships.slice((safePage - 1) * safeLimit, safePage * safeLimit);
  const withAssignments = (includeAssignments === true || includeAssignments === 'true')
    ? pagedMemberships.map((membership) => ({
      ...membership,
      assignments: assignmentsByMembership.get(membership.membershipId) || [],
    }))
    : pagedMemberships;

  return reply.send({ page: safePage, limit: safeLimit, total, items: withAssignments });
});

fastify.get('/orgs/:orgId/members/:memberId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Get one organization member with branch assignments',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.read', orgId);
  if (denied) return;

  const scope = await resolveRequesterScope(req, orgId);
  if (!scope.all && !scope.membershipId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });
  if (!membership) return reply.code(404).send({ message: 'Membership not found' });
  const assignments = await collections.assignments().find({ organizationId: orgId, membershipId: membership.membershipId }).toArray();
  if (!scope.all && membership.membershipId !== scope.membershipId) {
    const intersectsBranch = assignments.some((entry) => scope.branchIds.has(String(entry?.branchId || '').trim()));
    const intersectsInstitution = assignments.some((entry) => scope.institutionIds.has(String(entry?.institutionId || '').trim()));
    if (!intersectsBranch && !intersectsInstitution) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
  }
  return reply.send({ membership, assignments });
});

fastify.patch('/orgs/:orgId/members/:memberId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Update member details',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        activeFrom: { type: 'string', format: 'date-time' },
        activeTo: { type: 'string', format: 'date-time' },
        metadata: { type: 'object', additionalProperties: true },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.update', orgId);
  if (denied) return;

  const existing = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });
  if (!existing) return reply.code(404).send({ message: 'Membership not found' });

  const updates = { updatedAt: now() };
  if (req.body?.startDate) updates.activeFrom = new Date(req.body.startDate);
  if (req.body?.endDate) updates.activeTo = new Date(req.body.endDate);
  if (req.body?.metadata && typeof req.body.metadata === 'object') {
    updates.metadata = { ...(existing.metadata || {}), ...req.body.metadata };
  }

  await collections.memberships().updateOne({ organizationId: orgId, membershipId: req.params.memberId }, { $set: updates });

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: existing.userId || null,
    nin: existing.nin,
    eventType: 'ORG_MEMBER_STATUS_CHANGED',
    from: { activeFrom: existing.activeFrom, activeTo: existing.activeTo, metadata: existing.metadata || {} },
    to: { activeFrom: updates.activeFrom || existing.activeFrom, activeTo: updates.activeTo || existing.activeTo, metadata: updates.metadata || existing.metadata || {} },
    performedByUserId: req.auth.userId,
    reason: 'member_update',
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_STATUS_CHANGED',
    action: 'org.member.update',
    permissionKey: 'org.member.update',
    resource: { type: 'membership', id: req.params.memberId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ message: 'Membership updated' });
});

fastify.patch('/orgs/:orgId/members/:memberId/status', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Change member status',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['invited', 'active', 'suspended', 'left'] },
        reason: { type: 'string' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.status.update', orgId);
  if (denied) return;

  const existing = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });
  if (!existing) return reply.code(404).send({ message: 'Membership not found' });

  const updates = {
    status: req.body.status,
    updatedAt: now(),
  };
  if (req.body.status === 'left') {
    updates.activeTo = now();
  }

  await collections.memberships().updateOne({ organizationId: orgId, membershipId: req.params.memberId }, { $set: updates });

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: existing.userId || null,
    nin: existing.nin,
    eventType: 'ORG_MEMBER_STATUS_CHANGED',
    from: { status: existing.status },
    to: { status: req.body.status },
    performedByUserId: req.auth.userId,
    reason: req.body.reason || null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_STATUS_CHANGED',
    action: 'org.member.status.update',
    permissionKey: 'org.member.status.update',
    resource: { type: 'membership', id: req.params.memberId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { from: existing.status, to: req.body.status },
  });

  return reply.send({ message: 'Membership status updated' });
});

fastify.post('/orgs/:orgId/members/:memberId/branches', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Assign member to branch',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        branchId: { type: 'string' },
        institutionId: { type: 'string' },
        roles: { type: 'array', items: { type: 'string' } },
        departments: { type: 'array', items: { type: 'string' } },
        isPrimary: { type: 'boolean' },
        coverageType: { type: 'string', enum: ['primary', 'secondary', 'floating'] },
        activeFrom: { type: 'string', format: 'date-time' },
      },
    },
    response: { 201: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.branch.assign', orgId);
  if (denied) return;

  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });
  if (!membership) return reply.code(404).send({ message: 'Membership not found' });
  const scopedBranchId = req.body.branchId ? String(req.body.branchId).trim() : null;
  const scopedInstitutionId = req.body.institutionId ? String(req.body.institutionId).trim() : null;
  if (!scopedBranchId && !scopedInstitutionId) {
    return reply.code(400).send({ message: 'Provide branchId or institutionId' });
  }

  const assignmentId = crypto.randomUUID();
  const assignment = {
    assignmentId,
    membershipId: req.params.memberId,
    organizationId: orgId,
    institutionId: scopedInstitutionId,
    branchId: scopedBranchId,
    roles: Array.isArray(req.body.roles) ? req.body.roles : [],
    departments: Array.isArray(req.body.departments) ? req.body.departments : [],
    isPrimary: req.body.isPrimary === true,
    coverageType: validateCoverageType(req.body.coverageType) ? req.body.coverageType : 'secondary',
    activeFrom: req.body.startDate ? new Date(req.body.startDate) : now(),
    activeTo: null,
    assignedAt: req.body.startDate ? new Date(req.body.startDate) : now(),
    removedAt: null,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };
  await collections.assignments().insertOne(assignment);

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: membership.userId || null,
    nin: membership.nin,
    eventType: 'BRANCH_ASSIGNED',
    from: null,
    to: {
      assignmentId,
      branchId: assignment.branchId || null,
      institutionId: assignment.institutionId || null,
      roles: assignment.roles,
      departments: assignment.departments,
    },
    performedByUserId: req.auth.userId,
    reason: null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_BRANCH_ASSIGNED',
    action: 'org.member.branch.assign',
    permissionKey: 'org.member.branch.assign',
    resource: { type: 'branch_assignment', id: assignmentId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.code(201).send({ assignment });
});

fastify.patch('/orgs/:orgId/members/:memberId/branches/:assignmentId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Update branch assignment',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId', 'assignmentId'],
      properties: {
        orgId: { type: 'string' },
        memberId: { type: 'string' },
        assignmentId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      properties: {
        roles: { type: 'array', items: { type: 'string' } },
        departments: { type: 'array', items: { type: 'string' } },
        isPrimary: { type: 'boolean' },
        coverageType: { type: 'string', enum: ['primary', 'secondary', 'floating'] },
        status: { type: 'string', enum: ['active', 'inactive'] },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.branch.update', orgId);
  if (denied) return;

  const existing = await collections.assignments().findOne({
    organizationId: orgId,
    membershipId: req.params.memberId,
    assignmentId: req.params.assignmentId,
  });
  if (!existing) return reply.code(404).send({ message: 'Assignment not found' });

  const updates = { updatedAt: now() };
  if (req.body.roles) updates.roles = req.body.roles;
  if (req.body.departments) updates.departments = req.body.departments;
  if (req.body.isPrimary !== undefined) updates.isPrimary = req.body.isPrimary;
  if (req.body.coverageType) updates.coverageType = req.body.coverageType;
  if (req.body.status) {
    updates.status = req.body.status;
    if (req.body.status === 'inactive') updates.activeTo = now();
  }

  await collections.assignments().updateOne(
    { organizationId: orgId, membershipId: req.params.memberId, assignmentId: req.params.assignmentId },
    { $set: updates }
  );

  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: membership?.userId || null,
    nin: membership?.nin || null,
    eventType: 'ROLE_CHANGED',
    from: { roles: existing.roles, departments: existing.departments, status: existing.status },
    to: { roles: updates.roles || existing.roles, departments: updates.departments || existing.departments, status: updates.status || existing.status },
    performedByUserId: req.auth.userId,
    reason: null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_BRANCH_UPDATED',
    action: 'org.member.branch.update',
    permissionKey: 'org.member.branch.update',
    resource: { type: 'branch_assignment', id: req.params.assignmentId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ message: 'Assignment updated' });
});

fastify.delete('/orgs/:orgId/members/:memberId/branches/:assignmentId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Remove branch assignment (soft)',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId', 'assignmentId'],
      properties: {
        orgId: { type: 'string' },
        memberId: { type: 'string' },
        assignmentId: { type: 'string' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.branch.remove', orgId);
  if (denied) return;

  const existing = await collections.assignments().findOne({
    organizationId: orgId,
    membershipId: req.params.memberId,
    assignmentId: req.params.assignmentId,
  });
  if (!existing) return reply.code(404).send({ message: 'Assignment not found' });

  await collections.assignments().updateOne(
    { organizationId: orgId, membershipId: req.params.memberId, assignmentId: req.params.assignmentId },
    { $set: { status: 'inactive', activeTo: now(), removedAt: now(), updatedAt: now() } }
  );

  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: membership?.userId || null,
    nin: membership?.nin || null,
    eventType: 'BRANCH_UNASSIGNED',
    from: { assignmentId: req.params.assignmentId, branchId: existing.branchId },
    to: null,
    performedByUserId: req.auth.userId,
    reason: null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_BRANCH_REMOVED',
    action: 'org.member.branch.remove',
    permissionKey: 'org.member.branch.remove',
    resource: { type: 'branch_assignment', id: req.params.assignmentId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ message: 'Assignment removed' });
});

fastify.post('/orgs/:orgId/members/:memberId/transfer', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Transfer member between branches',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['fromBranchId', 'toBranchId'],
      properties: {
        fromBranchId: { type: 'string' },
        toBranchId: { type: 'string' },
        roles: { type: 'array', items: { type: 'string' } },
        departments: { type: 'array', items: { type: 'string' } },
        reason: { type: 'string' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.transfer', orgId);
  if (denied) return;

  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });
  if (!membership) return reply.code(404).send({ message: 'Membership not found' });

  const currentAssignment = await collections.assignments().findOne({
    organizationId: orgId,
    membershipId: req.params.memberId,
    branchId: req.body.fromBranchId,
    status: 'active',
  });
  if (!currentAssignment) return reply.code(404).send({ message: 'Active source assignment not found' });

  await collections.assignments().updateOne(
    { assignmentId: currentAssignment.assignmentId },
    { $set: { status: 'inactive', activeTo: now(), removedAt: now(), updatedAt: now() } }
  );

  const newAssignment = {
    assignmentId: crypto.randomUUID(),
    membershipId: req.params.memberId,
    organizationId: orgId,
    branchId: req.body.toBranchId,
    roles: Array.isArray(req.body.roles) && req.body.roles.length > 0 ? req.body.roles : currentAssignment.roles,
    departments: Array.isArray(req.body.departments) ? req.body.departments : currentAssignment.departments,
    isPrimary: currentAssignment.isPrimary,
    coverageType: currentAssignment.coverageType,
    activeFrom: now(),
    activeTo: null,
    assignedAt: now(),
    removedAt: null,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };
  await collections.assignments().insertOne(newAssignment);

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: membership.userId || null,
    nin: membership.nin,
    eventType: 'BRANCH_TRANSFERRED',
    from: { branchId: req.body.fromBranchId },
    to: { branchId: req.body.toBranchId },
    performedByUserId: req.auth.userId,
    reason: req.body.reason || null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_TRANSFERRED',
    action: 'org.member.transfer',
    permissionKey: 'org.member.transfer',
    resource: { type: 'membership', id: req.params.memberId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ message: 'Member transferred', assignment: newAssignment });
});

fastify.get('/orgs/:orgId/members/:memberId/history', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Get membership movement history',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.history.read', orgId);
  if (denied) return;

  const page = Math.max(Number(req.query?.page) || 1, 1);
  const limit = Math.min(Number(req.query?.limit) || 50, 200);

  const [items, total] = await Promise.all([
    collections.events()
      .find({ organizationId: orgId, membershipId: req.params.memberId })
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    collections.events().countDocuments({ organizationId: orgId, membershipId: req.params.memberId }),
  ]);

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_HISTORY_VIEWED',
    action: 'org.member.history.read',
    permissionKey: 'org.member.history.read',
    resource: { type: 'membership', id: req.params.memberId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ page, limit, total, items });
});

fastify.post('/internal/memberships/link-user', {
  preHandler: requireInternal,
  schema: {
    tags: ['Membership'],
    summary: 'Internal link memberships by NIN after user registration',
    security: [],
    body: {
      type: 'object',
      required: ['userId', 'nin'],
      properties: {
        userId: { type: 'string' },
        nin: { type: 'string', pattern: '^\\d{11}$' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const { userId, nin } = req.body || {};

  const candidates = await collections.memberships().find({ nin: String(nin), userId: null }).toArray();
  if (candidates.length === 0) {
    return reply.send({ message: 'No pending memberships found', linked: 0 });
  }

  const ids = candidates.map((m) => m.membershipId);
  await collections.memberships().updateMany(
    { membershipId: { $in: ids } },
    { $set: { userId: String(userId), status: 'active', updatedAt: now() } }
  );

  for (const item of candidates) {
    await writeEvent({
      organizationId: item.organizationId,
      membershipId: item.membershipId,
      userId: String(userId),
      nin: item.nin,
      eventType: 'USER_LINKED',
      from: { userId: null },
      to: { userId: String(userId) },
      performedByUserId: 'internal',
      reason: 'linked_after_registration',
    });
  }

  return reply.send({ message: 'Memberships linked', linked: candidates.length });
});

fastify.get('/internal/memberships/summary/:userId', {
  preHandler: requireInternalOrAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Internal summary of user memberships',
    params: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const userId = req.params.userId;
  if (!req.internal && req.auth?.userId !== userId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const memberships = await collections.memberships().find({ userId }).toArray();
  const membershipIds = memberships.map((m) => m.membershipId);
  const assignments = membershipIds.length === 0
    ? []
    : await collections.assignments().find({ membershipId: { $in: membershipIds }, status: 'active' }).toArray();

  return reply.send({
    organizations: memberships.map((m) => ({
      organizationId: m.organizationId,
      membershipId: m.membershipId,
      status: m.status,
    })),
    activeAssignments: assignments,
  });
});

fastify.post('/orgs/:orgId/memberships/invite', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Invite or upsert membership by NIN',
    description: 'Creates membership if absent and creates active branch assignments for provided branchIds.',
    security: [{ bearerAuth: [] }],
    params: { type: 'object', required: ['orgId'], properties: { orgId: { type: 'string' } } },
    body: {
      type: 'object',
      required: ['nin'],
      properties: {
        nin: { type: 'string', pattern: '^\\d{11}$' },
        roles: { type: 'array', items: { type: 'string' } },
        branchIds: { type: 'array', items: { type: 'string' } },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      503: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.invite', orgId);
  if (denied) return;

  const nin = String(req.body.nin);
  const ninRecord = await ensureNinExists(nin, req.headers.authorization);
  if (!ninRecord) {
    return reply.code(503).send({ message: 'Fetching from NIN is currently not available.' });
  }

  let membership = await collections.memberships().findOne({ organizationId: orgId, nin });
  if (!membership) {
    membership = {
      membershipId: crypto.randomUUID(),
      userId: null,
      nin,
      organizationId: orgId,
      status: 'invited',
      roles: Array.isArray(req.body.roles) ? req.body.roles : [],
      createdAt: now(),
      updatedAt: now(),
    };
    await collections.memberships().insertOne(membership);
  } else if (Array.isArray(req.body.roles) && req.body.roles.length > 0) {
    await collections.memberships().updateOne(
      { membershipId: membership.membershipId },
      { $set: { roles: req.body.roles, updatedAt: now() } }
    );
    membership.roles = req.body.roles;
  }

  const branchIds = Array.isArray(req.body.branchIds) ? req.body.branchIds : [];
  const insertedAssignments = [];
  for (const branchId of branchIds) {
    const existingAssignment = await collections.assignments().findOne({
      organizationId: orgId,
      membershipId: membership.membershipId,
      branchId,
      status: 'active',
    });
    if (existingAssignment) continue;
    const assignment = {
      assignmentId: crypto.randomUUID(),
      membershipId: membership.membershipId,
      branchId,
      organizationId: orgId,
      roles: Array.isArray(req.body.roles) ? req.body.roles : [],
      activeFrom: now(),
      activeTo: null,
      assignedAt: now(),
      removedAt: null,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    };
    await collections.assignments().insertOne(assignment);
    insertedAssignments.push(assignment);
  }

  await writeEvent({
    eventType: 'ORG_MEMBER_ADDED',
    userId: membership.userId || null,
    organizationId: orgId,
    branchId: null,
    metadata: { membershipId: membership.membershipId, branchCount: insertedAssignments.length, roles: membership.roles || [] },
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_ADDED',
    action: 'org.member.invite',
    permissionKey: 'org.member.invite',
    resource: { type: 'membership', id: membership.membershipId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.code(201).send({ membership, assignmentsCreated: insertedAssignments.length });
});

fastify.post('/orgs/:orgId/memberships/:membershipId/branches', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Assign membership to multiple branches',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'membershipId'],
      properties: { orgId: { type: 'string' }, membershipId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['branchIds'],
      properties: {
        branchIds: { type: 'array', items: { type: 'string' } },
        roles: { type: 'array', items: { type: 'string' } },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.branch.assign', orgId);
  if (denied) return;
  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.membershipId });
  if (!membership) return reply.code(404).send({ message: 'Membership not found' });

  const branchIds = Array.isArray(req.body.branchIds) ? req.body.branchIds : [];
  const roles = Array.isArray(req.body.roles) ? req.body.roles : [];
  const created = [];
  for (const branchId of branchIds) {
    const active = await collections.assignments().findOne({
      organizationId: orgId,
      membershipId: req.params.membershipId,
      branchId,
      status: 'active',
    });
    if (active) continue;
    const assignment = {
      assignmentId: crypto.randomUUID(),
      membershipId: req.params.membershipId,
      branchId,
      organizationId: orgId,
      roles,
      activeFrom: now(),
      activeTo: null,
      assignedAt: now(),
      removedAt: null,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    };
    await collections.assignments().insertOne(assignment);
    created.push(assignment);
  }
  await writeEvent({
    eventType: 'BRANCH_ASSIGNED',
    userId: membership.userId || null,
    organizationId: orgId,
    branchId: null,
    metadata: { membershipId: req.params.membershipId, branchIds, roles },
  });
  return reply.code(201).send({ assignments: created, count: created.length });
});

fastify.patch('/orgs/:orgId/memberships/:membershipId/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Update assignment for a branch in a membership',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'membershipId', 'branchId'],
      properties: {
        orgId: { type: 'string' },
        membershipId: { type: 'string' },
        branchId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      properties: {
        roles: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['active', 'inactive'] },
        activeTo: { type: 'string', format: 'date-time' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.branch.assignment.update', orgId);
  if (denied) return;
  const existing = await collections.assignments().findOne({
    organizationId: orgId,
    membershipId: req.params.membershipId,
    branchId: req.params.branchId,
    status: { $in: ['active', 'inactive'] },
  });
  if (!existing) return reply.code(404).send({ message: 'Assignment not found' });
  const updates = { updatedAt: now() };
  if (Array.isArray(req.body?.roles)) updates.roles = req.body.roles;
  if (req.body?.status) updates.status = req.body.status;
  if (req.body?.activeTo) updates.activeTo = new Date(req.body.activeTo);
  if (req.body?.status === 'inactive') {
    if (!updates.activeTo) updates.activeTo = now();
    updates.removedAt = updates.activeTo;
  } else if (req.body?.activeTo) {
    updates.removedAt = new Date(req.body.activeTo);
  }
  await collections.assignments().updateOne({ assignmentId: existing.assignmentId }, { $set: updates });
  await writeEvent({
    eventType: 'ROLE_CHANGED',
    userId: null,
    organizationId: orgId,
    branchId: req.params.branchId,
    metadata: { membershipId: req.params.membershipId, updates },
  });
  return reply.send({ message: 'Assignment updated' });
});

fastify.get('/orgs/:orgId/memberships', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'List memberships in an organization',
    security: [{ bearerAuth: [] }],
    params: { type: 'object', required: ['orgId'], properties: { orgId: { type: 'string' } } },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.member.list', req.params.orgId);
  if (denied) return;
  const items = await collections.memberships().find({ organizationId: req.params.orgId }).toArray();
  return reply.send({ items });
});

fastify.get('/orgs/:orgId/memberships/:membershipId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Read one membership',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'membershipId'],
      properties: { orgId: { type: 'string' }, membershipId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.member.read', req.params.orgId);
  if (denied) return;
  const membership = await collections.memberships().findOne({ organizationId: req.params.orgId, membershipId: req.params.membershipId });
  if (!membership) return reply.code(404).send({ message: 'Membership not found' });
  const assignments = await collections.assignments().find({ membershipId: req.params.membershipId, organizationId: req.params.orgId }).toArray();
  return reply.send({ membership, assignments });
});

fastify.get('/users/:userId/memberships', {
  preHandler: requireInternalOrAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Get memberships by userId',
    description: 'Returns user memberships. Supports includeBranches=true to include active branch assignments.',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string' } },
    },
    querystring: {
      type: 'object',
      properties: {
        includeBranches: { type: 'boolean' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const userId = String(req.params.userId);
  if (!req.internal && req.auth?.userId !== userId) {
    const denied = await enforcePermission(req, reply, 'membership.user.read');
    if (denied) return;
  }
  const items = await collections.memberships().find({ userId, status: 'active' }).toArray();
  const includeBranches = req.query?.includeBranches === true || req.query?.includeBranches === 'true';
  if (!includeBranches || items.length === 0) {
    return reply.send({
      userId,
      memberships: items.map((item) => ({
        organizationId: item.organizationId,
        organizationName: item.organizationName || null,
        membershipId: item.membershipId,
        membershipStatus: item.status,
        roles: Array.isArray(item.roles) ? item.roles : [],
      })),
    });
  }
  const membershipIds = items.map((item) => item.membershipId);
  const assignments = await collections.assignments().find({
    membershipId: { $in: membershipIds },
    status: 'active',
  }).toArray();
  const assignmentsByMembership = assignments.reduce((acc, assignment) => {
    if (!acc[assignment.membershipId]) {
      acc[assignment.membershipId] = [];
    }
    acc[assignment.membershipId].push({
      assignmentId: assignment.assignmentId,
      branchId: assignment.branchId,
      institutionId: assignment.institutionId || null,
      roles: assignment.roles || [],
      departments: assignment.departments || [],
      status: assignment.status,
      activeFrom: assignment.activeFrom || null,
      activeTo: assignment.activeTo || null,
    });
    return acc;
  }, {});
  return reply.send({ userId, memberships: items.map((item) => toMembershipSummary(item, assignmentsByMembership[item.membershipId] || [])) });
});

fastify.get('/orgs/:orgId/memberships/me', {
  preHandler: requireInternal,
  schema: {
    tags: ['Membership'],
    summary: 'Internal membership scope check by org/branch',
    description: 'Internal-only endpoint used by gateway for org/branch scoped authorization checks.',
    security: [],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    querystring: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' },
        branchId: { type: 'string' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const orgId = String(req.params.orgId);
  const userId = String(req.query?.userId || '');
  if (!userId) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }

  const membership = await collections.memberships().findOne({
    userId,
    organizationId: orgId,
    status: 'active',
  });
  if (!membership) {
    return reply.send({ allowed: false, membership: null, assignments: [] });
  }

  const assignments = await collections.assignments().find({
    membershipId: membership.membershipId,
    organizationId: orgId,
    status: 'active',
  }).toArray();

  const branchId = req.query?.branchId ? String(req.query.branchId) : null;
  if (branchId) {
    const branchMatch = assignments.some((item) => item.branchId === branchId);
    const crossBranchAllowed = hasCrossBranchRole(membership.roles);
    if (!branchMatch && !crossBranchAllowed) {
      return reply.send({ allowed: false, membership, assignments });
    }
  }

  return reply.send({
    allowed: true,
    membership,
    assignments,
  });
});

fastify.get('/users/:userId/movement-history', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Get chronological user movement history',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'membership.user.history.read');
  if (denied) return;
  const memberships = await collections.memberships().find({ userId: req.params.userId }).toArray();
  const membershipIds = memberships.map((m) => m.membershipId);
  const assignments = membershipIds.length
    ? await collections.assignments().find({ membershipId: { $in: membershipIds } }).sort({ activeFrom: 1 }).toArray()
    : [];
  const timeline = assignments.map((a) => ({
    membershipId: a.membershipId,
    organizationId: a.organizationId,
    branchId: a.branchId,
    roles: a.roles || [],
    activeFrom: a.activeFrom || null,
    activeTo: a.activeTo || null,
    status: a.status,
  }));
  return reply.send({ userId: req.params.userId, timeline });
});

fastify.post('/internal/memberships/access-check', {
  preHandler: requireInternal,
  schema: {
    tags: ['Membership'],
    summary: 'Internal scoped membership access check',
    body: {
      type: 'object',
      required: ['userId', 'organizationId'],
      properties: {
        userId: { type: 'string' },
        organizationId: { type: 'string' },
        branchId: { type: 'string' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const { userId, organizationId, branchId = null } = req.body || {};
  const membership = await collections.memberships().findOne({ userId: String(userId), organizationId: String(organizationId), status: { $in: ['active', 'invited'] } });
  if (!membership) return reply.send({ allowed: false, reason: 'NO_ACTIVE_MEMBERSHIP' });
  if (branchId) {
    const activeAssignment = await collections.assignments().findOne({
      membershipId: membership.membershipId,
      organizationId: String(organizationId),
      branchId: String(branchId),
      status: 'active',
    });
    if (!activeAssignment) return reply.send({ allowed: false, reason: 'NO_ACTIVE_BRANCH_ASSIGNMENT' });
  }
  return reply.send({ allowed: true, membershipId: membership.membershipId });
});

fastify.post('/internal/memberships/bootstrap', {
  preHandler: requireInternal,
  schema: {
    tags: ['Membership'],
    summary: 'Internal bootstrap of creator/owner memberships',
    body: {
      type: 'object',
      required: ['organizationId'],
      properties: {
        organizationId: { type: 'string' },
        createdByUserId: { type: 'string' },
        ownerUserId: { type: 'string' },
        ownerNin: { type: 'string' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const { organizationId, createdByUserId = null, ownerUserId = null, ownerNin = null } = req.body || {};
  const created = [];
  if (createdByUserId) {
    const exists = await collections.memberships().findOne({ organizationId, userId: String(createdByUserId) });
    if (!exists) {
      const membership = {
        membershipId: crypto.randomUUID(),
        userId: String(createdByUserId),
        nin: null,
        organizationId,
        status: 'active',
        roles: ['org_owner'],
        createdAt: now(),
        updatedAt: now(),
      };
      await collections.memberships().insertOne(membership);
      created.push(membership.membershipId);
    }
  }
  if (ownerUserId) {
    const exists = await collections.memberships().findOne({ organizationId, userId: String(ownerUserId) });
    if (!exists) {
      const membership = {
        membershipId: crypto.randomUUID(),
        userId: String(ownerUserId),
        nin: null,
        organizationId,
        status: 'active',
        roles: ['org_owner'],
        createdAt: now(),
        updatedAt: now(),
      };
      await collections.memberships().insertOne(membership);
      created.push(membership.membershipId);
    }
  } else if (ownerNin) {
    const exists = await collections.memberships().findOne({ organizationId, nin: String(ownerNin) });
    if (!exists) {
      const membership = {
        membershipId: crypto.randomUUID(),
        userId: null,
        nin: String(ownerNin),
        organizationId,
        status: 'invited',
        roles: ['org_owner'],
        createdAt: now(),
        updatedAt: now(),
      };
      await collections.memberships().insertOne(membership);
      created.push(membership.membershipId);
    }
  }
  return reply.send({ createdCount: created.length, membershipIds: created });
});

fastify.post('/internal/memberships/org/:orgId/suspend', {
  preHandler: requireInternal,
  schema: {
    tags: ['Membership'],
    summary: 'Internal suspend all organization memberships and assignments',
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = String(req.params.orgId);
  const ts = now();

  const membershipsRes = await collections.memberships().updateMany(
    { organizationId: orgId, status: { $in: ['active', 'invited'] } },
    [{
      $set: {
        orgSuspendPreviousStatus: { $ifNull: ['$orgSuspendPreviousStatus', '$status'] },
        status: 'suspended',
        suspendedByOrg: true,
        updatedAt: ts,
      },
    }],
  );
  const assignmentsRes = await collections.assignments().updateMany(
    { organizationId: orgId, status: 'active' },
    [{
      $set: {
        orgSuspendPreviousStatus: { $ifNull: ['$orgSuspendPreviousStatus', '$status'] },
        status: 'inactive',
        orgSuspended: true,
        activeTo: ts,
        updatedAt: ts,
      },
    }],
  );

  return reply.send({
    organizationId: orgId,
    suspendedMemberships: membershipsRes.modifiedCount || 0,
    suspendedAssignments: assignmentsRes.modifiedCount || 0,
  });
});

fastify.post('/internal/memberships/org/:orgId/resume', {
  preHandler: requireInternal,
  schema: {
    tags: ['Membership'],
    summary: 'Internal resume organization memberships and assignments',
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = String(req.params.orgId);
  const ts = now();
  const membershipsRes = await collections.memberships().updateMany(
    { organizationId: orgId, suspendedByOrg: true, status: 'suspended' },
    [{
      $set: {
        status: {
          $cond: [
            { $in: ['$orgSuspendPreviousStatus', ['active', 'invited']] },
            '$orgSuspendPreviousStatus',
            'active',
          ],
        },
        updatedAt: ts,
      },
    }, {
      $unset: ['orgSuspendPreviousStatus', 'suspendedByOrg'],
    }],
  );

  const assignmentsRes = await collections.assignments().updateMany(
    { organizationId: orgId, orgSuspended: true, status: 'inactive' },
    [{
      $set: {
        status: {
          $cond: [
            { $in: ['$orgSuspendPreviousStatus', ['active', 'inactive']] },
            '$orgSuspendPreviousStatus',
            'active',
          ],
        },
        activeTo: null,
        updatedAt: ts,
      },
    }, {
      $unset: ['orgSuspendPreviousStatus', 'orgSuspended'],
    }],
  );

  return reply.send({
    organizationId: orgId,
    resumedMemberships: membershipsRes.modifiedCount || 0,
    resumedAssignments: assignmentsRes.modifiedCount || 0,
  });
});

fastify.post('/internal/memberships/org/:orgId/archive-delete', {
  preHandler: requireInternal,
  schema: {
    tags: ['Membership'],
    summary: 'Internal archive and remove organization memberships on org delete',
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = String(req.params.orgId);
  const ts = now();
  const memberships = await collections.memberships().find({ organizationId: orgId }).toArray();
  const assignments = await collections.assignments().find({ organizationId: orgId }).toArray();

  const archive = {
    archiveId: crypto.randomUUID(),
    organizationId: orgId,
    memberships: memberships.map((entry) => {
      const clone = { ...entry };
      delete clone._id;
      return clone;
    }),
    assignments: assignments.map((entry) => {
      const clone = { ...entry };
      delete clone._id;
      return clone;
    }),
    archivedAt: ts,
    restoredAt: null,
  };
  await collections.archives().insertOne(archive);

  const membershipIds = memberships.map((entry) => String(entry.membershipId)).filter(Boolean);
  if (membershipIds.length > 0) {
    await collections.memberships().updateMany(
      { organizationId: orgId, membershipId: { $in: membershipIds } },
      {
        $set: {
          status: 'left',
          roles: [],
          removedByOrgDeletion: true,
          updatedAt: ts,
        },
      },
    );
  }
  const assignmentIds = assignments.map((entry) => String(entry.assignmentId)).filter(Boolean);
  if (assignmentIds.length > 0) {
    await collections.assignments().updateMany(
      { organizationId: orgId, assignmentId: { $in: assignmentIds } },
      {
        $set: {
          status: 'inactive',
          removedByOrgDeletion: true,
          activeTo: ts,
          removedAt: ts,
          updatedAt: ts,
        },
      },
    );
  }

  return reply.send({
    organizationId: orgId,
    archivedMemberships: memberships.length,
    archivedAssignments: assignments.length,
  });
});

fastify.post('/internal/memberships/org/:orgId/restore', {
  preHandler: requireInternal,
  schema: {
    tags: ['Membership'],
    summary: 'Internal restore archived memberships after org restore',
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = String(req.params.orgId);
  const archive = await collections.archives().findOne(
    { organizationId: orgId, restoredAt: null },
    { sort: { archivedAt: -1 } },
  );
  if (!archive) {
    return reply.send({ organizationId: orgId, restoredMemberships: 0, restoredAssignments: 0 });
  }

  const ts = now();
  const membershipEntries = Array.isArray(archive.memberships) ? archive.memberships : [];
  const assignmentEntries = Array.isArray(archive.assignments) ? archive.assignments : [];

  if (membershipEntries.length > 0) {
    await collections.memberships().bulkWrite(
      membershipEntries.map((entry) => {
        const doc = { ...entry, updatedAt: ts };
        delete doc._id;
        return {
          replaceOne: {
            filter: { membershipId: doc.membershipId, organizationId: orgId },
            replacement: doc,
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  }

  if (assignmentEntries.length > 0) {
    await collections.assignments().bulkWrite(
      assignmentEntries.map((entry) => {
        const doc = { ...entry, updatedAt: ts };
        delete doc._id;
        return {
          replaceOne: {
            filter: { assignmentId: doc.assignmentId, organizationId: orgId },
            replacement: doc,
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  }

  await collections.archives().updateOne(
    { archiveId: archive.archiveId },
    { $set: { restoredAt: ts } },
  );

  return reply.send({
    organizationId: orgId,
    restoredMemberships: membershipEntries.length,
    restoredAssignments: assignmentEntries.length,
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
    if (outboxTimer) clearInterval(outboxTimer);
    if (mongoClient) await mongoClient.close();
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

function buildApp(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'dbReady')) {
    dbReady = !!options.dbReady;
  }
  if (options.db) {
    db = options.db;
  }
  if (options.fetchImpl) {
    fetchClient = options.fetchImpl;
  }
  return fastify;
}

module.exports = {
  buildApp,
  start,
};

if (require.main === module) {
  start();
}



