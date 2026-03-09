const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion } = require('mongodb');
const { createClient } = require('redis');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');
const cors = require('@fastify/cors');
const { findPermissionRule } = require('./permissions/registry');
const { evaluateAuthzResponse } = require('./authz');
const { buildAuditPayload } = require('./audit-utils');
const { setStandardErrorHandler } = require('../../../../libs/shared/src/errors');
const { enforceProductionSecrets } = require('../../../../libs/shared/src/env');
const { buildEventEnvelope, createOutboxRepository, deliverOutboxBatch } = require('../../../../libs/shared/src/outbox');
const {
  CONTEXT_HEADER,
  CONTEXT_SIGNATURE_HEADER,
  buildSignedContext,
  encodeContext,
  signEncodedContext,
} = require('../../../../libs/shared/src/nhrs-context');

const serviceName = 'api-gateway';
const port = Number(process.env.PORT) || 8080;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const profileApiBaseUrl = process.env.PROFILE_API_BASE_URL || 'http://user-profile-service:8092';
const organizationApiBaseUrl = process.env.ORGANIZATION_API_BASE_URL || 'http://organization-service:8093';
const membershipApiBaseUrl = process.env.MEMBERSHIP_API_BASE_URL || 'http://membership-service:8103';
const healthRecordsIndexApiBaseUrl = process.env.HEALTH_RECORDS_INDEX_API_BASE_URL || 'http://health-records-index-service:8104';
const clinicalEncounterApiBaseUrl = process.env.CLINICAL_ENCOUNTER_API_BASE_URL || 'http://clinical-encounter-service:8105';
const laboratoryResultApiBaseUrl = process.env.LABORATORY_RESULT_API_BASE_URL || 'http://laboratory-result-service:8106';
const pharmacyDispenseApiBaseUrl = process.env.PHARMACY_DISPENSE_API_BASE_URL || 'http://pharmacy-dispense-service:8107';
const emergencyInventoryApiBaseUrl = process.env.EMERGENCY_INVENTORY_API_BASE_URL || 'http://emergency-inventory-service:8108';
const taskforceDirectoryApiBaseUrl = process.env.TASKFORCE_DIRECTORY_API_BASE_URL || 'http://taskforce-directory-service:8109';
const caseApiBaseUrl = process.env.CASE_API_BASE_URL || 'http://case-service:8110';
const doctorRegistryApiBaseUrl = process.env.DOCTOR_REGISTRY_API_BASE_URL || 'http://doctor-registry-service:8094';
const uiThemeApiBaseUrl = process.env.UI_THEME_API_BASE_URL || 'http://ui-theme-service:8111';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const membershipScopeCacheTtlSec = Number(process.env.MEMBERSHIP_SCOPE_CACHE_TTL_SEC) || 60;
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const nhrsContextTtlSeconds = Number(process.env.NHRS_CONTEXT_TTL_SECONDS) || 60;
const docsExportPath = process.env.DOCS_EXPORT_PATH;
const gatewayRateLimitWindowSec = Number(process.env.GATEWAY_RATE_LIMIT_WINDOW_SEC) || 60;
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 50;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;
const corsOrigins = String(
  process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173',
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const appEnv = String(process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();

let dbReady = false;
let mongoClient;
let redisClient;
let redisReady = false;
let outboxRepo = null;
let outboxTimer = null;
let fetchClient = (...args) => fetch(...args);
let routesRegistered = false;
const memoryRateLimitBuckets = new Map();
const memoryIdempotency = new Map();

const errorMessageSchema = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string' },
  },
};

const validationErrorSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'integer', example: 400 },
    error: { type: 'string', example: 'Bad Request' },
    message: { type: 'string', example: 'Validation error' },
  },
};

const unauthorizedSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', example: 'Unauthorized' },
  },
};

function authHeaderSchema(_required) {
  return {
    type: 'object',
    properties: {
      authorization: { type: 'string', pattern: '^Bearer\\s.+' },
      'x-org-id': { type: 'string' },
      'x-branch-id': { type: 'string' },
    },
  };
}

function standardResponses(extra) {
  const merged = {
    400: validationErrorSchema,
    401: unauthorizedSchema,
    423: errorMessageSchema,
    403: errorMessageSchema,
    429: errorMessageSchema,
    503: errorMessageSchema,
    ...extra,
  };
  for (const [statusCode, schema] of Object.entries(merged)) {
    if (
      schema &&
      typeof schema === 'object' &&
      schema.type === 'object' &&
      !Object.prototype.hasOwnProperty.call(schema, 'properties') &&
      !Object.prototype.hasOwnProperty.call(schema, 'patternProperties') &&
      !Object.prototype.hasOwnProperty.call(schema, 'additionalProperties')
    ) {
      merged[statusCode] = { ...schema, additionalProperties: true };
    }
  }
  return merged;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}

function getUserIdFromAuthorization(authorization) {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payloadRaw = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(payloadRaw);
    return payload?.sub ? String(payload.sub) : null;
  } catch (_err) {
    return null;
  }
}

function parseTokenPayload(authorization) {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7);
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payloadRaw = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(payloadRaw);
  } catch (_err) {
    return null;
  }
}

function getRequestId(req) {
  return String(req.headers['x-request-id'] || req.id || crypto.randomUUID());
}

function getTokenIdentity(req) {
  const payload = parseTokenPayload(req.headers.authorization || '');
  return {
    userId: payload?.sub ? String(payload.sub) : null,
    roles: Array.isArray(payload?.roles) ? payload.roles.map((r) => String(r)) : [],
  };
}

function rateLimitPolicy(req) {
  const routePath = req.routeOptions?.url || req.url.split('?')[0];
  const strictAuthRoutes = new Set([
    '/auth/login',
    '/auth/password/forgot',
    '/auth/password/reset',
    '/auth/token/refresh',
  ]);
  if (strictAuthRoutes.has(routePath)) {
    return [{ key: `ip:${getClientIp(req)}:auth`, max: 10, windowSec: 60 }];
  }
  if (routePath === '/emergency/requests' && req.method === 'POST') {
    const { userId } = getTokenIdentity(req);
    const rules = [{ key: `ip:${getClientIp(req)}:emergency`, max: 60, windowSec: 60 }];
    if (userId) rules.push({ key: `user:${userId}:emergency`, max: 30, windowSec: 60 });
    return rules;
  }
  if ((routePath === '/doctors/search' || routePath === '/emergency/inventory/search') && req.method === 'GET') {
    return [{ key: `ip:${getClientIp(req)}:search`, max: 60, windowSec: 60 }];
  }
  const { userId } = getTokenIdentity(req);
  if (userId) {
    return [{ key: `user:${userId}:general`, max: 300, windowSec: gatewayRateLimitWindowSec }];
  }
  return [{ key: `ip:${getClientIp(req)}:general`, max: 300, windowSec: gatewayRateLimitWindowSec }];
}

