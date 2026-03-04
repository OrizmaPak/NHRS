const fastifyFactory = require('fastify');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const { createRepository } = require('./db/repository');
const { registerRecordsRoutes } = require('./routes/records');

const serviceName = 'health-records-index-service';
const port = Number(process.env.PORT) || 8104;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_health_records_index_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const notificationApiBaseUrl = process.env.NOTIFICATION_API_BASE_URL || 'http://notification-service:8101';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';

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
      body: JSON.stringify({ permissionKey, organizationId, branchId }),
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

  function emitNotificationEvent(event) {
    setImmediate(async () => {
      try {
        await state.fetchClient(`${notificationApiBaseUrl}/internal/notifications/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
        });
      } catch (_err) {
        // Notification emission is non-blocking.
      }
    });
  }

  function emitAuditEvent(event) {
    setImmediate(async () => {
      try {
        await state.fetchClient(`${auditApiBaseUrl}/internal/audit/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...event,
            ipAddress: event.ipAddress || null,
            userAgent: event.userAgent || null,
            createdAt: new Date().toISOString(),
          }),
        });
      } catch (_err) {
        // Audit emission is non-blocking.
      }
    });
  }

  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (!state.dbReady) {
      return reply.code(503).send({ message: 'Health records index storage unavailable' });
    }
  });

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
    emitNotificationEvent,
    emitAuditEvent: (event) => emitAuditEvent({
      ...event,
      ipAddress: event.ipAddress || null,
      userAgent: event.userAgent || null,
    }),
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
    if (state.mongoClient) {
      await state.mongoClient.close();
    }
    await fastify.close();
  }

  fastify.decorate('connect', connect);
  fastify.decorate('closeService', close);
  return fastify;
}

const app = createApp();

async function start() {
  try {
    await app.connect();
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

module.exports = {
  buildApp: createApp,
  start,
};

if (require.main === module) {
  start();
}
