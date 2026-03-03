const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const serviceName = 'audit-log-service';
const port = Number(process.env.PORT) || 8091;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_audit_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const flushIntervalMs = Number(process.env.AUDIT_FLUSH_INTERVAL_MS) || 1000;
const flushBatchSize = Number(process.env.AUDIT_FLUSH_BATCH_SIZE) || 200;

const eventTypes = new Set([
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILURE',
  'AUTH_PASSWORD_SET',
  'AUTH_PASSWORD_CHANGE',
  'AUTH_PASSWORD_RESET_REQUEST',
  'AUTH_PASSWORD_RESET_COMPLETE',
  'AUTH_LOGOUT',
  'AUTH_PHONE_ADDED',
  'AUTH_PHONE_VERIFIED',
  'AUTH_EMAIL_ADDED',
  'AUTH_EMAIL_VERIFIED',
  'RBAC_ROLE_CREATED',
  'RBAC_ROLE_UPDATED',
  'RBAC_ROLE_DELETED',
  'RBAC_PERMISSION_CREATED',
  'RBAC_PERMISSION_ASSIGNED',
  'RBAC_USER_OVERRIDE_APPLIED',
  'RBAC_ACCESS_GRANTED',
  'RBAC_ACCESS_DENIED',
  'NIN_LOOKUP_SUCCESS',
  'NIN_LOOKUP_FAILURE',
  'NIN_REFRESH_REQUESTED',
]);

let dbReady = false;
let mongoClient;
let db;
let flushTimer = null;
const pendingEvents = [];

const collections = {
  auditEvents: () => db.collection('audit_events'),
};

function parseBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

function isAdminTokenPayload(payload) {
  const roles = Array.isArray(payload?.roles) ? payload.roles : [];
  return roles.includes('admin') || roles.includes('platform_admin') || roles.includes('auditor');
}

async function requireAdmin(req, reply) {
  const token = parseBearerToken(req);
  if (!token) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    if (!isAdminTokenPayload(payload)) {
      return reply.code(403).send({ message: 'Forbidden' });
    }
    req.auth = payload;
  } catch (_err) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== 'object') {
    return value ?? null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item));
  }

  const blockedKeys = new Set(['password', 'newPassword', 'currentPassword', 'code', 'otp', 'rawOtp']);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (blockedKeys.has(k)) {
      continue;
    }
    out[k] = sanitizeMetadata(v);
  }
  return out;
}

function normalizeEvent(input) {
  const eventType = typeof input?.eventType === 'string' ? input.eventType : '';
  const createdAt = input?.createdAt ? new Date(input.createdAt) : new Date();
  const normalized = {
    eventId: typeof input?.eventId === 'string' && input.eventId ? input.eventId : crypto.randomUUID(),
    userId: input?.userId ? String(input.userId) : null,
    organizationId: input?.organizationId ? String(input.organizationId) : null,
    eventType,
    action: typeof input?.action === 'string' ? input.action : eventType,
    resource:
      input?.resource && typeof input.resource === 'object'
        ? {
            type: input.resource.type ? String(input.resource.type) : null,
            id: input.resource.id ? String(input.resource.id) : null,
          }
        : null,
    permissionKey: input?.permissionKey ? String(input.permissionKey) : null,
    ipAddress: input?.ipAddress ? String(input.ipAddress) : null,
    userAgent: input?.userAgent ? String(input.userAgent) : null,
    metadata: sanitizeMetadata(input?.metadata || {}),
    outcome: input?.outcome === 'failure' ? 'failure' : 'success',
    failureReason: input?.failureReason ? String(input.failureReason) : null,
    createdAt,
  };

  if (!eventTypes.has(normalized.eventType)) {
    normalized.eventType = 'AUTH_LOGIN_FAILURE';
    normalized.failureReason = normalized.failureReason || 'UNKNOWN_EVENT_TYPE';
    normalized.outcome = 'failure';
  }

  return normalized;
}

async function flushEvents() {
  if (!dbReady || pendingEvents.length === 0) {
    return;
  }

  const batch = pendingEvents.splice(0, flushBatchSize);
  if (batch.length === 0) {
    return;
  }

  try {
    await collections.auditEvents().insertMany(batch, { ordered: false });
  } catch (err) {
    fastify.log.error({ err, batchSize: batch.length }, 'Audit event batch insert failed');
  }
}

function enqueueEvents(events) {
  for (const event of events) {
    pendingEvents.push(normalizeEvent(event));
  }
  if (pendingEvents.length >= flushBatchSize) {
    setImmediate(() => {
      void flushEvents();
    });
  }
}

const connectToMongo = async () => {
  if (!mongoUri) {
    fastify.log.warn('MONGODB_URI not set; audit-log-service running without persistence');
    return;
  }

  mongoClient = new MongoClient(mongoUri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  try {
    await mongoClient.connect();
    db = mongoClient.db(dbName);
    await db.command({ ping: 1 });
    dbReady = true;

    await Promise.all([
      collections.auditEvents().createIndex({ eventId: 1 }, { unique: true }),
      collections.auditEvents().createIndex({ createdAt: -1 }),
      collections.auditEvents().createIndex({ eventType: 1, createdAt: -1 }),
      collections.auditEvents().createIndex({ userId: 1, createdAt: -1 }),
      collections.auditEvents().createIndex({ organizationId: 1, createdAt: -1 }),
    ]);

    fastify.log.info({ dbName }, 'MongoDB connection established');
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed; continuing without database connection');
  }
};

fastify.get('/health', async () => {
  return {
    status: 'ok',
    service: serviceName,
    dbReady,
    dbName,
    queuedEvents: pendingEvents.length,
  };
});

fastify.post('/internal/audit/events', async (req, reply) => {
  const events = Array.isArray(req.body?.events)
    ? req.body.events
    : req.body
      ? [req.body]
      : [];

  if (events.length === 0) {
    return reply.code(400).send({ message: 'events payload is required' });
  }

  enqueueEvents(events);
  return reply.code(202).send({ accepted: events.length, queued: pendingEvents.length });
});

fastify.get('/audit/events', { preHandler: requireAdmin }, async (req, reply) => {
  if (!dbReady) {
    return reply.code(503).send({ message: 'Audit storage unavailable' });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.userId) filter.userId = String(req.query.userId);
  if (req.query.organizationId) filter.organizationId = String(req.query.organizationId);
  if (req.query.eventType) filter.eventType = String(req.query.eventType);
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  const [items, total] = await Promise.all([
    collections.auditEvents().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    collections.auditEvents().countDocuments(filter),
  ]);

  return reply.send({
    page,
    limit,
    total,
    items,
  });
});

fastify.get('/audit/events/:eventId', { preHandler: requireAdmin }, async (req, reply) => {
  if (!dbReady) {
    return reply.code(503).send({ message: 'Audit storage unavailable' });
  }

  const { eventId } = req.params;
  const filter = ObjectId.isValid(eventId)
    ? { $or: [{ eventId }, { _id: new ObjectId(eventId) }] }
    : { eventId };

  const event = await collections.auditEvents().findOne(filter);
  if (!event) {
    return reply.code(404).send({ message: 'Audit event not found' });
  }

  return reply.send(event);
});

const start = async () => {
  try {
    await connectToMongo();
    flushTimer = setInterval(() => {
      void flushEvents();
    }, flushIntervalMs);
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  try {
    if (flushTimer) {
      clearInterval(flushTimer);
    }
    await flushEvents();
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

