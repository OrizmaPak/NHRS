const fastifyFactory = require('fastify');
const jwt = require('jsonwebtoken');
const { connectMongo, createRepository } = require('./db');
const { emitNotificationEvent } = require('./integrations/notificationClient');
const { emitAuditEvent } = require('./integrations/auditClient');
const { registerRequestRoutes } = require('./routes/requests');
const { registerResponseRoutes } = require('./routes/responses');
const { registerRoomRoutes } = require('./routes/rooms');
const { registerInventoryRoutes } = require('./routes/inventory');

const serviceName = 'emergency-inventory-service';
const port = Number(process.env.PORT) || 8108;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_emergency_inventory_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const notificationApiBaseUrl = process.env.NOTIFICATION_API_BASE_URL || 'http://notification-service:8101';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';

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
      headers: {
        authorization: req.headers.authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ permissionKey, organizationId, branchId }),
    });
    if (!checked.ok || !checked.body?.allowed) {
      if (reply) {
        reply.code(checked.status === 401 ? 401 : 403).send({ message: 'Forbidden' });
      }
      return true;
    }
    return false;
  }

  function emitNotification(event) {
    emitNotificationEvent({
      fetchClient: state.fetchClient,
      baseUrl: notificationApiBaseUrl,
      event,
    });
  }

  function emitAudit(event) {
    emitAuditEvent({
      fetchClient: state.fetchClient,
      baseUrl: auditApiBaseUrl,
      event,
    });
  }

  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (!state.dbReady) return reply.code(503).send({ message: 'Emergency inventory storage unavailable' });
  });

  fastify.get('/health', async () => ({ status: 'ok', service: serviceName, dbReady: state.dbReady, dbName }));

  const commonDeps = {
    get repository() {
      return state.repository;
    },
    requireAuth,
    enforcePermission,
    emitNotification,
    emitAudit,
    getClientIp,
  };

  registerRequestRoutes(fastify, commonDeps);
  registerResponseRoutes(fastify, commonDeps);
  registerRoomRoutes(fastify, commonDeps);
  registerInventoryRoutes(fastify, commonDeps);

  async function connect() {
    if (state.injectedDb) return;
    if (!mongoUri) {
      fastify.log.warn('Missing MONGODB_URI; emergency-inventory-service running in degraded mode');
      return;
    }
    const connected = await connectMongo({ mongoUri, dbName, log: fastify.log });
    state.mongoClient = connected.mongoClient;
    state.db = connected.db;
    state.dbReady = connected.dbReady;
    if (!state.dbReady || !state.db) return;
    state.repository = createRepository(state.db);
    await state.repository.createIndexes();
  }

  async function closeService() {
    if (state.mongoClient) await state.mongoClient.close();
    await fastify.close();
  }

  fastify.decorate('connect', connect);
  fastify.decorate('closeService', closeService);
  return fastify;
}

const app = createApp();

async function start() {
  try {
    await app.connect();
    await app.listen({ host: '0.0.0.0', port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => { await app.closeService(); process.exit(0); });
process.on('SIGTERM', async () => { await app.closeService(); process.exit(0); });

module.exports = {
  buildApp: createApp,
  start,
};

if (require.main === module) {
  start();
}
