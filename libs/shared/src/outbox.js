const crypto = require('crypto');

function buildEventEnvelope({
  eventType,
  sourceService,
  aggregateType,
  aggregateId,
  payload,
  trace = {},
  eventId = crypto.randomUUID(),
  createdAt = new Date().toISOString(),
  destination = 'audit',
}) {
  return {
    eventId,
    eventType,
    sourceService,
    aggregateType,
    aggregateId,
    payload: payload || {},
    createdAt,
    trace: {
      requestId: trace.requestId || null,
      userId: trace.userId || null,
      orgId: trace.orgId || null,
      branchId: trace.branchId || null,
    },
    destination,
  };
}

function createOutboxRepository(db) {
  const col = db.collection('outbox_events');

  return {
    outbox: col,
    async createIndexes() {
      await Promise.all([
        col.createIndex({ eventId: 1 }, { unique: true }),
        col.createIndex({ status: 1, createdAt: 1 }),
        col.createIndex({ lockedUntil: 1 }),
        col.createIndex({ eventType: 1 }),
      ]);
    },
    async enqueueOutboxEvent(event) {
      const now = new Date().toISOString();
      const doc = {
        _id: event.eventId,
        ...event,
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        deliveredAt: null,
        lastError: null,
        lockedUntil: null,
        createdAt: event.createdAt || now,
      };
      await col.insertOne(doc);
      return doc;
    },
    async fetchPendingOutboxEvents(limit = 20, lockMs = 30000, now = new Date()) {
      const events = [];
      const lockUntil = new Date(now.getTime() + lockMs).toISOString();
      if (typeof col.findOneAndUpdate !== 'function') {
        const docs = typeof col.find === 'function'
          ? await col.find({}).toArray()
          : [];
        for (const doc of docs) {
          if (events.length >= limit) break;
          const status = String(doc.status || 'pending');
          const lockedUntilValue = doc.lockedUntil ? new Date(doc.lockedUntil).getTime() : null;
          if (!['pending', 'failed'].includes(status)) continue;
          if (lockedUntilValue && lockedUntilValue > now.getTime()) continue;
          const attempts = Number(doc.attempts || 0) + 1;
          if (typeof col.updateOne === 'function') {
            await col.updateOne(
              { _id: doc._id || doc.eventId },
              {
                $set: { lockedUntil: lockUntil, lastAttemptAt: now.toISOString() },
                $inc: { attempts: 1 },
              }
            );
          }
          events.push({
            ...doc,
            attempts,
            lockedUntil: lockUntil,
            lastAttemptAt: now.toISOString(),
          });
        }
        return events;
      }
      for (let i = 0; i < limit; i += 1) {
        const result = await col.findOneAndUpdate(
          {
            status: { $in: ['pending', 'failed'] },
            $or: [
              { lockedUntil: null },
              { lockedUntil: { $lte: now.toISOString() } },
            ],
          },
          {
            $set: { lockedUntil: lockUntil, lastAttemptAt: now.toISOString() },
            $inc: { attempts: 1 },
          },
          {
            sort: { createdAt: 1 },
            returnDocument: 'after',
          }
        );
        if (!result) break;
        events.push(result);
      }
      return events;
    },
    async markDelivered(eventId) {
      await col.updateOne(
        { _id: eventId },
        {
          $set: {
            status: 'delivered',
            deliveredAt: new Date().toISOString(),
            lockedUntil: null,
            lastError: null,
          },
        }
      );
    },
    async markFailed(eventId, error, terminal = false) {
      await col.updateOne(
        { _id: eventId },
        {
          $set: {
            status: terminal ? 'failed' : 'pending',
            lastError: String(error || 'unknown_error'),
            lockedUntil: null,
          },
        }
      );
    },
  };
}

async function deliverOutboxBatch({
  outboxRepo,
  logger,
  handlers,
  batchSize = 20,
  lockMs = 30000,
  maxAttempts = 20,
}) {
  const events = await outboxRepo.fetchPendingOutboxEvents(batchSize, lockMs, new Date());
  for (const event of events) {
    const handler = handlers[event.destination];
    if (!handler) {
      await outboxRepo.markFailed(event.eventId, `No handler for destination ${event.destination}`, true);
      continue;
    }
    try {
      await handler(event);
      await outboxRepo.markDelivered(event.eventId);
    } catch (err) {
      const terminal = Number(event.attempts || 0) >= maxAttempts;
      await outboxRepo.markFailed(event.eventId, err?.message || String(err), terminal);
      logger?.warn?.({ err, eventId: event.eventId, destination: event.destination }, 'Outbox delivery failed');
    }
  }
}

module.exports = {
  buildEventEnvelope,
  createOutboxRepository,
  deliverOutboxBatch,
};
