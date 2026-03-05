const crypto = require('crypto');
const DAY_MS = 24 * 60 * 60 * 1000;
function now() { return new Date(); }

function emitAudit(deps, req, event) {
  return deps.emitAuditEvent({ ipAddress: req.ip, userAgent: req.headers['user-agent'] || null, ...event }, req);
}

function registerRoutes(fastify, deps) {
  const err = { type: 'object', required: ['message'], properties: { message: { type: 'string' } } };

  fastify.post('/pharmacy/:nin/dispenses', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'Create pharmacy dispense and register index pointer',
      security: [{ bearerAuth: [] }],
      headers: { type: 'object', required: ['authorization', 'x-org-id'], properties: { authorization: { type: 'string' }, 'x-org-id': { type: 'string' }, 'x-branch-id': { type: 'string' } } },
      params: { type: 'object', required: ['nin'], properties: { nin: { type: 'string', pattern: '^\\d{11}$' } } },
      body: {
        type: 'object',
        properties: {
          prescription: { type: 'object', additionalProperties: true },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          instructions: { type: 'string' },
          notes: { type: 'string' },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, 400: err, 401: err, 403: err, 502: err },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'pharmacy.create', organizationId, branchId);
    if (denied) return;

    const dispense = {
      dispenseId: crypto.randomUUID(),
      nin: String(req.params.nin),
      organizationId,
      branchId,
      providerUserId: req.auth.userId,
      providerRoleContext: req.headers['x-role-context'] ? String(req.headers['x-role-context']) : null,
      prescription: req.body?.prescription || { doctorOrgId: null, doctorUserId: null, items: [] },
      items: Array.isArray(req.body?.items) ? req.body.items : [],
      instructions: req.body?.instructions || null,
      notes: req.body?.notes || null,
      pointers: {
        service: 'pharmacy-dispense-service',
        resourceId: null,
      },
      createdAt: now(),
      updatedAt: now(),
      editableUntil: new Date(Date.now() + DAY_MS),
    };
    dispense.pointers.resourceId = dispense.dispenseId;

    await deps.repository.insertDispense(dispense);
    const indexResult = await deps.registerIndexEntry({
      callJson: deps.callJson,
      baseUrl: deps.healthRecordsIndexApiBaseUrl,
      nin: dispense.nin,
      entryType: 'pharmacy_dispense',
      pointers: dispense.pointers,
      token: req.headers.authorization,
      orgId: req.headers['x-org-id'],
      branchId: req.headers['x-branch-id'] || '',
      payload: {
        itemCount: Array.isArray(dispense.items) ? dispense.items.length : 0,
      },
    });
    if (!indexResult.ok) {
      await deps.repository.deleteDispense(dispense.dispenseId);
      await emitAudit(deps, req, { userId: req.auth.userId, organizationId, eventType: 'INDEX_REGISTRATION_FAILED', action: 'pharmacy.create', outcome: 'failure', metadata: { dispenseId: dispense.dispenseId, nin: dispense.nin } });
      return reply.code(502).send({ message: 'Failed to register timeline index entry' });
    }

    await emitAudit(deps, req, { userId: req.auth.userId, organizationId, eventType: 'PHARMACY_DISPENSE_CREATED', action: 'pharmacy.create', outcome: 'success', metadata: { dispenseId: dispense.dispenseId, nin: dispense.nin } });
    return reply.code(201).send({ dispense });
  });

  fastify.get('/pharmacy/:nin/dispenses', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'List pharmacy dispenses by NIN',
      security: [{ bearerAuth: [] }],
      headers: { type: 'object', required: ['authorization', 'x-org-id'], properties: { authorization: { type: 'string' }, 'x-org-id': { type: 'string' }, 'x-branch-id': { type: 'string' } } },
      params: { type: 'object', required: ['nin'], properties: { nin: { type: 'string', pattern: '^\\d{11}$' } } },
      querystring: { type: 'object', properties: { from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' }, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: err, 401: err, 403: err },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'pharmacy.read', organizationId, branchId);
    if (denied) return;

    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
    const from = req.query?.from ? new Date(req.query.from) : null;
    const to = req.query?.to ? new Date(req.query.to) : null;
    const { items, total } = await deps.repository.listDispensesByNin(String(req.params.nin), from, to, page, limit);

    await emitAudit(deps, req, { userId: req.auth.userId, organizationId, eventType: 'PROVIDER_RECORD_VIEWED', action: 'pharmacy.read', outcome: 'success', metadata: { nin: String(req.params.nin), count: items.length } });
    return reply.send({ page, limit, total, items });
  });

  fastify.get('/pharmacy/dispenses/id/:dispenseId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'Get pharmacy dispense by id',
      security: [{ bearerAuth: [] }],
      headers: { type: 'object', required: ['authorization', 'x-org-id'], properties: { authorization: { type: 'string' }, 'x-org-id': { type: 'string' }, 'x-branch-id': { type: 'string' } } },
      params: { type: 'object', required: ['dispenseId'], properties: { dispenseId: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: err, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'pharmacy.read', organizationId, branchId);
    if (denied) return;

    const item = await deps.repository.getDispenseById(String(req.params.dispenseId));
    if (!item) return reply.code(404).send({ message: 'Dispense record not found' });
    return reply.send({ dispense: item });
  });

  fastify.patch('/pharmacy/dispenses/id/:dispenseId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'Update pharmacy dispense within 24h by creator only',
      security: [{ bearerAuth: [] }],
      headers: { type: 'object', required: ['authorization', 'x-org-id'], properties: { authorization: { type: 'string' }, 'x-org-id': { type: 'string' }, 'x-branch-id': { type: 'string' } } },
      params: { type: 'object', required: ['dispenseId'], properties: { dispenseId: { type: 'string' } } },
      body: { type: 'object', additionalProperties: false, properties: { prescription: { type: 'object', additionalProperties: true }, items: { type: 'array', items: { type: 'object', additionalProperties: true } }, instructions: { type: 'string' }, notes: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: err, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'pharmacy.update', organizationId, branchId);
    if (denied) return;

    const existing = await deps.repository.getDispenseById(String(req.params.dispenseId));
    if (!existing) return reply.code(404).send({ message: 'Dispense record not found' });
    if (String(existing.providerUserId) !== req.auth.userId) return reply.code(403).send({ message: 'Only the creator can edit this record' });
    if (existing.editableUntil && new Date(existing.editableUntil).getTime() < Date.now()) {
      await emitAudit(deps, req, { userId: req.auth.userId, organizationId, eventType: 'CORRECTION_REQUEST_CREATED', action: 'pharmacy.update', outcome: 'failure', metadata: { dispenseId: existing.dispenseId, reason: 'edit_window_expired' } });
      return reply.code(403).send({ message: 'EDIT_WINDOW_EXPIRED_USE_TASKFORCE_WORKFLOW' });
    }

    await deps.repository.updateDispense(existing.dispenseId, { ...req.body, updatedAt: now() });
    const updated = await deps.repository.getDispenseById(existing.dispenseId);
    await emitAudit(deps, req, { userId: req.auth.userId, organizationId, eventType: 'PHARMACY_DISPENSE_UPDATED', action: 'pharmacy.update', outcome: 'success', metadata: { dispenseId: existing.dispenseId } });
    return reply.send({ dispense: updated });
  });
}

module.exports = { registerRoutes };
