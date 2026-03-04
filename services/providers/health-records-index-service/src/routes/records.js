const crypto = require('crypto');

const ENTRY_TYPES = ['citizen_symptom', 'encounter', 'lab_result', 'pharmacy_dispense', 'note'];
const DAY_MS = 24 * 60 * 60 * 1000;

const baseErrorResponseSchema = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string' },
  },
};

function now() {
  return new Date();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0);
}

function mapEntry(entry) {
  return {
    entryId: entry.entryId,
    recordId: entry.recordId,
    entryType: entry.entryType,
    payload: entry.payload || {},
    createdBy: entry.createdBy || null,
    pointers: entry.pointers || { service: null, resourceId: null },
    visibility: entry.visibility || { hidden: false, hiddenFromOrgs: [], hiddenFromRoles: [] },
    editableUntil: entry.editableUntil || null,
    audit: entry.audit || { lastEditedAt: null, lastEditedBy: null },
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
  };
}

function shouldHideForProvider(entry, organizationId, roles) {
  const visibility = entry.visibility || {};
  if (visibility.hidden !== true) {
    return false;
  }
  const hiddenFromOrgs = normalizeStringArray(visibility.hiddenFromOrgs);
  const hiddenFromRoles = normalizeStringArray(visibility.hiddenFromRoles);
  if (hiddenFromOrgs.length === 0 && hiddenFromRoles.length === 0) {
    return true;
  }
  if (organizationId && hiddenFromOrgs.includes(String(organizationId))) {
    return true;
  }
  const userRoles = Array.isArray(roles) ? roles.map((role) => String(role)) : [];
  return hiddenFromRoles.some((role) => userRoles.includes(role));
}

function deriveContributingInstitutions(entries) {
  const byOrg = new Map();
  for (const entry of entries) {
    const organizationId = entry?.createdBy?.organizationId || null;
    if (!organizationId) continue;
    if (!byOrg.has(organizationId)) {
      byOrg.set(organizationId, {
        organizationId,
        branchIds: [],
      });
    }
    const branchId = entry?.createdBy?.branchId || null;
    if (branchId && !byOrg.get(organizationId).branchIds.includes(branchId)) {
      byOrg.get(organizationId).branchIds.push(branchId);
    }
  }
  return Array.from(byOrg.values());
}

function getRoleContext(req) {
  if (req.headers['x-role-context']) return String(req.headers['x-role-context']);
  if (Array.isArray(req.auth?.roles) && req.auth.roles.length > 0) {
    return String(req.auth.roles[0]);
  }
  return null;
}

function buildNotificationPayload({ citizenUserId, citizenNin, accessedByUserId, orgId, branchId }) {
  return {
    eventType: 'RECORD_ACCESSED',
    payload: {
      citizenUserId: citizenUserId || null,
      citizenNin: citizenNin || null,
      accessedByUserId: accessedByUserId || null,
      orgId: orgId || null,
      branchId: branchId || null,
      timestamp: now().toISOString(),
    },
  };
}

async function ensureRecordForCitizen(repository, authUser, req) {
  const citizenNin = String(authUser.nin);
  const existingByUserId = await repository.findRecordByCitizenUserId(req.auth.userId);
  if (existingByUserId) {
    if (!existingByUserId.citizenNin || existingByUserId.citizenNin !== citizenNin) {
      await repository.updateRecord(existingByUserId.recordId, { citizenNin, updatedAt: now() });
      existingByUserId.citizenNin = citizenNin;
      existingByUserId.updatedAt = now();
    }
    return existingByUserId;
  }

  const existingByNin = await repository.findRecordByNin(citizenNin);
  if (existingByNin) {
    await repository.updateRecord(existingByNin.recordId, {
      citizenUserId: req.auth.userId,
      updatedAt: now(),
    });
    existingByNin.citizenUserId = req.auth.userId;
    existingByNin.updatedAt = now();
    return existingByNin;
  }

  return repository.insertRecord({
    recordId: crypto.randomUUID(),
    citizenUserId: req.auth.userId,
    citizenNin,
    createdAt: now(),
    updatedAt: now(),
  });
}

async function ensureRecordForNin(repository, citizenNin) {
  const existingByNin = await repository.findRecordByNin(citizenNin);
  if (existingByNin) return existingByNin;
  return repository.insertRecord({
    recordId: crypto.randomUUID(),
    citizenUserId: null,
    citizenNin,
    createdAt: now(),
    updatedAt: now(),
  });
}

