const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { buildEventEnvelope, createOutboxRepository, deliverOutboxBatch } = require('../../../../libs/shared/src/outbox');
const { createContextVerificationHook } = require('../../../../libs/shared/src/nhrs-context');
const { enforceProductionSecrets } = require('../../../../libs/shared/src/env');
const { setStandardErrorHandler } = require('../../../../libs/shared/src/errors');

const serviceName = 'organization-service';
const port = Number(process.env.PORT) || 8093;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_organization_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const membershipApiBaseUrl = process.env.MEMBERSHIP_API_BASE_URL || 'http://membership-service:8103';
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
  organizations: () => db.collection('organizations'),
  ownerHistory: () => db.collection('organization_owner_history'),
  branches: () => db.collection('branches'),
};

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
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

async function requireAuth(req, reply) {
  const token = parseBearerToken(req);
  if (!token) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.auth = {
      userId: String(payload.sub),
      token,
    };
  } catch (_err) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
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

function emitAuditEvent(event, req = null) {
  if (!outboxRepo) return;
  outboxRepo.enqueueOutboxEvent(buildEventEnvelope({
    eventType: event.eventType || 'AUDIT_EVENT',
    sourceService: serviceName,
    aggregateType: event.resource?.type || 'organization',
    aggregateId: event.resource?.id || event.organizationId || null,
    payload: event,
    trace: {
      requestId: req?.headers?.['x-request-id'] || null,
      userId: req?.auth?.userId || event.userId || null,
      orgId: event.organizationId || req?.headers?.['x-org-id'] || null,
      branchId: req?.headers?.['x-branch-id'] || null,
    },
    destination: 'audit',
  })).catch((err) => {
    fastify.log.warn({ err, eventType: event?.eventType }, 'Organization outbox enqueue failed');
  });
}

async function enforcePermission(req, reply, permissionKey, organizationId = null) {
  const checked = await callJson(`${rbacApiBaseUrl}/rbac/check`, {
    method: 'POST',
    headers: {
      authorization: req.headers.authorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ permissionKey, organizationId }),
  });

  if (!checked.ok || !checked.body?.allowed) {
    reply.code(checked.status === 401 ? 401 : 403).send({ message: 'Forbidden' });
    emitAuditEvent({
      userId: req.auth?.userId || null,
      organizationId,
      eventType: 'RBAC_ACCESS_DENIED',
      action: 'organization.permission.check',
      permissionKey,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      outcome: 'failure',
      failureReason: checked.body?.reason || 'PERMISSION_DENIED',
      metadata: { path: req.routeOptions?.url || req.url, method: req.method },
    });
    return true;
  }
  return false;
}

function validateOrgType(type) {
  return ['hospital', 'laboratory', 'pharmacy', 'government', 'emergency', 'catalog'].includes(type);
}

async function bootstrapOrgDefaults(_authorization, organizationId, ownerUserId) {
  try {
    await callJson(`${rbacApiBaseUrl}/internal/rbac/bootstrap-org/${organizationId}`, {
      method: 'POST',
      headers: {
        'x-internal-token': internalServiceToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ownerUserId: ownerUserId || null }),
    });
  } catch (err) {
    fastify.log.warn({ err, organizationId }, 'Failed to bootstrap default org roles');
  }
}

async function bootstrapInitialMembership(organizationId, createdByUserId, ownerUserId, ownerNin) {
  try {
    await callJson(`${membershipApiBaseUrl}/internal/memberships/bootstrap`, {
      method: 'POST',
      headers: {
        'x-internal-token': internalServiceToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        createdByUserId: createdByUserId || null,
        ownerUserId: ownerUserId || null,
        ownerNin: ownerNin || null,
      }),
    });
  } catch (err) {
    fastify.log.warn({ err, organizationId }, 'Failed to bootstrap initial memberships');
  }
}

