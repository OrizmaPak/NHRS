const fastifyFactory = require('fastify');
const multipart = require('@fastify/multipart');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { enforceProductionSecrets } = require('../../../../libs/shared/src/env');
const { setStandardErrorHandler } = require('../../../../libs/shared/src/errors');
const { createContextVerificationHook } = require('../../../../libs/shared/src/nhrs-context');
const { resolveTheme } = require('./theme-resolver');
const { logoTypeAllowlist, validateColorInput, validateContrast, isSafeSvg } = require('./validation');

const serviceName = 'ui-theme-service';
const port = Number(process.env.PORT) || 8111;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_ui_theme_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const fileDocumentApiBaseUrl = process.env.FILE_DOCUMENT_API_BASE_URL || 'http://file-document-service:8102';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const maxLogoBytes = Number(process.env.UI_THEME_MAX_LOGO_BYTES) || 3 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function buildRepository(db) {
  const col = () => db.collection('ui_themes');

  async function createIndexes() {
    await Promise.all([
      col().createIndex({ scope_type: 1, scope_id: 1, deletedAt: 1 }, { unique: true }),
      col().createIndex({ parent_theme_id: 1 }),
      col().createIndex({ updatedAt: -1 }),
    ]);
  }

  async function findById(id) {
    return col().findOne({ id, deletedAt: null });
  }

  async function findScopeTheme(scopeType, scopeId) {
    return col().findOne(
      { scope_type: scopeType, scope_id: scopeId ?? null, deletedAt: null },
      { sort: { updatedAt: -1 } }
    );
  }

  async function listThemes(filter = {}) {
    const query = { deletedAt: null };
    if (filter.scope_type) query.scope_type = filter.scope_type;
    if (Object.prototype.hasOwnProperty.call(filter, 'scope_id')) {
      query.scope_id = filter.scope_id ?? null;
    }
    return col().find(query).sort({ updatedAt: -1 }).toArray();
  }

  async function createTheme(payload) {
    const doc = {
      id: crypto.randomUUID(),
      scope_type: payload.scope_type,
      scope_id: payload.scope_id ?? null,
      parent_theme_id: payload.parent_theme_id || null,
      theme_tokens: payload.theme_tokens || {},
      accessibility_defaults: payload.accessibility_defaults || {},
      updatedBy: payload.updatedBy || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      version: 1,
    };
    await col().insertOne(doc);
    return doc;
  }

  async function updateTheme(id, patch) {
    const current = await findById(id);
    if (!current) return null;
    const next = {
      ...current,
      parent_theme_id: Object.prototype.hasOwnProperty.call(patch, 'parent_theme_id')
        ? (patch.parent_theme_id || null)
        : current.parent_theme_id,
      theme_tokens: patch.theme_tokens
        ? { ...current.theme_tokens, ...patch.theme_tokens }
        : current.theme_tokens,
      accessibility_defaults: patch.accessibility_defaults
        ? { ...current.accessibility_defaults, ...patch.accessibility_defaults }
        : current.accessibility_defaults,
      updatedBy: patch.updatedBy || current.updatedBy,
      updatedAt: nowIso(),
      version: Number(current.version || 1) + 1,
    };
    await col().updateOne({ id }, { $set: next });
    return next;
  }

  async function updateThemeLogo(id, logoPatch, updatedBy) {
    const current = await findById(id);
    if (!current) return null;
    const next = {
      ...current,
      theme_tokens: {
        ...(current.theme_tokens || {}),
        logo: {
          ...((current.theme_tokens && current.theme_tokens.logo) || {}),
          ...logoPatch,
        },
      },
      updatedBy: updatedBy || current.updatedBy,
      updatedAt: nowIso(),
      version: Number(current.version || 1) + 1,
    };
    await col().updateOne({ id }, { $set: next });
    return next;
  }

  async function softDelete(id, updatedBy) {
    const current = await findById(id);
    if (!current) return false;
    await col().updateOne({ id }, {
      $set: {
        deletedAt: nowIso(),
        updatedAt: nowIso(),
        updatedBy: updatedBy || current.updatedBy,
        version: Number(current.version || 1) + 1,
      },
    });
    return true;
  }

  return {
    createIndexes,
    findById,
    findScopeTheme,
    listThemes,
    createTheme,
    updateTheme,
    updateThemeLogo,
    softDelete,
  };
}

