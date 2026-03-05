const { createOutboxRepository } = require('../../../../../libs/shared/src/outbox');

function createRepository(db) {
  const doctors = db.collection('doctors');
  const licenseHistory = db.collection('license_history');
  const outboxRepo = createOutboxRepository(db);

  return {
    async createIndexes() {
      await Promise.all([
        doctors.createIndex({ licenseNumber: 1 }, { unique: true }),
        doctors.createIndex({ userId: 1 }, { unique: true }),
        doctors.createIndex({ status: 1, specialization: 1 }),
        licenseHistory.createIndex({ doctorId: 1, createdAt: -1 }),
        outboxRepo.createIndexes(),
      ]);
    },

    async insertDoctor(doc) {
      await doctors.insertOne(doc);
      return doc;
    },

    async getDoctorById(doctorId) {
      return doctors.findOne({ doctorId });
    },

    async getDoctorByUserId(userId) {
      return doctors.findOne({ userId });
    },

    async updateDoctorStatus(doctorId, status) {
      const now = new Date().toISOString();
      await doctors.updateOne({ doctorId }, { $set: { status, updatedAt: now } });
      return doctors.findOne({ doctorId });
    },

    async listLicenseHistory(doctorId) {
      return licenseHistory.find({ doctorId }).sort({ createdAt: -1 }).toArray();
    },

    async insertLicenseHistory(doc) {
      await licenseHistory.insertOne(doc);
      return doc;
    },

    async searchVerifiedDoctors({ q, specialization, state, page, limit }) {
      const filter = { status: 'verified' };
      if (specialization) {
        filter.specialization = specialization;
      }
      if (state) {
        filter.affiliations = { $elemMatch: { state } };
      }
      if (q) {
        const regex = new RegExp(q, 'i');
        filter.$or = [
          { fullName: regex },
          { licenseNumber: regex },
          { specialization: regex },
        ];
      }
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        doctors.find(filter).sort({ fullName: 1 }).skip(skip).limit(limit).toArray(),
        doctors.countDocuments(filter),
      ]);
      return { items, total };
    },

    enqueueOutboxEvent: outboxRepo.enqueueOutboxEvent,
    fetchPendingOutboxEvents: outboxRepo.fetchPendingOutboxEvents,
    markOutboxDelivered: outboxRepo.markDelivered,
    markOutboxFailed: outboxRepo.markFailed,
  };
}

module.exports = { createRepository };
