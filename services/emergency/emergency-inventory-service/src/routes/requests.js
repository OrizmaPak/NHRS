const crypto = require('crypto');

function now() {
  return new Date();
}

const REGION_BY_STATE = {
  lagos: 'SOUTH_WEST',
  ogun: 'SOUTH_WEST',
  oyo: 'SOUTH_WEST',
  osun: 'SOUTH_WEST',
  ondo: 'SOUTH_WEST',
  ekiti: 'SOUTH_WEST',
  enugu: 'SOUTH_EAST',
  anambra: 'SOUTH_EAST',
  imo: 'SOUTH_EAST',
  ebonyi: 'SOUTH_EAST',
  abia: 'SOUTH_EAST',
  rivers: 'SOUTH_SOUTH',
  akwaibom: 'SOUTH_SOUTH',
  delta: 'SOUTH_SOUTH',
  edo: 'SOUTH_SOUTH',
  bayelsa: 'SOUTH_SOUTH',
  crossriver: 'SOUTH_SOUTH',
  kano: 'NORTH_WEST',
  kaduna: 'NORTH_WEST',
  katsina: 'NORTH_WEST',
  kebbi: 'NORTH_WEST',
  jigawa: 'NORTH_WEST',
  sokoto: 'NORTH_WEST',
  zamfara: 'NORTH_WEST',
  borno: 'NORTH_EAST',
  yobe: 'NORTH_EAST',
  adamawa: 'NORTH_EAST',
  bauchi: 'NORTH_EAST',
  gombe: 'NORTH_EAST',
  taraba: 'NORTH_EAST',
  plateau: 'NORTH_CENTRAL',
  benue: 'NORTH_CENTRAL',
  kogi: 'NORTH_CENTRAL',
  niger: 'NORTH_CENTRAL',
  nasarawa: 'NORTH_CENTRAL',
  kwara: 'NORTH_CENTRAL',
  fct: 'NORTH_CENTRAL',
};

function normalize(value) {
  return value ? String(value).trim().toLowerCase().replace(/\s+/g, '') : null;
}

function regionFromState(state) {
  const key = normalize(state);
  return key ? REGION_BY_STATE[key] || null : null;
}

async function resolveScopeTargets(repository, scope = {}, location = {}) {
  const level = String(scope.level || '').toUpperCase();
  const query = {};

  if (level === 'LGA') {
    query['location.lga'] = scope.lga || location.lga || null;
    if (scope.state || location.state) {
      query['location.state'] = scope.state || location.state;
    }
  } else if (level === 'STATE') {
    query['location.state'] = scope.state || location.state || null;
  } else if (level === 'REGION') {
    query['location.region'] = scope.region || regionFromState(scope.state || location.state);
  } else if (level === 'NATIONAL') {
    // all providers
  }

  Object.keys(query).forEach((key) => {
    if (!query[key]) delete query[key];
  });

  const docs = await repository.inventory().find(query).toArray();
  const unique = new Map();
  for (const doc of docs) {
    const orgId = doc.providerOrgId ? String(doc.providerOrgId) : null;
    if (!orgId) continue;
    const branchId = doc.providerBranchId ? String(doc.providerBranchId) : null;
    const mapKey = `${orgId}:${branchId || 'none'}`;
    if (!unique.has(mapKey)) {
      unique.set(mapKey, { providerOrgId: orgId, providerBranchId: branchId });
    }
  }
  return Array.from(unique.values());
}

