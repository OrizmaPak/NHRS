const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { buildEventEnvelope, createOutboxRepository, deliverOutboxBatch } = require('../../../../../libs/shared/src/outbox');
const { enforceProductionSecrets } = require('../../../../../libs/shared/src/env');
const { setStandardErrorHandler } = require('../../../../../libs/shared/src/errors');
const {
  computeOnboarding,
  pickEditableProfileFields,
  pickManagedProfileFields,
  buildProfileUpsertFromEnsure,
  mergeProfileView,
} = require('./profile-logic');
const { callJson, checkPermission } = require('./integration');

const serviceName = 'profile-service';
const port = Number(process.env.PORT) || 8092;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_profile_db';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const membershipApiBaseUrl = process.env.MEMBERSHIP_API_BASE_URL || '';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 20;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;

const searchWindowSec = 60;
const searchMaxPerWindow = 30;

let mongoClient;
let redisClient;
let dbReady = false;
let redisReady = false;
let db;
let fetchClient = (...args) => fetch(...args);
let outboxRepo = null;
let outboxTimer = null;

const collections = {
  profiles: () => db.collection('user_profiles'),
  placeholders: () => db.collection('profile_placeholders'),
};

const errorSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
  },
  required: ['message'],
};

const validationErrorSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'integer', example: 400 },
    error: { type: 'string', example: 'Bad Request' },
    message: { type: 'string', example: 'Validation error' },
  },
};

function profileResponses(extra = {}) {
  return {
    200: { type: 'object', additionalProperties: true },
    400: validationErrorSchema,
    401: errorSchema,
    403: errorSchema,
    429: errorSchema,
    503: errorSchema,
    ...extra,
  };
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
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      token,
    };
  } catch (_err) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
}

async function requireInternal(req, reply) {
  const incoming = req.headers['x-internal-token'];
  if (!incoming || incoming !== internalServiceToken) {
    return reply.code(401).send({ message: 'Unauthorized internal call' });
  }
}

async function enforcePermission(req, reply, permissionKey, organizationId) {
  const authorization = req.headers.authorization;
  const checked = await checkPermission(fetchClient, {
    rbacBaseUrl: rbacApiBaseUrl,
    authorization,
    permissionKey,
    organizationId,
    activeContextId: req.headers['x-active-context-id'] || null,
    activeContextName: req.headers['x-active-context-name'] || null,
    activeContextType: req.headers['x-active-context-type'] || null,
  });
  if (!checked.allowed) {
    reply.code(checked.status === 401 ? 401 : 403).send({ message: 'Forbidden' });
    return true;
  }
  return false;
}

function emitAuditEvent(event, req = null) {
  if (!outboxRepo) return;
  const orgIdFromHeaders = req?.headers ? (req.headers['x-org-id'] || null) : null;
  const branchIdFromHeaders = req?.headers ? (req.headers['x-branch-id'] || null) : null;
  outboxRepo.enqueueOutboxEvent(buildEventEnvelope({
    eventType: event.eventType || 'AUDIT_EVENT',
    sourceService: serviceName,
    aggregateType: event.resource?.type || 'profile',
    aggregateId: event.resource?.id || event.userId || null,
    payload: event,
    trace: {
      requestId: req?.headers?.['x-request-id'] || event.metadata?.requestId || null,
      userId: req?.auth?.userId || event.userId || null,
      orgId: event.organizationId || orgIdFromHeaders,
      branchId: event.metadata?.branchId || branchIdFromHeaders,
    },
    destination: 'audit',
  })).catch((err) => {
    fastify.log.warn({ err, eventType: event?.eventType }, 'profile outbox enqueue failed');
  });
}

function getPermissionOrganizationId(req) {
  const queryOrgId = req?.query && typeof req.query === 'object' ? req.query.organizationId : null;
  const headerOrgId = req?.headers?.['x-org-id'] || null;
  return String(queryOrgId || headerOrgId || '').trim() || null;
}

