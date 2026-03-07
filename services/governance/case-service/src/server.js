const fastifyFactory = require('fastify');
const jwt = require('jsonwebtoken');
const { connectMongo, createRepository } = require('./db');
const { buildEventEnvelope, deliverOutboxBatch } = require('../../../../libs/shared/src/outbox');
const { enforceProductionSecrets } = require('../../../../libs/shared/src/env');
const { registerCaseRoutes } = require('./routes/cases');
const { registerRoomRoutes } = require('./routes/rooms');
const { createContextVerificationHook } = require('../../../../libs/shared/src/nhrs-context');

const serviceName = 'case-service';
const port = Number(process.env.PORT) || 8110;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_case_service_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const notificationApiBaseUrl = process.env.NOTIFICATION_API_BASE_URL || 'http://notification-service:8101';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const taskforceDirectoryApiBaseUrl = process.env.TASKFORCE_DIRECTORY_API_BASE_URL || 'http://taskforce-directory-service:8109';
const healthRecordsIndexApiBaseUrl = process.env.HEALTH_RECORDS_INDEX_API_BASE_URL || 'http://health-records-index-service:8104';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 20;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;

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
    db: options.db || null,
    repository: options.db ? createRepository(options.db) : null,
    mongoClient: null,
    fetchClient: options.fetchImpl || ((...args) => fetch(...args)),
    injectedDb: Boolean(options.db),
    outboxTimer: null,
  };
  if (Object.prototype.hasOwnProperty.call(options, 'dbReady')) state.dbReady = !!options.dbReady;

  function parseBearerToken(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    return authHeader.slice(7);
  }

  async function callJson(url, reqOptions = {}) {
    const res = await state.fetchClient(url, reqOptions);
    const text = await res.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch (_err) { body = { message: text }; }
    }
    return { ok: res.ok, status: res.status, body };
  }

  async function requireAuth(req, reply) {
    if (req.auth?.userId) return;
    const token = parseBearerToken(req);
    if (!token) return reply.code(401).send({ message: 'Unauthorized' });
    try {
      const payload = jwt.verify(token, jwtSecret);
      req.auth = { userId: String(payload.sub), roles: Array.isArray(payload.roles) ? payload.roles : [] };
    } catch (_err) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
  }

  async function enforcePermission(req, reply, permissionKey, organizationId = null, branchId = null) {
    const checked = await callJson(`${rbacApiBaseUrl}/rbac/check`, {
      method: 'POST',
      headers: { authorization: req.headers.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ permissionKey, organizationId, branchId }),
    });
    if (!checked.ok || !checked.body?.allowed) {
      if (reply) reply.code(checked.status === 401 ? 401 : 403).send({ message: 'Forbidden' });
      return true;
    }
    return false;
  }

  function emitNotification(event) {
    return state.repository.enqueueOutboxEvent(buildEventEnvelope({
      eventType: event.eventType,
      sourceService: serviceName,
      aggregateType: 'governance_case',
      aggregateId: event.payload?.caseId || null,
      payload: event,
      trace: {
        requestId: event?.trace?.requestId || null,
        userId: event?.trace?.userId || null,
        orgId: event?.trace?.orgId || null,
        branchId: event?.trace?.branchId || null,
      },
      destination: 'notification',
    }));
  }

  function emitAudit(event) {
    return state.repository.enqueueOutboxEvent(buildEventEnvelope({
      eventType: event.eventType || 'AUDIT_EVENT',
      sourceService: serviceName,
      aggregateType: event.resource?.type || 'governance_case',
      aggregateId: event.resource?.id || null,
      payload: event,
      trace: {
        requestId: event?.metadata?.requestId || null,
        userId: event?.userId || null,
        orgId: event?.organizationId || null,
        branchId: event?.metadata?.branchId || null,
      },
      destination: 'audit',
    }));
  }

  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (!state.dbReady) return reply.code(503).send({ message: 'Case storage unavailable' });
  });

  fastify.addHook('onRequest', createContextVerificationHook({
    secret: nhrsContextSecret,
    requiredMatcher: (req) => {
      const p = req.url.split('?')[0];
      return p.startsWith('/cases/') || p === '/cases' || p.startsWith('/case-rooms/');
    },
  }));

  fastify.get('/health', async () => ({ status: 'ok', service: serviceName, dbReady: state.dbReady, dbName }));

  const deps = {
    get repository() { return state.repository; },
    requireAuth,
    enforcePermission,
    emitNotification,
    emitAudit,
    getClientIp,
    callJson,
    taskforceDirectoryApiBaseUrl,
    healthRecordsIndexApiBaseUrl,
    internalServiceToken,
  };

  registerCaseRoutes(fastify, deps);
  registerRoomRoutes(fastify, deps);

  async function connect() {
    if (state.injectedDb) return;
    const connected = await connectMongo({ mongoUri, dbName, log: fastify.log });
    state.mongoClient = connected.mongoClient;
    state.db = connected.db;
    state.dbReady = connected.dbReady;
    if (!state.dbReady || !state.db) return;
    state.repository = createRepository(state.db);
    await state.repository.createIndexes();
  }

  async function closeService() {
    if (state.outboxTimer) clearInterval(state.outboxTimer);
    if (state.mongoClient) await state.mongoClient.close();
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
  fastify.decorate('closeService', closeService);
  fastify.decorate('flushOutboxOnce', flushOutboxOnce);
  fastify.decorate('startOutboxWorker', startOutboxWorker);
  return fastify;
}

const app = createApp();

async function start() {
  try {
    enforceProductionSecrets({
      env: process.env,
      required: ['INTERNAL_SERVICE_TOKEN', 'JWT_SECRET', 'NHRS_CONTEXT_HMAC_SECRET', 'MONGODB_URI'],
      secrets: ['INTERNAL_SERVICE_TOKEN', 'JWT_SECRET', 'NHRS_CONTEXT_HMAC_SECRET'],
    });
    await app.connect();
    await app.startOutboxWorker();
    await app.listen({ host: '0.0.0.0', port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => { await app.closeService(); process.exit(0); });
process.on('SIGTERM', async () => { await app.closeService(); process.exit(0); });
process.on('unhandledRejection', (reason) => {
  const logger = app?.log || console;
  logger.error({ err: reason }, 'Unhandled promise rejection; service will keep running in degraded mode');
});
process.on('uncaughtException', (err) => {
  const logger = app?.log || console;
  logger.error({ err }, 'Uncaught exception; service will keep running in degraded mode');
});

module.exports = { buildApp: createApp, start };

if (require.main === module) start();


