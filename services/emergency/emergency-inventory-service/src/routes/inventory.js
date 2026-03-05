const crypto = require('crypto');
const { regionFromState } = require('./requests');

function now() {
  return new Date();
}

function registerInventoryRoutes(fastify, deps) {
  const errorSchema = { type: 'object', required: ['message'], properties: { message: { type: 'string' } } };

  fastify.put('/emergency/inventory/me', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'Upsert provider inventory',
      description: 'Creates or updates provider inventory for emergency discovery.',
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
      body: {
        type: 'object',
        required: ['items'],
        properties: {
          location: {
            type: 'object',
            properties: {
              state: { type: 'string' },
              lga: { type: 'string' },
              region: { type: 'string' },
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              required: ['itemType', 'name', 'quantityStatus'],
              properties: {
                itemType: { type: 'string', enum: ['drug', 'blood', 'equipment', 'service'] },
                name: { type: 'string' },
                quantityStatus: { type: 'string', enum: ['in_stock', 'low', 'out_of_stock', 'unknown'] },
                metadata: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: errorSchema,
        401: errorSchema,
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    const orgId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    if (!orgId) return reply.code(400).send({ message: 'x-org-id header is required' });
    const branchId = req.headers['x-branch-id'] ? String(req.headers['x-branch-id']) : null;

    const denied = await deps.enforcePermission(req, reply, 'emergency.inventory.upsert', orgId, branchId);
    if (denied) return;

    const state = req.body?.location?.state || null;
    const lga = req.body?.location?.lga || null;
    const region = req.body?.location?.region || regionFromState(state);

    const existing = await deps.repository.inventory().findOne({ providerOrgId: orgId, providerBranchId: branchId });
    const inventoryDoc = {
      inventoryId: existing?.inventoryId || crypto.randomUUID(),
      providerOrgId: orgId,
      providerBranchId: branchId,
      location: { state, lga, region },
      items: Array.isArray(req.body.items) ? req.body.items : [],
      updatedAt: now(),
    };

    await deps.repository.inventory().updateOne(
      { providerOrgId: orgId, providerBranchId: branchId },
      { $set: inventoryDoc },
      { upsert: true }
    );

    await deps.emitAudit({
      userId: req.auth.userId,
      organizationId: orgId,
      eventType: 'PROVIDER_INVENTORY_UPDATED',
      action: 'emergency.inventory.upsert',
      permissionKey: 'emergency.inventory.upsert',
      resource: { type: 'provider_inventory', id: inventoryDoc.inventoryId },
      outcome: 'success',
      metadata: { itemCount: inventoryDoc.items.length, requestTraceId: req.headers['x-request-id'] || null },
      ipAddress: deps.getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });

    return reply.send({ inventory: inventoryDoc });
  });

  fastify.get('/emergency/inventory/search', {
    preHandler: deps.requireAuth,
    schema: {
      tags: ['Emergency'],
      summary: 'Search provider inventory in scope',
      description: 'Search providers with matching inventory items within provided scope filters.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          itemType: { type: 'string' },
          q: { type: 'string' },
          scopeLevel: { type: 'string', enum: ['LGA', 'STATE', 'REGION', 'NATIONAL'] },
          state: { type: 'string' },
          lga: { type: 'string' },
          region: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        401: errorSchema,
        403: errorSchema,
      },
    },
  }, async (req, reply) => {
    const denied = await deps.enforcePermission(req, reply, 'emergency.inventory.search');
    if (denied) return;

    const docs = await deps.repository.inventory().find({}).toArray();
    const q = req.query?.q ? String(req.query.q).toLowerCase() : null;
    const itemType = req.query?.itemType ? String(req.query.itemType).toLowerCase() : null;
    const scopeLevel = req.query?.scopeLevel ? String(req.query.scopeLevel).toUpperCase() : null;

    const filtered = docs.filter((doc) => {
      if (scopeLevel === 'LGA' && req.query?.lga && String(doc.location?.lga || '').toLowerCase() !== String(req.query.lga).toLowerCase()) return false;
      if (scopeLevel === 'STATE' && req.query?.state && String(doc.location?.state || '').toLowerCase() !== String(req.query.state).toLowerCase()) return false;
      if (scopeLevel === 'REGION' && req.query?.region && String(doc.location?.region || '').toLowerCase() !== String(req.query.region).toLowerCase()) return false;
      const items = Array.isArray(doc.items) ? doc.items : [];
      return items.some((item) => {
        const typeOk = !itemType || String(item.itemType || '').toLowerCase() === itemType;
        const qOk = !q || String(item.name || '').toLowerCase().includes(q);
        return typeOk && qOk;
      });
    });

    const results = filtered.map((doc) => ({
      providerOrgId: doc.providerOrgId,
      providerBranchId: doc.providerBranchId || null,
      location: doc.location || null,
      items: Array.isArray(doc.items)
        ? doc.items.filter((item) => {
          const typeOk = !itemType || String(item.itemType || '').toLowerCase() === itemType;
          const qOk = !q || String(item.name || '').toLowerCase().includes(q);
          return typeOk && qOk;
        })
        : [],
      updatedAt: doc.updatedAt || null,
    }));

    return reply.send({ items: results, total: results.length });
  });
}

module.exports = { registerInventoryRoutes };