function buildForwardHeaders(req) {
  const headers = {
    authorization: req.headers.authorization,
    'content-type': 'application/json',
  };
  if (req.headers['x-active-context-id']) headers['x-active-context-id'] = req.headers['x-active-context-id'];
  if (req.headers['x-active-context-name']) headers['x-active-context-name'] = req.headers['x-active-context-name'];
  if (req.headers['x-active-context-type']) headers['x-active-context-type'] = req.headers['x-active-context-type'];
  if (req.headers['x-org-id']) headers['x-org-id'] = req.headers['x-org-id'];
  if (req.headers['x-branch-id']) headers['x-branch-id'] = req.headers['x-branch-id'];
  return headers;
}

async function fetchOrganizationMemberRefs(organizationId, req) {
  if (!organizationId || !membershipApiBaseUrl) return null;

  const allowedUserIds = new Set();
  const allowedNins = new Set();
  let page = 1;
  const limit = 500;
  const maxPages = 10;

  while (page <= maxPages) {
    const qs = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      status: 'active',
    });
    const res = await callJson(fetchClient, `${membershipApiBaseUrl}/orgs/${encodeURIComponent(String(organizationId))}/members?${qs.toString()}`, {
      method: 'GET',
      headers: buildForwardHeaders(req),
    });
    if (!res.ok) return null;

    const items = Array.isArray(res.body?.items) ? res.body.items : [];
    for (const item of items) {
      const userId = String(item?.userId || '').trim();
      const nin = String(item?.nin || '').trim();
      if (userId) allowedUserIds.add(userId);
      if (nin) allowedNins.add(nin);
    }

    const total = Number(res.body?.total || items.length || 0);
    if (items.length < limit || (page * limit) >= total) break;
    page += 1;
  }

  return { allowedUserIds, allowedNins };
}

function isProfileAllowedInOrganization(profile, memberRefs) {
  if (!memberRefs) return true;
  const userId = String(profile?.userId || '').trim();
  const nin = String(profile?.nin || '').trim();
  return memberRefs.allowedUserIds.has(userId) || memberRefs.allowedNins.has(nin);
}

async function updateProfileDocument(userId, editable, picker = pickEditableProfileFields) {
  const updates = picker(editable || {});
  const setDoc = {
    ...updates,
    'metadata.updatedAt': new Date(),
  };
  await collections.profiles().updateOne({ userId }, { $set: setDoc }, { upsert: true });
  const updated = await collections.profiles().findOne({ userId });
  const onboarding = computeOnboarding(updated || {});
  await collections.profiles().updateOne(
    { userId },
    { $set: { 'onboarding.completedSteps': onboarding.completedSteps, 'onboarding.completenessScore': onboarding.completenessScore } },
  );
  return { profile: await collections.profiles().findOne({ userId }), updatedKeys: Object.keys(updates) };
}

async function applySearchRateLimit(req, reply) {
  if (!redisReady || !req.auth?.userId) {
    return;
  }
  const now = Date.now();
  const key = `profile:search:${req.auth.userId}`;
  const member = `${now}:${crypto.randomUUID()}`;
  await redisClient.zAdd(key, [{ score: now, value: member }]);
  await redisClient.zRemRangeByScore(key, 0, now - searchWindowSec * 1000);
  const count = await redisClient.zCard(key);
  await redisClient.expire(key, searchWindowSec + 5);
  if (count > searchMaxPerWindow) {
    return reply.code(429).send({ message: 'Too many search requests' });
  }
  return null;
}

