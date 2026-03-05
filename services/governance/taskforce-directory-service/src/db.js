const { MongoClient, ServerApiVersion } = require('mongodb');

function createRepository(db) {
  return {
    units: () => db.collection('taskforce_units'),
    members: () => db.collection('taskforce_members'),
    async createIndexes() {
      await Promise.all([
        this.units().createIndex({ unitId: 1 }, { unique: true }),
        this.units().createIndex({ level: 1, 'coverage.state': 1, 'coverage.lga': 1 }),
        this.units().createIndex({ status: 1 }),
        this.members().createIndex({ memberId: 1 }, { unique: true }),
        this.members().createIndex({ unitId: 1, userId: 1 }, { unique: true }),
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
