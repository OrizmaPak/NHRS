const { MongoClient, ServerApiVersion } = require('mongodb');

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

module.exports = { connectMongo };