function extractUserRoles(req) {
  const tokenRoles = Array.isArray(req.auth?.roles) ? req.auth.roles : [];
  const contextRoles = Array.isArray(req.nhrs?.roles) ? req.nhrs.roles : [];
  return Array.from(new Set([...tokenRoles, ...contextRoles].map((r) => String(r))));
}

function isPlatformAdmin(roles) {
  const allow = new Set(['platform_admin', 'super_admin', 'app_admin']);
  return roles.some((role) => allow.has(role));
}

function canManageScope(req, scopeType, scopeId) {
  const roles = extractUserRoles(req);
  if (isPlatformAdmin(roles)) return true;

  if (scopeType === 'organization') {
    if (!roles.includes('org_admin') && !roles.includes('org_owner')) return false;
    const currentOrg = req.nhrs?.orgId || req.headers['x-org-id'] || null;
    return currentOrg && String(currentOrg) === String(scopeId);
  }

  if (scopeType === 'state') {
    if (!roles.includes('government_admin') && !roles.includes('state_admin')) return false;
    const currentState = req.headers['x-state-id'] || null;
    if (!currentState) return true;
    return String(currentState) === String(scopeId);
  }

  if (scopeType === 'taskforce') {
    if (!roles.includes('taskforce_admin') && !roles.includes('taskforce_lead')) return false;
    const currentTaskforce = req.headers['x-taskforce-id'] || null;
    if (!currentTaskforce) return true;
    return String(currentTaskforce) === String(scopeId);
  }

  return false;
}

function computeEtag(sources = []) {
  const key = sources.map((s) => `${s.id}:${s.version}`).join('|');
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  return `W/\"theme-${hash}\"`;
}

function validateThemePayload(payload = {}, partial = false) {
  const errors = [];
  const scopeTypes = new Set(['platform', 'organization', 'state', 'taskforce']);
  if (!partial) {
    if (!scopeTypes.has(payload.scope_type)) {
      errors.push('scope_type must be one of platform|organization|state|taskforce');
    }
    if (payload.scope_type !== 'platform' && !payload.scope_id) {
      errors.push('scope_id is required for non-platform scope_type');
    }
  }

  if (payload.theme_tokens && payload.theme_tokens.colors) {
    const invalidColors = validateColorInput(payload.theme_tokens.colors);
    if (invalidColors.length > 0) {
      errors.push(`Invalid colors: ${invalidColors.map((x) => x.key).join(', ')}`);
    }
    const contrast = validateContrast(payload.theme_tokens);
    if (!contrast.ok) {
      errors.push(`${contrast.reason} (ratio=${contrast.ratio})`);
    }
  }

  return errors;
}

async function uploadLogoViaFileService(fetchClient, upload) {
  const raw = Buffer.from(String(upload.contentBase64 || ''), 'base64');
  if (!raw.length) {
    return { error: 'Invalid base64 payload' };
  }
  if (raw.length > maxLogoBytes) {
    return { error: `Logo exceeds max size (${maxLogoBytes} bytes)` };
  }
  if (!logoTypeAllowlist.has(upload.contentType)) {
    return { error: 'Unsupported logo content type' };
  }
  if (upload.contentType === 'image/svg+xml' && !isSafeSvg(raw)) {
    return { error: 'Unsafe SVG payload' };
  }

  const formData = new FormData();
  const filename = upload.filename || `logo-${Date.now()}.png`;
  formData.append('file', new Blob([raw], { type: upload.contentType }), filename);

  const response = await fetchClient(`${fileDocumentApiBaseUrl}/files/upload`, {
    method: 'POST',
    body: formData,
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_err) {
      body = { message: text };
    }
  }

  if (!response.ok) {
    return { error: body?.message || `File upload failed: ${response.status}` };
  }

  const url = body?.file?.secureUrl || body?.file?.url || null;
  if (!url) return { error: 'Upload did not return URL' };
  return { url, metadata: body?.file || null };
}

