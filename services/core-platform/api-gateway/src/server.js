const fs = require('fs');
const path = require('path');
const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion } = require('mongodb');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');

const serviceName = 'api-gateway';
const port = Number(process.env.PORT) || 8080;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
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

const tokenBundleSchema = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    expiresIn: { type: 'integer', example: 900 },
    jti: { type: 'string' },
    requiresPasswordChange: { type: 'boolean' },
    user: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nin: { type: 'string' },
        email: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        phoneVerified: { type: 'boolean' },
        emailVerified: { type: 'boolean' },
        roles: { type: 'array', items: { type: 'string' } },
        status: { type: 'string' },
        requiresPasswordChange: { type: 'boolean' },
        passwordSetAt: { type: ['string', 'null'], format: 'date-time' },
        scope: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

function authHeaderSchema(required) {
  return {
    type: 'object',
    properties: {
      authorization: { type: 'string', pattern: '^Bearer\\s.+' },
    },
    ...(required ? { required: ['authorization'] } : {}),
  };
}

function standardResponses(extra) {
  return {
    400: validationErrorSchema,
    401: unauthorizedSchema,
    403: errorMessageSchema,
    429: errorMessageSchema,
    503: errorMessageSchema,
    ...extra,
  };
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

async function forwardToAuthApi(req, reply, targetPath) {
  const url = `${authApiBaseUrl}${targetPath}`;
  const headers = {
    'content-type': 'application/json',
  };

  if (req.headers.authorization) {
    headers.authorization = req.headers.authorization;
  }

  try {
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
  } catch (err) {
    req.log.error({ err, url }, 'Downstream request failed');
    return reply.code(502).send({ message: 'Downstream service unavailable' });
  }
}

function registerAuthRoutes() {
  fastify.post('/auth/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login using NIN, phone, or email',
      description:
        'NIN bootstrap accepts DDMMYYYY DOB only when password is not set. Phone/email login are disabled until password is set and contact is verified.',
      body: {
        type: 'object',
        required: ['method', 'password'],
        properties: {
          method: { type: 'string', enum: ['nin', 'phone', 'email'] },
          nin: { type: 'string', pattern: '^\\d{11}$' },
          phone: { type: 'string' },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
      response: standardResponses({
        200: tokenBundleSchema,
      }),
      examples: [
        {
          summary: 'NIN bootstrap',
          value: {
            method: 'nin',
            nin: '90000000001',
            password: '01011985',
          },
        },
      ],
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/login'));

  fastify.post('/auth/password/set', {
    schema: {
      tags: ['Auth'],
      summary: 'Set first password after NIN bootstrap',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      body: {
        type: 'object',
        required: ['newPassword'],
        properties: {
          newPassword: { type: 'string', minLength: 8 },
        },
      },
      response: standardResponses({
        200: { type: 'object', properties: { message: { type: 'string' } } },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/password/set'));

  fastify.post('/auth/password/change', {
    schema: {
      tags: ['Auth'],
      summary: 'Change password for authenticated user',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1 },
          newPassword: { type: 'string', minLength: 8 },
        },
      },
      response: standardResponses({
        200: { type: 'object', properties: { message: { type: 'string' } } },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/password/change'));

  fastify.post('/auth/password/forgot', {
    schema: {
      tags: ['Auth'],
      summary: 'Request OTP for password reset',
      description:
        'Recovery works only for verified phone/email. If neither is verified, continue with NIN bootstrap support flow.',
      body: {
        type: 'object',
        required: ['channel', 'destination'],
        properties: {
          channel: { type: 'string', enum: ['phone', 'email'] },
          destination: { type: 'string' },
        },
      },
      response: standardResponses({
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            channel: { type: 'string' },
            destination: { type: 'string' },
          },
        },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/password/forgot'));

  fastify.post('/auth/password/reset', {
    schema: {
      tags: ['Auth'],
      summary: 'Reset password using OTP',
      body: {
        type: 'object',
        required: ['channel', 'destination', 'code', 'newPassword'],
        properties: {
          channel: { type: 'string', enum: ['phone', 'email'] },
          destination: { type: 'string' },
          code: { type: 'string', minLength: 4 },
          newPassword: { type: 'string', minLength: 8 },
        },
      },
      response: standardResponses({
        200: { type: 'object', properties: { message: { type: 'string' } } },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/password/reset'));

  fastify.post('/auth/token/refresh', {
    schema: {
      tags: ['Auth'],
      summary: 'Refresh access token',
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
      response: standardResponses({
        200: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            expiresIn: { type: 'integer' },
            jti: { type: 'string' },
          },
        },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/token/refresh'));

  fastify.post('/auth/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Revoke refresh token session',
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
      response: standardResponses({
        200: { type: 'object', properties: { message: { type: 'string' } } },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/logout'));

  fastify.get('/auth/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current user profile, roles, and scope',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      response: standardResponses({
        200: {
          type: 'object',
          properties: {
            user: tokenBundleSchema.properties.user,
          },
        },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/me'));

  fastify.post('/auth/contact/phone', {
    schema: {
      tags: ['Auth'],
      summary: 'Set phone and send verification OTP',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      body: {
        type: 'object',
        required: ['phone'],
        properties: {
          phone: { type: 'string' },
        },
      },
      response: standardResponses({
        200: { type: 'object', properties: { message: { type: 'string' } } },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/contact/phone'));

  fastify.post('/auth/contact/phone/verify', {
    schema: {
      tags: ['Auth'],
      summary: 'Verify phone OTP and enable phone login',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      body: {
        type: 'object',
        required: ['phone', 'code'],
        properties: {
          phone: { type: 'string' },
          code: { type: 'string' },
        },
      },
      response: standardResponses({
        200: { type: 'object', properties: { message: { type: 'string' } } },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/contact/phone/verify'));

  fastify.post('/auth/contact/email', {
    schema: {
      tags: ['Auth'],
      summary: 'Set email and send verification OTP',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
      response: standardResponses({
        200: { type: 'object', properties: { message: { type: 'string' } } },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/contact/email'));

  fastify.post('/auth/contact/email/verify', {
    schema: {
      tags: ['Auth'],
      summary: 'Verify email OTP and enable email login',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      body: {
        type: 'object',
        required: ['email', 'code'],
        properties: {
          email: { type: 'string', format: 'email' },
          code: { type: 'string' },
        },
      },
      response: standardResponses({
        200: { type: 'object', properties: { message: { type: 'string' } } },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/contact/email/verify'));
}

function registerNinCacheRoutes() {
  fastify.get('/nin/:nin', {
    schema: {
      tags: ['NIN Cache'],
      summary: 'Get NIN cache record',
      description: 'Reads from local NIN cache only.',
      params: {
        type: 'object',
        required: ['nin'],
        properties: {
          nin: { type: 'string', pattern: '^\\d{11}$' },
        },
      },
      response: standardResponses({
        200: {
          type: 'object',
          properties: {
            nin: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            otherName: { type: 'string' },
            dob: { type: 'string', description: 'DDMMYYYY' },
            gender: { type: 'string' },
            phone: { type: ['string', 'null'] },
            email: { type: ['string', 'null'] },
            source: { type: 'string' },
            isActive: { type: 'boolean' },
          },
        },
        404: errorMessageSchema,
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, `/nin/${req.params.nin}`));

  fastify.post('/nin/refresh/:nin', {
    schema: {
      tags: ['NIN Cache'],
      summary: 'Request NIN refresh',
      description: 'Marks refresh request, but external NIN fetch is unavailable in Phase 1.',
      params: {
        type: 'object',
        required: ['nin'],
        properties: {
          nin: { type: 'string', pattern: '^\\d{11}$' },
        },
      },
      response: standardResponses({
        200: errorMessageSchema,
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, `/nin/refresh/${req.params.nin}`));
}

function registerRbacRoutes() {
  fastify.get('/rbac/roles', {
    schema: {
      tags: ['RBAC'],
      summary: 'List roles',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      response: standardResponses({
        200: {
          type: 'object',
          properties: {
            roles: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  permissions: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/rbac/roles'));

  fastify.post('/rbac/roles', {
    schema: {
      tags: ['RBAC'],
      summary: 'Create or update role (admin only)',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          permissions: { type: 'array', items: { type: 'string' } },
        },
      },
      response: standardResponses({
        200: { type: 'object', properties: { message: { type: 'string' } } },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/rbac/roles'));

  fastify.post('/rbac/assign-role', {
    schema: {
      tags: ['RBAC'],
      summary: 'Assign role to user (admin only)',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      body: {
        type: 'object',
        required: ['userId', 'roleName'],
        properties: {
          userId: { type: 'string' },
          roleName: { type: 'string' },
        },
      },
      response: standardResponses({
        200: { type: 'object', properties: { message: { type: 'string' } } },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, '/rbac/assign-role'));

  fastify.get('/rbac/user/:userId/scope', {
    schema: {
      tags: ['RBAC'],
      summary: 'Get user scope (self or admin)',
      security: [{ bearerAuth: [] }],
      headers: authHeaderSchema(true),
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
        },
      },
      response: standardResponses({
        200: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            roles: { type: 'array', items: { type: 'string' } },
            scope: { type: 'array', items: { type: 'string' } },
          },
        },
      }),
    },
  }, async (req, reply) => forwardToAuthApi(req, reply, `/rbac/user/${req.params.userId}/scope`));
}

async function registerDocs() {
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'NHRS Gateway API',
        description:
          'Single source of truth for NHRS Phase 1 endpoints (Auth, NIN Cache, RBAC).',
        version: '1.0.0',
      },
      servers: [
        { url: 'http://localhost', description: 'Local via nginx' },
        { url: `http://localhost:${port}`, description: 'Direct api-gateway port' },
      ],
      tags: [
        { name: 'Health', description: 'Service health endpoints' },
        { name: 'Auth', description: 'Authentication and account setup endpoints' },
        { name: 'NIN Cache', description: 'Local NIN cache endpoints' },
        { name: 'RBAC', description: 'Role and scope endpoints' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });

  fastify.get('/openapi.json', {
    schema: {
      tags: ['Health'],
      summary: 'Raw OpenAPI JSON',
      hide: true,
    },
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
          status: { type: 'string', example: 'ok' },
          service: { type: 'string', example: 'api-gateway' },
          dbReady: { type: 'boolean', example: true },
          dbName: { type: ['string', 'null'] },
        },
      },
    },
  },
}, async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  dbName: dbName || null,
}));

const start = async () => {
  try {
    await connectToMongo();
    await registerDocs();
    registerAuthRoutes();
    registerNinCacheRoutes();
    registerRbacRoutes();

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

