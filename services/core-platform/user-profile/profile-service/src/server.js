const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { buildEventEnvelope, createOutboxRepository, deliverOutboxBatch } = require('../../../../../libs/shared/src/outbox');
const { enforceProductionSecrets } = require('../../../../../libs/shared/src/env');
const { setStandardErrorHandler } = require('../../../../../libs/shared/src/errors');
const {
  computeOnboarding,
  pickSelfEditableProfileFields,
  pickMissingSelfProfileFields,
  pickMissingManagedProfileFields,
  buildProfileUpsertFromEnsure,
  mergeProfileView,
} = require('./profile-logic');
const { callJson, checkPermission } = require('./integration');

const serviceName = 'profile-service';
const port = Number(process.env.PORT) || 8092;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_profile_db';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const membershipApiBaseUrl = process.env.MEMBERSHIP_API_BASE_URL || '';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 20;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;

const searchWindowSec = 60;
const searchMaxPerWindow = 30;

let mongoClient;
let redisClient;
let dbReady = false;
let redisReady = false;
let db;
let fetchClient = (...args) => fetch(...args);
let outboxRepo = null;
let outboxTimer = null;

const collections = {
  profiles: () => db.collection('user_profiles'),
  placeholders: () => db.collection('profile_placeholders'),
  patientRegistry: () => db.collection('care_patient_registry'),
};

const errorSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
  },
  required: ['message'],
};

const validationErrorSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'integer', example: 400 },
    error: { type: 'string', example: 'Bad Request' },
    message: { type: 'string', example: 'Validation error' },
  },
};

function profileResponses(extra = {}) {
  return {
    200: { type: 'object', additionalProperties: true },
    400: validationErrorSchema,
    401: errorSchema,
    403: errorSchema,
    429: errorSchema,
    503: errorSchema,
    ...extra,
  };
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}

function parseBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

async function requireAuth(req, reply) {
  const token = parseBearerToken(req);
  if (!token) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.auth = {
      userId: String(payload.sub),
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      token,
    };
  } catch (_err) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
}

async function requireInternal(req, reply) {
  const incoming = req.headers['x-internal-token'];
  if (!incoming || incoming !== internalServiceToken) {
    return reply.code(401).send({ message: 'Unauthorized internal call' });
  }
}

async function enforcePermission(req, reply, permissionKey, organizationId) {
  const authorization = req.headers.authorization;
  const checked = await checkPermission(fetchClient, {
    rbacBaseUrl: rbacApiBaseUrl,
    authorization,
    permissionKey,
    organizationId,
    activeContextId: req.headers['x-active-context-id'] || null,
    activeContextName: req.headers['x-active-context-name'] || null,
    activeContextType: req.headers['x-active-context-type'] || null,
  });
  if (!checked.allowed) {
    reply.code(checked.status === 401 ? 401 : 403).send({ message: 'Forbidden' });
    return true;
  }
  return false;
}

function emitAuditEvent(event, req = null) {
  if (!outboxRepo) return;
  const orgIdFromHeaders = req?.headers ? (req.headers['x-org-id'] || null) : null;
  const branchIdFromHeaders = req?.headers ? (req.headers['x-branch-id'] || null) : null;
  outboxRepo.enqueueOutboxEvent(buildEventEnvelope({
    eventType: event.eventType || 'AUDIT_EVENT',
    sourceService: serviceName,
    aggregateType: event.resource?.type || 'profile',
    aggregateId: event.resource?.id || event.userId || null,
    payload: event,
    trace: {
      requestId: req?.headers?.['x-request-id'] || event.metadata?.requestId || null,
      userId: req?.auth?.userId || event.userId || null,
      orgId: event.organizationId || orgIdFromHeaders,
      branchId: event.metadata?.branchId || branchIdFromHeaders,
    },
    destination: 'audit',
  })).catch((err) => {
    fastify.log.warn({ err, eventType: event?.eventType }, 'profile outbox enqueue failed');
  });
}

function getPermissionOrganizationId(req) {
  const queryOrgId = req?.query && typeof req.query === 'object' ? req.query.organizationId : null;
  const headerOrgId = req?.headers?.['x-org-id'] || null;
  const activeContextId = req?.headers?.['x-active-context-id'] || null;
  let contextOrgId = null;
  if (typeof activeContextId === 'string' && activeContextId.startsWith('org:')) {
    const parts = activeContextId.split(':');
    if (parts.length >= 2 && parts[1]) {
      contextOrgId = parts[1];
    }
  }
  return String(queryOrgId || headerOrgId || contextOrgId || '').trim() || null;
}

function getCareInstitutionId(req) {
  const queryInstitutionId = req?.query && typeof req.query === 'object' ? req.query.institutionId : null;
  const bodyInstitutionId = req?.body && typeof req.body === 'object' ? req.body.institutionId : null;
  const headerInstitutionId = req?.headers?.['x-institution-id'] || null;
  return String(queryInstitutionId || bodyInstitutionId || headerInstitutionId || '').trim() || null;
}

function getCareBranchId(req) {
  const queryBranchId = req?.query && typeof req.query === 'object' ? req.query.branchId : null;
  const bodyBranchId = req?.body && typeof req.body === 'object' ? req.body.branchId : null;
  const headerBranchId = req?.headers?.['x-branch-id'] || null;
  return String(queryBranchId || bodyBranchId || headerBranchId || '').trim() || null;
}

function isPatientCareProfileRequest(req) {
  const queryView = req?.query && typeof req.query === 'object' ? req.query.view : null;
  return String(queryView || '').trim().toLowerCase() === 'patient-care';
}

function buildForwardHeaders(req) {
  const headers = {
    authorization: req.headers.authorization,
    'content-type': 'application/json',
  };
  if (req.headers['x-active-context-id']) headers['x-active-context-id'] = req.headers['x-active-context-id'];
  if (req.headers['x-active-context-name']) headers['x-active-context-name'] = req.headers['x-active-context-name'];
  if (req.headers['x-active-context-type']) headers['x-active-context-type'] = req.headers['x-active-context-type'];
  if (req.headers['x-org-id']) headers['x-org-id'] = req.headers['x-org-id'];
  if (req.headers['x-institution-id']) headers['x-institution-id'] = req.headers['x-institution-id'];
  if (req.headers['x-branch-id']) headers['x-branch-id'] = req.headers['x-branch-id'];
  return headers;
}

