const { MongoClient, ServerApiVersion } = require('mongodb');

async function connectMongo({ mongoUri, dbName, log }) {
  const mongoClient = new MongoClient(mongoUri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  try {
    await mongoClient.connect();
    const db = mongoClient.db(dbName);
    await db.command({ ping: 1 });
    return { mongoClient, db, dbReady: true };
  } catch (err) {
    log.warn({ err }, 'MongoDB connection failed');
    try {
      await mongoClient.close();
    } catch (_ignored) {
      // ignore
    }
    return { mongoClient: null, db: null, dbReady: false };
  }
}

module.exports = { connectMongo };