async function consumeRateLimitBucket(key, max, windowSec) {
  if (redisReady && redisClient) {
    const redisKey = `gateway:rl:${key}`;
    const count = await redisClient.incr(redisKey);
    if (count === 1) {
      await redisClient.expire(redisKey, windowSec);
    }
    if (count > max) {
      const ttl = await redisClient.ttl(redisKey);
      return { allowed: false, retryAfterSeconds: Math.max(ttl, 1) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const nowMs = Date.now();
  const current = memoryRateLimitBuckets.get(key);
  if (!current || current.resetAt <= nowMs) {
    memoryRateLimitBuckets.set(key, { count: 1, resetAt: nowMs + (windowSec * 1000) });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  if (current.count > max) {
    return { allowed: false, retryAfterSeconds: Math.max(Math.ceil((current.resetAt - nowMs) / 1000), 1) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

async function applyRateLimit(req, reply) {
  const rules = rateLimitPolicy(req);
  for (const rule of rules) {
    const decision = await consumeRateLimitBucket(rule.key, rule.max, rule.windowSec);
    if (!decision.allowed) {
      return reply.code(429).send({
        message: 'RATE_LIMITED',
        code: 'RATE_LIMITED',
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
  }
}

function isIdempotentProtectedRoute(method, routePath) {
  if (method !== 'POST') return false;
  if (routePath === '/emergency/requests') return true;
  if (/^\/records\/[^/]+\/entries$/.test(routePath)) return true;
  if (/^\/encounters\/[^/]+$/.test(routePath)) return true;
  if (/^\/labs\/[^/]+\/results$/.test(routePath)) return true;
  if (/^\/pharmacy\/[^/]+\/dispenses$/.test(routePath)) return true;
  if (routePath === '/cases') return true;
  if (/^\/licenses\/[^/]+\/(verify|suspend|revoke|reinstate)$/.test(routePath)) return true;
  return false;
}

function computeBodyHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex');
}

function idempotencyMemKey(routePath, scope, key) {
  return `${routePath}:${scope}:${key}`;
}

async function applyIdempotency(req, reply) {
  const routePath = req.routeOptions?.url || req.url.split('?')[0];
  if (!isIdempotentProtectedRoute(req.method, routePath)) return;
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) return;
  const identity = getTokenIdentity(req);
  const scope = identity.userId || `ip:${getClientIp(req)}`;
  const requestHash = computeBodyHash(req.body);
  const key = String(idempotencyKey);

  if (!dbReady || !mongoClient) {
    const memKey = idempotencyMemKey(routePath, scope, key);
    const existing = memoryIdempotency.get(memKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return reply.code(409).send({ message: 'IDEMPOTENCY_KEY_REUSED', code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      reply.header('x-idempotency-replayed', 'true');
      return reply.code(existing.responseStatus).send(existing.responseBody);
    }
    req.idempotencyContext = { memKey, requestHash };
    return;
  }

  const col = mongoClient.db(dbName).collection('idempotency_keys');
  const existing = await col.findOne({ key, scope, route: routePath });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return reply.code(409).send({ message: 'IDEMPOTENCY_KEY_REUSED', code: 'IDEMPOTENCY_KEY_REUSED' });
    }
    reply.header('x-idempotency-replayed', 'true');
    return reply.code(existing.responseStatus).send(existing.responseBody);
  }
  req.idempotencyContext = {
    key,
    scope,
    route: routePath,
    requestHash,
  };
}

function emitAuditEvent(event) {
  const payload = buildAuditPayload(event);
  if (!outboxRepo) return;
  outboxRepo.enqueueOutboxEvent(buildEventEnvelope({
    eventType: payload.eventType || 'AUDIT_EVENT',
    sourceService: serviceName,
    aggregateType: payload.resource?.type || 'gateway',
    aggregateId: payload.resource?.id || payload.userId || null,
    payload,
    trace: {
      requestId: payload.metadata?.requestId || null,
      userId: payload.userId || null,
      orgId: payload.organizationId || null,
      branchId: payload.metadata?.branchId || null,
    },
    destination: 'audit',
  })).catch((err) => {
    fastify.log.warn({ err, eventType: payload?.eventType }, 'Gateway audit enqueue failed');
  });
}

async function connectToMongo() {
  if (!mongoUri || !dbName) {
    fastify.log.warn('MONGODB_URI or DB_NAME not set; starting without database connection');
    return;
  }

  mongoClient = new MongoClient(mongoUri, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  try {
    await mongoClient.connect();
    await mongoClient.db('admin').command({ ping: 1 });
    outboxRepo = createOutboxRepository(mongoClient.db(dbName));
    await mongoClient.db(dbName).collection('idempotency_keys').createIndexes([
      { key: { key: 1, scope: 1, route: 1 }, unique: true },
      { key: { createdAt: 1 }, expireAfterSeconds: 24 * 60 * 60 },
    ]);
    await outboxRepo.createIndexes();
    dbReady = true;
    fastify.log.info({ dbName }, 'MongoDB connection established');
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed; continuing without database connection');
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

async function connectToRedis() {
  try {
    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: () => false,
      },
    });
    redisClient.on('error', (err) => fastify.log.warn({ err }, 'Redis error'));
    await redisClient.connect();
    redisReady = true;
  } catch (err) {
    fastify.log.warn({ err }, 'Redis connection failed; membership scope cache disabled');
  }
}

function extractScope(req, rule) {
  let organizationId = req.headers['x-org-id'] || null;
  let branchId = req.headers['x-branch-id'] || null;
  if (typeof rule.orgFrom === 'string' && rule.orgFrom.startsWith('params.')) {
    const paramKey = rule.orgFrom.split('.')[1];
    if (paramKey && req.params?.[paramKey]) {
      organizationId = req.params[paramKey];
    }
  }
  if (!organizationId && req.params?.orgId) {
    organizationId = req.params.orgId;
  }
  if (!branchId && req.params?.branchId) {
    branchId = req.params.branchId;
  }
  return {
    organizationId: organizationId ? String(organizationId) : null,
    branchId: branchId ? String(branchId) : null,
  };
}

function membershipScopeCacheKey(userId, organizationId, branchId) {
  return `gateway:scope:${String(userId)}:${String(organizationId)}:${branchId ? String(branchId) : 'all'}`;
}

async function validateMembershipScope({ userId, organizationId, branchId }) {
  if (!userId || !organizationId) {
    return { allowed: false, reason: 'MISSING_SCOPE_IDENTIFIERS' };
  }

  const cacheKey = membershipScopeCacheKey(userId, organizationId, branchId);
  if (redisReady) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed;
      }
    } catch (err) {
      fastify.log.warn({ err }, 'Failed reading membership scope cache');
    }
  }

  const qs = new URLSearchParams({ userId: String(userId) });
  if (branchId) {
    qs.set('branchId', String(branchId));
  }
  const response = await fetchClient(`${membershipApiBaseUrl}/orgs/${encodeURIComponent(String(organizationId))}/memberships/me?${qs.toString()}`, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': internalServiceToken,
    },
  });
  const body = await response.json();
  const result = response.ok
    ? {
      allowed: body?.allowed === true,
      reason: body?.allowed === true ? null : (body?.message || 'NOT_ORG_MEMBER'),
      membership: body?.membership || null,
    }
    : { allowed: false, reason: body?.message || 'NOT_ORG_MEMBER' };

  if (redisReady) {
    try {
      await redisClient.set(cacheKey, JSON.stringify(result), { EX: membershipScopeCacheTtlSec });
    } catch (err) {
      fastify.log.warn({ err }, 'Failed writing membership scope cache');
    }
  }
  return result;
}

async function forwardRequest(baseUrl, req, reply, targetPath) {
  const queryPart = req.raw?.url && req.raw.url.includes('?') ? req.raw.url.slice(req.raw.url.indexOf('?')) : '';
  const url = `${baseUrl}${targetPath}${queryPart}`;
  const headers = { 'content-type': 'application/json' };
  if (req.headers.authorization) {
    headers.authorization = req.headers.authorization;
  }
  if (req.headers['x-org-id']) {
    headers['x-org-id'] = req.headers['x-org-id'];
  }
  if (req.headers['x-branch-id']) {
    headers['x-branch-id'] = req.headers['x-branch-id'];
  }

  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  const authContext = req.authzContext || {};
  const contextPayload = buildSignedContext({
    requestId,
    userId: authContext.userId || null,
    roles: authContext.roles || [],
    orgId: authContext.organizationId || null,
    branchId: authContext.branchId || null,
    permissionsChecked: authContext.permissionKey ? [authContext.permissionKey] : [],
    membershipChecked: !!authContext.membershipChecked,
    ttlSeconds: nhrsContextTtlSeconds,
  });
  const encodedContext = encodeContext(contextPayload);
  headers[CONTEXT_HEADER] = encodedContext;
  headers[CONTEXT_SIGNATURE_HEADER] = signEncodedContext(encodedContext, nhrsContextSecret);
  headers['x-request-id'] = requestId;

  const response = await fetchClient(url, {
    method: req.method,
    headers,
    body: req.body ? JSON.stringify(req.body) : undefined,
  });

  const raw = await response.text();
  const contentType = response.headers.get('content-type') || 'application/json';
  let parsedBody = null;
  if (raw) {
    try {
      parsedBody = JSON.parse(raw);
    } catch (_err) {
      parsedBody = raw;
    }
  }
  return {
    statusCode: response.status,
    contentType,
    body: parsedBody,
  };
}

async function enforcePermission(req, reply) {
  const routePath = req.routeOptions?.url || req.url.split('?')[0];
  const rule = findPermissionRule(req.method, routePath);
  const ipAddress = getClientIp(req);
  const userAgent = req.headers['user-agent'] || null;

  if (!rule || rule.public || !rule.permissionKey) {
    req.authzContext = {
      userId: null,
      roles: [],
      permissionKey: null,
      organizationId: null,
      branchId: null,
      membershipChecked: false,
    };
    return;
  }

  const authorization = req.headers.authorization || '';
  const hasBearerToken = authorization.startsWith('Bearer ');
  if (!hasBearerToken) {
    emitAuditEvent({
      userId: null,
      organizationId: req.headers['x-org-id'] || null,
      eventType: 'RBAC_ACCESS_DENIED',
      action: 'gateway.permission_check',
      permissionKey: rule.permissionKey,
      ipAddress,
      userAgent,
      outcome: 'failure',
      failureReason: 'MISSING_BEARER_TOKEN',
      metadata: { method: req.method, path: routePath },
    });
    const decision = evaluateAuthzResponse({ rule, hasBearerToken, checkStatus: 401, checkBody: null });
    return reply.code(decision.statusCode).send(decision.body);
  }

  const { organizationId, branchId } = extractScope(req, rule);
  const tokenPayload = parseTokenPayload(authorization);
  const tokenUserId = tokenPayload?.sub ? String(tokenPayload.sub) : getUserIdFromAuthorization(authorization);
  const tokenRoles = Array.isArray(tokenPayload?.roles) ? tokenPayload.roles.map((r) => String(r)) : [];

  try {
    if (rule.requireOrgScope && !organizationId) {
      return reply.code(400).send({ message: 'x-org-id header is required' });
    }
    if (organizationId) {
      if (!tokenUserId) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }
      const membershipDecision = await validateMembershipScope({
        userId: tokenUserId,
        organizationId,
        branchId,
      });
      if (!membershipDecision.allowed) {
        emitAuditEvent({
          userId: tokenUserId,
          organizationId,
          eventType: 'RBAC_ACCESS_DENIED',
          action: 'gateway.membership_scope_check',
          permissionKey: rule.permissionKey,
          ipAddress,
          userAgent,
          outcome: 'failure',
          failureReason: membershipDecision.reason || 'NO_ACTIVE_MEMBERSHIP',
          metadata: {
            method: req.method,
            path: routePath,
            branchId,
          },
        });
        return reply.code(403).send({ message: 'Not a member of this organization' });
      }
    }

    const checkResponse = await fetchClient(`${rbacApiBaseUrl}/rbac/check`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        permissionKey: rule.permissionKey,
        organizationId,
        branchId,
      }),
    });

    let checkBody = null;
    try {
      if (typeof checkResponse.text === 'function') {
        const raw = await checkResponse.text();
        checkBody = raw ? JSON.parse(raw) : null;
      } else if (typeof checkResponse.json === 'function') {
        checkBody = await checkResponse.json();
      }
    } catch (_err) {
      checkBody = null;
    }
    const decision = evaluateAuthzResponse({
      rule,
      hasBearerToken,
      checkStatus: checkResponse.status,
      checkBody,
    });

    emitAuditEvent({
      userId: checkBody?.userId || null,
      organizationId,
      eventType: decision.proceed ? 'RBAC_ACCESS_GRANTED' : 'RBAC_ACCESS_DENIED',
      action: 'gateway.permission_check',
      permissionKey: rule.permissionKey,
      ipAddress,
      userAgent,
      outcome: decision.proceed ? 'success' : 'failure',
      failureReason: decision.proceed ? null : (checkBody?.reason || 'PERMISSION_DENIED'),
      metadata: {
        method: req.method,
        path: routePath,
        reason: checkBody?.reason || null,
      },
    });

    if (!decision.proceed) {
      return reply.code(decision.statusCode).send(decision.body);
    }

    req.authzContext = {
      userId: tokenUserId || null,
      roles: tokenRoles,
      permissionKey: rule.permissionKey,
      organizationId,
      branchId,
      membershipChecked: !!organizationId,
    };
  } catch (err) {
    req.log.error({ err, routePath, permissionKey: rule.permissionKey }, 'RBAC enforcement failed');
    return reply.code(503).send({ message: 'Authorization service unavailable' });
  }
}

