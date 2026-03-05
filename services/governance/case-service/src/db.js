const { MongoClient, ServerApiVersion } = require('mongodb');

function createRepository(db) {
  return {
    cases: () => db.collection('governance_cases'),
    actions: () => db.collection('case_actions'),
    rooms: () => db.collection('case_rooms'),
    messages: () => db.collection('case_room_messages'),
    async createIndexes() {
      await Promise.all([
        this.cases().createIndex({ caseId: 1 }, { unique: true }),
        this.cases().createIndex({ status: 1, createdAt: -1 }),
        this.cases().createIndex({ 'routing.assignedUnitId': 1, status: 1 }),
        this.actions().createIndex({ actionId: 1 }, { unique: true }),
        this.actions().createIndex({ caseId: 1, createdAt: -1 }),
        this.rooms().createIndex({ roomId: 1 }, { unique: true }),
        this.rooms().createIndex({ caseId: 1 }, { unique: true }),
        this.messages().createIndex({ messageId: 1 }, { unique: true }),
        this.messages().createIndex({ roomId: 1, createdAt: 1 }),
      ]);
    },
  };
}

async function connectMongo({ mongoUri, dbName, log }) {
  if (!mongoUri) {
    log?.warn?.('Missing MONGODB_URI; running in degraded mode');
    return { dbReady: false, mongoClient: null, db: null };
  }
  try {
    const mongoClient = new MongoClient(mongoUri, {
      serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
    });
    await mongoClient.connect();
    const db = mongoClient.db(dbName);
    await db.command({ ping: 1 });
    return { dbReady: true, mongoClient, db };
  } catch (err) {
    log?.warn?.({ err }, 'MongoDB connection failed');
    return { dbReady: false, mongoClient: null, db: null };
  }
}

module.exports = { connectMongo, createRepository };
