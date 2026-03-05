const crypto = require('crypto');

const baseError = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string' },
  },
};

async function updateStatus({ req, reply, deps, permissionKey, doctorId, status, action, eventType, noteField }) {
  const denied = await deps.enforcePermission(req, reply, permissionKey);
  if (denied) return;

  const doctor = await deps.repository.getDoctorById(String(doctorId));
  if (!doctor) return reply.code(404).send({ message: 'Doctor not found' });

  const updated = await deps.repository.updateDoctorStatus(doctor.doctorId, status);
  const notes = req.body?.[noteField] ? String(req.body[noteField]) : null;
  const createdAt = new Date().toISOString();
  await deps.repository.insertLicenseHistory({
    historyId: crypto.randomUUID(),
    doctorId: doctor.doctorId,
    action,
    performedByUserId: req.auth.userId,
    notes,
    createdAt,
  });

  deps.emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType,
    action: `licenses.${String(action).toLowerCase()}`,
    resource: { type: 'doctor', id: doctor.doctorId },
    permissionKey,
    outcome: 'success',
    metadata: { notes },
  });

  deps.emitNotificationEvent({
    eventType,
    payload: {
      doctorId: doctor.doctorId,
      userId: doctor.userId,
      status,
      notes,
      performedByUserId: req.auth.userId,
    },
  });

  return reply.send({ doctor: updated });
}

function registerLicenseRoutes(fastify, deps) {
  fastify.post('/licenses/:doctorId/verify', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Doctor Registry'],
      summary: 'Verify a doctor license',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['doctorId'],
        properties: {
          doctorId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          notes: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        401: baseError,
        403: baseError,
        404: baseError,
      },
    },
  }, async (req, reply) => updateStatus({
    req,
    reply,
    deps,
    permissionKey: 'doctor.verify',
    doctorId: req.params.doctorId,
    status: 'verified',
    action: 'VERIFIED',
    eventType: 'DOCTOR_LICENSE_VERIFIED',
    noteField: 'notes',
  }));

  fastify.post('/licenses/:doctorId/suspend', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Doctor Registry'],
      summary: 'Suspend a doctor license',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['doctorId'],
        properties: {
          doctorId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: baseError,
        401: baseError,
        403: baseError,
        404: baseError,
      },
    },
  }, async (req, reply) => updateStatus({
    req,
    reply,
    deps,
    permissionKey: 'doctor.suspend',
    doctorId: req.params.doctorId,
    status: 'suspended',
    action: 'SUSPENDED',
    eventType: 'DOCTOR_LICENSE_SUSPENDED',
    noteField: 'reason',
  }));

  fastify.post('/licenses/:doctorId/revoke', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Doctor Registry'],
      summary: 'Revoke a doctor license',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['doctorId'],
        properties: {
          doctorId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: baseError,
        401: baseError,
        403: baseError,
        404: baseError,
      },
    },
  }, async (req, reply) => updateStatus({
    req,
    reply,
    deps,
    permissionKey: 'doctor.revoke',
    doctorId: req.params.doctorId,
    status: 'revoked',
    action: 'REVOKED',
    eventType: 'DOCTOR_LICENSE_REVOKED',
    noteField: 'reason',
  }));

  fastify.post('/licenses/:doctorId/reinstate', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Doctor Registry'],
      summary: 'Reinstate a doctor license',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['doctorId'],
        properties: {
          doctorId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          notes: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        401: baseError,
        403: baseError,
        404: baseError,
      },
    },
  }, async (req, reply) => updateStatus({
    req,
    reply,
    deps,
    permissionKey: 'doctor.reinstate',
    doctorId: req.params.doctorId,
    status: 'verified',
    action: 'REINSTATED',
    eventType: 'DOCTOR_LICENSE_REINSTATED',
    noteField: 'notes',
  }));
}

module.exports = { registerLicenseRoutes };
