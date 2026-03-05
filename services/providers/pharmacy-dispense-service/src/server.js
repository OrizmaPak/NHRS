const fastifyFactory = require('fastify');
const jwt = require('jsonwebtoken');
const { connectMongo } = require('./db');
const { checkPermission } = require('./integrations/rbacClient');
const { registerIndexEntry } = require('./integrations/indexClient');
const { createRepository } = require('./db/repository');
const { registerRoutes } = require('./routes/pharmacy');

const serviceName = 'pharmacy-dispense-service';
const port = Number(process.env.PORT) || 8107;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_pharmacy_dispense_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const healthRecordsIndexApiBaseUrl = process.env.HEALTH_RECORDS_INDEX_API_BASE_URL || 'http://health-records-index-service:8104';

function createApp(options = {}) {
  const fastify = fastifyFactory({ logger: true });
  const state = {
    dbReady: false,
    db: options.db || null,
    mongoClient: null,
    repository: options.db ? createRepository(options.db) : null,
    fetchClient: options.fetchImpl || ((...args) => fetch(...args)),
    injectedDb: Boolean(options.db),
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
    if (text) { try { body = JSON.parse(text); } catch (_err) { body = { message: text }; } }
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

  function emitAuditEvent(event) {
    setImmediate(async () => {
      try {
        await state.fetchClient(`${auditApiBaseUrl}/internal/audit/events`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
        });
      } catch (_err) {}
    });
  }

  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (!state.dbReady) return reply.code(503).send({ message: 'Pharmacy dispense storage unavailable' });
  });

  fastify.get('/health', async () => ({ status: 'ok', service: serviceName, dbReady: state.dbReady, dbName }));

  registerRoutes(fastify, {
    get repository() { return state.repository; },
    requireAuth,
    enforcePermission,
    callJson,
    registerIndexEntry,
    emitAuditEvent,
    healthRecordsIndexApiBaseUrl,
  });

  async function connect() {
    if (state.injectedDb) return;
    if (!mongoUri) {
      fastify.log.warn('Missing MONGODB_URI; pharmacy-dispense-service running in degraded mode');
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

if (require.main === module) start();