function registerRequestRoutes(fastify, deps) {
  const errorSchema = { type: 'object', required: ['message'], properties: { message: { type: 'string' } } };

  fastify.post('/emergency/requests', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'Create emergency request',
      description: 'Creates emergency request, auto-creates incident room, and routes alerts to in-scope providers.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['title', 'description', 'category', 'urgency', 'scope', 'location'],
        properties: {
          title: { type: 'string', minLength: 3 },
          description: { type: 'string', minLength: 3 },
          category: { type: 'string', enum: ['drug', 'blood', 'test', 'bed', 'ambulance', 'other'] },
          urgency: { type: 'string', enum: ['critical', 'high', 'medium'] },
          scope: {
            type: 'object',
            required: ['level'],
            properties: {
              level: { type: 'string', enum: ['LGA', 'STATE', 'REGION', 'NATIONAL'] },
              lga: { type: 'string' },
              state: { type: 'string' },
              region: { type: 'string' },
            },
          },
          location: {
            type: 'object',
            required: ['state', 'lga'],
            properties: {
              state: { type: 'string' },
              lga: { type: 'string' },
              addressText: { type: 'string' },
              lat: { type: 'number' },
              lng: { type: 'number' },
            },
          },
          nin: { type: 'string', pattern: '^\\d{11}$' },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        400: errorSchema,
        401: errorSchema,
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'emergency.request.create');
    if (denied) return;

    const requestId = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    const createdAt = now();

    const requestDoc = {
      requestId,
      createdByUserId: req.auth.userId,
      createdByType: (req.headers['x-org-id'] ? 'provider' : 'citizen'),
      nin: req.body.nin || null,
      title: req.body.title,
      description: req.body.description,
      category: req.body.category,
      urgency: req.body.urgency,
      scope: {
        level: req.body.scope.level,
        lga: req.body.scope.lga || null,
        state: req.body.scope.state || null,
        region: req.body.scope.region || null,
      },
      location: {
        state: req.body.location.state,
        lga: req.body.location.lga,
        addressText: req.body.location.addressText || null,
        lat: req.body.location.lat || null,
        lng: req.body.location.lng || null,
      },
      status: 'open',
      createdAt,
      updatedAt: createdAt,
    };

    const roomDoc = {
      roomId,
      requestId,
      participants: [{ userId: req.auth.userId, orgId: req.headers['x-org-id'] || null, role: requestDoc.createdByType }],
      createdAt,
      updatedAt: createdAt,
    };

    await deps.repository.requests().insertOne(requestDoc);
    await deps.repository.rooms().insertOne(roomDoc);

    const targets = await resolveScopeTargets(deps.repository, requestDoc.scope, requestDoc.location);
    await deps.emitNotification({
      eventType: 'EMERGENCY_ALERT',
      payload: {
        requestId,
        title: requestDoc.title,
        urgency: requestDoc.urgency,
        category: requestDoc.category,
        scope: requestDoc.scope,
        createdAt: createdAt.toISOString(),
      },
      targets,
      trace: {
        requestId: req.headers['x-request-id'] || null,
        userId: req.auth.userId,
        orgId: req.headers['x-org-id'] || null,
        branchId: req.headers['x-branch-id'] || null,
      },
    });

    await deps.emitAudit({
      userId: req.auth.userId,
      organizationId: req.headers['x-org-id'] || null,
      eventType: 'EMERGENCY_REQUEST_CREATED',
      action: 'emergency.request.create',
      permissionKey: 'emergency.request.create',
      resource: { type: 'emergency_request', id: requestId },
      outcome: 'success',
      metadata: { roomId, targetCount: targets.length, requestId: req.headers['x-request-id'] || null },
      ipAddress: deps.getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });

    return reply.code(201).send({ request: requestDoc, room: roomDoc, targets });
  });

  fastify.get('/emergency/requests', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'List emergency requests',
      description: 'List emergency requests with dashboard filters.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          scopeLevel: { type: 'string' },
          state: { type: 'string' },
          lga: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        401: errorSchema,
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'emergency.request.read');
    if (denied) return;
    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
    const filter = {};
    if (req.query?.status) filter.status = req.query.status;
    if (req.query?.scopeLevel) filter['scope.level'] = req.query.scopeLevel;
    if (req.query?.state) filter['location.state'] = req.query.state;
    if (req.query?.lga) filter['location.lga'] = req.query.lga;

    const [items, total] = await Promise.all([
      deps.repository.requests().find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      deps.repository.requests().countDocuments(filter),
    ]);
    return { page, limit, total, items };
  });

  fastify.get('/emergency/requests/:requestId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'Get one emergency request',
      description: 'Returns request details with responses summary and room id.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['requestId'],
        properties: { requestId: { type: 'string' } },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        401: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'emergency.request.read');
    if (denied) return;

    const requestDoc = await deps.repository.requests().findOne({ requestId: String(req.params.requestId) });
    if (!requestDoc) return reply.code(404).send({ message: 'Emergency request not found' });

    const [room, responsesCount, latestResponses] = await Promise.all([
      deps.repository.rooms().findOne({ requestId: requestDoc.requestId }),
      deps.repository.responses().countDocuments({ requestId: requestDoc.requestId }),
      deps.repository.responses().find({ requestId: requestDoc.requestId }).sort({ createdAt: -1 }).limit(5).toArray(),
    ]);

    return reply.send({
      request: requestDoc,
      roomId: room ? room.roomId : null,
      responsesSummary: { total: responsesCount, latest: latestResponses },
    });
  });

  fastify.patch('/emergency/requests/:requestId/status', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'Update emergency request status',
      description: 'Changes request status and posts a room system message.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['requestId'],
        properties: { requestId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'cancelled', 'expired'] },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        401: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'emergency.request.update_status');
    if (denied) return;

    const existing = await deps.repository.requests().findOne({ requestId: String(req.params.requestId) });
    if (!existing) return reply.code(404).send({ message: 'Emergency request not found' });

    await deps.repository.requests().updateOne(
      { requestId: existing.requestId },
      { $set: { status: req.body.status, updatedAt: now() } }
    );

    const room = await deps.repository.rooms().findOne({ requestId: existing.requestId });
    if (room) {
      await deps.repository.messages().insertOne({
        messageId: crypto.randomUUID(),
        roomId: room.roomId,
        senderUserId: req.auth.userId,
        senderOrgId: req.headers['x-org-id'] || null,
        messageType: 'system',
        body: `Request status changed to ${req.body.status}`,
        createdAt: now(),
      });
      await deps.repository.rooms().updateOne({ roomId: room.roomId }, { $set: { updatedAt: now() } });
    }

    await deps.emitAudit({
      userId: req.auth.userId,
      organizationId: req.headers['x-org-id'] || null,
      eventType: 'EMERGENCY_REQUEST_STATUS_CHANGED',
      action: 'emergency.request.update_status',
      permissionKey: 'emergency.request.update_status',
      resource: { type: 'emergency_request', id: existing.requestId },
      outcome: 'success',
      metadata: { from: existing.status, to: req.body.status, requestId: req.headers['x-request-id'] || null },
      ipAddress: deps.getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });

    return reply.send({ message: 'Status updated' });
  });
}

module.exports = {
  registerRequestRoutes,
  resolveScopeTargets,
  regionFromState,
};
