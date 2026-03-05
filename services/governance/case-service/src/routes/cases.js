const crypto = require('crypto');

function now() { return new Date(); }

const statusTransitions = {
  open: ['in_review', 'escalated', 'closed'],
  in_review: ['awaiting_approval', 'resolved', 'escalated', 'closed'],
  awaiting_approval: ['approved', 'rejected', 'escalated'],
  approved: ['resolved', 'closed'],
  rejected: ['closed', 'escalated'],
  resolved: ['closed'],
  escalated: ['in_review', 'awaiting_approval', 'resolved', 'closed'],
  closed: [],
};

function nextLevel(level) {
  const order = ['LGA', 'STATE', 'REGION', 'NATIONAL'];
  const idx = order.indexOf(String(level || '').toUpperCase());
  if (idx < 0 || idx >= order.length - 1) return null;
  return order[idx + 1];
}

async function appendAction(deps, caseId, actionType, performedByUserId, payload = {}) {
  const action = {
    actionId: crypto.randomUUID(),
    caseId,
    actionType,
    performedByUserId,
    payload,
    createdAt: now(),
  };
  await deps.repository.actions().insertOne(action);
  return action;
}

async function ensureRoomSystemMessage(deps, caseId, body, senderUserId = 'system') {
  const room = await deps.repository.rooms().findOne({ caseId });
  if (!room) return null;
  const message = {
    messageId: crypto.randomUUID(),
    roomId: room.roomId,
    senderUserId,
    messageType: 'system',
    body,
    createdAt: now(),
  };
  await deps.repository.messages().insertOne(message);
  await deps.repository.rooms().updateOne({ roomId: room.roomId }, { $set: { updatedAt: now() } });
  return message;
}

async function getUnitMembers(deps, unitId) {
  const res = await deps.callJson(`${deps.taskforceDirectoryApiBaseUrl}/internal/taskforce/units/${encodeURIComponent(String(unitId))}/members`, {
    method: 'GET',
    headers: { 'x-internal-token': deps.internalServiceToken, 'content-type': 'application/json' },
  });
  return res.ok ? (res.body?.items || []) : [];
}

async function getUnit(deps, unitId) {
  const res = await deps.callJson(`${deps.taskforceDirectoryApiBaseUrl}/internal/taskforce/units/${encodeURIComponent(String(unitId))}`, {
    method: 'GET',
    headers: { 'x-internal-token': deps.internalServiceToken, 'content-type': 'application/json' },
  });
  return res.ok ? (res.body?.unit || null) : null;
}

async function resolveUnit(deps, location, startLevel = 'LGA') {
  const res = await deps.callJson(`${deps.taskforceDirectoryApiBaseUrl}/internal/taskforce/resolve`, {
    method: 'POST',
    headers: { 'x-internal-token': deps.internalServiceToken, 'content-type': 'application/json' },
    body: JSON.stringify({ location, startLevel }),
  });
  if (!res.ok) return null;
  return res.body || null;
}

async function hasMemberRole(deps, unitId, userId, allowedRoles) {
  const members = await getUnitMembers(deps, unitId);
  return members.some((m) => String(m.userId) === String(userId) && Array.isArray(m.roles) && m.roles.some((r) => allowedRoles.includes(r)));
}

