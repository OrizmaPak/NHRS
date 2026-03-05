const crypto = require('crypto');

const baseError = {
  type: 'object',
  required: ['message'],
  properties: {
    message: { type: 'string' },
  },
};

function registerDoctorRoutes(fastify, deps) {
  fastify.post('/doctors/register', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Doctor Registry'],
      summary: 'Register a doctor license profile',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['fullName', 'licenseNumber', 'licenseAuthority', 'specialization'],
        properties: {
          fullName: { type: 'string' },
          licenseNumber: { type: 'string' },
          licenseAuthority: { type: 'string' },
          specialization: { type: 'string' },
          affiliations: {
            type: 'array',
            items: {
              type: 'object',
              required: ['orgId'],
              properties: {
                orgId: { type: 'string' },
                branchId: { type: 'string' },
                state: { type: 'string' },
              },
            },
          },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        400: baseError,
        401: baseError,
        403: baseError,
        409: baseError,
        503: baseError,
      },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'doctor.register');
    if (denied) return;

    const now = new Date().toISOString();
    const doctor = {
      doctorId: crypto.randomUUID(),
      userId: req.auth.userId,
      fullName: String(req.body.fullName).trim(),
      licenseNumber: String(req.body.licenseNumber).trim(),
      licenseAuthority: String(req.body.licenseAuthority).trim(),
      specialization: String(req.body.specialization).trim(),
      affiliations: Array.isArray(req.body.affiliations) ? req.body.affiliations : [],
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    try {
      await deps.repository.insertDoctor(doctor);
    } catch (err) {
      if (err?.code === 11000) {
        return reply.code(409).send({ message: 'Doctor already registered with this user or license number' });
      }
      throw err;
    }

    await deps.repository.insertLicenseHistory({
      historyId: crypto.randomUUID(),
      doctorId: doctor.doctorId,
      action: 'REGISTERED',
      performedByUserId: req.auth.userId,
      notes: null,
      createdAt: now,
    });

    deps.emitAuditEvent({
      userId: req.auth.userId,
      organizationId: null,
      eventType: 'DOCTOR_REGISTERED',
      action: 'doctor.register',
      resource: { type: 'doctor', id: doctor.doctorId },
      permissionKey: 'doctor.register',
      outcome: 'success',
      metadata: { licenseNumber: doctor.licenseNumber, specialization: doctor.specialization },
    });

    deps.emitNotificationEvent({
      eventType: 'DOCTOR_REGISTERED',
      payload: {
        doctorId: doctor.doctorId,
        userId: doctor.userId,
        fullName: doctor.fullName,
        specialization: doctor.specialization,
      },
    });

    return reply.code(201).send({ doctor });
  });

  fastify.get('/doctors/search', {
    schema: {
      tags: ['Doctor Registry'],
      summary: 'Public search for verified doctors',
      description: 'Returns verified doctors only.',
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          specialization: { type: 'string' },
          state: { type: 'string' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        503: baseError,
      },
    },
  }, async (req) => {
    const page = Math.max(Number(req.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
    const { items, total } = await deps.repository.searchVerifiedDoctors({
      q: req.query?.q ? String(req.query.q).trim() : null,
      specialization: req.query?.specialization ? String(req.query.specialization).trim() : null,
      state: req.query?.state ? String(req.query.state).trim() : null,
      page,
      limit,
    });

    return {
      page,
      limit,
      total,
      items: items.map((doctor) => ({
        doctorId: doctor.doctorId,
        fullName: doctor.fullName,
        specialization: doctor.specialization,
        licenseNumber: doctor.licenseNumber,
        licenseAuthority: doctor.licenseAuthority,
        affiliations: doctor.affiliations || [],
      })),
    };
  });

  fastify.get('/doctors/:doctorId', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Doctor Registry'],
      summary: 'Read full doctor profile and license history',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['doctorId'],
        properties: {
          doctorId: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        401: baseError,
        403: baseError,
        404: baseError,
      },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'doctor.read');
    if (denied) return;

    const doctor = await deps.repository.getDoctorById(String(req.params.doctorId));
    if (!doctor) return reply.code(404).send({ message: 'Doctor not found' });
    const history = await deps.repository.listLicenseHistory(doctor.doctorId);
    return reply.send({ doctor, licenseHistory: history });
  });

  fastify.get('/doctors/:userId/status', {
    preHandler: deps.requireInternal,
    schema: {
      tags: ['Doctor Registry'],
      summary: 'Internal doctor status lookup by userId',
      hide: true,
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        additionalProperties: true,
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        401: baseError,
      },
    },
  }, async (req) => {
    const doctor = await deps.repository.getDoctorByUserId(String(req.params.userId));
    if (!doctor) {
      return {
        doctorId: null,
        status: 'not_registered',
        specialization: null,
        licenseNumber: null,
      };
    }
    return {
      doctorId: doctor.doctorId,
      status: doctor.status,
      specialization: doctor.specialization,
      licenseNumber: doctor.licenseNumber,
    };
  });
}

module.exports = { registerDoctorRoutes };
