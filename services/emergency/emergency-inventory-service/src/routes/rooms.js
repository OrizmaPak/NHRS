const crypto = require('crypto');

function now() {
  return new Date();
}

function registerRoomRoutes(fastify, deps) {
  const errorSchema = { type: 'object', required: ['message'], properties: { message: { type: 'string' } } };

  fastify.get('/emergency/requests/:requestId/room', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'Get incident room for request',
      description: 'Returns room and participants for an emergency request.',
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
    const denied = await deps.enforcePermission(req, reply, 'emergency.room.read');
    if (denied) return;

    const room = await deps.repository.rooms().findOne({ requestId: String(req.params.requestId) });
    if (!room) return reply.code(404).send({ message: 'Incident room not found' });
    return reply.send({ room });
  });

  fastify.post('/emergency/rooms/:roomId/messages', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'Post incident room message',
      description: 'Posts a chat message in an emergency incident room.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['roomId'],
        properties: { roomId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['body'],
        properties: { body: { type: 'string', minLength: 1 } },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        401: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'emergency.room.message.create');
    if (denied) return;

    const room = await deps.repository.rooms().findOne({ roomId: String(req.params.roomId) });
    if (!room) return reply.code(404).send({ message: 'Incident room not found' });

    const message = {
      messageId: crypto.randomUUID(),
      roomId: room.roomId,
      senderUserId: req.auth.userId,
      senderOrgId: req.headers['x-org-id'] || null,
      messageType: 'text',
      body: req.body.body,
      createdAt: now(),
    };

    await deps.repository.messages().insertOne(message);
    await deps.repository.rooms().updateOne({ roomId: room.roomId }, { $set: { updatedAt: now() } });

    await deps.emitAudit({
      userId: req.auth.userId,
      organizationId: req.headers['x-org-id'] || null,
      eventType: 'EMERGENCY_ROOM_MESSAGE_SENT',
      action: 'emergency.room.message.create',
      permissionKey: 'emergency.room.message.create',
      resource: { type: 'emergency_room_message', id: message.messageId },
      outcome: 'success',
      metadata: { roomId: room.roomId, requestTraceId: req.headers['x-request-id'] || null },
      ipAddress: deps.getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });

    return reply.code(201).send({ message });
  });

  fastify.get('/emergency/rooms/:roomId/messages', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'List incident room messages',
      description: 'Returns incident room messages with newest-last ordering and pagination.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['roomId'],
        properties: { roomId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
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
    const denied = await deps.enforcePermission(req, reply, 'emergency.room.read');
    if (denied) return;

    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);

    const [items, total] = await Promise.all([
      deps.repository.messages().find({ roomId: String(req.params.roomId) }).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
      deps.repository.messages().countDocuments({ roomId: String(req.params.roomId) }),
    ]);

    return reply.send({ page, limit, total, items });
  });
}

module.exports = { registerRoomRoutes };
