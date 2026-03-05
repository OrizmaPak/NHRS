const { createOutboxRepository } = require('../../../../../libs/shared/src/outbox');

function createRepository(db) {
  const dispenses = () => db.collection('pharmacy_dispenses');
  const outbox = createOutboxRepository(db);

  async function createIndexes() {
    await Promise.all([
      dispenses().createIndex({ dispenseId: 1 }, { unique: true }),
      dispenses().createIndex({ nin: 1, createdAt: -1 }),
      dispenses().createIndex({ providerUserId: 1, createdAt: -1 }),
      dispenses().createIndex({ organizationId: 1, branchId: 1, createdAt: -1 }),
      outbox.createIndexes(),
    ]);
  }

  async function insertDispense(doc) { await dispenses().insertOne(doc); return doc; }
  async function getDispenseById(dispenseId) { return dispenses().findOne({ dispenseId }); }
  async function deleteDispense(dispenseId) { await dispenses().deleteOne({ dispenseId }); }
  async function updateDispense(dispenseId, setDoc) { await dispenses().updateOne({ dispenseId }, { $set: setDoc }); }

  async function listDispensesByNin(nin, from, to, page, limit) {
    const filter = { nin };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      dispenses().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      dispenses().countDocuments(filter),
    ]);
    return { items, total };
  }

  return {
    createIndexes,
    insertDispense,
    getDispenseById,
    deleteDispense,
    updateDispense,
    listDispensesByNin,
    enqueueOutboxEvent: outbox.enqueueOutboxEvent,
    fetchPendingOutboxEvents: outbox.fetchPendingOutboxEvents,
    markOutboxDelivered: outbox.markDelivered,
    markOutboxFailed: outbox.markFailed,
  };
}

module.exports = { createRepository };