function registerProxyRoute({ method, publicRoute = false, url, targetBase, targetPath, schema }) {
  const routeSchema = schema ? { ...schema } : undefined;
  if (routeSchema && String(method).toUpperCase() === 'GET') {
    delete routeSchema.body;
  }

  fastify.route({
    method,
    url,
    schema: routeSchema,
    config: { publicRoute },
    preHandler: [applyRateLimit, applyIdempotency, enforcePermission],
    handler: async (req, reply) => {
      try {
        const result = await forwardRequest(targetBase, req, reply, typeof targetPath === 'function' ? targetPath(req) : targetPath);
        if (req.idempotencyContext && result.statusCode >= 200 && result.statusCode < 500) {
          if (dbReady && mongoClient) {
            await mongoClient.db(dbName).collection('idempotency_keys').insertOne({
              key: req.idempotencyContext.key,
              scope: req.idempotencyContext.scope,
              route: req.idempotencyContext.route,
              requestHash: req.idempotencyContext.requestHash,
              responseStatus: result.statusCode,
              responseBody: result.body,
              createdAt: new Date(),
            });
          } else {
            memoryIdempotency.set(req.idempotencyContext.memKey, {
              requestHash: req.idempotencyContext.requestHash,
              responseStatus: result.statusCode,
              responseBody: result.body,
              createdAt: Date.now(),
            });
          }
        }
        reply.code(result.statusCode).header('content-type', result.contentType);
        if (typeof result.body === 'undefined' || result.body === null) return reply.send();
        return reply.send(result.body);
      } catch (err) {
        req.log.error({ err, url }, 'Downstream request failed');
        return reply.code(502).send({ message: 'Downstream service unavailable', code: 'DOWNSTREAM_UNAVAILABLE' });
      }
    },
  });
}

