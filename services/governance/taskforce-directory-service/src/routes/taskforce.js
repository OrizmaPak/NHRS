const crypto = require('crypto');

function now() { return new Date(); }

const levelOrder = ['LGA', 'STATE', 'REGION', 'NATIONAL'];

function buildEscalationLevels(startLevel = 'LGA') {
  const idx = Math.max(levelOrder.indexOf(String(startLevel).toUpperCase()), 0);
  return levelOrder.slice(idx);
}

function normalize(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

async function resolveTaskforceUnit(repository, input = {}) {
  const location = input.location || {};
  const levels = buildEscalationLevels(input.startLevel || 'LGA');

  for (const level of levels) {
    const query = { level, status: 'active' };
    if (level === 'LGA') {
      if (!location.lga) continue;
      query['coverage.lga'] = location.lga;
      if (location.state) query['coverage.state'] = location.state;
    } else if (level === 'STATE') {
      if (!location.state) continue;
      query['coverage.state'] = location.state;
    } else if (level === 'REGION') {
      if (!location.region) continue;
      query['coverage.region'] = location.region;
    }

    const unit = await repository.units().findOne(query);
    if (unit) {
      return { unitId: unit.unitId, level: unit.level, unit };
    }
  }

  return { unitId: null, level: null, unit: null };
}

function registerTaskforceRoutes(fastify, deps) {
  const err = { type: 'object', required: ['message'], properties: { message: { type: 'string' } } };

  fastify.post('/taskforce/units', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Create taskforce unit',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['level', 'name'],
        properties: {
          level: { type: 'string', enum: levelOrder },
          name: { type: 'string' },
          coverage: {
            type: 'object',
            properties: { region: { type: 'string' }, state: { type: 'string' }, lga: { type: 'string' } },
          },
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, 401: err, 403: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'taskforce.unit.create');
    if (denied) return;

    const unit = {
      unitId: crypto.randomUUID(),
      level: req.body.level,
      name: req.body.name,
      coverage: {
        region: req.body.coverage?.region || null,
        state: req.body.coverage?.state || null,
        lga: req.body.coverage?.lga || null,
      },
      status: req.body.status || 'active',
      createdAt: now(),
      updatedAt: now(),
    };
    await deps.repository.units().insertOne(unit);
    deps.emitAudit({
      userId: req.auth.userId,
      eventType: 'TASKFORCE_UNIT_CREATED',
      action: 'taskforce.unit.create',
      permissionKey: 'taskforce.unit.create',
      resource: { type: 'taskforce_unit', id: unit.unitId },
      outcome: 'success',
      metadata: { level: unit.level },
      ipAddress: deps.getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    return reply.code(201).send({ unit });
  });

  fastify.get('/taskforce/units', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'List taskforce units',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { level: { type: 'string' }, region: { type: 'string' }, state: { type: 'string' }, lga: { type: 'string' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'taskforce.unit.read');
    if (denied) return;

    const filter = {};
    if (req.query?.level) filter.level = req.query.level;
    if (req.query?.region) filter['coverage.region'] = req.query.region;
    if (req.query?.state) filter['coverage.state'] = req.query.state;
    if (req.query?.lga) filter['coverage.lga'] = req.query.lga;

    const items = await deps.repository.units().find(filter).sort({ createdAt: -1 }).toArray();
    return reply.send({ items });
  });

  fastify.patch('/taskforce/units/:unitId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Update taskforce unit',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['unitId'], properties: { unitId: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          status: { type: 'string', enum: ['active', 'inactive'] },
          coverage: { type: 'object', properties: { region: { type: 'string' }, state: { type: 'string' }, lga: { type: 'string' } } },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'taskforce.unit.update');
    if (denied) return;

    const existing = await deps.repository.units().findOne({ unitId: req.params.unitId });
    if (!existing) return reply.code(404).send({ message: 'Taskforce unit not found' });
    const updates = { updatedAt: now() };
    if (req.body?.name) updates.name = req.body.name;
    if (req.body?.status) updates.status = req.body.status;
    if (req.body?.coverage) {
      updates.coverage = {
        region: req.body.coverage.region ?? existing.coverage?.region ?? null,
        state: req.body.coverage.state ?? existing.coverage?.state ?? null,
        lga: req.body.coverage.lga ?? existing.coverage?.lga ?? null,
      };
    }
    await deps.repository.units().updateOne({ unitId: req.params.unitId }, { $set: updates });
    return reply.send({ message: 'Taskforce unit updated' });
  });

  fastify.post('/taskforce/units/:unitId/members', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Add taskforce member',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['unitId'], properties: { unitId: { type: 'string' } } },
      body: {
        type: 'object', required: ['userId', 'roles'],
        properties: {
          userId: { type: 'string' },
          orgId: { type: 'string' },
          roles: { type: 'array', items: { type: 'string', enum: ['reviewer', 'approver', 'dispatcher'] } },
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'taskforce.member.manage');
    if (denied) return;
    const unit = await deps.repository.units().findOne({ unitId: req.params.unitId });
    if (!unit) return reply.code(404).send({ message: 'Taskforce unit not found' });

    const member = {
      memberId: crypto.randomUUID(),
      unitId: unit.unitId,
      userId: req.body.userId,
      orgId: req.body.orgId || null,
      roles: Array.isArray(req.body.roles) ? req.body.roles : [],
      status: req.body.status || 'active',
      createdAt: now(),
      updatedAt: now(),
    };

    await deps.repository.members().insertOne(member);
    return reply.code(201).send({ member });
  });

  fastify.get('/taskforce/units/:unitId/members', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'List taskforce members',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['unitId'], properties: { unitId: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'taskforce.unit.read');
    if (denied) return;
    const items = await deps.repository.members().find({ unitId: req.params.unitId }).toArray();
    return reply.send({ items });
  });

  fastify.delete('/taskforce/units/:unitId/members/:memberId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Governance'],
      summary: 'Remove taskforce member',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['unitId', 'memberId'],
        properties: { unitId: { type: 'string' }, memberId: { type: 'string' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err, 403: err, 404: err },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'taskforce.member.manage');
    if (denied) return;
    const existing = await deps.repository.members().findOne({ unitId: req.params.unitId, memberId: req.params.memberId });
    if (!existing) return reply.code(404).send({ message: 'Taskforce member not found' });
    await deps.repository.members().deleteOne({ memberId: req.params.memberId });
    return reply.send({ message: 'Taskforce member removed' });
  });

  fastify.post('/internal/taskforce/resolve', {
    preHandler: deps.requireInternal,
    schema: {
      tags: ['Governance'],
      summary: 'Internal resolve taskforce unit by location',
      body: {
        type: 'object',
        properties: {
          location: {
            type: 'object',
            properties: { region: { type: 'string' }, state: { type: 'string' }, lga: { type: 'string' } },
          },
          startLevel: { type: 'string', enum: levelOrder },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err },
    },
  }, async (req, reply) => {
    const result = await resolveTaskforceUnit(deps.repository, req.body || {});
    if (!result.unitId) return reply.send({ unitId: null, level: null, unit: null });
    return reply.send(result);
  });

  fastify.get('/internal/taskforce/units/:unitId/members', {
    preHandler: deps.requireInternal,
    schema: {
      tags: ['Governance'],
      summary: 'Internal get active unit members',
      params: { type: 'object', required: ['unitId'], properties: { unitId: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err },
    },
  }, async (req) => {
    const members = await deps.repository.members().find({ unitId: req.params.unitId, status: 'active' }).toArray();
    return { items: members };
  });

  fastify.get('/internal/taskforce/units/:unitId', {
    preHandler: deps.requireInternal,
    schema: {
      tags: ['Governance'],
      summary: 'Internal get unit by id',
      params: { type: 'object', required: ['unitId'], properties: { unitId: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: err },
    },
  }, async (req) => {
    const unit = await deps.repository.units().findOne({ unitId: req.params.unitId });
    return { unit: unit || null };
  });
}

module.exports = { registerTaskforceRoutes, resolveTaskforceUnit, levelOrder, normalize };