function registerCaseRoutes(fastify, deps) {
  const err = { type: 'object', required: ['message'], properties: { message: { type: 'string' } } };

  fastify.post('/cases', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Create governance case',
      description: 'Creates complaint/correction case, auto-routes to taskforce unit, creates room, and notifies assigned unit.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['caseType', 'subject', 'description'],
        properties: {
          caseType: { type: 'string', enum: ['CITIZEN_COMPLAINT', 'PROVIDER_COMPLAINT', 'RECORD_CORRECTION'] },
          subject: { type: 'string' },
          description: { type: 'string' },
          nin: { type: 'string', pattern: '^\\d{11}$' },
          location: { type: 'object', properties: { region: { type: 'string' }, state: { type: 'string' }, lga: { type: 'string' } } },
          related: { type: 'object', additionalProperties: true },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, 400: err, 401: err, 403: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.case.create');
    if (denied) return;

    const location = req.body.location || {};
    const resolved = await resolveUnit(deps, location, 'LGA');
    const assignedUnitId = resolved?.unitId || null;
    const assignedLevel = resolved?.level || null;

    const caseId = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    const createdAt = now();

    const caseDoc = {
      caseId,
      caseType: req.body.caseType,
      createdByUserId: req.auth.userId,
      createdByType: req.headers['x-org-id'] ? 'provider' : 'citizen',
      nin: req.body.nin || null,
      related: {
        recordEntryId: req.body.related?.recordEntryId || null,
        pointers: req.body.related?.pointers || null,
      },
      subject: req.body.subject,
      description: req.body.description,
      location: {
        region: location.region || null,
        state: location.state || null,
        lga: location.lga || null,
      },
      routing: {
        assignedUnitId,
        assignedLevel,
        escalationCount: 0,
      },
      status: 'open',
      createdAt,
      updatedAt: createdAt,
    };

    await deps.repository.cases().insertOne(caseDoc);
    await appendAction(deps, caseId, 'CREATED', req.auth.userId, { assignedUnitId, assignedLevel });

    const unitMembers = assignedUnitId ? await getUnitMembers(deps, assignedUnitId) : [];
    const participants = [
      { userId: req.auth.userId, unitId: null, role: caseDoc.createdByType },
      ...unitMembers.map((m) => ({ userId: m.userId, unitId: assignedUnitId, role: Array.isArray(m.roles) ? m.roles[0] : 'reviewer' })),
    ];

    await deps.repository.rooms().insertOne({ roomId, caseId, participants, createdAt, updatedAt: createdAt });

    deps.emitNotification({
      eventType: 'TASKFORCE_CASE_ASSIGNED',
      payload: { caseId, unitId: assignedUnitId, level: assignedLevel, subject: caseDoc.subject },
      targets: unitMembers.map((m) => ({ userId: m.userId, unitId: assignedUnitId })),
    });

    deps.emitAudit({
      userId: req.auth.userId,
      organizationId: req.headers['x-org-id'] || null,
      eventType: 'GOVERNANCE_CASE_CREATED',
      action: 'governance.case.create',
      permissionKey: 'governance.case.create',
      resource: { type: 'governance_case', id: caseId },
      outcome: 'success',
      metadata: { assignedUnitId, assignedLevel },
      ipAddress: deps.getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });

    return reply.code(201).send({ case: caseDoc, roomId });
  });

  fastify.get('/cases', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'List governance cases',
      security: [{ bearerAuth: [] }],
      querystring: { type: 'object', properties: { status: { type: 'string' }, caseType: { type: 'string' }, assignedUnitId: { type: 'string' }, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.case.read');
    if (denied) return;

    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
    const filter = {};
    if (req.query?.status) filter.status = req.query.status;
    if (req.query?.caseType) filter.caseType = req.query.caseType;
    if (req.query?.assignedUnitId) filter['routing.assignedUnitId'] = req.query.assignedUnitId;

    const [items, total] = await Promise.all([
      deps.repository.cases().find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      deps.repository.cases().countDocuments(filter),
    ]);
    return reply.send({ page, limit, total, items });
  });

  fastify.get('/cases/:caseId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Get governance case details',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['caseId'], properties: { caseId: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.case.read');
    if (denied) return;

    const caseDoc = await deps.repository.cases().findOne({ caseId: req.params.caseId });
    if (!caseDoc) return reply.code(404).send({ message: 'Case not found' });
    const [room, actions] = await Promise.all([
      deps.repository.rooms().findOne({ caseId: caseDoc.caseId }),
      deps.repository.actions().find({ caseId: caseDoc.caseId }).sort({ createdAt: -1 }).limit(20).toArray(),
    ]);
    return reply.send({ case: caseDoc, roomId: room?.roomId || null, recentActions: actions });
  });

  fastify.patch('/cases/:caseId/status', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Update case status',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['caseId'], properties: { caseId: { type: 'string' } } },
      body: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['open', 'in_review', 'awaiting_approval', 'approved', 'rejected', 'resolved', 'escalated', 'closed'] } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: err, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.case.update_status');
    if (denied) return;
    const caseDoc = await deps.repository.cases().findOne({ caseId: req.params.caseId });
    if (!caseDoc) return reply.code(404).send({ message: 'Case not found' });

    const allowed = statusTransitions[caseDoc.status] || [];
    if (!allowed.includes(req.body.status)) {
      return reply.code(400).send({ message: `Invalid transition from ${caseDoc.status} to ${req.body.status}` });
    }

    await deps.repository.cases().updateOne({ caseId: caseDoc.caseId }, { $set: { status: req.body.status, updatedAt: now() } });
    await appendAction(deps, caseDoc.caseId, 'STATUS_CHANGED', req.auth.userId, { from: caseDoc.status, to: req.body.status });
    await ensureRoomSystemMessage(deps, caseDoc.caseId, `Case status changed to ${req.body.status}`, req.auth.userId);
    return reply.send({ message: 'Case status updated' });
  });

  fastify.post('/cases/:caseId/corrections/propose', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Propose record correction',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['caseId'], properties: { caseId: { type: 'string' } } },
      body: { type: 'object', required: ['proposedChanges', 'reason'], properties: { proposedChanges: { type: 'object', additionalProperties: true }, reason: { type: 'string' }, evidence: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.correction.propose');
    if (denied) return;

    const caseDoc = await deps.repository.cases().findOne({ caseId: req.params.caseId });
    if (!caseDoc) return reply.code(404).send({ message: 'Case not found' });
    if (!caseDoc.routing?.assignedUnitId) return reply.code(403).send({ message: 'Case is not assigned to a taskforce unit' });

    const canPropose = await hasMemberRole(deps, caseDoc.routing.assignedUnitId, req.auth.userId, ['reviewer', 'approver']);
    if (!canPropose) return reply.code(403).send({ message: 'Only assigned reviewers can propose corrections' });

    await appendAction(deps, caseDoc.caseId, 'PROPOSED_CORRECTION', req.auth.userId, {
      proposedChanges: req.body.proposedChanges,
      reason: req.body.reason,
      evidence: req.body.evidence || [],
    });
    await deps.repository.cases().updateOne({ caseId: caseDoc.caseId }, { $set: { status: 'awaiting_approval', updatedAt: now() } });
    await ensureRoomSystemMessage(deps, caseDoc.caseId, 'Correction proposed; awaiting approval', req.auth.userId);

    return reply.send({ message: 'Correction proposed' });
  });

  fastify.post('/cases/:caseId/corrections/approve', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Approve correction',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['caseId'], properties: { caseId: { type: 'string' } } },
      body: { type: 'object', required: ['decisionNotes'], properties: { decisionNotes: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err, 404: err, 502: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.correction.approve');
    if (denied) return;

    const caseDoc = await deps.repository.cases().findOne({ caseId: req.params.caseId });
    if (!caseDoc) return reply.code(404).send({ message: 'Case not found' });

    const unit = caseDoc.routing?.assignedUnitId ? await getUnit(deps, caseDoc.routing.assignedUnitId) : null;
    const isApprover = caseDoc.routing?.assignedUnitId ? await hasMemberRole(deps, caseDoc.routing.assignedUnitId, req.auth.userId, ['approver']) : false;
    const canApprove = isApprover || unit?.level === 'NATIONAL';
    if (!canApprove) return reply.code(403).send({ message: 'Approval requires approver authority' });

    if (caseDoc.nin) {
      const indexRes = await deps.callJson(`${deps.healthRecordsIndexApiBaseUrl}/records/${encodeURIComponent(String(caseDoc.nin))}/entries`, {
        method: 'POST',
        headers: {
          authorization: req.headers.authorization,
          'x-org-id': req.headers['x-org-id'] || 'taskforce',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          entryType: 'note',
          payload: {
            type: 'correction_approved',
            caseId: caseDoc.caseId,
            decisionNotes: req.body.decisionNotes,
            related: caseDoc.related || null,
          },
          pointers: caseDoc.related?.pointers || null,
        }),
      });
      if (!indexRes.ok) {
        return reply.code(502).send({ message: 'Failed to append correction amendment to records index' });
      }
    }

    await appendAction(deps, caseDoc.caseId, 'APPROVED', req.auth.userId, { decisionNotes: req.body.decisionNotes });
    await deps.repository.cases().updateOne({ caseId: caseDoc.caseId }, { $set: { status: 'approved', updatedAt: now() } });
    await ensureRoomSystemMessage(deps, caseDoc.caseId, 'Correction approved', req.auth.userId);

    deps.emitAudit({
      userId: req.auth.userId,
      organizationId: req.headers['x-org-id'] || null,
      eventType: 'RECORD_CORRECTION_APPROVED',
      action: 'governance.correction.approve',
      permissionKey: 'governance.correction.approve',
      resource: { type: 'governance_case', id: caseDoc.caseId },
      outcome: 'success',
      metadata: { decisionNotes: req.body.decisionNotes },
      ipAddress: deps.getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });

    return reply.send({ message: 'Correction approved' });
  });

  fastify.post('/cases/:caseId/corrections/reject', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Reject correction',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['caseId'], properties: { caseId: { type: 'string' } } },
      body: { type: 'object', required: ['decisionNotes'], properties: { decisionNotes: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.correction.reject');
    if (denied) return;

    const caseDoc = await deps.repository.cases().findOne({ caseId: req.params.caseId });
    if (!caseDoc) return reply.code(404).send({ message: 'Case not found' });

    const unit = caseDoc.routing?.assignedUnitId ? await getUnit(deps, caseDoc.routing.assignedUnitId) : null;
    const isApprover = caseDoc.routing?.assignedUnitId ? await hasMemberRole(deps, caseDoc.routing.assignedUnitId, req.auth.userId, ['approver']) : false;
    const canReject = isApprover || unit?.level === 'NATIONAL';
    if (!canReject) return reply.code(403).send({ message: 'Reject requires approver authority' });

    await appendAction(deps, caseDoc.caseId, 'REJECTED', req.auth.userId, { decisionNotes: req.body.decisionNotes });
    await deps.repository.cases().updateOne({ caseId: caseDoc.caseId }, { $set: { status: 'rejected', updatedAt: now() } });
    await ensureRoomSystemMessage(deps, caseDoc.caseId, 'Correction rejected', req.auth.userId);

    deps.emitAudit({
      userId: req.auth.userId,
      organizationId: req.headers['x-org-id'] || null,
      eventType: 'RECORD_CORRECTION_REJECTED',
      action: 'governance.correction.reject',
      permissionKey: 'governance.correction.reject',
      resource: { type: 'governance_case', id: caseDoc.caseId },
      outcome: 'success',
      metadata: { decisionNotes: req.body.decisionNotes },
      ipAddress: deps.getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });

    return reply.send({ message: 'Correction rejected' });
  });

  fastify.post('/cases/:caseId/escalate', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Escalate governance case',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['caseId'], properties: { caseId: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'governance.case.escalate');
    if (denied) return;

    const caseDoc = await deps.repository.cases().findOne({ caseId: req.params.caseId });
    if (!caseDoc) return reply.code(404).send({ message: 'Case not found' });

    const startLevel = nextLevel(caseDoc.routing?.assignedLevel || 'LGA');
    if (!startLevel) return reply.send({ message: 'Case is already at highest level' });

    const resolved = await resolveUnit(deps, caseDoc.location || {}, startLevel);
    if (!resolved?.unitId) return reply.send({ message: 'No higher taskforce unit found', escalated: false });

    const escalationCount = Number(caseDoc.routing?.escalationCount || 0) + 1;
    await deps.repository.cases().updateOne(
      { caseId: caseDoc.caseId },
      {
        $set: {
          'routing.assignedUnitId': resolved.unitId,
          'routing.assignedLevel': resolved.level,
          'routing.escalationCount': escalationCount,
          status: 'escalated',
          updatedAt: now(),
        },
      }
    );

    const newMembers = await getUnitMembers(deps, resolved.unitId);
    const room = await deps.repository.rooms().findOne({ caseId: caseDoc.caseId });
    if (room) {
      const existingKeys = new Set((room.participants || []).map((p) => `${p.userId}:${p.unitId || 'none'}`));
      const additions = newMembers
        .map((m) => ({ userId: m.userId, unitId: resolved.unitId, role: Array.isArray(m.roles) ? m.roles[0] : 'reviewer' }))
        .filter((p) => !existingKeys.has(`${p.userId}:${p.unitId || 'none'}`));
      if (additions.length > 0) {
        await deps.repository.rooms().updateOne(
          { roomId: room.roomId },
          { $set: { participants: [...(room.participants || []), ...additions], updatedAt: now() } }
        );
      }
    }

    await appendAction(deps, caseDoc.caseId, 'ESCALATED', req.auth.userId, {
      fromUnitId: caseDoc.routing?.assignedUnitId || null,
      toUnitId: resolved.unitId,
      toLevel: resolved.level,
      escalationCount,
    });
    await ensureRoomSystemMessage(deps, caseDoc.caseId, `Case escalated to ${resolved.level}`, req.auth.userId);

    return reply.send({ message: 'Case escalated', assignedUnitId: resolved.unitId, assignedLevel: resolved.level, escalationCount });
  });
}

module.exports = { registerCaseRoutes, resolveUnit, getUnitMembers, hasMemberRole, nextLevel };
