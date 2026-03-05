const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion } = require('mongodb');
const { createClient } = require('redis');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');
const { findPermissionRule } = require('./permissions/registry');
const { evaluateAuthzResponse } = require('./authz');
const { buildAuditPayload } = require('./audit-utils');
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
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const membershipScopeCacheTtlSec = Number(process.env.MEMBERSHIP_SCOPE_CACHE_TTL_SEC) || 60;
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const nhrsContextTtlSeconds = Number(process.env.NHRS_CONTEXT_TTL_SECONDS) || 60;
const docsExportPath = process.env.DOCS_EXPORT_PATH;

let dbReady = false;
let mongoClient;
let redisClient;
let redisReady = false;
let fetchClient = (...args) => fetch(...args);
let routesRegistered = false;

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
  return {
    400: validationErrorSchema,
    401: unauthorizedSchema,
    423: errorMessageSchema,
    403: errorMessageSchema,
    429: errorMessageSchema,
    503: errorMessageSchema,
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

function emitAuditEvent(event) {
  const payload = buildAuditPayload(event);
  setImmediate(async () => {
    try {
      await fetchClient(`${auditApiBaseUrl}/internal/audit/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      fastify.log.warn({ err, eventType: payload?.eventType }, 'Gateway audit emit failed');
    }
  });
}

async function connectToMongo() {
  if (!mongoUri || !dbName) {
    fastify.log.warn('MONGODB_URI or DB_NAME not set; starting without database connection');
    return;
  }

  mongoClient = new MongoClient(mongoUri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  try {
    await mongoClient.connect();
    await mongoClient.db('admin').command({ ping: 1 });
    dbReady = true;
    fastify.log.info({ dbName }, 'MongoDB connection established');
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed; continuing without database connection');
  }
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
  reply.code(response.status);
  reply.header('content-type', contentType);

  if (!raw) {
    return reply.send();
  }

  try {
    return reply.send(JSON.parse(raw));
  } catch (_err) {
    return reply.send(raw);
  }
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

    const checkBody = await checkResponse.json();
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
    preHandler: enforcePermission,
    handler: async (req, reply) => {
      try {
        return await forwardRequest(targetBase, req, reply, typeof targetPath === 'function' ? targetPath(req) : targetPath);
      } catch (err) {
        req.log.error({ err, url }, 'Downstream request failed');
        return reply.code(502).send({ message: 'Downstream service unavailable' });
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
  routesRegistered = true;
}

const start = async () => {
  try {
    await connectToMongo();
    await connectToRedis();
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

async function buildApp(options = {}) {
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
