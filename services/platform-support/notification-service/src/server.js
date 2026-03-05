const fastifyFactory = require('fastify');
const { MongoClient, ServerApiVersion } = require('mongodb');

const serviceName = 'notification-service';
const port = Number(process.env.PORT) || 8101;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_notification_db';

function createApp() {
  const fastify = fastifyFactory({ logger: true });
  const state = {
    dbReady: false,
    mongoClient: null,
    db: null,
    processedEventIds: new Map(),
  };

  function collections() {
    return {
      notifications: state.db.collection('notifications'),
      processed: state.db.collection('notification_processed_events'),
    };
  }

  async function connect() {
    if (!mongoUri) {
      fastify.log.warn('MONGODB_URI not set; notification-service running in degraded mode');
      return;
    }
    try {
      state.mongoClient = new MongoClient(mongoUri, {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        },
      });
      await state.mongoClient.connect();
      state.db = state.mongoClient.db(dbName);
      await state.db.command({ ping: 1 });
      await Promise.all([
        collections().notifications.createIndex({ eventId: 1 }, { unique: true }),
        collections().notifications.createIndex({ createdAt: -1 }),
        collections().processed.createIndex({ eventId: 1 }, { unique: true }),
        collections().processed.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 }),
      ]);
      state.dbReady = true;
    } catch (err) {
      fastify.log.warn({ err }, 'MongoDB connection failed; continuing without database connection');
    }
  }

  function rememberEvent(eventId) {
    state.processedEventIds.set(eventId, Date.now());
    if (state.processedEventIds.size > 5000) {
      const oldest = [...state.processedEventIds.entries()].sort((a, b) => a[1] - b[1]).slice(0, 1000);
      oldest.forEach(([id]) => state.processedEventIds.delete(id));
    }
  }

  async function isDuplicateEvent(eventId) {
    if (!eventId) return false;
    if (state.processedEventIds.has(eventId)) return true;
    if (!state.dbReady) return false;
    const existing = await collections().processed.findOne({ eventId });
    return Boolean(existing);
  }

  async function markProcessed(eventId) {
    if (!eventId || !state.dbReady) return;
    await collections().processed.updateOne(
      { eventId },
      { $setOnInsert: { eventId, createdAt: new Date() } },
      { upsert: true }
    );
    rememberEvent(eventId);
  }

  fastify.get('/health', async () => ({
    status: 'ok',
    service: serviceName,
    dbReady: state.dbReady,
    dbName,
  }));

  fastify.post('/internal/notifications/events', async (req, reply) => {
    const events = Array.isArray(req.body?.events)
      ? req.body.events
      : req.body
        ? [req.body]
        : [];
    if (events.length === 0) {
      return reply.code(400).send({ message: 'events payload is required' });
    }

    let accepted = 0;
    for (const raw of events) {
      const eventId = raw?.eventId ? String(raw.eventId) : null;
      if (eventId && await isDuplicateEvent(eventId)) {
        continue;
      }
      if (state.dbReady) {
        await collections().notifications.insertOne({
          eventId: eventId || `evt-${Date.now()}-${Math.random()}`,
          eventType: raw?.eventType || 'UNKNOWN_EVENT',
          payload: raw?.payload || {},
          targets: raw?.targets || [],
          createdAt: new Date(),
        });
      }
      if (eventId) {
        await markProcessed(eventId);
      }
      accepted += 1;
    }

    return reply.code(202).send({ accepted });
  });

  async function closeService() {
    if (state.mongoClient) {
      await state.mongoClient.close();
    }
    await fastify.close();
  }

  fastify.decorate('connect', connect);
  fastify.decorate('closeService', closeService);
  return fastify;
}

const app = createApp();

async function start() {
  try {
    await app.connect();
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => { await app.closeService(); process.exit(0); });
process.on('SIGTERM', async () => { await app.closeService(); process.exit(0); });

module.exports = { buildApp: createApp, start };

if (require.main === module) {
  start();
}