function registerAuthRoutes() {
  registerProxyRoute({
    method: 'POST',
    url: '/auth/login',
    publicRoute: true,
    targetBase: authApiBaseUrl,
    targetPath: '/login',
    schema: {
      tags: ['Auth'],
      summary: 'Login using NIN, phone, or email',
      description:
        'NIN bootstrap accepts DDMMYYYY DOB only when password is not set. Phone/email login remains disabled until contact is set/verified and password is set.',
      body: {
        type: 'object',
        required: ['method', 'password'],
        properties: {
          method: { type: 'string', enum: ['nin', 'phone', 'email'] },
          nin: { type: 'string', pattern: '^\\d{11}$' },
          phone: { type: 'string' },
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      response: standardResponses({ 200: { type: 'object' } }),
    },
  });

  const protectedAuthRoutes = [
    { method: 'POST', path: '/auth/password/set', upstream: '/password/set' },
    { method: 'POST', path: '/auth/password/change', upstream: '/password/change' },
    { method: 'GET', path: '/auth/me', upstream: '/me' },
    { method: 'POST', path: '/auth/context/switch', upstream: '/context/switch' },
    { method: 'POST', path: '/auth/contact/phone', upstream: '/contact/phone' },
    { method: 'POST', path: '/auth/contact/phone/verify', upstream: '/contact/phone/verify' },
    { method: 'POST', path: '/auth/contact/email', upstream: '/contact/email' },
    { method: 'POST', path: '/auth/contact/email/verify', upstream: '/contact/email/verify' },
  ];

  for (const route of protectedAuthRoutes) {
    registerProxyRoute({
      method: route.method,
      url: route.path,
      targetBase: authApiBaseUrl,
      targetPath: route.upstream,
      schema: {
        tags: ['Auth'],
        summary: `Proxy ${route.method} ${route.path}`,
        security: [{ bearerAuth: [] }],
        headers: authHeaderSchema(true),
        body: { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' } }),
      },
    });
  }

  registerProxyRoute({
    method: 'GET',
    url: '/auth/users/search',
    targetBase: authApiBaseUrl,
    targetPath: '/users/search',
    schema: {
      tags: ['Auth'],
      summary: 'Search identity users by NIN/BVN/email/phone/name',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
      response: standardResponses({ 200: { type: 'object' } }),
    },
  });

  const publicAuthRoutes = [
    { method: 'POST', path: '/auth/password/forgot', upstream: '/password/forgot' },
    { method: 'POST', path: '/auth/password/reset', upstream: '/password/reset' },
    { method: 'POST', path: '/auth/token/refresh', upstream: '/token/refresh' },
    { method: 'POST', path: '/auth/logout', upstream: '/logout' },
  ];

  for (const route of publicAuthRoutes) {
    registerProxyRoute({
      method: route.method,
      url: route.path,
      publicRoute: true,
      targetBase: authApiBaseUrl,
      targetPath: route.upstream,
      schema: {
        tags: ['Auth'],
        summary: `Proxy ${route.method} ${route.path}`,
        body: { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' } }),
      },
    });
  }
}

function registerNinRoutes() {
  registerProxyRoute({
    method: 'GET',
    url: '/nin/:nin',
    targetBase: authApiBaseUrl,
    targetPath: (req) => `/nin/${req.params.nin}`,
    schema: {
      tags: ['NIN Cache'],
      summary: 'Read NIN from local cache',
      params: { type: 'object', required: ['nin'], properties: { nin: { type: 'string', pattern: '^\\d{11}$' } } },
      headers: authHeaderSchema(true),
      security: [{ bearerAuth: [] }],
      response: standardResponses({ 200: { type: 'object' } }),
    },
  });

  registerProxyRoute({
    method: 'POST',
    url: '/nin/refresh/:nin',
    targetBase: authApiBaseUrl,
    targetPath: (req) => `/nin/refresh/${req.params.nin}`,
    schema: {
      tags: ['NIN Cache'],
      summary: 'Request NIN refresh (Phase 1 unavailable)',
      params: { type: 'object', required: ['nin'], properties: { nin: { type: 'string', pattern: '^\\d{11}$' } } },
      headers: authHeaderSchema(true),
      security: [{ bearerAuth: [] }],
      response: standardResponses({ 200: errorMessageSchema }),
    },
  });
}

function registerRbacRoutes() {
  const proxyRouteDefs = [
    ['GET', '/rbac/me/scope', '/rbac/me/scope'],
    ['POST', '/rbac/check', '/rbac/check'],
    ['POST', '/rbac/app/permissions', '/rbac/app/permissions'],
    ['GET', '/rbac/app/permissions', '/rbac/app/permissions'],
    ['POST', '/rbac/app/roles', '/rbac/app/roles'],
    ['GET', '/rbac/app/roles', '/rbac/app/roles'],
    ['PATCH', '/rbac/app/roles/:roleId', '/rbac/app/roles/:roleId'],
    ['DELETE', '/rbac/app/roles/:roleId', '/rbac/app/roles/:roleId'],
    ['POST', '/rbac/app/users/:userId/roles', '/rbac/app/users/:userId/roles'],
    ['POST', '/rbac/app/users/:userId/overrides', '/rbac/app/users/:userId/overrides'],
    ['GET', '/rbac/app/users/:userId/access', '/rbac/app/users/:userId/access'],
    ['POST', '/rbac/org/:organizationId/permissions', '/rbac/org/:organizationId/permissions'],
    ['GET', '/rbac/org/:organizationId/permissions', '/rbac/org/:organizationId/permissions'],
    ['POST', '/rbac/org/:organizationId/roles', '/rbac/org/:organizationId/roles'],
    ['GET', '/rbac/org/:organizationId/roles', '/rbac/org/:organizationId/roles'],
    ['PATCH', '/rbac/org/:organizationId/roles/:roleId', '/rbac/org/:organizationId/roles/:roleId'],
    ['DELETE', '/rbac/org/:organizationId/roles/:roleId', '/rbac/org/:organizationId/roles/:roleId'],
    ['POST', '/rbac/org/:organizationId/users/:userId/roles', '/rbac/org/:organizationId/users/:userId/roles'],
    ['POST', '/rbac/org/:organizationId/users/:userId/overrides', '/rbac/org/:organizationId/users/:userId/overrides'],
    ['GET', '/rbac/org/:organizationId/users/:userId/access', '/rbac/org/:organizationId/users/:userId/access'],
  ];

  for (const [method, pathPattern, upstreamPattern] of proxyRouteDefs) {
    registerProxyRoute({
      method,
      url: pathPattern,
      targetBase: rbacApiBaseUrl,
      targetPath: (req) => {
        let p = upstreamPattern;
        for (const [k, v] of Object.entries(req.params || {})) {
          p = p.replace(`:${k}`, encodeURIComponent(String(v)));
        }
        return p;
      },
      schema: {
        tags: ['RBAC'],
        summary: `Proxy ${method} ${pathPattern}`,
        security: [{ bearerAuth: [] }],
        headers: authHeaderSchema(true),
        params: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' } }),
      },
    });
  }
}

function registerAuditRoutes() {
  registerProxyRoute({
    method: 'GET',
    url: '/audit/events',
    targetBase: auditApiBaseUrl,
    targetPath: '/audit/events',
    schema: {
      tags: ['Audit'],
      summary: 'List audit events (admin)',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      querystring: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          eventType: { type: 'string' },
          organizationId: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      response: standardResponses({ 200: { type: 'object' } }),
    },
  });

  registerProxyRoute({
    method: 'GET',
    url: '/audit/events/:eventId',
    targetBase: auditApiBaseUrl,
    targetPath: (req) => `/audit/events/${req.params.eventId}`,
    schema: {
      tags: ['Audit'],
      summary: 'Get one audit event (admin)',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      params: {
        type: 'object',
        required: ['eventId'],
        properties: {
          eventId: { type: 'string' },
        },
      },
      response: standardResponses({ 200: { type: 'object' }, 404: errorMessageSchema }),
    },
  });
}

function registerProfileRoutes() {
  registerProxyRoute({
    method: 'GET',
    url: '/profile/me',
    targetBase: profileApiBaseUrl,
    targetPath: '/profile/me',
    schema: {
      tags: ['Profile'],
      summary: 'Get merged self profile',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      response: standardResponses({ 200: { type: 'object' } }),
    },
  });

  registerProxyRoute({
    method: 'PATCH',
    url: '/profile/me',
    targetBase: profileApiBaseUrl,
    targetPath: '/profile/me',
    schema: {
      tags: ['Profile'],
      summary: 'Update editable self profile fields',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      body: { type: 'object', additionalProperties: true },
      response: standardResponses({ 200: { type: 'object' } }),
    },
  });

  registerProxyRoute({
    method: 'POST',
    url: '/profile/me/request-nin-refresh',
    targetBase: profileApiBaseUrl,
    targetPath: '/profile/me/request-nin-refresh',
    schema: {
      tags: ['Profile'],
      summary: 'Request NIN refresh for self profile',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      response: standardResponses({ 200: { type: 'object' } }),
    },
  });

  registerProxyRoute({
    method: 'GET',
    url: '/profile/me/status',
    targetBase: profileApiBaseUrl,
    targetPath: '/profile/me/status',
    schema: {
      tags: ['Profile'],
      summary: 'Get onboarding status and completeness',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      response: standardResponses({ 200: { type: 'object' } }),
    },
  });

  registerProxyRoute({
    method: 'GET',
    url: '/profile/search',
    targetBase: profileApiBaseUrl,
    targetPath: '/profile/search',
    schema: {
      tags: ['Profile'],
      summary: 'Search profiles (staff/admin)',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      querystring: { type: 'object', additionalProperties: true },
      response: standardResponses({ 200: { type: 'object' } }),
    },
  });

  registerProxyRoute({
    method: 'GET',
    url: '/profile/:userId',
    targetBase: profileApiBaseUrl,
    targetPath: (req) => `/profile/${req.params.userId}`,
    schema: {
      tags: ['Profile'],
      summary: 'Get profile by userId (staff/admin)',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      params: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } },
      response: standardResponses({ 200: { type: 'object' }, 404: errorMessageSchema }),
    },
  });

  registerProxyRoute({
    method: 'GET',
    url: '/profile/by-nin/:nin',
    targetBase: profileApiBaseUrl,
    targetPath: (req) => `/profile/by-nin/${req.params.nin}`,
    schema: {
      tags: ['Profile'],
      summary: 'Get profile or registration status by NIN',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      params: { type: 'object', required: ['nin'], properties: { nin: { type: 'string', pattern: '^\\d{11}$' } } },
      response: standardResponses({ 200: { type: 'object' } }),
    },
  });

  registerProxyRoute({
    method: 'POST',
    url: '/profile/create-placeholder',
    targetBase: profileApiBaseUrl,
    targetPath: '/profile/create-placeholder',
    schema: {
      tags: ['Profile'],
      summary: 'Create placeholder reference by NIN',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      body: {
        type: 'object',
        required: ['nin'],
        properties: {
          nin: { type: 'string', pattern: '^\\d{11}$' },
          note: { type: 'string' },
        },
      },
      response: standardResponses({ 201: { type: 'object' } }),
    },
  });
}

function registerOrganizationMembershipRoutes() {
  const orgRoutes = [
    ['POST', '/orgs', '/orgs'],
    ['GET', '/orgs', '/orgs'],
    ['GET', '/orgs/search', '/orgs/search'],
    ['GET', '/orgs/:orgId', '/orgs/:orgId'],
    ['PATCH', '/orgs/:orgId', '/orgs/:orgId'],
    ['PATCH', '/orgs/:orgId/owner', '/orgs/:orgId/owner'],
    ['POST', '/orgs/:orgId/assign-owner', '/orgs/:orgId/assign-owner'],
    ['POST', '/orgs/:orgId/branches', '/orgs/:orgId/branches'],
    ['GET', '/orgs/:orgId/branches', '/orgs/:orgId/branches'],
    ['GET', '/orgs/:orgId/branches/:branchId', '/orgs/:orgId/branches/:branchId'],
    ['PATCH', '/orgs/:orgId/branches/:branchId', '/orgs/:orgId/branches/:branchId'],
    ['DELETE', '/orgs/:orgId/branches/:branchId', '/orgs/:orgId/branches/:branchId'],
  ];

  for (const [method, routePath, upstreamPath] of orgRoutes) {
    registerProxyRoute({
      method,
      url: routePath,
      targetBase: organizationApiBaseUrl,
      targetPath: (req) => {
        let p = upstreamPath;
        for (const [k, v] of Object.entries(req.params || {})) {
          p = p.replace(`:${k}`, encodeURIComponent(String(v)));
        }
        return p;
      },
      schema: {
        tags: ['Organization'],
        summary: `Proxy ${method} ${routePath}`,
        description: 'Organization and branch management endpoints.',
        security: [{ bearerAuth: [] }],
        headers: authHeaderSchema(true),
        params: { type: 'object', additionalProperties: true },
        querystring: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' }, 201: { type: 'object' } }),
      },
    });
  }

  const membershipRoutes = [
    ['POST', '/orgs/:orgId/members', '/orgs/:orgId/members'],
    ['GET', '/orgs/:orgId/members', '/orgs/:orgId/members'],
    ['GET', '/orgs/:orgId/members/:memberId', '/orgs/:orgId/members/:memberId'],
    ['PATCH', '/orgs/:orgId/members/:memberId', '/orgs/:orgId/members/:memberId'],
    ['PATCH', '/orgs/:orgId/members/:memberId/status', '/orgs/:orgId/members/:memberId/status'],
    ['POST', '/orgs/:orgId/members/:memberId/branches', '/orgs/:orgId/members/:memberId/branches'],
    ['PATCH', '/orgs/:orgId/members/:memberId/branches/:assignmentId', '/orgs/:orgId/members/:memberId/branches/:assignmentId'],
    ['DELETE', '/orgs/:orgId/members/:memberId/branches/:assignmentId', '/orgs/:orgId/members/:memberId/branches/:assignmentId'],
    ['POST', '/orgs/:orgId/members/:memberId/transfer', '/orgs/:orgId/members/:memberId/transfer'],
    ['GET', '/orgs/:orgId/members/:memberId/history', '/orgs/:orgId/members/:memberId/history'],
    ['POST', '/orgs/:orgId/memberships/invite', '/orgs/:orgId/memberships/invite'],
    ['POST', '/orgs/:orgId/memberships/:membershipId/branches', '/orgs/:orgId/memberships/:membershipId/branches'],
    ['PATCH', '/orgs/:orgId/memberships/:membershipId/branches/:branchId', '/orgs/:orgId/memberships/:membershipId/branches/:branchId'],
    ['GET', '/orgs/:orgId/memberships', '/orgs/:orgId/memberships'],
    ['GET', '/orgs/:orgId/memberships/:membershipId', '/orgs/:orgId/memberships/:membershipId'],
    ['GET', '/users/:userId/memberships', '/users/:userId/memberships'],
    ['GET', '/users/:userId/movement-history', '/users/:userId/movement-history'],
  ];

  for (const [method, routePath, upstreamPath] of membershipRoutes) {
    registerProxyRoute({
      method,
      url: routePath,
      targetBase: membershipApiBaseUrl,
      targetPath: (req) => {
        let p = upstreamPath;
        for (const [k, v] of Object.entries(req.params || {})) {
          p = p.replace(`:${k}`, encodeURIComponent(String(v)));
        }
        return p;
      },
      schema: {
        tags: ['Membership'],
        summary: `Proxy ${method} ${routePath}`,
        description: 'Organization staff onboarding, branch assignment, transfer, and history endpoints.',
        security: [{ bearerAuth: [] }],
        headers: authHeaderSchema(true),
        params: { type: 'object', additionalProperties: true },
        querystring: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' }, 201: { type: 'object' } }),
      },
    });
  }

}

function registerHealthRecordsRoutes() {
  const routes = [
    ['GET', '/records/me', '/records/me'],
    ['GET', '/records/:nin', '/records/:nin'],
    ['POST', '/records/me/symptoms', '/records/me/symptoms'],
    ['POST', '/records/:nin/entries', '/records/:nin/entries'],
    ['PATCH', '/records/entries/:entryId', '/records/entries/:entryId'],
    ['POST', '/records/entries/:entryId/hide', '/records/entries/:entryId/hide'],
  ];

  for (const [method, routePath, upstreamPath] of routes) {
    registerProxyRoute({
      method,
      url: routePath,
      targetBase: healthRecordsIndexApiBaseUrl,
      targetPath: (req) => {
        let p = upstreamPath;
        for (const [k, v] of Object.entries(req.params || {})) {
          p = p.replace(`:${k}`, encodeURIComponent(String(v)));
        }
        return p;
      },
      schema: {
        tags: ['Health Records'],
        summary: `Proxy ${method} ${routePath}`,
        description: 'Citizen/provider timeline metadata endpoints.',
        security: [{ bearerAuth: [] }],
        headers: authHeaderSchema(true),
        params: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' }, 201: { type: 'object' } }),
      },
    });
  }
}

function registerProviderRecordsRoutes() {
  const routeDefs = [
    ['POST', '/encounters/:nin', clinicalEncounterApiBaseUrl, '/encounters/:nin'],
    ['GET', '/encounters/:nin', clinicalEncounterApiBaseUrl, '/encounters/:nin'],
    ['GET', '/encounters/id/:encounterId', clinicalEncounterApiBaseUrl, '/encounters/id/:encounterId'],
    ['PATCH', '/encounters/id/:encounterId', clinicalEncounterApiBaseUrl, '/encounters/id/:encounterId'],
    ['POST', '/labs/:nin/results', laboratoryResultApiBaseUrl, '/labs/:nin/results'],
    ['GET', '/labs/:nin/results', laboratoryResultApiBaseUrl, '/labs/:nin/results'],
    ['GET', '/labs/results/id/:resultId', laboratoryResultApiBaseUrl, '/labs/results/id/:resultId'],
    ['PATCH', '/labs/results/id/:resultId', laboratoryResultApiBaseUrl, '/labs/results/id/:resultId'],
    ['POST', '/pharmacy/:nin/dispenses', pharmacyDispenseApiBaseUrl, '/pharmacy/:nin/dispenses'],
    ['GET', '/pharmacy/:nin/dispenses', pharmacyDispenseApiBaseUrl, '/pharmacy/:nin/dispenses'],
    ['GET', '/pharmacy/dispenses/id/:dispenseId', pharmacyDispenseApiBaseUrl, '/pharmacy/dispenses/id/:dispenseId'],
    ['PATCH', '/pharmacy/dispenses/id/:dispenseId', pharmacyDispenseApiBaseUrl, '/pharmacy/dispenses/id/:dispenseId'],
  ];

  for (const [method, routePath, targetBase, upstreamPath] of routeDefs) {
    registerProxyRoute({
      method,
      url: routePath,
      targetBase,
      targetPath: (req) => {
        let p = upstreamPath;
        for (const [k, v] of Object.entries(req.params || {})) {
          p = p.replace(`:${k}`, encodeURIComponent(String(v)));
        }
        return p;
      },
      schema: {
        tags: ['Provider Records'],
        summary: `Proxy ${method} ${routePath}`,
        description: 'Clinical encounter, laboratory result, and pharmacy dispense content endpoints.',
        security: [{ bearerAuth: [] }],
        headers: authHeaderSchema(true),
        params: { type: 'object', additionalProperties: true },
        querystring: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' }, 201: { type: 'object' }, 502: errorMessageSchema }),
      },
    });
  }
}

function registerDoctorRegistryRoutes() {
  const routeDefs = [
    ['POST', '/doctors/register', '/doctors/register'],
    ['GET', '/doctors/search', '/doctors/search'],
    ['GET', '/doctors/:doctorId', '/doctors/:doctorId'],
    ['POST', '/licenses/:doctorId/verify', '/licenses/:doctorId/verify'],
    ['POST', '/licenses/:doctorId/suspend', '/licenses/:doctorId/suspend'],
    ['POST', '/licenses/:doctorId/revoke', '/licenses/:doctorId/revoke'],
    ['POST', '/licenses/:doctorId/reinstate', '/licenses/:doctorId/reinstate'],
  ];

  for (const [method, routePath, upstreamPath] of routeDefs) {
    registerProxyRoute({
      method,
      url: routePath,
      targetBase: doctorRegistryApiBaseUrl,
      targetPath: (req) => {
        let p = upstreamPath;
        for (const [k, v] of Object.entries(req.params || {})) {
          p = p.replace(`:${k}`, encodeURIComponent(String(v)));
        }
        return p;
      },
      publicRoute: method === 'GET' && routePath === '/doctors/search',
      schema: {
        tags: ['Doctor Registry'],
        summary: `Proxy ${method} ${routePath}`,
        description: 'Doctor registration, public verification lookup, and license governance endpoints.',
        security: method === 'GET' && routePath === '/doctors/search' ? [] : [{ bearerAuth: [] }],
        headers: authHeaderSchema(true),
        params: { type: 'object', additionalProperties: true },
        querystring: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' }, 201: { type: 'object' } }),
      },
    });
  }
}

function registerUiThemeRoutes() {
  const routeDefs = [
    ['GET', '/ui/theme/platform', '/ui/theme/platform'],
    ['GET', '/ui/theme/effective', '/ui/theme/effective'],
    ['GET', '/ui/theme', '/ui/theme'],
    ['POST', '/ui/theme', '/ui/theme'],
    ['PATCH', '/ui/theme/:id', '/ui/theme/:id'],
    ['POST', '/ui/theme/:id/logo', '/ui/theme/:id/logo'],
    ['DELETE', '/ui/theme/:id', '/ui/theme/:id'],
  ];

  for (const [method, routePath, upstreamPath] of routeDefs) {
    registerProxyRoute({
      method,
      url: routePath,
      publicRoute: method === 'GET' && (routePath === '/ui/theme/platform' || routePath === '/ui/theme/effective'),
      targetBase: uiThemeApiBaseUrl,
      targetPath: (req) => {
        let p = upstreamPath;
        for (const [k, v] of Object.entries(req.params || {})) {
          p = p.replace(`:${k}`, encodeURIComponent(String(v)));
        }
        return p;
      },
      schema: {
        tags: ['UI Theme'],
        summary: `Proxy ${method} ${routePath}`,
        description: routePath === '/ui/theme/effective'
          ? 'Returns effective UI theme for context switching by merging platform, parent and tenant theme tokens.'
          : undefined,
        security: method === 'GET' && (routePath === '/ui/theme/platform' || routePath === '/ui/theme/effective')
          ? []
          : [{ bearerAuth: [] }],
        headers: authHeaderSchema(!(method === 'GET' && (routePath === '/ui/theme/platform' || routePath === '/ui/theme/effective'))),
        querystring: routePath === '/ui/theme/effective'
          ? {
            type: 'object',
            required: ['scope_type'],
            properties: {
              scope_type: { type: 'string', enum: ['platform', 'organization', 'state', 'taskforce'] },
              scope_id: { type: 'string' },
            },
          }
          : { type: 'object', additionalProperties: true },
        params: { type: 'object', additionalProperties: true },
        body: routePath === '/ui/theme/:id/logo'
          ? {
            type: 'object',
            properties: {
              lightUrl: { type: 'string' },
              darkUrl: { type: 'string' },
              markUrl: { type: 'string' },
              upload: {
                type: 'object',
                properties: {
                  variant: { type: 'string', enum: ['light', 'dark', 'mark'] },
                  filename: { type: 'string' },
                  contentType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/svg+xml'] },
                  contentBase64: { type: 'string' },
                },
                required: ['variant', 'contentType', 'contentBase64'],
              },
            },
          }
          : { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' }, 201: { type: 'object' }, 304: { type: 'null' } }),
      },
    });
  }
}

function registerEmergencyRoutes() {
  const routeDefs = [
    ['POST', '/emergency/requests', '/emergency/requests'],
    ['GET', '/emergency/requests', '/emergency/requests'],
    ['GET', '/emergency/requests/:requestId', '/emergency/requests/:requestId'],
    ['PATCH', '/emergency/requests/:requestId/status', '/emergency/requests/:requestId/status'],
    ['POST', '/emergency/requests/:requestId/responses', '/emergency/requests/:requestId/responses'],
    ['GET', '/emergency/requests/:requestId/responses', '/emergency/requests/:requestId/responses'],
    ['GET', '/emergency/requests/:requestId/room', '/emergency/requests/:requestId/room'],
    ['POST', '/emergency/rooms/:roomId/messages', '/emergency/rooms/:roomId/messages'],
    ['GET', '/emergency/rooms/:roomId/messages', '/emergency/rooms/:roomId/messages'],
    ['PUT', '/emergency/inventory/me', '/emergency/inventory/me'],
    ['GET', '/emergency/inventory/search', '/emergency/inventory/search'],
  ];

  for (const [method, routePath, upstreamPath] of routeDefs) {
    registerProxyRoute({
      method,
      url: routePath,
      targetBase: emergencyInventoryApiBaseUrl,
      targetPath: (req) => {
        let p = upstreamPath;
        for (const [k, v] of Object.entries(req.params || {})) {
          p = p.replace(`:${k}`, encodeURIComponent(String(v)));
        }
        return p;
      },
      schema: {
        tags: ['Emergency'],
        summary: `Proxy ${method} ${routePath}`,
        description: 'Emergency requests, provider responses, incident rooms, and inventory discovery endpoints.',
        security: [{ bearerAuth: [] }],
        headers: authHeaderSchema(true),
        params: { type: 'object', additionalProperties: true },
        querystring: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' }, 201: { type: 'object' } }),
      },
    });
  }
}

function registerGovernanceTaskforceRoutes() {
  const routeDefs = [
    ['POST', '/taskforce/units', taskforceDirectoryApiBaseUrl, '/taskforce/units'],
    ['GET', '/taskforce/units', taskforceDirectoryApiBaseUrl, '/taskforce/units'],
    ['PATCH', '/taskforce/units/:unitId', taskforceDirectoryApiBaseUrl, '/taskforce/units/:unitId'],
    ['POST', '/taskforce/units/:unitId/members', taskforceDirectoryApiBaseUrl, '/taskforce/units/:unitId/members'],
    ['GET', '/taskforce/units/:unitId/members', taskforceDirectoryApiBaseUrl, '/taskforce/units/:unitId/members'],
    ['DELETE', '/taskforce/units/:unitId/members/:memberId', taskforceDirectoryApiBaseUrl, '/taskforce/units/:unitId/members/:memberId'],
    ['POST', '/cases', caseApiBaseUrl, '/cases'],
    ['GET', '/cases', caseApiBaseUrl, '/cases'],
    ['GET', '/cases/:caseId', caseApiBaseUrl, '/cases/:caseId'],
    ['PATCH', '/cases/:caseId/status', caseApiBaseUrl, '/cases/:caseId/status'],
    ['POST', '/cases/:caseId/corrections/propose', caseApiBaseUrl, '/cases/:caseId/corrections/propose'],
    ['POST', '/cases/:caseId/corrections/approve', caseApiBaseUrl, '/cases/:caseId/corrections/approve'],
    ['POST', '/cases/:caseId/corrections/reject', caseApiBaseUrl, '/cases/:caseId/corrections/reject'],
    ['GET', '/cases/:caseId/room', caseApiBaseUrl, '/cases/:caseId/room'],
    ['POST', '/case-rooms/:roomId/messages', caseApiBaseUrl, '/case-rooms/:roomId/messages'],
    ['GET', '/case-rooms/:roomId/messages', caseApiBaseUrl, '/case-rooms/:roomId/messages'],
    ['POST', '/cases/:caseId/escalate', caseApiBaseUrl, '/cases/:caseId/escalate'],
  ];

  for (const [method, routePath, targetBase, upstreamPath] of routeDefs) {
    registerProxyRoute({
      method,
      url: routePath,
      targetBase,
      targetPath: (req) => {
        let p = upstreamPath;
        for (const [k, v] of Object.entries(req.params || {})) {
          p = p.replace(`:${k}`, encodeURIComponent(String(v)));
        }
        return p;
      },
      schema: {
        tags: ['Governance'],
        summary: `Proxy ${method} ${routePath}`,
        description: 'Taskforce directory, case lifecycle, correction workflow, and case room endpoints.',
        security: [{ bearerAuth: [] }],
        headers: authHeaderSchema(true),
        params: { type: 'object', additionalProperties: true },
        querystring: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
        response: standardResponses({ 200: { type: 'object' }, 201: { type: 'object' } }),
      },
    });
  }
}

async function registerDocs() {
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'NHRS Gateway API',
        description:
          'Gateway docs for NHRS Auth + NIN Cache + RBAC + Audit. Includes rate limiting (429), lockout (423), and RBAC precedence: user overrides > role permissions.',
        version: '1.1.0',
      },
      servers: [
        { url: 'http://localhost', description: 'Local via nginx' },
        { url: `http://localhost:${port}`, description: 'Direct api-gateway port' },
      ],
      tags: [
        { name: 'Health', description: 'Service health endpoints' },
        { name: 'Auth', description: 'Authentication and account setup endpoints' },
        { name: 'NIN Cache', description: 'Local NIN cache endpoints' },
        { name: 'RBAC', description: 'Role/permission/override endpoints' },
        { name: 'Audit', description: 'Audit event query endpoints' },
        { name: 'Profile', description: 'User profile and onboarding endpoints' },
        { name: 'Organization', description: 'Organization and branch endpoints' },
        { name: 'Membership', description: 'Membership and branch assignment endpoints' },
        { name: 'Health Records', description: 'Citizen/provider timeline metadata endpoints' },
        { name: 'Provider Records', description: 'Provider clinical content modules (encounters, labs, pharmacy)' },
        { name: 'Emergency', description: 'Emergency requests, provider responses, incident rooms, and inventory discovery' },
        { name: 'Governance', description: 'Taskforce directory, cases, correction workflow, and escalation' },
        { name: 'Doctor Registry', description: 'Doctor registration, verification, and license governance endpoints' },
        { name: 'UI Theme', description: 'UI branding and accessibility defaults by platform/org/state/taskforce context' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });

  fastify.get('/openapi.json', {
    schema: { tags: ['Health'], summary: 'Raw OpenAPI JSON', hide: true },
  }, async () => fastify.swagger());
}

async function registerCors() {
  await fastify.register(cors, {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'x-request-id',
      'x-active-context-id',
      'x-org-id',
      'x-branch-id',
      'idempotency-key',
    ],
    exposedHeaders: ['x-request-id'],
    maxAge: 86400,
    origin(origin, cb) {
      // Allow non-browser clients (curl, health probes) without Origin header.
      if (!origin) {
        cb(null, true);
        return;
      }
      if (appEnv === 'development') {
        try {
          const parsed = new URL(origin);
          if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
            cb(null, true);
            return;
          }
        } catch (_err) {
          // fall through to explicit allowlist check
        }
      }
      if (corsOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('CORS_NOT_ALLOWED'), false);
    },
  });
}

