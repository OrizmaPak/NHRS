const fs = require('fs');
const path = require('path');
const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion } = require('mongodb');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');
const { findPermissionRule } = require('./permissions/registry');
const { evaluateAuthzResponse } = require('./authz');
const { buildAuditPayload } = require('./audit-utils');

const serviceName = 'api-gateway';
const port = Number(process.env.PORT) || 8080;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const docsExportPath = process.env.DOCS_EXPORT_PATH;

let dbReady = false;
let mongoClient;

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

function authHeaderSchema(required) {
  return {
    type: 'object',
    properties: {
      authorization: { type: 'string', pattern: '^Bearer\\s.+' },
      'x-org-id': { type: 'string' },
    },
    ...(required ? { required: ['authorization'] } : {}),
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

function emitAuditEvent(event) {
  const payload = buildAuditPayload(event);
  setImmediate(async () => {
    try {
      await fetch(`${auditApiBaseUrl}/internal/audit/events`, {
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

async function forwardRequest(baseUrl, req, reply, targetPath) {
  const url = `${baseUrl}${targetPath}`;
  const headers = { 'content-type': 'application/json' };
  if (req.headers.authorization) {
    headers.authorization = req.headers.authorization;
  }
  if (req.headers['x-org-id']) {
    headers['x-org-id'] = req.headers['x-org-id'];
  }

  const response = await fetch(url, {
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

  let organizationId = req.headers['x-org-id'] || null;
  if (rule.orgFrom === 'params.organizationId' && req.params?.organizationId) {
    organizationId = req.params.organizationId;
  }

  try {
    const checkResponse = await fetch(`${rbacApiBaseUrl}/rbac/check`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        permissionKey: rule.permissionKey,
        organizationId,
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

const start = async () => {
  try {
    await connectToMongo();
    await registerDocs();
    registerAuthRoutes();
    registerNinRoutes();
    registerRbacRoutes();
    registerAuditRoutes();

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
    if (mongoClient) {
      await mongoClient.close();
    }
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
