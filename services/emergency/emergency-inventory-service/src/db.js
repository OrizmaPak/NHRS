const { MongoClient, ServerApiVersion } = require('mongodb');

function createRepository(db) {
  return {
    requests: () => db.collection('emergency_requests'),
    responses: () => db.collection('emergency_responses'),
    rooms: () => db.collection('emergency_rooms'),
    messages: () => db.collection('emergency_room_messages'),
    inventory: () => db.collection('provider_inventory'),
    async createIndexes() {
      await Promise.all([
        this.requests().createIndex({ requestId: 1 }, { unique: true }),
        this.requests().createIndex({ status: 1, createdAt: -1 }),
        this.requests().createIndex({ 'scope.level': 1, 'scope.state': 1, 'scope.lga': 1, createdAt: -1 }),
        this.responses().createIndex({ responseId: 1 }, { unique: true }),
        this.responses().createIndex({ requestId: 1, createdAt: -1 }),
        this.responses().createIndex({ providerOrgId: 1, createdAt: -1 }),
        this.rooms().createIndex({ roomId: 1 }, { unique: true }),
        this.rooms().createIndex({ requestId: 1 }, { unique: true }),
        this.messages().createIndex({ roomId: 1, createdAt: 1 }),
        this.messages().createIndex({ messageId: 1 }, { unique: true }),
        this.inventory().createIndex({ inventoryId: 1 }, { unique: true }),
        this.inventory().createIndex({ providerOrgId: 1, providerBranchId: 1 }, { unique: true }),
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

module.exports = {
  connectMongo,
  createRepository,
};