function registerRecordsRoutes(fastify, deps) {
  const {
    getRepository,
    requireAuth,
    enforcePermission,
    fetchAuthMe,
    emitNotificationEvent,
    emitAuditEvent,
  } = deps;

  function repository() {
    return getRepository();
  }

  fastify.get('/records/me', {
    preHandler: requireAuth,
    schema: {
      tags: ['Health Records'],
      summary: 'Get citizen timeline metadata',
      description: 'Returns the authenticated citizen timeline entries and contributing institutions derived only from entries.',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            recordId: { type: 'string' },
            citizenUserId: { type: 'string' },
            citizenNin: { type: 'string' },
            entries: { type: 'array', items: { type: 'object', additionalProperties: true } },
            contributingInstitutions: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        400: baseErrorResponseSchema,
        401: baseErrorResponseSchema,
        403: baseErrorResponseSchema,
        503: baseErrorResponseSchema,
      },
    },
  }, async (req, reply) => {
    const denied = await enforcePermission(req, reply, 'records.me.read');
    if (denied) return;

    const authUser = await fetchAuthMe(req.headers.authorization);
    if (!authUser?.nin) {
      return reply.code(400).send({ message: 'No NIN linked to user' });
    }

    const record = await ensureRecordForCitizen(repository(), authUser, req);
    const entries = await repository().listEntriesByRecord(record.recordId);
    const mappedEntries = entries.map(mapEntry);
    return reply.send({
      recordId: record.recordId,
      citizenUserId: record.citizenUserId,
      citizenNin: record.citizenNin,
      entries: mappedEntries,
      contributingInstitutions: deriveContributingInstitutions(entries),
    });
  });

  fastify.get('/records/:nin', {
    preHandler: requireAuth,
    schema: {
      tags: ['Health Records'],
      summary: 'Provider timeline view by NIN',
      description: 'Provider read with organization/branch scope. Hidden entries are filtered by org/role visibility.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['nin'],
        properties: {
          nin: { type: 'string', pattern: '^\\d{11}$' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            recordId: { type: 'string' },
            citizenUserId: { type: ['string', 'null'] },
            citizenNin: { type: 'string' },
            entries: { type: 'array', items: { type: 'object', additionalProperties: true } },
            contributingInstitutions: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        400: baseErrorResponseSchema,
        401: baseErrorResponseSchema,
        403: baseErrorResponseSchema,
        503: baseErrorResponseSchema,
      },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) {
      return reply.code(400).send({ message: 'x-org-id header is required' });
    }
    const denied = await enforcePermission(req, reply, 'records.nin.read', organizationId, branchId);
    if (denied) return;

    const citizenNin = String(req.params.nin);
    const record = await ensureRecordForNin(repository(), citizenNin);
    const entries = await repository().listEntriesByRecord(record.recordId);
    const visibleEntries = entries.filter((entry) => !shouldHideForProvider(entry, organizationId, req.auth.roles));

    emitNotificationEvent(buildNotificationPayload({
      citizenUserId: record.citizenUserId,
      citizenNin: record.citizenNin,
      accessedByUserId: req.auth.userId,
      orgId: organizationId,
      branchId,
    }));
    emitAuditEvent({
      userId: req.auth.userId,
      organizationId,
      eventType: 'RECORD_ACCESSED',
      action: 'records.nin.read',
      resource: { type: 'record', id: record.recordId },
      permissionKey: 'records.nin.read',
      outcome: 'success',
      metadata: { citizenNin, branchId },
    });

    return reply.send({
      recordId: record.recordId,
      citizenUserId: record.citizenUserId,
      citizenNin: record.citizenNin,
      entries: visibleEntries.map(mapEntry),
      contributingInstitutions: deriveContributingInstitutions(visibleEntries),
    });
  });

  fastify.post('/records/me/symptoms', {
    preHandler: requireAuth,
    schema: {
      tags: ['Health Records'],
      summary: 'Create citizen symptom timeline entry',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['symptoms'],
        properties: {
          symptoms: { type: 'array', minItems: 1, items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        400: baseErrorResponseSchema,
        401: baseErrorResponseSchema,
        403: baseErrorResponseSchema,
      },
    },
  }, async (req, reply) => {
    const denied = await enforcePermission(req, reply, 'records.symptoms.create');
    if (denied) return;

    const authUser = await fetchAuthMe(req.headers.authorization);
    if (!authUser?.nin) {
      return reply.code(400).send({ message: 'No NIN linked to user' });
    }
    const record = await ensureRecordForCitizen(repository(), authUser, req);
    const entry = await repository().insertEntry({
      entryId: crypto.randomUUID(),
      recordId: record.recordId,
      entryType: 'citizen_symptom',
      payload: {
        symptoms: normalizeStringArray(req.body.symptoms),
        note: req.body.note || null,
      },
      createdBy: {
        organizationId: null,
        branchId: null,
        providerUserId: null,
        providerRoleContext: null,
        citizenUserId: req.auth.userId,
      },
      createdAt: now(),
      editableUntil: null,
      visibility: {
        hidden: false,
        hiddenFromOrgs: [],
        hiddenFromRoles: [],
      },
      pointers: {
        service: null,
        resourceId: null,
      },
      audit: {
        lastEditedAt: null,
        lastEditedBy: null,
      },
      updatedAt: now(),
    });

    await repository().updateRecord(record.recordId, { updatedAt: now() });
    emitAuditEvent({
      userId: req.auth.userId,
      organizationId: null,
      eventType: 'RECORD_ENTRY_CREATED',
      action: 'records.symptoms.create',
      resource: { type: 'record_entry', id: entry.entryId },
      permissionKey: 'records.symptoms.create',
      outcome: 'success',
      metadata: { entryType: entry.entryType },
    });

    return reply.code(201).send({ entry: mapEntry(entry) });
  });

  fastify.post('/records/:nin/entries', {
    preHandler: requireAuth,
    schema: {
      tags: ['Health Records'],
      summary: 'Create provider timeline metadata entry',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['nin'],
        properties: {
          nin: { type: 'string', pattern: '^\\d{11}$' },
        },
      },
      body: {
        type: 'object',
        required: ['entryType'],
        properties: {
          entryType: { type: 'string', enum: ['encounter', 'lab_result', 'pharmacy_dispense', 'note'] },
          payload: { type: 'object', additionalProperties: true },
          pointers: {
            type: 'object',
            properties: {
              service: { type: 'string' },
              resourceId: { type: 'string' },
            },
          },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        400: baseErrorResponseSchema,
        401: baseErrorResponseSchema,
        403: baseErrorResponseSchema,
      },
    },
  }, async (req, reply) => {
    const organizationId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;
    if (!organizationId) {
      return reply.code(400).send({ message: 'x-org-id header is required' });
    }
    const denied = await enforcePermission(req, reply, 'records.entry.create', organizationId, branchId);
    if (denied) return;

    const citizenNin = String(req.params.nin);
    const record = await ensureRecordForNin(repository(), citizenNin);
    const createdAt = now();
    const entry = await repository().insertEntry({
      entryId: crypto.randomUUID(),
      recordId: record.recordId,
      entryType: String(req.body.entryType),
      payload: req.body.payload || {},
      createdBy: {
        organizationId,
        branchId,
        providerUserId: req.auth.userId,
        providerRoleContext: getRoleContext(req),
        citizenUserId: null,
      },
      createdAt,
      editableUntil: new Date(createdAt.getTime() + DAY_MS),
      visibility: {
        hidden: false,
        hiddenFromOrgs: [],
        hiddenFromRoles: [],
      },
      pointers: {
        service: req.body?.pointers?.service || null,
        resourceId: req.body?.pointers?.resourceId || null,
      },
      audit: {
        lastEditedAt: null,
        lastEditedBy: null,
      },
      updatedAt: createdAt,
    });

    await repository().updateRecord(record.recordId, { updatedAt: now() });
    emitAuditEvent({
      userId: req.auth.userId,
      organizationId,
      eventType: 'RECORD_ENTRY_CREATED',
      action: 'records.entry.create',
      resource: { type: 'record_entry', id: entry.entryId },
      permissionKey: 'records.entry.create',
      outcome: 'success',
      metadata: { entryType: entry.entryType, citizenNin },
    });

    return reply.code(201).send({ entry: mapEntry(entry) });
  });

  fastify.patch('/records/entries/:entryId', {
    preHandler: requireAuth,
    schema: {
      tags: ['Health Records'],
      summary: 'Edit record timeline entry with ownership and time-window checks',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['entryId'],
        properties: {
          entryId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['payload'],
        properties: {
          payload: { type: 'object', additionalProperties: true },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        401: baseErrorResponseSchema,
        403: baseErrorResponseSchema,
        404: baseErrorResponseSchema,
      },
    },
  }, async (req, reply) => {
    const denied = await enforcePermission(req, reply, 'records.entry.update');
    if (denied) return;

    const entry = await repository().findEntryById(String(req.params.entryId));
    if (!entry) return reply.code(404).send({ message: 'Entry not found' });

    const createdBy = entry.createdBy || {};
    const isCitizenCreator = createdBy.citizenUserId && String(createdBy.citizenUserId) === req.auth.userId;
    const isProviderCreator = createdBy.providerUserId && String(createdBy.providerUserId) === req.auth.userId;

    if (!isCitizenCreator && !isProviderCreator) {
      return reply.code(403).send({ message: 'Only the creator can edit this entry' });
    }

    if (isProviderCreator && entry.editableUntil && new Date(entry.editableUntil).getTime() < Date.now()) {
      emitAuditEvent({
        userId: req.auth.userId,
        organizationId: createdBy.organizationId || null,
        eventType: 'RECORD_ENTRY_EDIT_DENIED',
        action: 'records.entry.update',
        resource: { type: 'record_entry', id: entry.entryId },
        permissionKey: 'records.entry.update',
        outcome: 'failure',
        failureReason: 'EDIT_WINDOW_EXPIRED_USE_TASKFORCE_WORKFLOW',
      });
      return reply.code(403).send({ message: 'EDIT_WINDOW_EXPIRED_USE_TASKFORCE_WORKFLOW' });
    }

    await repository().updateEntry(entry.entryId, {
      payload: req.body.payload || {},
      updatedAt: now(),
      audit: {
        ...(entry.audit || { lastEditedAt: null, lastEditedBy: null }),
        lastEditedAt: now(),
        lastEditedBy: req.auth.userId,
      },
    });
    const updated = await repository().findEntryById(entry.entryId);
    emitAuditEvent({
      userId: req.auth.userId,
      organizationId: createdBy.organizationId || null,
      eventType: 'RECORD_ENTRY_UPDATED',
      action: 'records.entry.update',
      resource: { type: 'record_entry', id: entry.entryId },
      permissionKey: 'records.entry.update',
      outcome: 'success',
    });
    return reply.send({ entry: mapEntry(updated) });
  });

  fastify.post('/records/entries/:entryId/hide', {
    preHandler: requireAuth,
    schema: {
      tags: ['Health Records'],
      summary: 'Citizen hide rules for a timeline entry',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['entryId'],
        properties: {
          entryId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['hidden'],
        properties: {
          hidden: { type: 'boolean' },
          hiddenFromOrgs: { type: 'array', items: { type: 'string' } },
          hiddenFromRoles: { type: 'array', items: { type: 'string' } },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        401: baseErrorResponseSchema,
        403: baseErrorResponseSchema,
        404: baseErrorResponseSchema,
      },
    },
  }, async (req, reply) => {
    const denied = await enforcePermission(req, reply, 'records.entry.hide');
    if (denied) return;

    const entry = await repository().findEntryById(String(req.params.entryId));
    if (!entry) return reply.code(404).send({ message: 'Entry not found' });
    const isCitizenOwner = String(entry?.createdBy?.citizenUserId || '') === req.auth.userId;
    if (!isCitizenOwner) {
      return reply.code(403).send({ message: 'Only the citizen owner can hide this entry' });
    }

    const hidden = req.body.hidden === true;
    await repository().updateEntry(entry.entryId, {
      visibility: {
        hidden,
        hiddenFromOrgs: normalizeStringArray(req.body.hiddenFromOrgs),
        hiddenFromRoles: normalizeStringArray(req.body.hiddenFromRoles),
      },
      updatedAt: now(),
      audit: {
        ...(entry.audit || { lastEditedAt: null, lastEditedBy: null }),
        lastEditedAt: now(),
        lastEditedBy: req.auth.userId,
      },
    });

    emitAuditEvent({
      userId: req.auth.userId,
      organizationId: null,
      eventType: 'RECORD_ENTRY_VISIBILITY_UPDATED',
      action: 'records.entry.hide',
      resource: { type: 'record_entry', id: entry.entryId },
      permissionKey: 'records.entry.hide',
      outcome: 'success',
    });

    const updated = await repository().findEntryById(entry.entryId);
    return reply.send({ entry: mapEntry(updated) });
  });
}

module.exports = {
  registerRecordsRoutes,
  shouldHideForProvider,
  deriveContributingInstitutions,
};