async function connect() {
  if (!mongoUri) {
    fastify.log.warn('Missing MONGODB_URI; organization-service running in degraded mode');
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
      collections.organizations().createIndex({ organizationId: 1 }, { unique: true }),
      collections.organizations().createIndex({ ownerUserId: 1 }),
      collections.organizations().createIndex({ ownerNin: 1 }),
      collections.organizations().createIndex({ name: 'text' }),
      collections.branches().createIndex({ branchId: 1 }, { unique: true }),
      collections.branches().createIndex({ organizationId: 1, code: 1 }, { unique: true }),
      collections.ownerHistory().createIndex({ organizationId: 1, timestamp: -1 }),
      outboxRepo.createIndexes(),
    ]);
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed');
  }
}

fastify.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  if (!dbReady) {
    return reply.code(503).send({ message: 'Organization storage unavailable' });
  }
});

fastify.addHook('onRequest', createContextVerificationHook({
  secret: nhrsContextSecret,
  requiredMatcher: (req) => req.url.startsWith('/orgs/'),
}));

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

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  dbName,
}));

fastify.post('/orgs', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Create organization',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['name', 'type'],
      properties: {
        name: { type: 'string', minLength: 2 },
        type: { type: 'string', enum: ['hospital', 'laboratory', 'pharmacy', 'government', 'emergency', 'catalog'] },
        ownerUserId: { type: 'string' },
        ownerNin: { type: 'string', pattern: '^\\d{11}$' },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      503: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.create');
  if (denied) return;

  const { name, type, ownerUserId = null, ownerNin = null } = req.body || {};
  if (!validateOrgType(type)) {
    return reply.code(400).send({ message: 'Invalid organization type' });
  }
  if (ownerUserId && ownerNin) {
    return reply.code(400).send({ message: 'Provide ownerUserId or ownerNin, not both' });
  }

  const organizationId = crypto.randomUUID();
  const doc = {
    organizationId,
    name: String(name).trim(),
    type,
    createdByUserId: req.auth.userId,
    ownerUserId: ownerUserId ? String(ownerUserId) : (!ownerNin ? req.auth.userId : null),
    ownerNin: ownerNin ? String(ownerNin) : null,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };

  await collections.organizations().insertOne(doc);
  await collections.ownerHistory().insertOne({
    eventId: crypto.randomUUID(),
    organizationId,
    fromOwnerUserId: null,
    fromOwnerNin: null,
    toOwnerUserId: doc.ownerUserId,
    toOwnerNin: doc.ownerNin,
    changedByUserId: req.auth.userId,
    reason: 'initial_owner_assignment',
    timestamp: now(),
  });

  bootstrapOrgDefaults(req.headers.authorization, organizationId, doc.ownerUserId);
  bootstrapInitialMembership(organizationId, req.auth.userId, doc.ownerUserId, doc.ownerNin);

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'ORG_CREATED',
    action: 'org.create',
    resource: { type: 'organization', id: organizationId },
    permissionKey: 'org.create',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { type, ownerUserId: doc.ownerUserId, ownerNin: doc.ownerNin },
  });

  return reply.code(201).send({ organization: doc });
});

fastify.get('/orgs', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'List organizations',
    description: 'Lists organizations visible to the caller.',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.list');
  if (denied) return;
  const page = Math.max(Number(req.query?.page) || 1, 1);
  const limit = Math.min(Number(req.query?.limit) || 20, 100);
  const [items, total] = await Promise.all([
    collections.organizations().find({}).skip((page - 1) * limit).limit(limit).toArray(),
    collections.organizations().countDocuments({}),
  ]);
  return reply.send({ page, limit, total, items });
});

fastify.get('/orgs/:orgId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Get organization',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: {
        orgId: { type: 'string' },
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
  const denied = await enforcePermission(req, reply, 'org.read', req.params.orgId);
  if (denied) return;
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) {
    return reply.code(404).send({ message: 'Organization not found' });
  }
  return reply.send({ organization });
});