function createApp(options = {}) {
  const fastify = fastifyFactory({ logger: true });

  const state = {
    dbReady: false,
    db: options.db || null,
    repository: options.db ? buildRepository(options.db) : null,
    mongoClient: null,
    fetchClient: options.fetchImpl || ((...args) => fetch(...args)),
    injectedDb: Boolean(options.db),
  };

  if (Object.prototype.hasOwnProperty.call(options, 'dbReady')) {
    state.dbReady = !!options.dbReady;
  }

  fastify.register(multipart, {
    limits: {
      fileSize: maxLogoBytes,
      files: 1,
    },
  });

  function parseBearerToken(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;
    return authHeader.slice(7);
  }

  async function requireAuth(req, reply) {
    if (req.auth?.userId) return;
    const token = parseBearerToken(req);
    if (!token) return reply.code(401).send({ message: 'Unauthorized' });
    try {
      const payload = jwt.verify(token, jwtSecret);
      req.auth = {
        userId: String(payload.sub),
        roles: Array.isArray(payload.roles) ? payload.roles : [],
      };
    } catch (_err) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }
  }

  async function loadParentChain(theme) {
    const parents = [];
    let pointer = theme;
    const seen = new Set();
    while (pointer?.parent_theme_id) {
      if (seen.has(pointer.parent_theme_id)) break;
      seen.add(pointer.parent_theme_id);
      const parent = await state.repository.findById(pointer.parent_theme_id);
      if (!parent) break;
      parents.unshift(parent);
      pointer = parent;
      if (parents.length > 8) break;
    }
    return parents;
  }

  function sendWithEtag(req, reply, payload, sources) {
    const etag = computeEtag(sources);
    if (req.headers['if-none-match'] === etag) {
      reply.code(304);
      return reply.send();
    }
    reply.header('etag', etag);
    reply.header('cache-control', 'public, max-age=60');
    return reply.send(payload);
  }

  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (!state.dbReady) {
      return reply.code(503).send({ message: 'UI theme storage unavailable' });
    }
  });

  fastify.addHook('onRequest', createContextVerificationHook({
    secret: nhrsContextSecret,
    requiredMatcher: (req) => {
      const routePath = req.url.split('?')[0];
      if (!routePath.startsWith('/ui/theme')) return false;
      return !(routePath === '/ui/theme/effective' || routePath === '/ui/theme/platform');
    },
  }));

  fastify.get('/health', async () => ({
    status: 'ok',
    service: serviceName,
    dbReady: state.dbReady,
    dbName,
  }));

  fastify.get('/ui/theme/platform', {
    schema: {
      tags: ['UI Theme'],
      summary: 'Get platform default theme',
      description: 'Returns platform (public) theme tokens and accessibility defaults with cache-friendly ETag.',
      response: {
        200: { type: 'object', additionalProperties: true },
        304: { type: 'null' },
        503: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const platformTheme = await state.repository.findScopeTheme('platform', null);
    if (!platformTheme) {
      return reply.code(404).send({ message: 'Platform theme not configured' });
    }
    const resolved = resolveTheme({ platformTheme, parentThemes: [], tenantTheme: null });
    return sendWithEtag(req, reply, {
      scope_type: 'platform',
      scope_id: null,
      theme: resolved,
    }, resolved.sources);
  });

  fastify.get('/ui/theme/effective', {
    schema: {
      tags: ['UI Theme'],
      summary: 'Get effective theme by scope',
      description: 'Resolves effective theme using inheritance chain: platform -> parent -> tenant.',
      querystring: {
        type: 'object',
        required: ['scope_type'],
        properties: {
          scope_type: { type: 'string', enum: ['platform', 'organization', 'state', 'taskforce'] },
          scope_id: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        304: { type: 'null' },
        400: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const { scope_type: scopeType, scope_id: scopeId } = req.query;
    if (scopeType !== 'platform' && !scopeId) {
      return reply.code(400).send({ message: 'scope_id is required for non-platform scope_type' });
    }

    const platformTheme = await state.repository.findScopeTheme('platform', null);
    if (!platformTheme) {
      return reply.code(404).send({ message: 'Platform theme not configured' });
    }

    if (scopeType === 'platform') {
      const resolved = resolveTheme({ platformTheme, parentThemes: [], tenantTheme: null });
      return sendWithEtag(req, reply, { scope_type: scopeType, scope_id: null, theme: resolved }, resolved.sources);
    }

    const tenantTheme = await state.repository.findScopeTheme(scopeType, scopeId);
    if (!tenantTheme) {
      const resolved = resolveTheme({ platformTheme, parentThemes: [], tenantTheme: null });
      return sendWithEtag(req, reply, {
        scope_type: scopeType,
        scope_id: scopeId,
        inheritedOnly: true,
        theme: resolved,
      }, resolved.sources);
    }

    const parents = await loadParentChain(tenantTheme);
    const resolved = resolveTheme({ platformTheme, parentThemes: parents, tenantTheme });
    return sendWithEtag(req, reply, {
      scope_type: scopeType,
      scope_id: scopeId,
      theme: resolved,
    }, resolved.sources);
  });

  fastify.get('/ui/theme', {
    preHandler: requireAuth,
    schema: {
      tags: ['UI Theme'],
      summary: 'List configured themes',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          scope_type: { type: 'string', enum: ['platform', 'organization', 'state', 'taskforce'] },
          scope_id: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
        401: { type: 'object', properties: { message: { type: 'string' } } },
        403: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const { scope_type: scopeType, scope_id: scopeId } = req.query || {};
    if (!scopeType && !isPlatformAdmin(extractUserRoles(req))) {
      return reply.code(403).send({ message: 'scope_type and scope_id are required for non-platform admin' });
    }
    if (scopeType && !canManageScope(req, scopeType, scopeId)) {
      return reply.code(403).send({ message: 'Forbidden for requested scope' });
    }
    const items = await state.repository.listThemes({ scope_type: scopeType, scope_id: scopeId });
    return reply.send({ items });
  });

  fastify.post('/ui/theme', {
    preHandler: requireAuth,
    schema: {
      tags: ['UI Theme'],
      summary: 'Create scope theme',
      security: [{ bearerAuth: [] }],
      body: { type: 'object', additionalProperties: false, required: ['scope_type'], properties: {
        scope_type: { type: 'string', enum: ['platform', 'organization', 'state', 'taskforce'] },
        scope_id: { type: 'string' },
        parent_theme_id: { type: 'string' },
        theme_tokens: { type: 'object', additionalProperties: true },
        accessibility_defaults: { type: 'object', additionalProperties: true },
      } },
      response: {
        201: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { message: { type: 'string' } } },
        403: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const payload = req.body || {};
    const errors = validateThemePayload(payload, false);
    if (errors.length > 0) {
      return reply.code(400).send({ message: errors.join('; ') });
    }
    if (!canManageScope(req, payload.scope_type, payload.scope_id)) {
      return reply.code(403).send({ message: 'Forbidden for requested scope' });
    }

    const existing = await state.repository.findScopeTheme(payload.scope_type, payload.scope_id ?? null);
    if (existing) {
      return reply.code(409).send({ message: 'Theme already exists for this scope' });
    }

    const created = await state.repository.createTheme({
      ...payload,
      updatedBy: req.auth.userId,
    });
    return reply.code(201).send(created);
  });

  fastify.patch('/ui/theme/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['UI Theme'],
      summary: 'Update theme',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', additionalProperties: false, properties: {
        parent_theme_id: { type: 'string' },
        theme_tokens: { type: 'object', additionalProperties: true },
        accessibility_defaults: { type: 'object', additionalProperties: true },
      } },
      response: {
        200: { type: 'object', additionalProperties: true },
        403: { type: 'object', properties: { message: { type: 'string' } } },
        404: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const current = await state.repository.findById(req.params.id);
    if (!current) return reply.code(404).send({ message: 'Theme not found' });
    if (!canManageScope(req, current.scope_type, current.scope_id)) {
      return reply.code(403).send({ message: 'Forbidden for requested scope' });
    }

    const errors = validateThemePayload(req.body || {}, true);
    if (errors.length > 0) {
      return reply.code(400).send({ message: errors.join('; ') });
    }

    const updated = await state.repository.updateTheme(req.params.id, {
      ...req.body,
      updatedBy: req.auth.userId,
    });
    return reply.send(updated);
  });

  fastify.post('/ui/theme/:id/logo', {
    preHandler: requireAuth,
    schema: {
      tags: ['UI Theme'],
      summary: 'Update theme logos',
      description: 'Supports URL patch flow or direct base64 upload flow via file-document-service.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lightUrl: { type: 'string' },
          darkUrl: { type: 'string' },
          markUrl: { type: 'string' },
          upload: {
            type: 'object',
            additionalProperties: false,
            properties: {
              variant: { type: 'string', enum: ['light', 'dark', 'mark'] },
              filename: { type: 'string' },
              contentType: { type: 'string' },
              contentBase64: { type: 'string' },
            },
            required: ['variant', 'contentType', 'contentBase64'],
          },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { message: { type: 'string' } } },
        403: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const current = await state.repository.findById(req.params.id);
    if (!current) return reply.code(404).send({ message: 'Theme not found' });
    if (!canManageScope(req, current.scope_type, current.scope_id)) {
      return reply.code(403).send({ message: 'Forbidden for requested scope' });
    }

    const payload = req.body || {};
    const logoPatch = {};

    if (payload.upload) {
      const uploaded = await uploadLogoViaFileService(state.fetchClient, payload.upload);
      if (uploaded.error) {
        return reply.code(400).send({ message: uploaded.error });
      }
      const key = `${payload.upload.variant}Url`;
      logoPatch[key] = uploaded.url;
    }

    if (payload.lightUrl) logoPatch.lightUrl = payload.lightUrl;
    if (payload.darkUrl) logoPatch.darkUrl = payload.darkUrl;
    if (payload.markUrl) logoPatch.markUrl = payload.markUrl;

    if (Object.keys(logoPatch).length === 0) {
      return reply.code(400).send({ message: 'Provide lightUrl/darkUrl/markUrl or upload payload' });
    }

    const updated = await state.repository.updateThemeLogo(req.params.id, logoPatch, req.auth.userId);
    return reply.send(updated);
  });

  fastify.delete('/ui/theme/:id', {
    preHandler: requireAuth,
    schema: {
      tags: ['UI Theme'],
      summary: 'Soft-delete theme',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: { type: 'object', properties: { deleted: { type: 'boolean' } } },
        403: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const current = await state.repository.findById(req.params.id);
    if (!current) return reply.code(404).send({ message: 'Theme not found' });
    if (!canManageScope(req, current.scope_type, current.scope_id)) {
      return reply.code(403).send({ message: 'Forbidden for requested scope' });
    }
    await state.repository.softDelete(req.params.id, req.auth.userId);
    return reply.send({ deleted: true });
  });

  async function connect() {
    if (state.injectedDb) return;
    if (!mongoUri) {
      fastify.log.warn('Missing MONGODB_URI; ui-theme-service running in degraded mode');
      return;
    }
    try {
      const client = new MongoClient(mongoUri, {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        },
      });
      await client.connect();
      const db = client.db(dbName);
      await db.command({ ping: 1 });
      state.mongoClient = client;
      state.db = db;
      state.repository = buildRepository(db);
      state.dbReady = true;
      await state.repository.createIndexes();
    } catch (err) {
      fastify.log.warn({ err }, 'MongoDB connection failed');
    }
  }

  async function closeService() {
    if (state.mongoClient) {
      await state.mongoClient.close();
    }
    await fastify.close();
  }

  fastify.decorate('connect', connect);
  fastify.decorate('closeService', closeService);
  fastify.decorate('repository', state.repository);
  setStandardErrorHandler(fastify);
  return fastify;
}

const app = createApp();

async function start() {
  try {
    enforceProductionSecrets({
      env: process.env,
      required: ['JWT_SECRET', 'NHRS_CONTEXT_HMAC_SECRET', 'MONGODB_URI'],
      secrets: ['JWT_SECRET', 'NHRS_CONTEXT_HMAC_SECRET'],
    });
    await app.connect();
    await app.listen({ host: '0.0.0.0', port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

module.exports = {
  createApp,
  buildRepository,
};

if (require.main === module) {
  start();
}
