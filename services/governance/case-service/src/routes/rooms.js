const crypto = require('crypto');

function now() { return new Date(); }

function registerRoomRoutes(fastify, deps) {
  const err = { type: 'object', required: ['message'], properties: { message: { type: 'string' } } };

  fastify.get('/cases/:caseId/room', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Get case room',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['caseId'], properties: { caseId: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.case.room.read');
    if (denied) return;

    const room = await deps.repository.rooms().findOne({ caseId: req.params.caseId });
    if (!room) return reply.code(404).send({ message: 'Case room not found' });
    return reply.send({ room });
  });

  fastify.post('/case-rooms/:roomId/messages', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Post case room message',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['roomId'], properties: { roomId: { type: 'string' } } },
      body: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1 } } },
      response: { 201: { type: 'object', additionalProperties: true }, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.case.room.message.create');
    if (denied) return;

    const room = await deps.repository.rooms().findOne({ roomId: req.params.roomId });
    if (!room) return reply.code(404).send({ message: 'Case room not found' });

    const message = {
      messageId: crypto.randomUUID(),
      roomId: room.roomId,
      senderUserId: req.auth.userId,
      messageType: 'text',
      body: req.body.body,
      createdAt: now(),
    };

    await deps.repository.messages().insertOne(message);
    await deps.repository.rooms().updateOne({ roomId: room.roomId }, { $set: { updatedAt: now() } });
    return reply.code(201).send({ message });
  });

  fastify.get('/case-rooms/:roomId/messages', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'List case room messages',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['roomId'], properties: { roomId: { type: 'string' } } },
      querystring: { type: 'object', properties: { page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.case.room.read');
    if (denied) return;

    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
    const [items, total] = await Promise.all([
      deps.repository.messages().find({ roomId: req.params.roomId }).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
      deps.repository.messages().countDocuments({ roomId: req.params.roomId }),
    ]);
    return reply.send({ page, limit, total, items });
  });
}

module.exports = { registerRoomRoutes };