async function fetchOrganizationMemberRefs(organizationId, req) {
  if (!organizationId || !membershipApiBaseUrl) return null;

  const allowedUserIds = new Set();
  const allowedNins = new Set();
  let page = 1;
  const limit = 500;
  const maxPages = 10;

  while (page <= maxPages) {
    const qs = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      status: 'active',
    });
    const res = await callJson(fetchClient, `${membershipApiBaseUrl}/orgs/${encodeURIComponent(String(organizationId))}/members?${qs.toString()}`, {
      method: 'GET',
      headers: buildForwardHeaders(req),
    });
    if (!res.ok) return null;

    const items = Array.isArray(res.body?.items) ? res.body.items : [];
    for (const item of items) {
      const userId = String(item?.userId || '').trim();
      const nin = String(item?.nin || '').trim();
      if (userId) allowedUserIds.add(userId);
      if (nin) allowedNins.add(nin);
    }

    const total = Number(res.body?.total || items.length || 0);
    if (items.length < limit || (page * limit) >= total) break;
    page += 1;
  }

  return { allowedUserIds, allowedNins };
}

function isProfileAllowedInOrganization(profile, memberRefs) {
  if (!memberRefs) return true;
  const userId = String(profile?.userId || '').trim();
  const nin = String(profile?.nin || '').trim();
  return memberRefs.allowedUserIds.has(userId) || memberRefs.allowedNins.has(nin);
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function normalizePatientNameCandidate(value, fallbackNin = '') {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  const digits = normalized.replace(/\D/g, '');
  const fallbackDigits = String(fallbackNin || '').trim().replace(/\D/g, '');
  const isSyntheticNinLabel =
    normalized === fallbackDigits
    || (/^NIN\b/i.test(normalized) && digits.length === 11)
    || Boolean(fallbackDigits && digits === fallbackDigits);

  return isSyntheticNinLabel ? '' : normalized;
}

function buildPatientDisplayName(source = {}, fallbackNin = '') {
  const firstName = pickFirstNonEmpty(source.firstName);
  const otherName = pickFirstNonEmpty(source.otherName);
  const lastName = pickFirstNonEmpty(source.lastName);
  const nameParts = [firstName, otherName, lastName].filter(Boolean);
  const combinedName = nameParts.join(' ').trim();
  const strongCombinedName = nameParts.length >= 2 ? combinedName : '';
  return pickFirstNonEmpty(
    strongCombinedName,
    normalizePatientNameCandidate(source.displayName, fallbackNin),
    normalizePatientNameCandidate(source.fullName, fallbackNin),
    normalizePatientNameCandidate(source.name, fallbackNin),
    combinedName,
    fallbackNin ? `NIN ${fallbackNin}` : '',
    'Patient',
  );
}

function buildPatientRegistrySnapshot({ profile = null, ninSummary = null, fallbackNin = '' }) {
  const source = profile || ninSummary || {};
  const nin = pickFirstNonEmpty(source.nin, fallbackNin);
  const firstName = pickFirstNonEmpty(source.firstName) || null;
  const otherName = pickFirstNonEmpty(source.otherName) || null;
  const lastName = pickFirstNonEmpty(source.lastName) || null;
  const displayName = buildPatientDisplayName(source, nin);

  return {
    userId: pickFirstNonEmpty(source.userId) || null,
    nin,
    displayName,
    firstName,
    otherName,
    lastName,
    gender: pickFirstNonEmpty(source.gender) || null,
    dob: pickFirstNonEmpty(source.dob) || null,
    phone: pickFirstNonEmpty(source.phone) || null,
    email: pickFirstNonEmpty(source.email).toLowerCase() || null,
  };
}

function buildUniqueStringList(...groups) {
  return Array.from(
    new Set(
      groups
        .flat()
        .map((entry) => String(entry || '').trim())
        .filter(Boolean),
    ),
  );
}

function toTimestamp(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickLatestNonEmpty(entries, fieldName) {
  for (const entry of entries) {
    const value = entry?.[fieldName];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function mergePatientRegistryEntries(entries) {
  const sorted = [...entries].sort((left, right) => {
    const rightStamp = Math.max(toTimestamp(right?.updatedAt), toTimestamp(right?.createdAt));
    const leftStamp = Math.max(toTimestamp(left?.updatedAt), toTimestamp(left?.createdAt));
    return rightStamp - leftStamp;
  });
  const primary = sorted[0] || {};
  const earliestCreatedAt = entries
    .map((entry) => entry?.createdAt)
    .filter(Boolean)
    .sort((left, right) => toTimestamp(left) - toTimestamp(right))[0] || primary.createdAt || new Date();
  const latestUpdatedAt = entries
    .map((entry) => entry?.updatedAt || entry?.createdAt)
    .filter(Boolean)
    .sort((left, right) => toTimestamp(right) - toTimestamp(left))[0] || primary.updatedAt || primary.createdAt || new Date();
  const institutionIds = buildUniqueStringList(
    entries.map((entry) => entry?.institutionId),
    entries.flatMap((entry) => Array.isArray(entry?.institutionIds) ? entry.institutionIds : []),
  );
  const branchIds = buildUniqueStringList(
    entries.map((entry) => entry?.branchId),
    entries.flatMap((entry) => Array.isArray(entry?.branchIds) ? entry.branchIds : []),
  );
  const nin = pickLatestNonEmpty(sorted, 'nin') || null;
  const firstName = pickLatestNonEmpty(sorted, 'firstName');
  const otherName = pickLatestNonEmpty(sorted, 'otherName');
  const lastName = pickLatestNonEmpty(sorted, 'lastName');
  const displayName = buildPatientDisplayName({
    displayName: pickLatestNonEmpty(sorted, 'displayName'),
    fullName: pickLatestNonEmpty(sorted, 'fullName'),
    name: pickLatestNonEmpty(sorted, 'name'),
    firstName,
    otherName,
    lastName,
  }, nin || '');

  return {
    ...primary,
    registryId: pickLatestNonEmpty(sorted, 'registryId') || crypto.randomUUID(),
    organizationId: pickLatestNonEmpty(sorted, 'organizationId') || null,
    nin,
    userId: pickLatestNonEmpty(sorted, 'userId'),
    displayName,
    firstName,
    otherName,
    lastName,
    gender: pickLatestNonEmpty(sorted, 'gender'),
    dob: pickLatestNonEmpty(sorted, 'dob'),
    phone: pickLatestNonEmpty(sorted, 'phone'),
    email: pickLatestNonEmpty(sorted, 'email'),
    institutionId: pickLatestNonEmpty(sorted, 'institutionId') || institutionIds[0] || null,
    institutionIds,
    branchId: pickLatestNonEmpty(sorted, 'branchId') || branchIds[0] || null,
    branchIds,
    registeredByUserId: pickLatestNonEmpty(sorted, 'registeredByUserId'),
    createdAt: earliestCreatedAt,
    updatedAt: latestUpdatedAt,
  };
}

async function dropIndexIfExists(collection, indexName) {
  if (!collection || typeof collection.dropIndex !== 'function') return;
  try {
    await collection.dropIndex(indexName);
  } catch (error) {
    if (!/index not found|ns not found/i.test(String(error?.message || ''))) {
      throw error;
    }
  }
}

async function normalizePatientRegistryCollection() {
  const collection = collections.patientRegistry();
  if (!collection || typeof collection.find !== 'function') return;

  const allEntries = await collection.find({}).toArray();
  if (!Array.isArray(allEntries) || allEntries.length === 0) return;

  if (typeof collection.replaceOne === 'function' && typeof collection.deleteMany === 'function') {
    const grouped = new Map();
    for (const entry of allEntries) {
      const organizationId = String(entry?.organizationId || '').trim();
      const nin = String(entry?.nin || '').trim();
      if (!organizationId || !nin) continue;
      const key = `${organizationId}::${nin}`;
      const bucket = grouped.get(key) || [];
      bucket.push(entry);
      grouped.set(key, bucket);
    }

    for (const entries of grouped.values()) {
      if (!entries.length) continue;
      const merged = mergePatientRegistryEntries(entries);
      const [primary, ...duplicates] = [...entries].sort((left, right) => {
        const rightStamp = Math.max(toTimestamp(right?.updatedAt), toTimestamp(right?.createdAt));
        const leftStamp = Math.max(toTimestamp(left?.updatedAt), toTimestamp(left?.createdAt));
        return rightStamp - leftStamp;
      });
      if (primary?._id) {
        await collection.replaceOne({ _id: primary._id }, { ...merged, _id: primary._id });
      }
      const duplicateIds = duplicates.map((entry) => entry?._id).filter(Boolean);
      if (duplicateIds.length > 0) {
        await collection.deleteMany({ _id: { $in: duplicateIds } });
      }
    }
  }

  await dropIndexIfExists(collection, 'organizationId_1_institutionId_1_nin_1');
  await dropIndexIfExists(collection, 'organizationId_1_institutionId_1_createdAt_-1');
}

function flattenUpdateFields(input, prefix = '') {
  const out = {};
  if (!input || typeof input !== 'object') return out;

  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(out, flattenUpdateFields(value, path));
      continue;
    }
    out[path] = value;
  }

  return out;
}

async function updateProfileDocument(userId, editable, picker = pickSelfEditableProfileFields) {
  const updates = picker(editable || {});
  if (Object.keys(updates).length === 0) {
    return { profile: await collections.profiles().findOne({ userId }), updatedKeys: [] };
  }
  const setDoc = {
    ...flattenUpdateFields(updates),
    'metadata.updatedAt': new Date(),
  };
  await collections.profiles().updateOne({ userId }, { $set: setDoc }, { upsert: true });
  const updated = await collections.profiles().findOne({ userId });
  const onboarding = computeOnboarding(updated || {});
  await collections.profiles().updateOne(
    { userId },
    { $set: { 'onboarding.completedSteps': onboarding.completedSteps, 'onboarding.completenessScore': onboarding.completenessScore } },
  );
  return { profile: await collections.profiles().findOne({ userId }), updatedKeys: Object.keys(updates) };
}

async function applySearchRateLimit(req, reply) {
  if (!redisReady || !req.auth?.userId) {
    return;
  }
  const now = Date.now();
  const key = `profile:search:${req.auth.userId}`;
  const member = `${now}:${crypto.randomUUID()}`;
  await redisClient.zAdd(key, [{ score: now, value: member }]);
  await redisClient.zRemRangeByScore(key, 0, now - searchWindowSec * 1000);
  const count = await redisClient.zCard(key);
  await redisClient.expire(key, searchWindowSec + 5);
  if (count > searchMaxPerWindow) {
    return reply.code(429).send({ message: 'Too many search requests' });
  }
  return null;
}

async function connect() {
  if (!mongoUri) {
    fastify.log.warn('Missing MONGODB_URI; profile-service running in degraded mode');
    return;
  }

  try {
    mongoClient = new MongoClient(mongoUri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: false,
        deprecationErrors: true,
      },
    });
    await mongoClient.connect();
    db = mongoClient.db(dbName);
    await db.command({ ping: 1 });
    dbReady = true;
    outboxRepo = createOutboxRepository(db);
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed');
  }

  try {
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => fastify.log.error({ err }, 'Redis error'));
    await redisClient.connect();
    redisReady = true;
  } catch (err) {
    fastify.log.warn({ err }, 'Redis connection failed');
  }

  if (dbReady) {
    await normalizePatientRegistryCollection();
    await Promise.all([
      collections.profiles().createIndex({ userId: 1 }, { unique: true }),
      collections.profiles().createIndex({ nin: 1 }, { unique: true, sparse: true }),
      collections.profiles().createIndex({ phone: 1 }, { unique: true, sparse: true }),
      collections.profiles().createIndex({ email: 1 }, { unique: true, sparse: true }),
      collections.profiles().createIndex({ lastName: 'text', firstName: 'text', displayName: 'text' }),
      collections.placeholders().createIndex({ nin: 1 }),
      collections.patientRegistry().createIndex({ organizationId: 1, nin: 1 }, { unique: true }),
      collections.patientRegistry().createIndex({ organizationId: 1, createdAt: -1 }),
      collections.patientRegistry().createIndex({ organizationId: 1, institutionIds: 1 }),
      collections.patientRegistry().createIndex({ organizationId: 1, branchIds: 1 }),
      collections.patientRegistry().createIndex({ displayName: 'text', firstName: 'text', lastName: 'text', otherName: 'text', nin: 'text' }),
      outboxRepo.createIndexes(),
    ]);
  }
}