fastify.get('/health', {
  schema: {
    tags: ['Health'],
    summary: 'API Gateway health check',
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          service: { type: 'string' },
          dbReady: { type: 'boolean' },
          dbName: { type: ['string', 'null'] },
        },
      },
    },
  },
}, async () => ({ status: 'ok', service: serviceName, dbReady, dbName: dbName || null }));

async function registerGatewayRoutes() {
  if (routesRegistered) return;
  await registerCors();
  await registerDocs();
  registerAuthRoutes();
  registerNinRoutes();
  registerRbacRoutes();
  registerAuditRoutes();
  registerProfileRoutes();
  registerOrganizationMembershipRoutes();
  registerHealthRecordsRoutes();
  registerProviderRecordsRoutes();
  registerDoctorRegistryRoutes();
  registerEmergencyRoutes();
  registerGovernanceTaskforceRoutes();
  registerUiThemeRoutes();
  routesRegistered = true;
}

fastify.addHook('onRequest', async (req) => {
  req.headers['x-request-id'] = getRequestId(req);
});

fastify.addHook('onSend', async (req, reply, payload) => {
  reply.header('x-request-id', req.headers['x-request-id'] || getRequestId(req));
  return payload;
});

setStandardErrorHandler(fastify);

const start = async () => {
  try {
    enforceProductionSecrets({
      env: process.env,
      required: ['INTERNAL_SERVICE_TOKEN', 'NHRS_CONTEXT_HMAC_SECRET', 'JWT_SECRET'],
      secrets: ['INTERNAL_SERVICE_TOKEN', 'NHRS_CONTEXT_HMAC_SECRET', 'JWT_SECRET'],
    });
    await connectToMongo();
    await connectToRedis();
    startOutboxWorker();
    await registerGatewayRoutes();

    if (docsExportPath) {
      await fastify.ready();
      const spec = fastify.swagger();
      const absolutePath = path.resolve(docsExportPath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, JSON.stringify(spec, null, 2), 'utf8');
      fastify.log.info({ docsExportPath: absolutePath }, 'OpenAPI spec generated');
      process.exit(0);
    }

    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  try {
    if (outboxTimer) clearInterval(outboxTimer);
    if (redisClient) {
      await redisClient.quit();
    }
    if (mongoClient) {
      await mongoClient.close();
    }
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

async function buildApp(options = {}) {
  if (options.resetState !== false) {
    memoryRateLimitBuckets.clear();
    memoryIdempotency.clear();
  }
  if (Object.prototype.hasOwnProperty.call(options, 'dbReady')) {
    dbReady = !!options.dbReady;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'redisReady')) {
    redisReady = !!options.redisReady;
  }
  if (options.redisClient) {
    redisClient = options.redisClient;
  }
  if (options.fetchImpl) {
    fetchClient = options.fetchImpl;
  }
  if (options.registerRoutes !== false) {
    await registerGatewayRoutes();
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

