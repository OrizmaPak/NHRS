const fastifyFactory = require('fastify');
const jwt = require('jsonwebtoken');
const { connectMongo } = require('./db');
const { createRepository } = require('./db/repository');
const { registerDoctorRoutes } = require('./routes/doctors');
const { registerLicenseRoutes } = require('./routes/licenses');
const { emitNotificationEvent } = require('./integrations/notificationClient');
const { emitAuditEvent } = require('./integrations/auditClient');

const serviceName = 'doctor-registry-service';
const port = Number(process.env.PORT) || 8094;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_doctor_registry_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const notificationApiBaseUrl = process.env.NOTIFICATION_API_BASE_URL || 'http://notification-service:8101';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';

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
      req.auth = {
        userId: String(payload.sub),
        roles: Array.isArray(payload.roles) ? payload.roles.map((role) => String(role)) : [],
      };
    } catch (_err) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
  }

  async function requireInternal(req, reply) {
    const token = req.headers['x-internal-token'];
    if (!token || token !== internalServiceToken) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
  }

  async function enforcePermission(req, reply, permissionKey) {
    const checked = await callJson(`${rbacApiBaseUrl}/rbac/check`, {
      method: 'POST',
      headers: {
        authorization: req.headers.authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ permissionKey }),
    });
    if (!checked.ok || !checked.body?.allowed) {
      reply.code(checked.status === 401 ? 401 : 403).send({ message: 'Forbidden' });
      return true;
    }
    return false;
  }

  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (!state.dbReady) {
      return reply.code(503).send({ message: 'Doctor registry storage unavailable' });
    }
  });

  fastify.get('/health', async () => ({
    status: 'ok',
    service: serviceName,
    dbReady: state.dbReady,
    dbName,
  }));

  const deps = {
    get repository() {
      return state.repository;
    },
    requireAuth,
    requireInternal,
    enforcePermission,
    emitAuditEvent: (event) => emitAuditEvent({
      fetchClient: state.fetchClient,
      auditApiBaseUrl,
      event,
    }),
    emitNotificationEvent: (event) => emitNotificationEvent({
      fetchClient: state.fetchClient,
      notificationApiBaseUrl,
      event,
    }),
  };

  registerDoctorRoutes(fastify, deps);
  registerLicenseRoutes(fastify, deps);

  async function connect() {
    if (state.injectedDb) return;
    if (!mongoUri) {
      fastify.log.warn('Missing MONGODB_URI; doctor-registry-service running in degraded mode');
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

module.exports = { buildApp: createApp, start };

if (require.main === module) {
  start();
}

