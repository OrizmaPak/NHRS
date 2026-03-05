const { createOutboxRepository } = require('../../../../../libs/shared/src/outbox');

function createRepository(db) {
  const results = () => db.collection('lab_results');
  const outbox = createOutboxRepository(db);

  async function createIndexes() {
    await Promise.all([
      results().createIndex({ resultId: 1 }, { unique: true }),
      results().createIndex({ nin: 1, createdAt: -1 }),
      results().createIndex({ providerUserId: 1, createdAt: -1 }),
      results().createIndex({ organizationId: 1, branchId: 1, createdAt: -1 }),
      outbox.createIndexes(),
    ]);
  }

  async function insertResult(doc) { await results().insertOne(doc); return doc; }
  async function getResultById(resultId) { return results().findOne({ resultId }); }
  async function deleteResult(resultId) { await results().deleteOne({ resultId }); }
  async function updateResult(resultId, setDoc) { await results().updateOne({ resultId }, { $set: setDoc }); }

  async function listResultsByNin(nin, from, to, page, limit) {
    const filter = { nin };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      results().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      results().countDocuments(filter),
    ]);
    return { items, total };
  }

  return {
    createIndexes,
    insertResult,
    getResultById,
    deleteResult,
    updateResult,
    listResultsByNin,
    enqueueOutboxEvent: outbox.enqueueOutboxEvent,
    fetchPendingOutboxEvents: outbox.fetchPendingOutboxEvents,
    markOutboxDelivered: outbox.markDelivered,
    markOutboxFailed: outbox.markFailed,
  };
}

module.exports = { createRepository };