async function connect() {
  if (!mongoUri) {
    fastify.log.warn('Missing MONGODB_URI; profile-service running in degraded mode');
    return;
  }

  try {
    mongoClient = new MongoClient(mongoUri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: false,
        deprecationErrors: true,
      },
    });
    await mongoClient.connect();
    db = mongoClient.db(dbName);
    await db.command({ ping: 1 });
    dbReady = true;
    outboxRepo = createOutboxRepository(db);
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed');
  }

  try {
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => fastify.log.error({ err }, 'Redis error'));
    await redisClient.connect();
    redisReady = true;
  } catch (err) {
    fastify.log.warn({ err }, 'Redis connection failed');
  }

  if (dbReady) {
    await Promise.all([
      collections.profiles().createIndex({ userId: 1 }, { unique: true }),
      collections.profiles().createIndex({ nin: 1 }, { unique: true, sparse: true }),
      collections.profiles().createIndex({ phone: 1 }, { unique: true, sparse: true }),
      collections.profiles().createIndex({ email: 1 }, { unique: true, sparse: true }),
      collections.profiles().createIndex({ lastName: 'text', firstName: 'text', displayName: 'text' }),
      collections.placeholders().createIndex({ nin: 1 }),
      outboxRepo.createIndexes(),
    ]);
  }
}

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

fastify.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  if (!dbReady) {
    return reply.code(503).send({ message: 'Profile storage unavailable' });
  }
});

async function fetchAuthMe(authorization) {
  const res = await callJson(fetchClient, `${authApiBaseUrl}/me`, {
    method: 'GET',
    headers: { authorization, 'content-type': 'application/json' },
  });
  return res.ok ? res.body?.user : null;
}

async function fetchNinSummary(nin, authorization) {
  if (!nin) return null;
  const res = await callJson(fetchClient, `${authApiBaseUrl}/nin/${nin}`, {
    method: 'GET',
    headers: { authorization, 'content-type': 'application/json' },
  });
  if (!res.ok) return null;
  return {
    nin: res.body?.nin || nin,
    firstName: res.body?.firstName || null,
    lastName: res.body?.lastName || null,
    otherName: res.body?.otherName || null,
    dob: res.body?.dob || null,
    gender: res.body?.gender || null,
    isActive: res.body?.isActive !== false,
    lastFetchedAt: res.body?.lastFetchedAt || null,
  };
}

async function fetchRolesSummary(authorization) {
  const res = await callJson(fetchClient, `${rbacApiBaseUrl}/rbac/me/scope`, {
    method: 'GET',
    headers: { authorization, 'content-type': 'application/json' },
  });
  if (!res.ok) return null;
  return {
    appScopePermissions: res.body?.appScopePermissions || [],
    orgScopePermissions: res.body?.orgScopePermissions || [],
    rolesUsed: res.body?.rolesUsed || null,
  };
}

