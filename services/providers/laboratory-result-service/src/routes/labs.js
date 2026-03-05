const crypto = require('crypto');
const DAY_MS = 24 * 60 * 60 * 1000;

function now() { return new Date(); }

function emitAudit(deps, req, event) {
  return deps.emitAuditEvent({ ipAddress: req.ip, userAgent: req.headers['user-agent'] || null, ...event }, req);
}

function registerRoutes(fastify, deps) {
  const baseError = { type: 'object', required: ['message'], properties: { message: { type: 'string' } } };

  fastify.post('/labs/:nin/results', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'Create lab result and register index pointer',
      security: [{ bearerAuth: [] }],
      headers: { type: 'object', required: ['authorization', 'x-org-id'], properties: { authorization: { type: 'string' }, 'x-org-id': { type: 'string' }, 'x-branch-id': { type: 'string' } } },
      params: { type: 'object', required: ['nin'], properties: { nin: { type: 'string', pattern: '^\\d{11}$' } } },
      body: {
        type: 'object',
        required: ['testName'],
        properties: {
          testName: { type: 'string' },
          testCode: { type: 'string' },
          specimenType: { type: 'string' },
          values: { type: 'array', items: { type: 'object', additionalProperties: true } },
          interpretation: { type: 'string' },
          notes: { type: 'string' },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, 400: baseError, 401: baseError, 403: baseError, 502: baseError },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'labs.create', organizationId, branchId);
    if (denied) return;

    const result = {
      resultId: crypto.randomUUID(),
      nin: String(req.params.nin),
      organizationId,
      branchId,
      providerUserId: req.auth.userId,
      providerRoleContext: req.headers['x-role-context'] ? String(req.headers['x-role-context']) : null,
      testName: req.body.testName,
      testCode: req.body.testCode || null,
      specimenType: req.body.specimenType || null,
      values: Array.isArray(req.body.values) ? req.body.values : [],
      interpretation: req.body.interpretation || null,
      notes: req.body.notes || null,
      pointers: {
        service: 'laboratory-result-service',
        resourceId: null,
      },
      createdAt: now(),
      updatedAt: now(),
      editableUntil: new Date(Date.now() + DAY_MS),
    };
    result.pointers.resourceId = result.resultId;

    await deps.repository.insertResult(result);
    const indexResult = await deps.registerIndexEntry({
      callJson: deps.callJson,
      baseUrl: deps.healthRecordsIndexApiBaseUrl,
      nin: result.nin,
      entryType: 'lab_result',
      pointers: result.pointers,
      token: req.headers.authorization,
      orgId: req.headers['x-org-id'],
      branchId: req.headers['x-branch-id'] || '',
      payload: {
        testName: result.testName,
        testCode: result.testCode,
      },
    });
    if (!indexResult.ok) {
      await deps.repository.deleteResult(result.resultId);
      await emitAudit(deps, req, { userId: req.auth.userId, organizationId, eventType: 'INDEX_REGISTRATION_FAILED', action: 'labs.create', outcome: 'failure', metadata: { resultId: result.resultId, nin: result.nin } });
      return reply.code(502).send({ message: 'Failed to register timeline index entry' });
    }

    await emitAudit(deps, req, { userId: req.auth.userId, organizationId, eventType: 'LAB_RESULT_CREATED', action: 'labs.create', outcome: 'success', metadata: { resultId: result.resultId, nin: result.nin } });
    return reply.code(201).send({ result });
  });

  fastify.get('/labs/:nin/results', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'List lab results by NIN',
      security: [{ bearerAuth: [] }],
      headers: { type: 'object', required: ['authorization', 'x-org-id'], properties: { authorization: { type: 'string' }, 'x-org-id': { type: 'string' }, 'x-branch-id': { type: 'string' } } },
      params: { type: 'object', required: ['nin'], properties: { nin: { type: 'string', pattern: '^\\d{11}$' } } },
      querystring: { type: 'object', properties: { from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' }, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: baseError, 401: baseError, 403: baseError },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'labs.read', organizationId, branchId);
    if (denied) return;

    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
    const from = req.query?.from ? new Date(req.query.from) : null;
    const to = req.query?.to ? new Date(req.query.to) : null;
    const { items, total } = await deps.repository.listResultsByNin(String(req.params.nin), from, to, page, limit);

    await emitAudit(deps, req, { userId: req.auth.userId, organizationId, eventType: 'PROVIDER_RECORD_VIEWED', action: 'labs.read', outcome: 'success', metadata: { nin: String(req.params.nin), count: items.length } });
    return reply.send({ page, limit, total, items });
  });

  fastify.get('/labs/results/id/:resultId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'Get lab result by id',
      security: [{ bearerAuth: [] }],
      headers: { type: 'object', required: ['authorization', 'x-org-id'], properties: { authorization: { type: 'string' }, 'x-org-id': { type: 'string' }, 'x-branch-id': { type: 'string' } } },
      params: { type: 'object', required: ['resultId'], properties: { resultId: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: baseError, 401: baseError, 403: baseError, 404: baseError },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'labs.read', organizationId, branchId);
    if (denied) return;

    const item = await deps.repository.getResultById(String(req.params.resultId));
    if (!item) return reply.code(404).send({ message: 'Lab result not found' });
    return reply.send({ result: item });
  });

  fastify.patch('/labs/results/id/:resultId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'Update lab result within 24h by creator only',
      security: [{ bearerAuth: [] }],
      headers: { type: 'object', required: ['authorization', 'x-org-id'], properties: { authorization: { type: 'string' }, 'x-org-id': { type: 'string' }, 'x-branch-id': { type: 'string' } } },
      params: { type: 'object', required: ['resultId'], properties: { resultId: { type: 'string' } } },
      body: { type: 'object', additionalProperties: false, properties: { interpretation: { type: 'string' }, notes: { type: 'string' }, values: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: baseError, 401: baseError, 403: baseError, 404: baseError },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'labs.update', organizationId, branchId);
    if (denied) return;

    const existing = await deps.repository.getResultById(String(req.params.resultId));
    if (!existing) return reply.code(404).send({ message: 'Lab result not found' });
    if (String(existing.providerUserId) !== req.auth.userId) return reply.code(403).send({ message: 'Only the creator can edit this record' });
    if (existing.editableUntil && new Date(existing.editableUntil).getTime() < Date.now()) {
      await emitAudit(deps, req, { userId: req.auth.userId, organizationId, eventType: 'CORRECTION_REQUEST_CREATED', action: 'labs.update', outcome: 'failure', metadata: { resultId: existing.resultId, reason: 'edit_window_expired' } });
      return reply.code(403).send({ message: 'EDIT_WINDOW_EXPIRED_USE_TASKFORCE_WORKFLOW' });
    }

    await deps.repository.updateResult(existing.resultId, { ...req.body, updatedAt: now() });
    const updated = await deps.repository.getResultById(existing.resultId);
    await emitAudit(deps, req, { userId: req.auth.userId, organizationId, eventType: 'LAB_RESULT_UPDATED', action: 'labs.update', outcome: 'success', metadata: { resultId: existing.resultId } });
    return reply.send({ result: updated });
  });
}

module.exports = { registerRoutes };
