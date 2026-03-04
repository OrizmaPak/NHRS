const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const serviceName = 'membership-service';
const port = Number(process.env.PORT) || 8103;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_membership_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';

let dbReady = false;
let mongoClient;
let db;
let fetchClient = (...args) => fetch(...args);

const collections = {
  memberships: () => db.collection('org_memberships'),
  assignments: () => db.collection('branch_assignments'),
  events: () => db.collection('membership_events'),
};

function now() {
  return new Date();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}

function parseBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

async function callJson(url, options = {}) {
  const res = await fetchClient(url, options);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_err) {
      body = { message: text };
    }
  }
  return { ok: res.ok, status: res.status, body };
}

function emitAuditEvent(event) {
  setImmediate(async () => {
    try {
      await fetchClient(`${auditApiBaseUrl}/internal/audit/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (err) {
      fastify.log.warn({ err, eventType: event?.eventType }, 'Membership audit emit failed');
    }
  });
}

async function requireAuth(req, reply) {
  const token = parseBearerToken(req);
  if (!token) return reply.code(401).send({ message: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.auth = { userId: String(payload.sub), token };
  } catch (_err) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
}

async function requireInternal(req, reply) {
  const incoming = req.headers['x-internal-token'];
  if (!incoming || incoming !== internalServiceToken) {
    return reply.code(401).send({ message: 'Unauthorized internal call' });
  }
}

async function requireInternalOrAuth(req, reply) {
  const internal = req.headers['x-internal-token'];
  if (internal && internal === internalServiceToken) {
    req.internal = true;
    return;
  }
  return requireAuth(req, reply);
}

async function enforcePermission(req, reply, permissionKey, organizationId = null) {
  const checked = await callJson(`${rbacApiBaseUrl}/rbac/check`, {
    method: 'POST',
    headers: {
      authorization: req.headers.authorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ permissionKey, organizationId }),
  });

  if (!checked.ok || !checked.body?.allowed) {
    reply.code(checked.status === 401 ? 401 : 403).send({ message: 'Forbidden' });
    return true;
  }
  return false;
}

function validateCoverageType(type) {
  return ['primary', 'secondary', 'floating'].includes(type);
}

async function ensureNinExists(nin, authorization) {
  const ninRes = await callJson(`${authApiBaseUrl}/nin/${nin}`, {
    method: 'GET',
    headers: {
      authorization,
      'content-type': 'application/json',
    },
  });
  if (!ninRes.ok || !ninRes.body) {
    return null;
  }
  return ninRes.body;
}

async function writeEvent(payload) {
  await collections.events().insertOne({
    eventId: crypto.randomUUID(),
    timestamp: now(),
    ...payload,
  });
}

async function connect() {
  if (!mongoUri) {
    fastify.log.warn('Missing MONGODB_URI; membership-service running in degraded mode');
    return;
  }

  try {
    mongoClient = new MongoClient(mongoUri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    await mongoClient.connect();
    db = mongoClient.db(dbName);
    await db.command({ ping: 1 });
    dbReady = true;

    await Promise.all([
      collections.memberships().createIndex({ membershipId: 1 }, { unique: true }),
      collections.memberships().createIndex({ organizationId: 1, nin: 1 }, { unique: true }),
      collections.memberships().createIndex({ userId: 1, organizationId: 1 }),
      collections.assignments().createIndex({ assignmentId: 1 }, { unique: true }),
      collections.assignments().createIndex({ organizationId: 1, membershipId: 1 }),
      collections.events().createIndex({ membershipId: 1, timestamp: -1 }),
      collections.events().createIndex({ organizationId: 1, timestamp: -1 }),
    ]);
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed');
  }
}

fastify.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  if (!dbReady) {
    return reply.code(503).send({ message: 'Membership storage unavailable' });
  }
});

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  dbName,
}));

fastify.post('/orgs/:orgId/members', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Add organization member by NIN',
    security: [{ bearerAuth: [] }],
    params: { type: 'object', required: ['orgId'], properties: { orgId: { type: 'string' } } },
    body: {
      type: 'object',
      required: ['nin'],
      properties: {
        nin: { type: 'string', pattern: '^\\d{11}$' },
        initialRoles: { type: 'array', items: { type: 'string' } },
        initialBranchAssignments: {
          type: 'array',
          items: {
            type: 'object',
            required: ['branchId', 'roles'],
            properties: {
              branchId: { type: 'string' },
              roles: { type: 'array', items: { type: 'string' } },
              departments: { type: 'array', items: { type: 'string' } },
              isPrimary: { type: 'boolean' },
              coverageType: { type: 'string', enum: ['primary', 'secondary', 'floating'] },
              startDate: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      503: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.add', orgId);
  if (denied) return;

  const nin = String(req.body.nin);
  const ninRecord = await ensureNinExists(nin, req.headers.authorization);
  if (!ninRecord) {
    return reply.code(503).send({ message: 'Fetching from NIN is currently not available.' });
  }

  const existing = await collections.memberships().findOne({ organizationId: orgId, nin });
  if (existing) {
    return reply.send({ membership: existing, created: false });
  }

  const membershipId = crypto.randomUUID();
  const membership = {
    membershipId,
    organizationId: orgId,
    userId: null,
    nin,
    addedByUserId: req.auth.userId,
    status: 'invited',
    startDate: now(),
    endDate: null,
    metadata: { notes: null, initialRoles: req.body.initialRoles || [] },
    createdAt: now(),
    updatedAt: now(),
  };
  await collections.memberships().insertOne(membership);

  const initialAssignments = Array.isArray(req.body.initialBranchAssignments) ? req.body.initialBranchAssignments : [];
  for (const assignment of initialAssignments) {
    const assignmentId = crypto.randomUUID();
    await collections.assignments().insertOne({
      assignmentId,
      membershipId,
      organizationId: orgId,
      branchId: assignment.branchId,
      roles: Array.isArray(assignment.roles) ? assignment.roles : [],
      departments: Array.isArray(assignment.departments) ? assignment.departments : [],
      isPrimary: assignment.isPrimary === true,
      coverageType: validateCoverageType(assignment.coverageType) ? assignment.coverageType : 'secondary',
      startDate: assignment.startDate ? new Date(assignment.startDate) : now(),
      endDate: null,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    });
  }

  await writeEvent({
    organizationId: orgId,
    membershipId,
    userId: null,
    nin,
    eventType: 'ORG_MEMBER_ADDED',
    from: null,
    to: { status: 'invited' },
    performedByUserId: req.auth.userId,
    reason: null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_ADDED',
    action: 'org.member.add',
    permissionKey: 'org.member.add',
    resource: { type: 'membership', id: membershipId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { nin, initialAssignments: initialAssignments.length },
  });

  return reply.code(201).send({ membership, created: true });
});

fastify.get('/orgs/:orgId/members', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'List organization members',
    security: [{ bearerAuth: [] }],
    params: { type: 'object', required: ['orgId'], properties: { orgId: { type: 'string' } } },
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        status: { type: 'string' },
        q: { type: 'string' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.read', orgId);
  if (denied) return;

  const { page = 1, limit = 20, status, q } = req.query || {};
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const filter = { organizationId: orgId };
  if (status) filter.status = status;
  if (q) {
    filter.$or = [
      { nin: { $regex: String(q), $options: 'i' } },
      { userId: { $regex: String(q), $options: 'i' } },
    ];
  }

  const [items, total] = await Promise.all([
    collections.memberships().find(filter).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
    collections.memberships().countDocuments(filter),
  ]);
  return reply.send({ page: safePage, limit: safeLimit, total, items });
});

fastify.get('/orgs/:orgId/members/:memberId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Get one organization member with branch assignments',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.read', orgId);
  if (denied) return;

  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });
  if (!membership) return reply.code(404).send({ message: 'Membership not found' });
  const assignments = await collections.assignments().find({ organizationId: orgId, membershipId: membership.membershipId }).toArray();
  return reply.send({ membership, assignments });
});

fastify.patch('/orgs/:orgId/members/:memberId/status', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Change member status',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['invited', 'active', 'suspended', 'left'] },
        reason: { type: 'string' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.status.change', orgId);
  if (denied) return;

  const existing = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });
  if (!existing) return reply.code(404).send({ message: 'Membership not found' });

  const updates = {
    status: req.body.status,
    updatedAt: now(),
  };
  if (req.body.status === 'left') {
    updates.endDate = now();
  }

  await collections.memberships().updateOne({ organizationId: orgId, membershipId: req.params.memberId }, { $set: updates });

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: existing.userId || null,
    nin: existing.nin,
    eventType: 'ORG_MEMBER_STATUS_CHANGED',
    from: { status: existing.status },
    to: { status: req.body.status },
    performedByUserId: req.auth.userId,
    reason: req.body.reason || null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_STATUS_CHANGED',
    action: 'org.member.status.change',
    permissionKey: 'org.member.status.change',
    resource: { type: 'membership', id: req.params.memberId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { from: existing.status, to: req.body.status },
  });

  return reply.send({ message: 'Membership status updated' });
});

fastify.post('/orgs/:orgId/members/:memberId/branches', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Assign member to branch',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['branchId', 'roles'],
      properties: {
        branchId: { type: 'string' },
        roles: { type: 'array', items: { type: 'string' } },
        departments: { type: 'array', items: { type: 'string' } },
        isPrimary: { type: 'boolean' },
        coverageType: { type: 'string', enum: ['primary', 'secondary', 'floating'] },
        startDate: { type: 'string', format: 'date-time' },
      },
    },
    response: { 201: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.branch.assign', orgId);
  if (denied) return;

  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });
  if (!membership) return reply.code(404).send({ message: 'Membership not found' });

  const assignmentId = crypto.randomUUID();
  const assignment = {
    assignmentId,
    membershipId: req.params.memberId,
    organizationId: orgId,
    branchId: req.body.branchId,
    roles: Array.isArray(req.body.roles) ? req.body.roles : [],
    departments: Array.isArray(req.body.departments) ? req.body.departments : [],
    isPrimary: req.body.isPrimary === true,
    coverageType: validateCoverageType(req.body.coverageType) ? req.body.coverageType : 'secondary',
    startDate: req.body.startDate ? new Date(req.body.startDate) : now(),
    endDate: null,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };
  await collections.assignments().insertOne(assignment);

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: membership.userId || null,
    nin: membership.nin,
    eventType: 'BRANCH_ASSIGNED',
    from: null,
    to: { assignmentId, branchId: req.body.branchId, roles: assignment.roles, departments: assignment.departments },
    performedByUserId: req.auth.userId,
    reason: null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_BRANCH_ASSIGNED',
    action: 'org.member.branch.assign',
    permissionKey: 'org.member.branch.assign',
    resource: { type: 'branch_assignment', id: assignmentId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.code(201).send({ assignment });
});

fastify.patch('/orgs/:orgId/members/:memberId/branches/:assignmentId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Update branch assignment',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId', 'assignmentId'],
      properties: {
        orgId: { type: 'string' },
        memberId: { type: 'string' },
        assignmentId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      properties: {
        roles: { type: 'array', items: { type: 'string' } },
        departments: { type: 'array', items: { type: 'string' } },
        isPrimary: { type: 'boolean' },
        coverageType: { type: 'string', enum: ['primary', 'secondary', 'floating'] },
        status: { type: 'string', enum: ['active', 'inactive'] },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.branch.update', orgId);
  if (denied) return;

  const existing = await collections.assignments().findOne({
    organizationId: orgId,
    membershipId: req.params.memberId,
    assignmentId: req.params.assignmentId,
  });
  if (!existing) return reply.code(404).send({ message: 'Assignment not found' });

  const updates = { updatedAt: now() };
  if (req.body.roles) updates.roles = req.body.roles;
  if (req.body.departments) updates.departments = req.body.departments;
  if (req.body.isPrimary !== undefined) updates.isPrimary = req.body.isPrimary;
  if (req.body.coverageType) updates.coverageType = req.body.coverageType;
  if (req.body.status) {
    updates.status = req.body.status;
    if (req.body.status === 'inactive') updates.endDate = now();
  }

  await collections.assignments().updateOne(
    { organizationId: orgId, membershipId: req.params.memberId, assignmentId: req.params.assignmentId },
    { $set: updates }
  );

  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: membership?.userId || null,
    nin: membership?.nin || null,
    eventType: 'ROLE_CHANGED',
    from: { roles: existing.roles, departments: existing.departments, status: existing.status },
    to: { roles: updates.roles || existing.roles, departments: updates.departments || existing.departments, status: updates.status || existing.status },
    performedByUserId: req.auth.userId,
    reason: null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_BRANCH_UPDATED',
    action: 'org.member.branch.update',
    permissionKey: 'org.member.branch.update',
    resource: { type: 'branch_assignment', id: req.params.assignmentId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ message: 'Assignment updated' });
});

fastify.delete('/orgs/:orgId/members/:memberId/branches/:assignmentId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Remove branch assignment (soft)',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId', 'assignmentId'],
      properties: {
        orgId: { type: 'string' },
        memberId: { type: 'string' },
        assignmentId: { type: 'string' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.branch.remove', orgId);
  if (denied) return;

  const existing = await collections.assignments().findOne({
    organizationId: orgId,
    membershipId: req.params.memberId,
    assignmentId: req.params.assignmentId,
  });
  if (!existing) return reply.code(404).send({ message: 'Assignment not found' });

  await collections.assignments().updateOne(
    { organizationId: orgId, membershipId: req.params.memberId, assignmentId: req.params.assignmentId },
    { $set: { status: 'inactive', endDate: now(), updatedAt: now() } }
  );

  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: membership?.userId || null,
    nin: membership?.nin || null,
    eventType: 'BRANCH_UNASSIGNED',
    from: { assignmentId: req.params.assignmentId, branchId: existing.branchId },
    to: null,
    performedByUserId: req.auth.userId,
    reason: null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_BRANCH_REMOVED',
    action: 'org.member.branch.remove',
    permissionKey: 'org.member.branch.remove',
    resource: { type: 'branch_assignment', id: req.params.assignmentId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ message: 'Assignment removed' });
});

fastify.post('/orgs/:orgId/members/:memberId/transfer', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Transfer member between branches',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['fromBranchId', 'toBranchId'],
      properties: {
        fromBranchId: { type: 'string' },
        toBranchId: { type: 'string' },
        roles: { type: 'array', items: { type: 'string' } },
        departments: { type: 'array', items: { type: 'string' } },
        reason: { type: 'string' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true }, 404: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.transfer', orgId);
  if (denied) return;

  const membership = await collections.memberships().findOne({ organizationId: orgId, membershipId: req.params.memberId });
  if (!membership) return reply.code(404).send({ message: 'Membership not found' });

  const currentAssignment = await collections.assignments().findOne({
    organizationId: orgId,
    membershipId: req.params.memberId,
    branchId: req.body.fromBranchId,
    status: 'active',
  });
  if (!currentAssignment) return reply.code(404).send({ message: 'Active source assignment not found' });

  await collections.assignments().updateOne(
    { assignmentId: currentAssignment.assignmentId },
    { $set: { status: 'inactive', endDate: now(), updatedAt: now() } }
  );

  const newAssignment = {
    assignmentId: crypto.randomUUID(),
    membershipId: req.params.memberId,
    organizationId: orgId,
    branchId: req.body.toBranchId,
    roles: Array.isArray(req.body.roles) && req.body.roles.length > 0 ? req.body.roles : currentAssignment.roles,
    departments: Array.isArray(req.body.departments) ? req.body.departments : currentAssignment.departments,
    isPrimary: currentAssignment.isPrimary,
    coverageType: currentAssignment.coverageType,
    startDate: now(),
    endDate: null,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };
  await collections.assignments().insertOne(newAssignment);

  await writeEvent({
    organizationId: orgId,
    membershipId: req.params.memberId,
    userId: membership.userId || null,
    nin: membership.nin,
    eventType: 'BRANCH_TRANSFERRED',
    from: { branchId: req.body.fromBranchId },
    to: { branchId: req.body.toBranchId },
    performedByUserId: req.auth.userId,
    reason: req.body.reason || null,
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_TRANSFERRED',
    action: 'org.member.transfer',
    permissionKey: 'org.member.transfer',
    resource: { type: 'membership', id: req.params.memberId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ message: 'Member transferred', assignment: newAssignment });
});

fastify.get('/orgs/:orgId/members/:memberId/history', {
  preHandler: requireAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Get membership movement history',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'memberId'],
      properties: { orgId: { type: 'string' }, memberId: { type: 'string' } },
    },
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true }, 403: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const orgId = req.params.orgId;
  const denied = await enforcePermission(req, reply, 'org.member.history.read', orgId);
  if (denied) return;

  const page = Math.max(Number(req.query?.page) || 1, 1);
  const limit = Math.min(Number(req.query?.limit) || 50, 200);

  const [items, total] = await Promise.all([
    collections.events()
      .find({ organizationId: orgId, membershipId: req.params.memberId })
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    collections.events().countDocuments({ organizationId: orgId, membershipId: req.params.memberId }),
  ]);

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: orgId,
    eventType: 'ORG_MEMBER_HISTORY_VIEWED',
    action: 'org.member.history.read',
    permissionKey: 'org.member.history.read',
    resource: { type: 'membership', id: req.params.memberId },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ page, limit, total, items });
});

fastify.post('/internal/memberships/link-user', {
  preHandler: requireInternal,
  schema: {
    tags: ['Membership'],
    summary: 'Internal link memberships by NIN after user registration',
    security: [],
    body: {
      type: 'object',
      required: ['userId', 'nin'],
      properties: {
        userId: { type: 'string' },
        nin: { type: 'string', pattern: '^\\d{11}$' },
      },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const { userId, nin } = req.body || {};

  const candidates = await collections.memberships().find({ nin: String(nin), userId: null }).toArray();
  if (candidates.length === 0) {
    return reply.send({ message: 'No pending memberships found', linked: 0 });
  }

  const ids = candidates.map((m) => m.membershipId);
  await collections.memberships().updateMany(
    { membershipId: { $in: ids } },
    { $set: { userId: String(userId), status: 'active', updatedAt: now() } }
  );

  for (const item of candidates) {
    await writeEvent({
      organizationId: item.organizationId,
      membershipId: item.membershipId,
      userId: String(userId),
      nin: item.nin,
      eventType: 'USER_LINKED',
      from: { userId: null },
      to: { userId: String(userId) },
      performedByUserId: 'internal',
      reason: 'linked_after_registration',
    });
  }

  return reply.send({ message: 'Memberships linked', linked: candidates.length });
});

fastify.get('/internal/memberships/summary/:userId', {
  preHandler: requireInternalOrAuth,
  schema: {
    tags: ['Membership'],
    summary: 'Internal summary of user memberships',
    params: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string' } },
    },
    response: { 200: { type: 'object', additionalProperties: true }, 401: { type: 'object', additionalProperties: true } },
  },
}, async (req, reply) => {
  const userId = req.params.userId;
  if (!req.internal && req.auth?.userId !== userId) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const memberships = await collections.memberships().find({ userId }).toArray();
  const membershipIds = memberships.map((m) => m.membershipId);
  const assignments = membershipIds.length === 0
    ? []
    : await collections.assignments().find({ membershipId: { $in: membershipIds }, status: 'active' }).toArray();

  return reply.send({
    organizations: memberships.map((m) => ({
      organizationId: m.organizationId,
      membershipId: m.membershipId,
      status: m.status,
    })),
    activeAssignments: assignments,
  });
});

const start = async () => {
  try {
    await connect();
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  try {
    if (mongoClient) await mongoClient.close();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function buildApp(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'dbReady')) {
    dbReady = !!options.dbReady;
  }
  if (options.db) {
    db = options.db;
  }
  if (options.fetchImpl) {
    fetchClient = options.fetchImpl;
  }
  return fastify;
}

module.exports = {
  buildApp,
  start,
};

if (require.main === module) {
  start();
}

