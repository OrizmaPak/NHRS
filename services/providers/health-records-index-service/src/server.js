const fastifyFactory = require('fastify');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const { createRepository } = require('./db/repository');
const { registerRecordsRoutes } = require('./routes/records');
const { createContextVerificationHook } = require('../../../../libs/shared/src/nhrs-context');
const { buildEventEnvelope, deliverOutboxBatch } = require('../../../../libs/shared/src/outbox');
const { enforceProductionSecrets } = require('../../../../libs/shared/src/env');

const serviceName = 'health-records-index-service';
const port = Number(process.env.PORT) || 8104;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_health_records_index_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const notificationApiBaseUrl = process.env.NOTIFICATION_API_BASE_URL || 'http://notification-service:8101';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 20;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;

function parseBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}

function createApp(options = {}) {
  const fastify = fastifyFactory({ logger: true });
  const state = {
    dbReady: false,
    mongoClient: null,
    db: null,
    repository: null,
    fetchClient: options.fetchImpl || ((...args) => fetch(...args)),
    startedWithInjectedDb: Boolean(options.db),
    outboxTimer: null,
  };

  if (options.db) {
    state.db = options.db;
    state.repository = createRepository(options.db);
    state.dbReady = Object.prototype.hasOwnProperty.call(options, 'dbReady') ? !!options.dbReady : true;
  }

  async function callJson(url, reqOptions = {}) {
    const res = await state.fetchClient(url, reqOptions);
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

  async function requireAuth(req, reply) {
    if (req.auth?.userId) return;
    const token = parseBearerToken(req);
    if (!token) return reply.code(401).send({ message: 'Unauthorized' });
    try {
      const payload = jwt.verify(token, jwtSecret);
      req.auth = {
        userId: String(payload.sub),
        roles: Array.isArray(payload.roles) ? payload.roles.map((role) => String(role)) : [],
      };
    } catch (_err) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
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

  async function fetchAuthMe(authorization) {
    const res = await callJson(`${authApiBaseUrl}/me`, {
      method: 'GET',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
    });
    return res.ok ? (res.body?.user || null) : null;
  }

  async function emitNotificationEvent(event, req) {
    if (!state.repository?.enqueueOutboxEvent) return;
    await state.repository.enqueueOutboxEvent(buildEventEnvelope({
      eventType: event.eventType || 'NOTIFICATION_EVENT',
      sourceService: serviceName,
      aggregateType: 'record_entry',
      aggregateId: event.payload?.entryId || event.payload?.recordId || null,
      payload: event,
      trace: {
        requestId: req?.nhrs?.requestId || req?.headers?.['x-request-id'] || null,
        userId: req?.nhrs?.userId || req?.auth?.userId || null,
        orgId: req?.nhrs?.orgId || req?.headers?.['x-org-id'] || null,
        branchId: req?.nhrs?.branchId || req?.headers?.['x-branch-id'] || null,
      },
      destination: 'notification',
    }));
  }

  async function emitAuditEvent(event, req) {
    if (!state.repository?.enqueueOutboxEvent) return;
    await state.repository.enqueueOutboxEvent(buildEventEnvelope({
      eventType: event.eventType || 'AUDIT_EVENT',
      sourceService: serviceName,
      aggregateType: event.resource?.type || 'record_entry',
      aggregateId: event.resource?.id || null,
      payload: {
        ...event,
        ipAddress: event.ipAddress || req?.ip || null,
        userAgent: event.userAgent || req?.headers?.['user-agent'] || null,
      },
      trace: {
        requestId: req?.nhrs?.requestId || req?.headers?.['x-request-id'] || null,
        userId: req?.nhrs?.userId || req?.auth?.userId || null,
        orgId: req?.nhrs?.orgId || req?.headers?.['x-org-id'] || null,
        branchId: req?.nhrs?.branchId || req?.headers?.['x-branch-id'] || null,
      },
      destination: 'audit',
    }));
  }

  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (!state.dbReady) {
      return reply.code(503).send({ message: 'Health records index storage unavailable' });
    }
  });

  fastify.addHook('onRequest', createContextVerificationHook({
    secret: nhrsContextSecret,
    requiredMatcher: (req) => /^\/records\/\d{11}(\/entries)?/.test(req.url.split('?')[0]),
  }));

  fastify.get('/health', async () => ({
    status: 'ok',
    service: serviceName,
    dbReady: state.dbReady,
    dbName,
  }));

  registerRecordsRoutes(fastify, {
    getRepository: () => state.repository,
    requireAuth,
    enforcePermission,
    fetchAuthMe,
    emitNotificationEvent: (event, req) => emitNotificationEvent(event, req),
    emitAuditEvent: (event, req) => emitAuditEvent({
      ...event,
      ipAddress: event.ipAddress || null,
      userAgent: event.userAgent || null,
    }, req),
    getClientIp,
  });

  async function connect() {
    if (state.startedWithInjectedDb) {
      return;
    }
    if (!mongoUri) {
      fastify.log.warn('Missing MONGODB_URI; health-records-index-service running in degraded mode');
      return;
    }
    try {
      state.mongoClient = new MongoClient(mongoUri, {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        },
      });
      await state.mongoClient.connect();
      state.db = state.mongoClient.db(dbName);
      await state.db.command({ ping: 1 });
      state.repository = createRepository(state.db);
      await state.repository.createIndexes();
      state.dbReady = true;
    } catch (err) {
      fastify.log.warn({ err }, 'MongoDB connection failed');
    }
  }

  async function close() {
    if (state.outboxTimer) clearInterval(state.outboxTimer);
    if (state.mongoClient) {
      await state.mongoClient.close();
    }
    await fastify.close();
  }

  async function flushOutboxOnce() {
    if (!state.repository?.fetchPendingOutboxEvents) return;
    await deliverOutboxBatch({
      outboxRepo: {
        fetchPendingOutboxEvents: state.repository.fetchPendingOutboxEvents,
        markDelivered: state.repository.markOutboxDelivered,
        markFailed: state.repository.markOutboxFailed,
      },
      logger: fastify.log,
      batchSize: outboxBatchSize,
      maxAttempts: outboxMaxAttempts,
      handlers: {
        notification: async (event) => {
          const res = await state.fetchClient(`${notificationApiBaseUrl}/internal/notifications/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ eventId: event.eventId, ...event.payload }),
          });
          if (!res.ok) throw new Error(`notification delivery failed: ${res.status}`);
        },
        audit: async (event) => {
          const res = await state.fetchClient(`${auditApiBaseUrl}/internal/audit/events`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ eventId: event.eventId, ...event.payload, createdAt: event.createdAt }),
          });
          if (!res.ok) throw new Error(`audit delivery failed: ${res.status}`);
        },
      },
    });
  }

  async function startOutboxWorker() {
    if (state.outboxTimer) return;
    state.outboxTimer = setInterval(() => { void flushOutboxOnce(); }, outboxIntervalMs);
  }

  fastify.decorate('connect', connect);
  fastify.decorate('closeService', close);
  fastify.decorate('flushOutboxOnce', flushOutboxOnce);
  fastify.decorate('startOutboxWorker', startOutboxWorker);
  return fastify;
}

const app = createApp();

async function start() {
  try {
    enforceProductionSecrets({
      env: process.env,
      required: ['JWT_SECRET', 'NHRS_CONTEXT_HMAC_SECRET', 'MONGODB_URI'],
      secrets: ['JWT_SECRET', 'NHRS_CONTEXT_HMAC_SECRET'],
    });
    await app.connect();
    await app.startOutboxWorker();
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await app.closeService();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await app.closeService();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  const logger = app?.log || console;
  logger.error({ err: reason }, 'Unhandled promise rejection; service will keep running in degraded mode');
});

process.on('uncaughtException', (err) => {
  const logger = app?.log || console;
  logger.error({ err }, 'Uncaught exception; service will keep running in degraded mode');
});

module.exports = {
  buildApp: createApp,
  start,
};

if (require.main === module) {
  start();
}