async function fetchMembershipSummary(userId, authorization) {
  if (!membershipApiBaseUrl) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await callJson(fetchClient, `${membershipApiBaseUrl}/users/${userId}/memberships?includeBranches=true`, {
      method: 'GET',
      headers: {
        authorization,
        'x-internal-token': internalServiceToken,
        'content-type': 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const memberships = Array.isArray(res.body?.memberships)
      ? res.body.memberships
      : (Array.isArray(res.body?.items) ? res.body.items : []);
    return {
      memberships: memberships.map((item) => ({
        organizationId: item.organizationId,
        organizationName: item.organizationName || null,
        membershipId: item.membershipId,
        membershipStatus: item.membershipStatus || item.status || null,
        roles: Array.isArray(item.roles) ? item.roles : [],
        branches: Array.isArray(item.branches) ? item.branches : [],
      })),
    };
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureProfileFromAuth(userId, authUser, createdFrom = 'nin_login') {
  const existing = await collections.profiles().findOne({ userId });
  const upsertDoc = buildProfileUpsertFromEnsure(
    {
      userId,
      nin: authUser?.nin || existing?.nin || null,
      phone: authUser?.phone || existing?.phone || null,
      email: authUser?.email || existing?.email || null,
      phoneVerified: !!authUser?.phoneVerified,
      emailVerified: !!authUser?.emailVerified,
      hasSetPassword: !!authUser?.passwordSetAt && !authUser?.requiresPasswordChange,
      createdFrom,
    },
    existing
  );

  await collections.profiles().updateOne({ userId }, { $set: upsertDoc }, { upsert: true });
  return collections.profiles().findOne({ userId });
}

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  redisReady,
  dbName,
}));

fastify.get('/profile/me', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Get merged self profile view',
    description: 'Returns user profile, NIN cache summary, RBAC scope summary, and optional membership summary.',
    security: [{ bearerAuth: [] }],
    response: profileResponses({
      200: {
        type: 'object',
        additionalProperties: true,
        example: {
          profile: { userId: 'user-1', nin: '90000000001', displayName: 'John Doe', profileStatus: 'active' },
          ninSummary: { nin: '90000000001', firstName: 'John', lastName: 'Doe' },
          rolesSummary: { appScopePermissions: [{ permissionKey: 'profile.me.read', effect: 'allow' }] },
          membershipSummary: {
            memberships: [
              {
                organizationId: 'org-1',
                membershipId: 'mem-1',
                status: 'active',
                roles: ['org_staff'],
                branches: [
                  {
                    branchId: 'branch-1',
                    roles: ['doctor'],
                    departments: ['pediatrics'],
                    status: 'active',
                  },
                ],
              },
            ],
          },
        },
      },
    }),
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'profile.me.read');
  if (denied) return;
  const authUser = await fetchAuthMe(req.headers.authorization);
  if (!authUser) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
  const profile = await ensureProfileFromAuth(req.auth.userId, authUser, 'nin_login');
  const [ninSummary, rolesSummary, membershipSummary] = await Promise.all([
    fetchNinSummary(profile?.nin, req.headers.authorization),
    fetchRolesSummary(req.headers.authorization),
    fetchMembershipSummary(req.auth.userId, req.headers.authorization),
  ]);
  if (membershipApiBaseUrl && membershipSummary === null) {
    emitAuditEvent({
      userId: req.auth.userId,
      eventType: 'PROFILE_MEMBERSHIP_LOOKUP_FAILED',
      action: 'profile.membership.lookup',
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      outcome: 'failure',
      failureReason: 'MEMBERSHIP_SERVICE_UNAVAILABLE',
    }, req);
  }

  const merged = mergeProfileView({ profile, ninSummary, rolesSummary, membershipSummary });
  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_VIEWED_SELF',
    action: 'profile.me.read',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  }, req);
  return reply.send(merged);
});

fastify.patch('/profile/me', {
  preHandler: requireAuth,
  schema: {
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        displayName: { type: 'string' },
        address: { type: 'object', additionalProperties: true },
        preferences: { type: 'object', additionalProperties: true },
      },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'profile.me.update');
  if (denied) return;

  const { profile, updatedKeys } = await updateProfileDocument(req.auth.userId, req.body || {}, pickEditableProfileFields);

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_UPDATED_SELF',
    action: 'profile.me.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { updatedKeys },
  }, req);
  return reply.send({ message: 'Profile updated', profile });
});

fastify.post('/profile/me/request-nin-refresh', { preHandler: requireAuth }, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'profile.nin.refresh.request');
  if (denied) return;

  const profile = await collections.profiles().findOne({ userId: req.auth.userId });
  if (!profile?.nin) {
    return reply.code(400).send({ message: 'No NIN linked to profile' });
  }

  const response = await callJson(fetchClient, `${authApiBaseUrl}/nin/refresh/${profile.nin}`, {
    method: 'POST',
    headers: { authorization: req.headers.authorization, 'content-type': 'application/json' },
  });

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_NIN_REFRESH_REQUESTED',
    action: 'profile.nin.refresh.request',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: response.ok ? 'success' : 'failure',
    failureReason: response.ok ? null : 'NIN_REFRESH_UNAVAILABLE',
    metadata: { nin: profile.nin },
  }, req);

  return reply.code(response.status).send(response.body || { message: 'Request failed' });
});

