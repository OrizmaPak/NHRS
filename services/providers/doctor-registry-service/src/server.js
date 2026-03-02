const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion } = require('mongodb');

const serviceName = 'doctor-registry-service';
const port = Number(process.env.PORT) || 8094;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

let dbReady = false;
let mongoClient;

const connectToMongo = async () => {
  if (!mongoUri || !dbName) {
    fastify.log.warn('MONGODB_URI or DB_NAME not set; starting without database connection');
    return;
  }

  mongoClient = new MongoClient(mongoUri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await mongoClient.connect();
  await mongoClient.db('admin').command({ ping: 1 });
  dbReady = true;
  fastify.log.info({ dbName }, 'MongoDB connection established');
};

fastify.get('/health', async () => {
  return { status: 'ok', service: serviceName, dbReady, dbName: dbName || null };
});

const start = async () => {
  try {
    await connectToMongo();
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  try {
    if (mongoClient) {
      await mongoClient.close();
    }
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
