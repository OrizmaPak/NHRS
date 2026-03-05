const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;

function now() {
  return new Date();
}

function emitAudit(deps, req, event) {
  deps.emitAuditEvent({
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || null,
    ...event,
  });
}

function registerRoutes(fastify, deps) {
  const baseError = {
    type: 'object',
    required: ['message'],
    properties: { message: { type: 'string' } },
  };

  fastify.post('/encounters/:nin', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'Create clinical encounter and register index entry',
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
        required: ['nin'],
        properties: { nin: { type: 'string', pattern: '^\\d{11}$' } },
      },
      body: {
        type: 'object',
        required: ['visitType', 'chiefComplaint'],
        properties: {
          visitType: { type: 'string', enum: ['outpatient', 'inpatient', 'emergency'] },
          chiefComplaint: { type: 'string' },
          notes: { type: 'string' },
          vitals: { type: 'object', additionalProperties: true },
          diagnosisCodes: { type: 'array', items: { type: 'string' } },
          diagnosisText: { type: 'string' },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        400: baseError,
        401: baseError,
        403: baseError,
        502: baseError,
        503: baseError,
      },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'encounters.create', organizationId, branchId);
    if (denied) return;

    const doctorStatusResult = await deps.fetchDoctorStatus({
      callJson: deps.callJson,
      baseUrl: deps.doctorRegistryApiBaseUrl,
      userId: req.auth.userId,
      internalServiceToken: deps.internalServiceToken,
    });
    if (!doctorStatusResult.ok) {
      return reply.code(503).send({ message: 'Doctor registry unavailable' });
    }
    if (doctorStatusResult.body?.status !== 'verified') {
      return reply.code(403).send({ message: 'DOCTOR_LICENSE_NOT_VERIFIED' });
    }

    const encounter = {
      encounterId: crypto.randomUUID(),
      nin: String(req.params.nin),
      citizenUserId: null,
      organizationId,
      branchId,
      providerUserId: req.auth.userId,
      providerRoleContext: req.headers['x-role-context'] ? String(req.headers['x-role-context']) : null,
      visitType: req.body.visitType,
      chiefComplaint: req.body.chiefComplaint,
      notes: req.body.notes || null,
      vitals: req.body.vitals || {},
      diagnosisCodes: Array.isArray(req.body.diagnosisCodes) ? req.body.diagnosisCodes : [],
      diagnosisText: req.body.diagnosisText || null,
      pointers: {
        service: 'clinical-encounter-service',
        resourceId: null,
      },
      createdAt: now(),
      updatedAt: now(),
      editableUntil: new Date(Date.now() + DAY_MS),
    };
    encounter.pointers.resourceId = encounter.encounterId;

    await deps.repository.insertEncounter(encounter);
    const indexResult = await deps.registerIndexEntry({
      callJson: deps.callJson,
      baseUrl: deps.healthRecordsIndexApiBaseUrl,
      nin: encounter.nin,
      entryType: 'encounter',
      pointers: encounter.pointers,
      token: req.headers.authorization,
      orgId: req.headers['x-org-id'],
      branchId: req.headers['x-branch-id'] || '',
      payload: {
        visitType: encounter.visitType,
        chiefComplaint: encounter.chiefComplaint,
      },
    });
    if (!indexResult.ok) {
      await deps.repository.deleteEncounter(encounter.encounterId);
      emitAudit(deps, req, {
        userId: req.auth.userId,
        organizationId,
        eventType: 'INDEX_REGISTRATION_FAILED',
        action: 'encounters.create',
        outcome: 'failure',
        metadata: { encounterId: encounter.encounterId, nin: encounter.nin },
      });
      return reply.code(502).send({ message: 'Failed to register timeline index entry' });
    }

    emitAudit(deps, req, {
      userId: req.auth.userId,
      organizationId,
      eventType: 'ENCOUNTER_CREATED',
      action: 'encounters.create',
      outcome: 'success',
      metadata: { encounterId: encounter.encounterId, nin: encounter.nin },
    });

    return reply.code(201).send({ encounter });
  });

  fastify.get('/encounters/:nin', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'List encounters by NIN',
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
      params: { type: 'object', required: ['nin'], properties: { nin: { type: 'string', pattern: '^\\d{11}$' } } },
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 400: baseError, 401: baseError, 403: baseError },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'encounters.read', organizationId, branchId);
    if (denied) return;

    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
    const from = req.query?.from ? new Date(req.query.from) : null;
    const to = req.query?.to ? new Date(req.query.to) : null;
    const { items, total } = await deps.repository.listEncountersByNin(String(req.params.nin), from, to, page, limit);

    emitAudit(deps, req, {
      userId: req.auth.userId,
      organizationId,
      eventType: 'PROVIDER_RECORD_VIEWED',
      action: 'encounters.read',
      outcome: 'success',
      metadata: { nin: String(req.params.nin), count: items.length },
    });

    return reply.send({ page, limit, total, items });
  });

  fastify.get('/encounters/id/:encounterId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'Get encounter by id',
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
      params: { type: 'object', required: ['encounterId'], properties: { encounterId: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: baseError, 401: baseError, 403: baseError, 404: baseError },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'encounters.read', organizationId, branchId);
    if (denied) return;

    const item = await deps.repository.getEncounterById(String(req.params.encounterId));
    if (!item) return reply.code(404).send({ message: 'Encounter not found' });
    return reply.send({ encounter: item });
  });

  fastify.patch('/encounters/id/:encounterId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Provider Records'],
      summary: 'Update encounter within 24h by creator only',
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
      params: { type: 'object', required: ['encounterId'], properties: { encounterId: { type: 'string' } } },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chiefComplaint: { type: 'string' },
          notes: { type: 'string' },
          vitals: { type: 'object', additionalProperties: true },
          diagnosisCodes: { type: 'array', items: { type: 'string' } },
          diagnosisText: { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 400: baseError, 401: baseError, 403: baseError, 404: baseError },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) return reply.code(400).send({ message: 'x-org-id header is required' });

    const denied = await deps.enforcePermission(req, reply, 'encounters.update', organizationId, branchId);
    if (denied) return;

    const existing = await deps.repository.getEncounterById(String(req.params.encounterId));
    if (!existing) return reply.code(404).send({ message: 'Encounter not found' });
    if (String(existing.providerUserId) !== req.auth.userId) {
      return reply.code(403).send({ message: 'Only the creator can edit this record' });
    }
    if (existing.editableUntil && new Date(existing.editableUntil).getTime() < Date.now()) {
      emitAudit(deps, req, {
        userId: req.auth.userId,
        organizationId,
        eventType: 'CORRECTION_REQUEST_CREATED',
        action: 'encounters.update',
        outcome: 'failure',
        metadata: { encounterId: existing.encounterId, reason: 'edit_window_expired' },
      });
      return reply.code(403).send({ message: 'EDIT_WINDOW_EXPIRED_USE_TASKFORCE_WORKFLOW' });
    }

    const setDoc = { ...req.body, updatedAt: now() };
    await deps.repository.updateEncounter(existing.encounterId, setDoc);
    const updated = await deps.repository.getEncounterById(existing.encounterId);
    emitAudit(deps, req, {
      userId: req.auth.userId,
      organizationId,
      eventType: 'ENCOUNTER_UPDATED',
      action: 'encounters.update',
      outcome: 'success',
      metadata: { encounterId: existing.encounterId },
    });
    return reply.send({ encounter: updated });
  });
}

module.exports = { registerRoutes };
