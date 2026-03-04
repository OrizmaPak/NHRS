const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const serviceName = 'health-records-index-service';
const port = Number(process.env.PORT) || 8104;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_health_records_index_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const notificationApiBaseUrl = process.env.NOTIFICATION_API_BASE_URL || 'http://notification-service:8101';

let dbReady = false;
let mongoClient;
let db;
let fetchClient = (...args) => fetch(...args);

const collections = {
  entries: () => db.collection('record_entries'),
};

function now() {
  return new Date();
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

function emitProviderAccessNotification(payload) {
  setImmediate(async () => {
    try {
      await fetchClient(`${notificationApiBaseUrl}/internal/notifications/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (_err) {
      // Non-blocking
    }
  });
}

async function requireAuth(req, reply) {
  const token = parseBearerToken(req);
  if (!token) return reply.code(401).send({ message: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.auth = { userId: String(payload.sub), token };
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

function mapEntry(entry) {
  return {
    entryId: entry.entryId,
    nin: entry.nin,
    ownerUserId: entry.ownerUserId || null,
    entryType: entry.entryType,
    payload: entry.payload || {},
    source: entry.source || null,
    metadata: {
      editableUntil: entry.editableUntil || null,
      visibility: entry.visibility || { hidden: false },
    },
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
  };
}

async function connect() {
  if (!mongoUri) {
    fastify.log.warn('Missing MONGODB_URI; health-records-index-service running in degraded mode');
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

    await Promise.all([
      collections.entries().createIndex({ entryId: 1 }, { unique: true }),
      collections.entries().createIndex({ ownerUserId: 1, createdAt: -1 }),
      collections.entries().createIndex({ nin: 1, createdAt: -1 }),
      collections.entries().createIndex({ organizationId: 1, branchId: 1 }),
    ]);
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed');
  }
}

fastify.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  if (!dbReady) {
    return reply.code(503).send({ message: 'Health records index storage unavailable' });
  }
});

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  dbName,
}));

fastify.get('/records/me', {
  preHandler: requireAuth,
  schema: {
    tags: ['Health Records'],
    summary: 'Get citizen timeline entries',
    security: [{ bearerAuth: [] }],
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'records.me.read');
  if (denied) return;

  const authUser = await fetchAuthMe(req.headers.authorization);
  if (!authUser?.nin) {
    return reply.code(400).send({ message: 'No NIN linked to user' });
  }

  const items = await collections.entries().find({
    nin: authUser.nin,
    'visibility.hidden': { $ne: true },
  }).sort({ createdAt: -1 }).toArray();

  const institutionsMap = new Map();
  for (const item of items) {
    const organizationId = item.organizationId || item.source?.organizationId || null;
    if (!organizationId) continue;
    if (!institutionsMap.has(organizationId)) {
      institutionsMap.set(organizationId, {
        organizationId,
        branchIds: [],
      });
    }
    const branchId = item.branchId || item.source?.branchId || null;
    if (branchId && !institutionsMap.get(organizationId).branchIds.includes(branchId)) {
      institutionsMap.get(organizationId).branchIds.push(branchId);
    }
  }

  return reply.send({
    nin: authUser.nin,
    items: items.map(mapEntry),
    contributingInstitutions: Array.from(institutionsMap.values()),
  });
});

fastify.get('/records/:nin', {
  preHandler: requireAuth,
  schema: {
    tags: ['Health Records'],
    summary: 'Get timeline entries by NIN (provider access)',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['nin'],
      properties: { nin: { type: 'string', pattern: '^\\d{11}$' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const organizationId = req.headers['x-org-id'] || null;
  const branchId = req.headers['x-branch-id'] || null;
  const denied = await enforcePermission(req, reply, 'records.nin.read', organizationId, branchId);
  if (denied) return;

  const nin = String(req.params.nin);
  const items = await collections.entries().find({
    nin,
    'visibility.hidden': { $ne: true },
  }).sort({ createdAt: -1 }).toArray();

  emitProviderAccessNotification({
    eventType: 'PROVIDER_RECORD_ACCESSED',
    userId: req.auth.userId,
    metadata: {
      nin,
      organizationId,
      branchId,
      itemCount: items.length,
    },
  });

  return reply.send({ nin, items: items.map(mapEntry) });
});

fastify.post('/records/me/symptoms', {
  preHandler: requireAuth,
  schema: {
    tags: ['Health Records'],
    summary: 'Create citizen symptom timeline entry',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['symptoms'],
      properties: {
        symptoms: { type: 'array', items: { type: 'string' }, minItems: 1 },
        note: { type: 'string' },
      },
    },
    response: { 201: { type: 'object', additionalProperties: true }, 400: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'records.symptoms.create');
  if (denied) return;
  const authUser = await fetchAuthMe(req.headers.authorization);
  if (!authUser?.nin) {
    return reply.code(400).send({ message: 'No NIN linked to user' });
  }

  const entry = {
    entryId: crypto.randomUUID(),
    ownerUserId: req.auth.userId,
    createdByUserId: req.auth.userId,
    nin: authUser.nin,
    entryType: 'symptom',
    payload: {
      symptoms: req.body.symptoms,
      note: req.body.note || null,
    },
    source: {
      type: 'citizen',
      userId: req.auth.userId,
      organizationId: null,
      branchId: null,
    },
    organizationId: null,
    branchId: null,
    editableUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    visibility: { hidden: false, hiddenAt: null, hiddenByUserId: null },
    createdAt: now(),
    updatedAt: now(),
  };
  await collections.entries().insertOne(entry);
  return reply.code(201).send({ entry: mapEntry(entry) });
});

fastify.post('/records/:nin/entries', {
  preHandler: requireAuth,
  schema: {
    tags: ['Health Records'],
    summary: 'Create provider timeline metadata entry for a NIN',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['nin'],
      properties: { nin: { type: 'string', pattern: '^\\d{11}$' } },
    },
    body: {
      type: 'object',
      required: ['entryType', 'payload'],
      properties: {
        entryType: { type: 'string' },
        payload: { type: 'object', additionalProperties: true },
      },
    },
    response: { 201: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const organizationId = req.headers['x-org-id'] || null;
  const branchId = req.headers['x-branch-id'] || null;
  const denied = await enforcePermission(req, reply, 'records.entry.create', organizationId, branchId);
  if (denied) return;

  const entry = {
    entryId: crypto.randomUUID(),
    ownerUserId: null,
    createdByUserId: req.auth.userId,
    nin: String(req.params.nin),
    entryType: String(req.body.entryType),
    payload: req.body.payload || {},
    source: {
      type: 'provider',
      userId: req.auth.userId,
      organizationId,
      branchId,
    },
    organizationId,
    branchId,
    editableUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    visibility: { hidden: false, hiddenAt: null, hiddenByUserId: null },
    createdAt: now(),
    updatedAt: now(),
  };
  await collections.entries().insertOne(entry);
  return reply.code(201).send({ entry: mapEntry(entry) });
});

fastify.patch('/records/entries/:entryId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Health Records'],
    summary: 'Update timeline entry within editable window',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['entryId'],
      properties: { entryId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['payload'],
      properties: {
        payload: { type: 'object', additionalProperties: true },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'records.entry.update');
  if (denied) return;

  const entry = await collections.entries().findOne({ entryId: String(req.params.entryId) });
  if (!entry) return reply.code(404).send({ message: 'Entry not found' });
  if (String(entry.createdByUserId || '') !== req.auth.userId) {
    return reply.code(403).send({ message: 'Only the creator can edit this entry' });
  }
  if (entry.editableUntil && new Date(entry.editableUntil).getTime() < Date.now()) {
    return reply.code(403).send({ message: 'Entry edit window has expired' });
  }

  await collections.entries().updateOne(
    { entryId: entry.entryId },
    { $set: { payload: req.body.payload || {}, updatedAt: now() } }
  );
  const updated = await collections.entries().findOne({ entryId: entry.entryId });
  return reply.send({ entry: mapEntry(updated) });
});

fastify.post('/records/entries/:entryId/hide', {
  preHandler: requireAuth,
  schema: {
    tags: ['Health Records'],
    summary: 'Hide a timeline entry from standard reads',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['entryId'],
      properties: { entryId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'records.entry.hide');
  if (denied) return;

  const entry = await collections.entries().findOne({ entryId: String(req.params.entryId) });
  if (!entry) return reply.code(404).send({ message: 'Entry not found' });
  if (String(entry.ownerUserId || '') !== req.auth.userId && String(entry.createdByUserId || '') !== req.auth.userId) {
    return reply.code(403).send({ message: 'Not permitted to hide this entry' });
  }

  await collections.entries().updateOne(
    { entryId: entry.entryId },
    { $set: { visibility: { hidden: true, hiddenAt: now(), hiddenByUserId: req.auth.userId }, updatedAt: now() } }
  );
  return reply.send({ message: 'Entry hidden' });
});

const start = async () => {
  try {
    await connect();
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  try {
    if (mongoClient) await mongoClient.close();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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