fastify.get('/profile/me/status', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Get profile onboarding status',
    description: 'Returns onboarding completeness score and suggested next steps.',
    security: [{ bearerAuth: [] }],
    response: profileResponses({
      200: {
        type: 'object',
        example: {
          userId: 'user-1',
          profileStatus: 'pending',
          onboarding: { hasSetPassword: true, completedSteps: ['password_set'], completenessScore: 40 },
          nextSteps: ['verify_phone', 'verify_email'],
        },
      },
    }),
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'profile.me.read');
  if (denied) return;
  const profile = await collections.profiles().findOne({ userId: req.auth.userId });
  const onboarding = computeOnboarding(profile || {});
  const nextSteps = [];
  if (!profile?.onboarding?.hasSetPassword) nextSteps.push('set_password');
  if (!profile?.onboarding?.hasVerifiedPhone) nextSteps.push('verify_phone');
  if (!profile?.onboarding?.hasVerifiedEmail) nextSteps.push('verify_email');
  if (!profile?.displayName) nextSteps.push('set_display_name');
  return reply.send({
    userId: req.auth.userId,
    profileStatus: profile?.profileStatus || 'incomplete',
    onboarding: {
      ...(profile?.onboarding || {}),
      completedSteps: onboarding.completedSteps,
      completenessScore: onboarding.completenessScore,
    },
    nextSteps,
  });
});

fastify.get('/profile/search', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Search profiles',
    description: 'Searches user profiles by q/nin/phone/email/name with pagination. Rate-limited.',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        nin: { type: 'string', pattern: '^\\d{11}$' },
        phone: { type: 'string' },
        email: { type: 'string', format: 'email' },
        name: { type: 'string' },
        role: { type: 'string' },
        organizationId: { type: 'string' },
        branchId: { type: 'string' },
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    response: profileResponses({
      200: {
        type: 'object',
        example: {
          page: 1,
          limit: 20,
          total: 1,
          items: [{ userId: 'user-1', nin: '90000000001', displayName: 'John Doe', profileStatus: 'active' }],
        },
      },
    }),
  },
}, async (req, reply) => {
  const organizationId = getPermissionOrganizationId(req);
  const denied = await enforcePermission(req, reply, 'profile.search', organizationId);
  if (denied) return;
  const limited = await applySearchRateLimit(req, reply);
  if (limited) return;

  const { q, nin, phone, email, name, role, page = 1, limit = 20 } = req.query || {};
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const filter = {};

  if (nin) filter.nin = String(nin);
  if (phone) filter.phone = String(phone);
  if (email) filter.email = String(email).toLowerCase();
  if (role) filter.professionTypes = String(role);
  if (name) {
    filter.$or = [
      { firstName: { $regex: String(name), $options: 'i' } },
      { lastName: { $regex: String(name), $options: 'i' } },
      { displayName: { $regex: String(name), $options: 'i' } },
    ];
  }
  if (q) {
    filter.$text = { $search: String(q) };
  }

  const projection = { userId: 1, nin: 1, displayName: 1, firstName: 1, lastName: 1, phone: 1, email: 1, professionTypes: 1, profileStatus: 1 };
  let items = [];
  let total = 0;

  if (organizationId) {
    const memberRefs = await fetchOrganizationMemberRefs(organizationId, req);
    if (!memberRefs) {
      return reply.code(503).send({ message: 'Membership scope unavailable' });
    }
    const matched = await collections.profiles()
      .find(filter, { projection })
      .toArray();
    const visible = matched.filter((profile) => isProfileAllowedInOrganization(profile, memberRefs));
    total = visible.length;
    items = visible.slice((safePage - 1) * safeLimit, safePage * safeLimit);
  } else {
    [items, total] = await Promise.all([
      collections.profiles()
        .find(filter, { projection })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .toArray(),
      collections.profiles().countDocuments(filter),
    ]);
  }

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_SEARCHED',
    action: 'profile.search',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { hasQ: !!q, page: safePage, limit: safeLimit },
  }, req);
  return reply.send({ page: safePage, limit: safeLimit, total, items });
});

