const fastifyFactory = require('fastify');
const jwt = require('jsonwebtoken');
const { connectMongo } = require('./db');
const { checkPermission } = require('./integrations/rbacClient');
const { registerIndexEntry } = require('./integrations/indexClient');
const { fetchDoctorStatus } = require('./integrations/doctorRegistryClient');
const { createRepository } = require('./db/repository');
const { registerRoutes } = require('./routes/encounters');
const { createContextVerificationHook } = require('../../../../libs/shared/src/nhrs-context');
const { buildEventEnvelope, deliverOutboxBatch } = require('../../../../libs/shared/src/outbox');
const { enforceProductionSecrets } = require('../../../../libs/shared/src/env');

const serviceName = 'clinical-encounter-service';
const port = Number(process.env.PORT) || 8105;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_clinical_encounter_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const healthRecordsIndexApiBaseUrl = process.env.HEALTH_RECORDS_INDEX_API_BASE_URL || 'http://health-records-index-service:8104';
const doctorRegistryApiBaseUrl = process.env.DOCTOR_REGISTRY_API_BASE_URL || 'http://doctor-registry-service:8094';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 20;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;

function createApp(options = {}) {
  const fastify = fastifyFactory({ logger: true });
  const state = {
    dbReady: false,
    db: options.db || null,
    mongoClient: null,
    repository: options.db ? createRepository(options.db) : null,
    fetchClient: options.fetchImpl || ((...args) => fetch(...args)),
    injectedDb: Boolean(options.db),
    outboxTimer: null,
  };
  if (Object.prototype.hasOwnProperty.call(options, 'dbReady')) {
    state.dbReady = !!options.dbReady;
  }

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
      try {
        body = JSON.parse(text);
      } catch (_err) {
        body = { message: text };
      }
    }
    return { ok: res.ok, status: res.status, body };
  }

  async function requireAuth(req, reply) {
    if (req.auth?.userId) {
      return;
    }
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
    const checked = await checkPermission({
      callJson,
      baseUrl: rbacApiBaseUrl,
      authorization: req.headers.authorization,
      permissionKey,
      organizationId,
      branchId,
    });
    if (!checked.allowed) {
      reply.code(checked.status === 401 ? 401 : 403).send({ message: 'Forbidden' });
      return true;
    }
    return false;
  }

  function emitAuditEvent(event, req) {
    if (!state.repository?.enqueueOutboxEvent) return Promise.resolve();
    return state.repository.enqueueOutboxEvent(buildEventEnvelope({
      eventType: event.eventType || 'AUDIT_EVENT',
      sourceService: serviceName,
      aggregateType: event.resource?.type || 'encounter',
      aggregateId: event.resource?.id || event.metadata?.encounterId || null,
      payload: event,
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
    if (!state.dbReady) return reply.code(503).send({ message: 'Encounter storage unavailable' });
  });

  fastify.addHook('onRequest', createContextVerificationHook({
    secret: nhrsContextSecret,
    requiredMatcher: (req) => req.url.startsWith('/encounters'),
  }));

  fastify.get('/health', async () => ({ status: 'ok', service: serviceName, dbReady: state.dbReady, dbName }));

  registerRoutes(fastify, {
    get repository() {
      return state.repository;
    },
    requireAuth,
    enforcePermission,
    callJson,
    fetchDoctorStatus,
    registerIndexEntry,
    emitAuditEvent,
    healthRecordsIndexApiBaseUrl,
    doctorRegistryApiBaseUrl,
    internalServiceToken,
  });

  async function connect() {
    if (state.injectedDb) return;
    if (!mongoUri) {
      fastify.log.warn('Missing MONGODB_URI; clinical-encounter-service running in degraded mode');
      return;
    }
    try {
      const connected = await connectMongo({ mongoUri, dbName, log: fastify.log });
      state.mongoClient = connected.mongoClient;
      state.db = connected.db;
      state.dbReady = connected.dbReady;
      if (!state.dbReady || !state.db) {
        return;
      }
      state.repository = createRepository(state.db);
      await state.repository.createIndexes();
    } catch (err) {
      fastify.log.warn({ err }, 'MongoDB connection failed');
    }
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

module.exports = { buildApp: createApp, start };

if (require.main === module) {
  start();
}

