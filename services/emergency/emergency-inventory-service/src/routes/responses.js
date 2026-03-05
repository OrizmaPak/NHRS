const crypto = require('crypto');

function now() {
  return new Date();
}

function registerResponseRoutes(fastify, deps) {
  const errorSchema = { type: 'object', required: ['message'], properties: { message: { type: 'string' } } };

  fastify.post('/emergency/requests/:requestId/responses', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'Create provider response to emergency request',
      description: 'Provider responds with availability/ETA/transfer options and room gets a system update.',
      security: [{ bearerAuth: [] }],
      headers: {
        type: 'object',
        required: ['authorization', 'x-org-id'],
        properties: {
          authorization: { type: 'string' },
          'x-org-id': { type: 'string' },
          'x-branch-id': { type: 'string' },
        },
      },
      params: {
        type: 'object',
        required: ['requestId'],
        properties: { requestId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['responseType', 'availability'],
        properties: {
          responseType: { type: 'string', enum: ['available', 'unavailable', 'transfer', 'recommendation'] },
          availability: { type: 'boolean' },
          etaMinutes: { type: 'integer', minimum: 0 },
          transferOptions: { type: 'object', additionalProperties: true },
          notes: { type: 'string' },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        400: errorSchema,
        401: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
    },
  }, async (req, reply) => {
    const orgId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    if (!orgId) return reply.code(400).send({ message: 'x-org-id header is required' });
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;

    const denied = await deps.enforcePermission(req, reply, 'emergency.response.create', orgId, branchId);
    if (denied) return;

    const requestDoc = await deps.repository.requests().findOne({ requestId: String(req.params.requestId) });
    if (!requestDoc) return reply.code(404).send({ message: 'Emergency request not found' });

    const responseDoc = {
      responseId: crypto.randomUUID(),
      requestId: requestDoc.requestId,
      providerOrgId: orgId,
      providerBranchId: branchId,
      providerUserId: req.auth.userId,
      responseType: req.body.responseType,
      availability: req.body.availability === true,
      etaMinutes: req.body.etaMinutes ?? null,
      transferOptions: req.body.transferOptions || null,
      notes: req.body.notes || null,
      createdAt: now(),
      updatedAt: now(),
    };

    await deps.repository.responses().insertOne(responseDoc);

    const room = await deps.repository.rooms().findOne({ requestId: requestDoc.requestId });
    if (room) {
      const message = `${orgId} responded: ${responseDoc.responseType}${responseDoc.etaMinutes !== null ? ` (ETA ${responseDoc.etaMinutes} mins)` : ''}`;
      await deps.repository.messages().insertOne({
        messageId: crypto.randomUUID(),
        roomId: room.roomId,
        senderUserId: req.auth.userId,
        senderOrgId: orgId,
        messageType: 'system',
        body: message,
        createdAt: now(),
      });
      await deps.repository.rooms().updateOne({ roomId: room.roomId }, { $set: { updatedAt: now() } });
    }

    await deps.emitAudit({
      userId: req.auth.userId,
      organizationId: orgId,
      eventType: 'EMERGENCY_RESPONSE_CREATED',
      action: 'emergency.response.create',
      permissionKey: 'emergency.response.create',
      resource: { type: 'emergency_response', id: responseDoc.responseId },
      outcome: 'success',
      metadata: { requestId: requestDoc.requestId, responseType: responseDoc.responseType, requestTraceId: req.headers['x-request-id'] || null },
      ipAddress: deps.getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });

    return reply.code(201).send({ response: responseDoc });
  });

  fastify.get('/emergency/requests/:requestId/responses', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'List emergency responses',
      description: 'Returns all provider responses for an emergency request.',
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
      },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'emergency.request.read');
    if (denied) return;

    const items = await deps.repository.responses().find({ requestId: String(req.params.requestId) }).sort({ createdAt: -1 }).toArray();
    return reply.send({ items });
  });
}

module.exports = { registerResponseRoutes };
