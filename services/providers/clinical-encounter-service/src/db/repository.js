const { createOutboxRepository } = require('../../../../../libs/shared/src/outbox');

function createRepository(db) {
  const encounters = () => db.collection('encounters');
  const outbox = createOutboxRepository(db);

  async function createIndexes() {
    await Promise.all([
      encounters().createIndex({ encounterId: 1 }, { unique: true }),
      encounters().createIndex({ nin: 1, createdAt: -1 }),
      encounters().createIndex({ providerUserId: 1, createdAt: -1 }),
      encounters().createIndex({ organizationId: 1, branchId: 1, createdAt: -1 }),
      outbox.createIndexes(),
    ]);
  }

  async function insertEncounter(doc) {
    await encounters().insertOne(doc);
    return doc;
  }

  async function getEncounterById(encounterId) {
    return encounters().findOne({ encounterId });
  }

  async function listEncountersByNin(nin, from, to, page, limit) {
    const filter = { nin };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      encounters().find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      encounters().countDocuments(filter),
    ]);
    return { items, total };
  }

  async function updateEncounter(encounterId, setDoc) {
    await encounters().updateOne({ encounterId }, { $set: setDoc });
  }

  async function deleteEncounter(encounterId) {
    await encounters().deleteOne({ encounterId });
  }

  return {
    createIndexes,
    insertEncounter,
    getEncounterById,
    listEncountersByNin,
    updateEncounter,
    deleteEncounter,
    enqueueOutboxEvent: outbox.enqueueOutboxEvent,
    fetchPendingOutboxEvents: outbox.fetchPendingOutboxEvents,
    markOutboxDelivered: outbox.markDelivered,
    markOutboxFailed: outbox.markFailed,
  };
}

module.exports = { createRepository };