fastify.patch('/orgs/:orgId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Update organization',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: {
        orgId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2 },
        status: { type: 'string', enum: ['active', 'suspended'] },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.update', req.params.orgId);
  if (denied) return;

  const update = { updatedAt: now() };
  if (req.body?.name) update.name = String(req.body.name).trim();
  if (req.body?.status) update.status = req.body.status;

  const result = await collections.organizations().findOneAndUpdate(
    { organizationId: req.params.orgId },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (!result.value) {
    return reply.code(404).send({ message: 'Organization not found' });
  }

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_UPDATED',
    action: 'org.update',
    resource: { type: 'organization', id: req.params.orgId },
    permissionKey: 'org.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { fields: Object.keys(req.body || {}) },
  });

  return reply.send({ organization: result.value });
});

fastify.patch('/orgs/:orgId/owner', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Change organization owner',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: {
        orgId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      properties: {
        ownerUserId: { type: 'string' },
        ownerNin: { type: 'string', pattern: '^\\d{11}$' },
        reason: { type: 'string' },
      },
      oneOf: [
        { required: ['ownerUserId'] },
        { required: ['ownerNin'] },
      ],
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.owner.assign', req.params.orgId);
  if (denied) return;

  const existing = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!existing) {
    return reply.code(404).send({ message: 'Organization not found' });
  }

  const { ownerUserId = null, ownerNin = null, reason = null } = req.body || {};
  const update = {
    ownerUserId: ownerUserId ? String(ownerUserId) : null,
    ownerNin: ownerNin ? String(ownerNin) : null,
    updatedAt: now(),
  };

  await collections.organizations().updateOne(
    { organizationId: req.params.orgId },
    { $set: update }
  );

  await collections.ownerHistory().insertOne({
    eventId: crypto.randomUUID(),
    organizationId: req.params.orgId,
    fromOwnerUserId: existing.ownerUserId || null,
    fromOwnerNin: existing.ownerNin || null,
    toOwnerUserId: update.ownerUserId,
    toOwnerNin: update.ownerNin,
    changedByUserId: req.auth.userId,
    reason: reason || 'manual_owner_change',
    timestamp: now(),
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_OWNER_CHANGED',
    action: 'org.owner.assign',
    resource: { type: 'organization', id: req.params.orgId },
    permissionKey: 'org.owner.assign',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { fromOwnerUserId: existing.ownerUserId || null, toOwnerUserId: update.ownerUserId || null, toOwnerNin: update.ownerNin || null },
  });

  return reply.send({ message: 'Owner updated' });
});

fastify.post('/orgs/:orgId/assign-owner', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Assign organization owner by NIN',
    description: 'Assigns owner using ownerNin and records owner history.',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['ownerNin'],
      properties: {
        ownerNin: { type: 'string', pattern: '^\\d{11}$' },
        reason: { type: 'string' },
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
  const denied = await enforcePermission(req, reply, 'org.owner.assign', req.params.orgId);
  if (denied) return;
  const existing = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!existing) return reply.code(404).send({ message: 'Organization not found' });

  const ownerNin = String(req.body.ownerNin);
  await collections.organizations().updateOne(
    { organizationId: req.params.orgId },
    { $set: { ownerNin, ownerUserId: null, updatedAt: now() } }
  );
  await collections.ownerHistory().insertOne({
    eventId: crypto.randomUUID(),
    organizationId: req.params.orgId,
    fromOwnerUserId: existing.ownerUserId || null,
    fromOwnerNin: existing.ownerNin || null,
    toOwnerUserId: null,
    toOwnerNin: ownerNin,
    changedByUserId: req.auth.userId,
    reason: req.body.reason || 'assign_owner_by_nin',
    timestamp: now(),
  });
  bootstrapInitialMembership(req.params.orgId, null, null, ownerNin);
  return reply.send({ message: 'Owner assigned' });
});

fastify.get('/orgs/search', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Search organizations',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        type: { type: 'string' },
        status: { type: 'string' },
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.search');
  if (denied) return;

  const { q, type, status, page = 1, limit = 20 } = req.query || {};
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const filter = {};
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (q) {
    filter.$or = [
      { name: { $regex: String(q), $options: 'i' } },
      { organizationId: { $regex: String(q), $options: 'i' } },
    ];
  }

  const [items, total] = await Promise.all([
    collections.organizations().find(filter).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
    collections.organizations().countDocuments(filter),
  ]);

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'ORG_SEARCHED',
    action: 'org.search',
    permissionKey: 'org.search',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { page: safePage, limit: safeLimit, hasQ: !!q },
  });

  return reply.send({ page: safePage, limit: safeLimit, total, items });
});