fastify.get('/profile/:userId', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Get profile by userId',
    description: 'Admin/staff profile read.',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' },
      },
    },
    querystring: {
      type: 'object',
      properties: {
        organizationId: { type: 'string' },
      },
    },
    response: profileResponses({
      200: {
        type: 'object',
        example: {
          profile: { userId: 'user-1', nin: '90000000001', displayName: 'John Doe', profileStatus: 'active' },
        },
      },
      404: errorSchema,
    }),
  },
}, async (req, reply) => {
  const organizationId = getPermissionOrganizationId(req);
  const denied = await enforcePermission(req, reply, 'profile.user.read', organizationId);
  if (denied) return;
  const { userId } = req.params;
  const profile = await collections.profiles().findOne({ userId: String(userId) });
  if (!profile) return reply.code(404).send({ message: 'Profile not found' });
  if (organizationId) {
    const memberRefs = await fetchOrganizationMemberRefs(organizationId, req);
    if (!memberRefs) {
      return reply.code(503).send({ message: 'Membership scope unavailable' });
    }
    if (!isProfileAllowedInOrganization(profile, memberRefs)) {
      return reply.code(404).send({ message: 'Profile not found' });
    }
  }

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_VIEWED_ADMIN',
    action: 'profile.user.read',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { targetUserId: userId },
  }, req);
  return reply.send({ profile });
});

fastify.patch('/profile/:userId', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Update profile by userId',
    description: 'Authorized org staff profile update.',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' },
      },
    },
    querystring: {
      type: 'object',
      properties: {
        organizationId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        displayName: { type: 'string' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        otherName: { type: 'string' },
        dob: { type: 'string' },
        gender: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        professionTypes: { type: 'array', items: { type: 'string' } },
        address: { type: 'object', additionalProperties: true },
        preferences: { type: 'object', additionalProperties: true },
      },
    },
    response: profileResponses({
      200: { type: 'object', additionalProperties: true },
      404: errorSchema,
    }),
  },
}, async (req, reply) => {
  const organizationId = getPermissionOrganizationId(req);
  const denied = await enforcePermission(req, reply, 'profile.user.update', organizationId);
  if (denied) return;

  const { userId } = req.params;
  const existing = await collections.profiles().findOne({ userId: String(userId) });
  if (!existing) return reply.code(404).send({ message: 'Profile not found' });
  if (organizationId) {
    const memberRefs = await fetchOrganizationMemberRefs(organizationId, req);
    if (!memberRefs) {
      return reply.code(503).send({ message: 'Membership scope unavailable' });
    }
    if (!isProfileAllowedInOrganization(existing, memberRefs)) {
      return reply.code(404).send({ message: 'Profile not found' });
    }
  }

  const { profile, updatedKeys } = await updateProfileDocument(String(userId), req.body || {}, pickManagedProfileFields);

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_UPDATED_ADMIN',
    action: 'profile.user.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { targetUserId: String(userId), updatedKeys },
  }, req);

  return reply.send({ message: 'Profile updated', profile });
});

fastify.get('/profile/by-nin/:nin', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Get profile by NIN',
    description: 'Returns registered profile when user exists, otherwise not-registered response with NIN summary (authorized callers only).',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['nin'],
      properties: {
        nin: { type: 'string', pattern: '^\\d{11}$' },
      },
    },
    response: profileResponses({
      200: {
        type: 'object',
        example: {
          registered: false,
          ninSummary: { nin: '90000000001', firstName: 'John', lastName: 'Doe' },
        },
      },
    }),
  },
}, async (req, reply) => {
  const organizationId = getPermissionOrganizationId(req);
  const denied = await enforcePermission(req, reply, 'profile.user.read', organizationId);
  if (denied) return;
  const { nin } = req.params;
  if (!/^\d{11}$/.test(String(nin))) return reply.code(400).send({ message: 'nin must be 11 digits' });

  const profile = await collections.profiles().findOne({ nin: String(nin) });
  if (profile) {
    if (organizationId) {
      const memberRefs = await fetchOrganizationMemberRefs(organizationId, req);
      if (!memberRefs) {
        return reply.code(503).send({ message: 'Membership scope unavailable' });
      }
      if (!isProfileAllowedInOrganization(profile, memberRefs)) {
        return reply.send({ registered: false, ninSummary: await fetchNinSummary(String(nin), req.headers.authorization) });
      }
    }
    return reply.send({ registered: true, profile });
  }
  const ninSummary = await fetchNinSummary(String(nin), req.headers.authorization);
  return reply.send({ registered: false, ninSummary });
});