async function flushOutboxOnce() {
  if (!outboxRepo) return;
  await deliverOutboxBatch({
    outboxRepo,
    logger: fastify.log,
    batchSize: outboxBatchSize,
    maxAttempts: outboxMaxAttempts,
    handlers: {
      audit: async (event) => {
        const res = await fetchClient(`${auditApiBaseUrl}/internal/audit/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ eventId: event.eventId, ...event.payload, createdAt: event.createdAt }),
        });
        if (!res.ok) throw new Error(`audit delivery failed: ${res.status}`);
      },
    },
  });
}

function startOutboxWorker() {
  if (outboxTimer) return;
  outboxTimer = setInterval(() => { void flushOutboxOnce(); }, outboxIntervalMs);
}

fastify.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  if (!dbReady) {
    return reply.code(503).send({ message: 'Profile storage unavailable' });
  }
});

async function fetchAuthMe(authorization) {
  const res = await callJson(fetchClient, `${authApiBaseUrl}/me`, {
    method: 'GET',
    headers: { authorization, 'content-type': 'application/json' },
  });
  return res.ok ? res.body?.user : null;
}

async function fetchNinSummary(nin, authorization) {
  if (!nin) return null;
  const res = await callJson(fetchClient, `${authApiBaseUrl}/nin/${nin}`, {
    method: 'GET',
    headers: { authorization, 'content-type': 'application/json' },
  });
  if (!res.ok) return null;
  const body = res.body || {};
  return {
    nin: body.nin || nin,
    firstName: body.firstName || null,
    lastName: body.lastName || null,
    otherName: body.otherName || null,
    middleName: body.middleName || body.otherName || null,
    fullName: body.fullName || null,
    displayName: body.displayName || body.fullName || null,
    dob: body.dob || null,
    gender: body.gender || null,
    nationality: body.nationality || null,
    stateOfOrigin: body.stateOfOrigin || body.state || null,
    state: body.state || body.stateOfOrigin || null,
    localGovernment: body.localGovernment || body.lga || null,
    lga: body.lga || body.localGovernment || null,
    phone: body.phone || null,
    email: body.email || null,
    photoUrl: body.photoUrl || null,
    profilePhotoUrl: body.profilePhotoUrl || body.photoUrl || null,
    profilePictureUrl: body.profilePictureUrl || body.profilePhotoUrl || body.photoUrl || null,
    avatarUrl: body.avatarUrl || body.profilePhotoUrl || body.photoUrl || null,
    imageUrl: body.imageUrl || body.photoUrl || null,
    passportPhotoUrl: body.passportPhotoUrl || body.photoUrl || null,
    address: body.address || null,
    addressText: body.addressText || body.residentialAddress || null,
    residentialAddress: body.residentialAddress || body.addressText || null,
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : null,
    isActive: body.isActive !== false,
    lastFetchedAt: body.lastFetchedAt || null,
  };
}

function shouldFetchNinSummaryForProfile(profile = {}) {
  if (!profile || typeof profile !== 'object') return true;
  if (!pickFirstNonEmpty(profile.firstName, profile.lastName, profile.otherName)) return true;
  if (!pickFirstNonEmpty(
    normalizePatientNameCandidate(profile.displayName, profile.nin),
    normalizePatientNameCandidate(profile.fullName, profile.nin),
    normalizePatientNameCandidate(profile.name, profile.nin),
  )) return true;
  if (!pickFirstNonEmpty(
    profile.dob,
    profile.gender,
    profile.nationality,
    profile.stateOfOrigin,
    profile.state,
    profile.localGovernment,
    profile.lga,
    profile.addressText,
    profile.residentialAddress,
  )) return true;
  return false;
}

function mergePatientProfileWithNinSummary(profile = {}, ninSummary = null) {
  if (!ninSummary) return profile;

  const nin = pickFirstNonEmpty(profile.nin, ninSummary.nin) || null;
  const firstName = pickFirstNonEmpty(profile.firstName, ninSummary.firstName) || null;
  const otherName = pickFirstNonEmpty(profile.otherName, profile.middleName, ninSummary.otherName, ninSummary.middleName) || null;
  const lastName = pickFirstNonEmpty(profile.lastName, ninSummary.lastName) || null;

  return {
    ...ninSummary,
    ...profile,
    nin,
    firstName,
    otherName,
    middleName: otherName,
    lastName,
    dob: pickFirstNonEmpty(profile.dob, ninSummary.dob) || null,
    gender: pickFirstNonEmpty(profile.gender, ninSummary.gender) || null,
    nationality: pickFirstNonEmpty(profile.nationality, ninSummary.nationality) || null,
    stateOfOrigin: pickFirstNonEmpty(profile.stateOfOrigin, profile.state, ninSummary.stateOfOrigin, ninSummary.state) || null,
    state: pickFirstNonEmpty(profile.state, profile.stateOfOrigin, ninSummary.state, ninSummary.stateOfOrigin) || null,
    localGovernment: pickFirstNonEmpty(profile.localGovernment, profile.lga, ninSummary.localGovernment, ninSummary.lga) || null,
    lga: pickFirstNonEmpty(profile.lga, profile.localGovernment, ninSummary.lga, ninSummary.localGovernment) || null,
    phone: pickFirstNonEmpty(profile.phone, ninSummary.phone) || null,
    email: pickFirstNonEmpty(profile.email, ninSummary.email).toLowerCase() || null,
    addressText: pickFirstNonEmpty(profile.addressText, profile.residentialAddress, ninSummary.addressText, ninSummary.residentialAddress) || null,
    residentialAddress: pickFirstNonEmpty(profile.residentialAddress, profile.addressText, ninSummary.residentialAddress, ninSummary.addressText) || null,
    displayName: buildPatientDisplayName({
      ...ninSummary,
      ...profile,
      firstName,
      otherName,
      lastName,
    }, nin || ''),
  };
}

async function fetchRolesSummary(authorization) {
  const res = await callJson(fetchClient, `${rbacApiBaseUrl}/rbac/me/scope`, {
    method: 'GET',
    headers: { authorization, 'content-type': 'application/json' },
  });
  if (!res.ok) return null;
  return {
    appScopePermissions: res.body?.appScopePermissions || [],
    orgScopePermissions: res.body?.orgScopePermissions || [],
    rolesUsed: res.body?.rolesUsed || null,
  };
}

async function fetchMembershipSummary(userId, authorization) {
  if (!membershipApiBaseUrl) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await callJson(fetchClient, `${membershipApiBaseUrl}/users/${userId}/memberships?includeBranches=true`, {
      method: 'GET',
      headers: {
        authorization,
        'x-internal-token': internalServiceToken,
        'content-type': 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const memberships = Array.isArray(res.body?.memberships)
      ? res.body.memberships
      : (Array.isArray(res.body?.items) ? res.body.items : []);
    return {
      memberships: memberships.map((item) => ({
        organizationId: item.organizationId,
        organizationName: item.organizationName || null,
        membershipId: item.membershipId,
        membershipStatus: item.membershipStatus || item.status || null,
        roles: Array.isArray(item.roles) ? item.roles : [],
        branches: Array.isArray(item.branches) ? item.branches : [],
      })),
    };
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureProfileFromAuth(userId, authUser, createdFrom = 'nin_login') {
  const existing = await collections.profiles().findOne({ userId });
  const upsertDoc = buildProfileUpsertFromEnsure(
    {
      userId,
      nin: authUser?.nin || existing?.nin || null,
      phone: authUser?.phone || existing?.phone || null,
      email: authUser?.email || existing?.email || null,
      phoneVerified: !!authUser?.phoneVerified,
      emailVerified: !!authUser?.emailVerified,
      hasSetPassword: !!authUser?.passwordSetAt && !authUser?.requiresPasswordChange,
      createdFrom,
    },
    existing
  );

  await collections.profiles().updateOne({ userId }, { $set: upsertDoc }, { upsert: true });
  return collections.profiles().findOne({ userId });
}

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  redisReady,
  dbName,
}));

fastify.get('/profile/me', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Get merged self profile view',
    description: 'Returns user profile, NIN cache summary, RBAC scope summary, and optional membership summary.',
    security: [{ bearerAuth: [] }],
    response: profileResponses({
      200: {
        type: 'object',
        additionalProperties: true,
        example: {
          profile: { userId: 'user-1', nin: '90000000001', displayName: 'John Doe', profileStatus: 'active' },
          ninSummary: { nin: '90000000001', firstName: 'John', lastName: 'Doe' },
          rolesSummary: { appScopePermissions: [{ permissionKey: 'profile.me.read', effect: 'allow' }] },
          membershipSummary: {
            memberships: [
              {
                organizationId: 'org-1',
                membershipId: 'mem-1',
                status: 'active',
                roles: ['org_staff'],
                branches: [
                  {
                    branchId: 'branch-1',
                    roles: ['doctor'],
                    departments: ['pediatrics'],
                    status: 'active',
                  },
                ],
              },
            ],
          },
        },
      },
    }),
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'profile.me.read');
  if (denied) return;
  const authUser = await fetchAuthMe(req.headers.authorization);
  if (!authUser) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
  const profile = await ensureProfileFromAuth(req.auth.userId, authUser, 'nin_login');
  const [ninSummary, rolesSummary, membershipSummary] = await Promise.all([
    fetchNinSummary(profile?.nin, req.headers.authorization),
    fetchRolesSummary(req.headers.authorization),
    fetchMembershipSummary(req.auth.userId, req.headers.authorization),
  ]);
  if (membershipApiBaseUrl && membershipSummary === null) {
    emitAuditEvent({
      userId: req.auth.userId,
      eventType: 'PROFILE_MEMBERSHIP_LOOKUP_FAILED',
      action: 'profile.membership.lookup',
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      outcome: 'failure',
      failureReason: 'MEMBERSHIP_SERVICE_UNAVAILABLE',
    }, req);
  }

  const merged = mergeProfileView({ profile, ninSummary, rolesSummary, membershipSummary });
  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_VIEWED_SELF',
    action: 'profile.me.read',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  }, req);
  return reply.send(merged);
});

fastify.patch('/profile/me', {
  preHandler: requireAuth,
  schema: {
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        displayName: { type: 'string' },
        otherName: { type: 'string' },
        dob: { type: 'string' },
        gender: { type: 'string' },
        nationality: { type: 'string' },
        stateOfOrigin: { type: 'string' },
        localGovernment: { type: 'string' },
        address: { type: 'object', additionalProperties: true },
        preferences: { type: 'object', additionalProperties: true },
      },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'profile.me.update');
  if (denied) return;

  const existing = await collections.profiles().findOne({ userId: req.auth.userId });
  const { profile, updatedKeys } = await updateProfileDocument(
    req.auth.userId,
    pickMissingSelfProfileFields(existing, req.body || {}),
    (payload) => payload || {},
  );

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_UPDATED_SELF',
    action: 'profile.me.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { updatedKeys },
  }, req);
  return reply.send({ message: updatedKeys.length > 0 ? 'Profile updated' : 'No missing profile fields were updated', profile });
});

fastify.post('/profile/me/request-nin-refresh', { preHandler: requireAuth }, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'profile.nin.refresh.request');
  if (denied) return;

  const profile = await collections.profiles().findOne({ userId: req.auth.userId });
  if (!profile?.nin) {
    return reply.code(400).send({ message: 'No NIN linked to profile' });
  }

  const response = await callJson(fetchClient, `${authApiBaseUrl}/nin/refresh/${profile.nin}`, {
    method: 'POST',
    headers: { authorization: req.headers.authorization, 'content-type': 'application/json' },
  });

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_NIN_REFRESH_REQUESTED',
    action: 'profile.nin.refresh.request',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: response.ok ? 'success' : 'failure',
    failureReason: response.ok ? null : 'NIN_REFRESH_UNAVAILABLE',
    metadata: { nin: profile.nin },
  }, req);

  return reply.code(response.status).send(response.body || { message: 'Request failed' });
});

fastify.get('/profile/me/status', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Get profile onboarding status',
    description: 'Returns onboarding completeness score and suggested next steps.',
    security: [{ bearerAuth: [] }],
    response: profileResponses({
      200: {
        type: 'object',
        example: {
          userId: 'user-1',
          profileStatus: 'pending',
          onboarding: { hasSetPassword: true, completedSteps: ['password_set'], completenessScore: 40 },
          nextSteps: ['verify_phone', 'verify_email'],
        },
      },
    }),
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'profile.me.read');
  if (denied) return;
  const profile = await collections.profiles().findOne({ userId: req.auth.userId });
  const onboarding = computeOnboarding(profile || {});
  const nextSteps = [];
  if (!profile?.onboarding?.hasSetPassword) nextSteps.push('set_password');
  if (!profile?.onboarding?.hasVerifiedPhone) nextSteps.push('verify_phone');
  if (!profile?.onboarding?.hasVerifiedEmail) nextSteps.push('verify_email');
  if (!profile?.displayName) nextSteps.push('set_display_name');
  return reply.send({
    userId: req.auth.userId,
    profileStatus: profile?.profileStatus || 'incomplete',
    onboarding: {
      ...(profile?.onboarding || {}),
      completedSteps: onboarding.completedSteps,
      completenessScore: onboarding.completenessScore,
    },
    nextSteps,
  });
});

fastify.get('/profile/search', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Search profiles',
    description: 'Searches user profiles by q/nin/phone/email/name with pagination. Rate-limited.',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
        properties: {
          q: { type: 'string' },
          nin: { type: 'string', pattern: '^\\d{11}$' },
          phone: { type: 'string' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string' },
          view: { type: 'string', enum: ['patient-care'] },
          organizationId: { type: 'string' },
          branchId: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
    },
    response: profileResponses({
      200: {
        type: 'object',
        additionalProperties: true,
        example: {
          page: 1,
          limit: 20,
          total: 1,
          items: [{ userId: 'user-1', nin: '90000000001', displayName: 'John Doe', profileStatus: 'active' }],
        },
      },
    }),
  },
}, async (req, reply) => {
  const organizationId = getPermissionOrganizationId(req);
  const isPatientCareRequest = isPatientCareProfileRequest(req);
  const denied = await enforcePermission(req, reply, 'profile.search', organizationId);
  if (denied) return;
  if (isPatientCareRequest) {
    const careDenied = await enforcePermission(req, reply, 'records.nin.read', organizationId);
    if (careDenied) return;
  }
  const limited = await applySearchRateLimit(req, reply);
  if (limited) return;

  const { q, nin, phone, email, name, role, page = 1, limit = 20 } = req.query || {};
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const filter = {};

  if (nin) filter.nin = String(nin);
  if (phone) filter.phone = String(phone);
  if (email) filter.email = String(email).toLowerCase();
  if (role) filter.professionTypes = String(role);
  if (name) {
    filter.$or = [
      { firstName: { $regex: String(name), $options: 'i' } },
      { lastName: { $regex: String(name), $options: 'i' } },
      { displayName: { $regex: String(name), $options: 'i' } },
    ];
  }
  if (q) {
    filter.$text = { $search: String(q) };
  }

  const projection = { userId: 1, nin: 1, displayName: 1, firstName: 1, lastName: 1, phone: 1, email: 1, professionTypes: 1, profileStatus: 1 };
  let items = [];
  let total = 0;

  if (organizationId && !isPatientCareRequest) {
    const memberRefs = await fetchOrganizationMemberRefs(organizationId, req);
    if (!memberRefs) {
      return reply.code(503).send({ message: 'Membership scope unavailable' });
    }
    const matched = await collections.profiles()
      .find(filter, { projection })
      .toArray();
    const visible = matched.filter((profile) => isProfileAllowedInOrganization(profile, memberRefs));
    total = visible.length;
    items = visible.slice((safePage - 1) * safeLimit, safePage * safeLimit);
  } else {
    [items, total] = await Promise.all([
      collections.profiles()
        .find(filter, { projection })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .toArray(),
      collections.profiles().countDocuments(filter),
    ]);
  }

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_SEARCHED',
    action: 'profile.search',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { hasQ: !!q, page: safePage, limit: safeLimit, view: isPatientCareRequest ? 'patient-care' : 'default' },
  }, req);
  return reply.send({ page: safePage, limit: safeLimit, total, items });
});

fastify.get('/profile/:userId', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Get profile by userId',
    description: 'Admin/staff profile read.',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' },
      },
    },
    querystring: {
      type: 'object',
      properties: {
        organizationId: { type: 'string' },
      },
    },
    response: profileResponses({
      200: {
        type: 'object',
        additionalProperties: true,
        example: {
          profile: { userId: 'user-1', nin: '90000000001', displayName: 'John Doe', profileStatus: 'active' },
        },
      },
      404: errorSchema,
    }),
  },
}, async (req, reply) => {
  const organizationId = getPermissionOrganizationId(req);
  const denied = await enforcePermission(req, reply, 'profile.user.read', organizationId);
  if (denied) return;
  const { userId } = req.params;
  const profile = await collections.profiles().findOne({ userId: String(userId) });
  if (!profile) return reply.code(404).send({ message: 'Profile not found' });
  if (organizationId) {
    const memberRefs = await fetchOrganizationMemberRefs(organizationId, req);
    if (!memberRefs) {
      return reply.code(503).send({ message: 'Membership scope unavailable' });
    }
    if (!isProfileAllowedInOrganization(profile, memberRefs)) {
      return reply.code(404).send({ message: 'Profile not found' });
    }
  }

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_VIEWED_ADMIN',
    action: 'profile.user.read',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { targetUserId: userId },
  }, req);
  return reply.send({ profile });
});

fastify.patch('/profile/:userId', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Update profile by userId',
    description: 'Authorized org staff profile update.',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' },
      },
    },
    querystring: {
      type: 'object',
      properties: {
        organizationId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        displayName: { type: 'string' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        otherName: { type: 'string' },
        dob: { type: 'string' },
        gender: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        professionTypes: { type: 'array', items: { type: 'string' } },
        address: { type: 'object', additionalProperties: true },
        preferences: { type: 'object', additionalProperties: true },
      },
    },
    response: profileResponses({
      200: { type: 'object', additionalProperties: true },
      404: errorSchema,
    }),
  },
}, async (req, reply) => {
  const organizationId = getPermissionOrganizationId(req);
  const denied = await enforcePermission(req, reply, 'profile.user.update', organizationId);
  if (denied) return;

  const { userId } = req.params;
  const existing = await collections.profiles().findOne({ userId: String(userId) });
  if (!existing) return reply.code(404).send({ message: 'Profile not found' });
  if (organizationId) {
    const memberRefs = await fetchOrganizationMemberRefs(organizationId, req);
    if (!memberRefs) {
      return reply.code(503).send({ message: 'Membership scope unavailable' });
    }
    if (!isProfileAllowedInOrganization(existing, memberRefs)) {
      return reply.code(404).send({ message: 'Profile not found' });
    }
  }

  const { profile, updatedKeys } = await updateProfileDocument(
    String(userId),
    pickMissingManagedProfileFields(existing, req.body || {}),
    (payload) => payload || {},
  );

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_UPDATED_ADMIN',
    action: 'profile.user.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { targetUserId: String(userId), updatedKeys },
  }, req);

  return reply.send({ message: updatedKeys.length > 0 ? 'Profile updated' : 'No missing profile fields were updated', profile });
});

fastify.get('/profile/by-nin/:nin', {
  preHandler: requireAuth,
  schema: {
    tags: ['User Profile'],
    summary: 'Get profile by NIN',
    description: 'Returns registered profile when user exists, otherwise not-registered response with NIN summary (authorized callers only).',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['nin'],
      properties: {
        nin: { type: 'string', pattern: '^\\d{11}$' },
      },
    },
    querystring: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['patient-care'] },
      },
    },
    response: profileResponses({
      200: {
        type: 'object',
        additionalProperties: true,
        example: {
          registered: false,
          ninSummary: { nin: '90000000001', firstName: 'John', lastName: 'Doe' },
        },
      },
    }),
  },
}, async (req, reply) => {
  const organizationId = getPermissionOrganizationId(req);
  const isPatientCareRequest = isPatientCareProfileRequest(req);
  const denied = await enforcePermission(req, reply, 'profile.user.read', organizationId);
  if (denied) return;
  if (isPatientCareRequest) {
    const careDenied = await enforcePermission(req, reply, 'records.nin.read', organizationId);
    if (careDenied) return;
  }
  const { nin } = req.params;
  if (!/^\d{11}$/.test(String(nin))) return reply.code(400).send({ message: 'nin must be 11 digits' });

  const profile = await collections.profiles().findOne({ nin: String(nin) });
  const ninSummary = profile && shouldFetchNinSummaryForProfile(profile)
    ? await fetchNinSummary(String(nin), req.headers.authorization)
    : null;
  if (profile) {
    if (organizationId && !isPatientCareRequest) {
      const memberRefs = await fetchOrganizationMemberRefs(organizationId, req);
      if (!memberRefs) {
        return reply.code(503).send({ message: 'Membership scope unavailable' });
      }
      if (!isProfileAllowedInOrganization(profile, memberRefs)) {
        return reply.send({ registered: false, ninSummary: ninSummary || await fetchNinSummary(String(nin), req.headers.authorization) });
      }
    }
    return reply.send({ registered: true, profile: mergePatientProfileWithNinSummary(profile, ninSummary), ...(ninSummary ? { ninSummary } : {}) });
  }
  const missingProfileNinSummary = await fetchNinSummary(String(nin), req.headers.authorization);
  return reply.send({ registered: false, ninSummary: missingProfileNinSummary });
});

fastify.get('/care/patients', {
  preHandler: requireAuth,
  schema: {
    tags: ['Patient Care'],
    summary: 'List registered care patients',
    description: 'Lists patients already registered into the current organization or institution care workspace.',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        nin: { type: 'string', pattern: '^\\d{11}$' },
        organizationId: { type: 'string' },
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    response: profileResponses({
      200: {
        type: 'object',
        additionalProperties: true,
        example: {
          page: 1,
          limit: 20,
          total: 1,
          items: [{ nin: '90000000001', displayName: 'John Doe', institutionIds: ['inst-1'], branchIds: ['branch-1'] }],
        },
      },
    }),
  },
}, async (req, reply) => {
  const organizationId = getPermissionOrganizationId(req);
  const denied = await enforcePermission(req, reply, 'profile.search', organizationId);
  if (denied) return;
  const careDenied = await enforcePermission(req, reply, 'records.nin.read', organizationId);
  if (careDenied) return;
  if (!organizationId) {
    return reply.code(400).send({ message: 'organizationId is required for care patient search' });
  }

  const { q, nin, page = 1, limit = 20 } = req.query || {};
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const filter = { organizationId };
  if (nin) {
    filter.nin = String(nin);
  }
  if (q) {
    const pattern = String(q).trim();
    if (pattern) {
      filter.$or = [
        { displayName: { $regex: pattern, $options: 'i' } },
        { firstName: { $regex: pattern, $options: 'i' } },
        { lastName: { $regex: pattern, $options: 'i' } },
        { otherName: { $regex: pattern, $options: 'i' } },
        { nin: { $regex: pattern, $options: 'i' } },
      ];
    }
  }

  const projection = {
    registryId: 1,
    organizationId: 1,
    institutionId: 1,
    institutionIds: 1,
    branchId: 1,
    branchIds: 1,
    userId: 1,
    nin: 1,
    displayName: 1,
    firstName: 1,
    otherName: 1,
    lastName: 1,
    gender: 1,
    dob: 1,
    phone: 1,
    email: 1,
    createdAt: 1,
    updatedAt: 1,
  };

  const [items, total] = await Promise.all([
    collections.patientRegistry()
      .find(filter, { projection })
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .toArray(),
    collections.patientRegistry().countDocuments(filter),
  ]);

  return reply.send({ page: safePage, limit: safeLimit, total, items });
});

fastify.post('/care/patients', {
  preHandler: requireAuth,
  schema: {
    tags: ['Patient Care'],
    summary: 'Register patient into organization care search',
    description: 'Looks up a patient by NIN and adds the patient into the organization-wide care register, with optional institution and branch attribution.',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['nin'],
      properties: {
        nin: { type: 'string', pattern: '^\\d{11}$' },
        institutionId: { type: 'string' },
        branchId: { type: 'string' },
      },
    },
    response: profileResponses({
      200: { type: 'object', additionalProperties: true },
      201: { type: 'object', additionalProperties: true },
    }),
  },
}, async (req, reply) => {
  const organizationId = getPermissionOrganizationId(req);
  const institutionId = getCareInstitutionId(req);
  const branchId = getCareBranchId(req);
  const denied = await enforcePermission(req, reply, 'profile.placeholder.create', organizationId);
  if (denied) return;
  const careDenied = await enforcePermission(req, reply, 'records.nin.read', organizationId);
  if (careDenied) return;
  if (!organizationId) {
    return reply.code(400).send({ message: 'organizationId is required for patient intake' });
  }

  const nin = String(req.body?.nin || '').trim();
  let profile = await collections.profiles().findOne({ nin });
  const needsNinSummary = !profile || shouldFetchNinSummaryForProfile(profile);
  const ninSummary = needsNinSummary ? await fetchNinSummary(nin, req.headers.authorization) : null;
  const mergedProfile = profile ? mergePatientProfileWithNinSummary(profile, ninSummary) : null;

  if (!mergedProfile && !ninSummary) {
    return reply.code(503).send({ message: 'Fetching patient details by NIN is currently not available.' });
  }

  const snapshot = buildPatientRegistrySnapshot({ profile: mergedProfile, ninSummary, fallbackNin: nin });
  const existing = await collections.patientRegistry().findOne({ organizationId, nin });
  const now = new Date();
  const registryId = existing?.registryId ? String(existing.registryId) : crypto.randomUUID();
  const nextInstitutionIds = buildUniqueStringList(
    existing?.institutionId,
    Array.isArray(existing?.institutionIds) ? existing.institutionIds : [],
    institutionId,
  );
  const nextBranchIds = Array.from(
    new Set(
      [
        ...(Array.isArray(existing?.branchIds) ? existing.branchIds.map((entry) => String(entry || '').trim()).filter(Boolean) : []),
        branchId,
      ].filter(Boolean),
    ),
  );
  const primaryInstitutionId = String(existing?.institutionId || '').trim()
    || institutionId
    || nextInstitutionIds[0]
    || null;
  const primaryBranchId = branchId
    || String(existing?.branchId || '').trim()
    || nextBranchIds[0]
    || null;

  await collections.patientRegistry().updateOne(
    { organizationId, nin },
    {
      $set: {
        registryId,
        organizationId,
        institutionId: primaryInstitutionId,
        institutionIds: nextInstitutionIds,
        branchId: primaryBranchId,
        branchIds: nextBranchIds,
        ...snapshot,
        updatedAt: now,
        registeredByUserId: existing?.registeredByUserId || req.auth.userId,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const patient = await collections.patientRegistry().findOne({ organizationId, nin });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: existing ? 'CARE_PATIENT_REFRESHED' : 'CARE_PATIENT_REGISTERED',
    action: 'profile.placeholder.create',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { institutionId: primaryInstitutionId, branchId: primaryBranchId, nin, registryId },
  }, req);

  return reply.code(existing ? 200 : 201).send({
    registryId,
    alreadyRegistered: Boolean(existing),
    patient,
  });
});

fastify.post('/profile/create-placeholder', {
  preHandler: requireAuth,
  schema: {
    body: {
      type: 'object',
      required: ['nin'],
      properties: {
        nin: { type: 'string', pattern: '^\\d{11}$' },
        note: { type: 'string' },
      },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'profile.placeholder.create', req.query?.organizationId);
  if (denied) return;
  const { nin, note } = req.body;

  const ninSummary = await fetchNinSummary(nin, req.headers.authorization);
  if (!ninSummary) {
    return reply.code(503).send({ message: 'Fetching from NIN is currently not available.' });
  }

  const placeholderId = crypto.randomUUID();
  await collections.placeholders().insertOne({
    placeholderId,
    nin,
    createdBy: req.auth.userId,
    note: note || null,
    createdAt: new Date(),
  });

  emitAuditEvent({
    userId: req.auth.userId,
    eventType: 'PROFILE_PLACEHOLDER_CREATED',
    action: 'profile.placeholder.create',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { nin, placeholderId },
  }, req);

  return reply.code(201).send({ placeholderId, registered: false, ninSummary });
});

fastify.post('/internal/profile/ensure', {
  preHandler: requireInternal,
  schema: {
    body: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' },
        nin: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        phoneVerified: { type: 'boolean' },
        emailVerified: { type: 'boolean' },
        hasSetPassword: { type: 'boolean' },
        createdFrom: { type: 'string' },
      },
    },
  },
}, async (req, reply) => {
  const body = req.body || {};
  const existing = await collections.profiles().findOne({ userId: String(body.userId) });
  const upsertDoc = buildProfileUpsertFromEnsure(body, existing);
  await collections.profiles().updateOne({ userId: String(body.userId) }, { $set: upsertDoc }, { upsert: true });
  return reply.send({ message: 'Profile ensured', userId: String(body.userId) });
});

fastify.post('/internal/profile/sync-contact', {
  preHandler: requireInternal,
  schema: {
    body: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        phoneVerified: { type: 'boolean' },
        emailVerified: { type: 'boolean' },
      },
    },
  },
}, async (req, reply) => {
  const { userId, phone, email, phoneVerified, emailVerified } = req.body || {};
  const updates = {
    'metadata.updatedAt': new Date(),
  };
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email;
  if (phoneVerified !== undefined) updates.phoneVerified = !!phoneVerified;
  if (emailVerified !== undefined) updates.emailVerified = !!emailVerified;

  await collections.profiles().updateOne({ userId: String(userId) }, { $set: updates }, { upsert: true });
  return reply.send({ message: 'Profile contact synced', userId: String(userId) });
});

const start = async () => {
  try {
    enforceProductionSecrets({
      nodeEnv: process.env.NODE_ENV,
      internalServiceToken,
      jwtSecret,
      nhrsContextSecret,
      mongodbUri: mongoUri,
    });
    await connect();
    startOutboxWorker();
    await fastify.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  try {
    if (outboxTimer) clearInterval(outboxTimer);
    if (redisClient) await redisClient.quit();
    if (mongoClient) await mongoClient.close();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => {
  const logger = (typeof fastify !== 'undefined' && fastify && fastify.log) ? fastify.log : console;
  logger.error({ err: reason }, 'Unhandled promise rejection; service will keep running in degraded mode');
});

process.on('uncaughtException', (err) => {
  const logger = (typeof fastify !== 'undefined' && fastify && fastify.log) ? fastify.log : console;
  logger.error({ err }, 'Uncaught exception; service will keep running in degraded mode');
});

setStandardErrorHandler(fastify);

function buildApp(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'dbReady')) {
    dbReady = !!options.dbReady;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'redisReady')) {
    redisReady = !!options.redisReady;
  }
  if (options.db) {
    db = options.db;
  }
  if (options.fetchImpl) {
    fetchClient = options.fetchImpl;
  }
  return fastify;
}

module.exports = {
  buildApp,
  start,
};

if (require.main === module) {
  start();
}