fastify.post('/orgs/:orgId/branches', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Create branch',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['name', 'code'],
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string', minLength: 2 },
        address: { type: 'object', additionalProperties: true },
        location: { type: 'object', additionalProperties: true },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.create', req.params.orgId);
  if (denied) return;

  const org = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!org) {
    return reply.code(404).send({ message: 'Organization not found' });
  }

  const branchId = crypto.randomUUID();
  const branch = {
    branchId,
    organizationId: req.params.orgId,
    name: String(req.body.name).trim(),
    code: String(req.body.code).trim().toUpperCase(),
    address: req.body.address || null,
    location: req.body.location || null,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };

  try {
    await collections.branches().insertOne(branch);
  } catch (err) {
    if (err?.code === 11000) {
      return reply.code(400).send({ message: 'Branch code already exists in this organization' });
    }
    throw err;
  }

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_BRANCH_CREATED',
    action: 'org.branch.create',
    resource: { type: 'branch', id: branchId },
    permissionKey: 'org.branch.create',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { code: branch.code },
  });

  return reply.code(201).send({ branch });
});

fastify.get('/orgs/:orgId/branches', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'List organization branches',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.read', req.params.orgId);
  if (denied) return;

  const branches = await collections.branches().find({ organizationId: req.params.orgId }).toArray();
  return reply.send({ items: branches });
});

fastify.get('/orgs/:orgId/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Get one branch',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'branchId'],
      properties: { orgId: { type: 'string' }, branchId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.read', req.params.orgId);
  if (denied) return;

  const branch = await collections.branches().findOne({ organizationId: req.params.orgId, branchId: req.params.branchId });
  if (!branch) {
    return reply.code(404).send({ message: 'Branch not found' });
  }
  return reply.send({ branch });
});

fastify.patch('/orgs/:orgId/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Update branch',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'branchId'],
      properties: { orgId: { type: 'string' }, branchId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        code: { type: 'string' },
        address: { type: 'object', additionalProperties: true },
        location: { type: 'object', additionalProperties: true },
        status: { type: 'string', enum: ['active', 'closed'] },
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
  const denied = await enforcePermission(req, reply, 'org.branch.update', req.params.orgId);
  if (denied) return;

  const update = { updatedAt: now() };
  if (req.body?.name) update.name = req.body.name;
  if (req.body?.code) update.code = String(req.body.code).trim().toUpperCase();
  if (req.body?.address !== undefined) update.address = req.body.address;
  if (req.body?.location !== undefined) update.location = req.body.location;
  if (req.body?.status) update.status = req.body.status;

  const result = await collections.branches().findOneAndUpdate(
    { organizationId: req.params.orgId, branchId: req.params.branchId },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (!result.value) {
    return reply.code(404).send({ message: 'Branch not found' });
  }

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_BRANCH_UPDATED',
    action: 'org.branch.update',
    resource: { type: 'branch', id: req.params.branchId },
    permissionKey: 'org.branch.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { fields: Object.keys(req.body || {}) },
  });

  return reply.send({ branch: result.value });
});

fastify.delete('/orgs/:orgId/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Soft-delete branch',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'branchId'],
      properties: { orgId: { type: 'string' }, branchId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.delete', req.params.orgId);
  if (denied) return;

  const result = await collections.branches().findOneAndUpdate(
    { organizationId: req.params.orgId, branchId: req.params.branchId },
    { $set: { status: 'closed', updatedAt: now() } },
    { returnDocument: 'after' }
  );
  if (!result.value) {
    return reply.code(404).send({ message: 'Branch not found' });
  }

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_BRANCH_DELETED',
    action: 'org.branch.delete',
    resource: { type: 'branch', id: req.params.branchId },
    permissionKey: 'org.branch.delete',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ message: 'Branch closed' });
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