fastify.post('/profile/create-placeholder', {
  preHandler: requireAuth,
  schema: {
    body: {
      type: 'object',
      required: ['nin'],
      properties: {
        nin: { type: 'string', pattern: '^\\d{11}$' },
        note: { type: 'string' },
      },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'profile.placeholder.create', req.query?.organizationId);
  if (denied) return;
  const { nin, note } = req.body;

  const ninSummary = await fetchNinSummary(nin, req.headers.authorization);
  if (!ninSummary) {
    return reply.code(503).send({ message: 'Fetching from NIN is currently not available.' });
  }

  const placeholderId = crypto.randomUUID();
  await collections.placeholders().insertOne({
    placeholderId,
    nin,
    createdBy: req.auth.userId,
    note: note || null,
    createdAt: new Date(),
  });

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_PLACEHOLDER_CREATED',
    action: 'profile.placeholder.create',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { nin, placeholderId },
  }, req);

  return reply.code(201).send({ placeholderId, registered: false, ninSummary });
});

fastify.post('/internal/profile/ensure', {
  preHandler: requireInternal,
  schema: {
    body: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' },
        nin: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        phoneVerified: { type: 'boolean' },
        emailVerified: { type: 'boolean' },
        hasSetPassword: { type: 'boolean' },
        createdFrom: { type: 'string' },
      },
    },
  },
}, async (req, reply) => {
  const body = req.body || {};
  const existing = await collections.profiles().findOne({ userId: String(body.userId) });
  const upsertDoc = buildProfileUpsertFromEnsure(body, existing);
  await collections.profiles().updateOne({ userId: String(body.userId) }, { $set: upsertDoc }, { upsert: true });
  return reply.send({ message: 'Profile ensured', userId: String(body.userId) });
});

fastify.post('/internal/profile/sync-contact', {
  preHandler: requireInternal,
  schema: {
    body: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        phoneVerified: { type: 'boolean' },
        emailVerified: { type: 'boolean' },
      },
    },
  },
}, async (req, reply) => {
  const { userId, phone, email, phoneVerified, emailVerified } = req.body || {};
  const updates = {
    'metadata.updatedAt': new Date(),
  };
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email;
  if (phoneVerified !== undefined) updates.phoneVerified = !!phoneVerified;
  if (emailVerified !== undefined) updates.emailVerified = !!emailVerified;

  await collections.profiles().updateOne({ userId: String(userId) }, { $set: updates }, { upsert: true });
  return reply.send({ message: 'Profile contact synced', userId: String(userId) });
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
    if (redisClient) await redisClient.quit();
    if (mongoClient) await mongoClient.close();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => {
  const logger = (typeof fastify !== 'undefined' && fastify && fastify.log) ? fastify.log : console;
  logger.error({ err: reason }, 'Unhandled promise rejection; service will keep running in degraded mode');
});

process.on('uncaughtException', (err) => {
  const logger = (typeof fastify !== 'undefined' && fastify && fastify.log) ? fastify.log : console;
  logger.error({ err }, 'Uncaught exception; service will keep running in degraded mode');
});

setStandardErrorHandler(fastify);

function buildApp(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'dbReady')) {
    dbReady = !!options.dbReady;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'redisReady')) {
    redisReady = !!options.redisReady;
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

