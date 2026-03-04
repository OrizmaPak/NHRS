function createRepository(db) {
  const recordsIndex = () => db.collection('records_index');
  const recordEntries = () => db.collection('record_entries');

  async function createIndexes() {
    await Promise.all([
      recordsIndex().createIndex({ recordId: 1 }, { unique: true }),
      recordsIndex().createIndex({ citizenUserId: 1 }, { unique: true, sparse: true }),
      recordsIndex().createIndex({ citizenNin: 1 }, { unique: true }),
      recordEntries().createIndex({ entryId: 1 }, { unique: true }),
      recordEntries().createIndex({ recordId: 1, createdAt: -1 }),
      recordEntries().createIndex({ 'createdBy.organizationId': 1, 'createdBy.branchId': 1 }),
      recordEntries().createIndex({ 'createdBy.providerUserId': 1, createdAt: -1 }),
      recordEntries().createIndex({ createdAt: -1 }),
    ]);
  }

  async function findRecordByNin(citizenNin) {
    return recordsIndex().findOne({ citizenNin });
  }

  async function findRecordByCitizenUserId(citizenUserId) {
    return recordsIndex().findOne({ citizenUserId });
  }

  async function insertRecord(doc) {
    await recordsIndex().insertOne(doc);
    return doc;
  }

  async function updateRecord(recordId, setDoc) {
    await recordsIndex().updateOne({ recordId }, { $set: setDoc });
  }

  async function insertEntry(doc) {
    await recordEntries().insertOne(doc);
    return doc;
  }

  async function findEntryById(entryId) {
    return recordEntries().findOne({ entryId });
  }

  async function updateEntry(entryId, setDoc) {
    await recordEntries().updateOne({ entryId }, { $set: setDoc });
  }

  async function listEntriesByRecord(recordId) {
    return recordEntries().find({ recordId }).sort({ createdAt: -1 }).toArray();
  }

  return {
    createIndexes,
    findRecordByNin,
    findRecordByCitizenUserId,
    insertRecord,
    updateRecord,
    insertEntry,
    findEntryById,
    updateEntry,
    listEntriesByRecord,
  };
}

module.exports = { createRepository };
