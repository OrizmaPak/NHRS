const fastify = require('fastify')({ logger: true });
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { buildEventEnvelope, createOutboxRepository, deliverOutboxBatch } = require('../../../../../libs/shared/src/outbox');
const { enforceProductionSecrets } = require('../../../../../libs/shared/src/env');
const { setStandardErrorHandler } = require('../../../../../libs/shared/src/errors');

const serviceName = 'auth-api';
const port = Number(process.env.PORT) || 8081;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_auth_db';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const profileApiBaseUrl = process.env.PROFILE_API_BASE_URL || 'http://user-profile-service:8092';
const membershipApiBaseUrl = process.env.MEMBERSHIP_API_BASE_URL || 'http://membership-service:8103';
const organizationApiBaseUrl = process.env.ORGANIZATION_API_BASE_URL || 'http://organization-service:8093';
const uiThemeApiBaseUrl = process.env.UI_THEME_API_BASE_URL || 'http://ui-theme-service:8111';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 50;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;
const authMeCacheTtlSec = Math.max(0, Number(process.env.AUTH_ME_CACHE_TTL_SEC) || 20);
const authMeDependencyCacheTtlSec = Math.max(0, Number(process.env.AUTH_ME_DEP_CACHE_TTL_SEC) || 20);
const authThemeCacheTtlSec = Math.max(0, Number(process.env.AUTH_THEME_CACHE_TTL_SEC) || 60);

const accessTtlSec = 15 * 60;
const refreshTtlSec = 7 * 24 * 60 * 60;
const otpTtlMs = 10 * 60 * 1000;
const ipLimitWindowSec = 5 * 60;
const ipLimitMax = 10;
const idFailureWindowSec = 10 * 60;
const idFailureMax = 5;
const idLockSec = 15 * 60;

let dbReady = false;
let redisReady = false;
let mongoClient;
let redisClient;
let db;
let outboxRepo = null;
let outboxTimer = null;
let mongoConnectPromise = null;
let mongoReconnectTimer = null;
let authIndexesReady = false;

const mongoReconnectDelayMs = Math.max(1000, Number(process.env.MONGO_RECONNECT_DELAY_MS) || 10000);

const collections = {
  ninCache: () => db.collection('nin_cache'),
  users: () => db.collection('users'),
  roles: () => db.collection('roles'),
  otp: () => db.collection('otp_codes'),
  sessions: () => db.collection('sessions'),
};

// Local fallback for citizen UX if RBAC scope is transiently unavailable.
const citizenFallbackPermissions = Object.freeze([
  'profile:read:self',
  'auth.me.read',
  'auth.password.change',
  'auth.contact.phone.write',
  'auth.contact.email.write',
  'nin.profile.read',
  'profile.me.read',
  'profile.me.update',
  'profile.nin.refresh.request',
  'records.me.read',
  'records.symptoms.create',
  'records.entry.update',
  'records.entry.hide',
  'doctor.register',
  'emergency.request.create',
  'emergency.request.read',
  'emergency.room.read',
  'emergency.room.message.create',
  'emergency.inventory.search',
  'governance.case.create',
  'governance.case.read',
  'governance.case.room.read',
  'governance.case.room.message.create',
]);

function toObjectIdOrNull(value) {
  if (!value || !ObjectId.isValid(value)) {
    return null;
  }
  return new ObjectId(value);
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip;
}

function normalizeLoginIdentifier(method, { nin, email, phone } = {}) {
  if (method === 'nin' && nin) return `nin:${String(nin)}`;
  if (method === 'phone' && phone) return `phone:${String(phone)}`;
  if (method === 'email' && email) return `email:${String(email).toLowerCase()}`;
  return null;
}

function sanitizeAuditMetadata(value) {
  if (!value || typeof value !== 'object') {
    return value ?? null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditMetadata(item));
  }

  const blocked = new Set(['password', 'newPassword', 'currentPassword', 'code', 'otp', 'rawOtp', 'refreshToken']);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (blocked.has(key)) {
      continue;
    }
    out[key] = sanitizeAuditMetadata(val);
  }
  return out;
}

function emitAuditEvent(event) {
  if (!outboxRepo) return;
  const payload = {
    ...event,
    metadata: sanitizeAuditMetadata(event?.metadata || {}),
  };
  outboxRepo.enqueueOutboxEvent(buildEventEnvelope({
    eventType: payload.eventType || 'AUDIT_EVENT',
    sourceService: serviceName,
    aggregateType: payload.resource?.type || 'auth',
    aggregateId: payload.resource?.id || payload.userId || null,
    payload,
    trace: {
      requestId: payload.metadata?.requestId || null,
      userId: payload.userId || null,
      orgId: payload.organizationId || null,
      branchId: payload.metadata?.branchId || null,
    },
    destination: 'audit',
  })).catch((err) => {
    fastify.log.warn({ err, eventType: event?.eventType }, 'auth outbox enqueue failed');
  });
}

function syncProfileInternal(path, payload) {
  void (async () => {
    try {
      await fetch(`${profileApiBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': internalServiceToken,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      fastify.log.warn({ err, path }, 'Profile internal sync failed');
    }
  })();

  if (path === '/internal/profile/ensure' && payload?.userId && payload?.nin) {
    syncMembershipLink(payload.userId, payload.nin);
  }
}

function syncMembershipLink(userId, nin) {
  if (!userId || !nin) {
    return;
  }
  void (async () => {
    try {
      await fetch(`${membershipApiBaseUrl}/internal/memberships/link-user`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': internalServiceToken,
        },
        body: JSON.stringify({ userId: String(userId), nin: String(nin) }),
      });
    } catch (err) {
      fastify.log.warn({ err }, 'Membership link sync failed');
    }
  })();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyFailureJitter() {
  await delay(100 + crypto.randomInt(401));
}

async function addIpAttemptAndCheckLimit(ip) {
  if (!redisReady || !ip) {
    return { limited: false, count: 0 };
  }
  const now = Date.now();
  const key = `login:ip:${ip}`;
  const member = `${now}:${crypto.randomUUID()}`;
  await redisClient.zAdd(key, [{ score: now, value: member }]);
  await redisClient.zRemRangeByScore(key, 0, now - ipLimitWindowSec * 1000);
  const count = await redisClient.zCard(key);
  await redisClient.expire(key, ipLimitWindowSec + 5);
  return { limited: count > ipLimitMax, count };
}

async function getIdentifierLock(identifier) {
  if (!redisReady || !identifier) {
    return false;
  }
  return !!(await redisClient.get(`login:id:${identifier}:lock`));
}

async function registerIdentifierFailure(identifier) {
  if (!redisReady || !identifier) {
    return { count: 0, locked: false };
  }
  const key = `login:id:${identifier}`;
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.expire(key, idFailureWindowSec);
  }
  const locked = count >= idFailureMax;
  if (locked) {
    await redisClient.set(`login:id:${identifier}:lock`, '1', { EX: idLockSec });
  }
  return { count, locked };
}

async function clearIdentifierFailures(identifier) {
  if (!redisReady || !identifier) {
    return;
  }
  await redisClient.del(`login:id:${identifier}`);
  await redisClient.del(`login:id:${identifier}:lock`);
}

async function markUserFailure(user, lockNow = false) {
  if (!user?._id) {
    return;
  }
  const update = {
    $inc: { failedLoginAttempts: 1 },
    $set: {
      lastFailedLoginAt: new Date(),
      updatedAt: new Date(),
    },
  };
  if (lockNow) {
    update.$set.lockUntil = new Date(Date.now() + idLockSec * 1000);
  }
  await collections.users().updateOne({ _id: user._id }, update);
}

async function clearUserFailureState(user) {
  if (!user?._id) {
    return;
  }
  await collections.users().updateOne(
    { _id: user._id },
    {
      $set: {
        failedLoginAttempts: 0,
        lockUntil: null,
        lastFailedLoginAt: null,
        updatedAt: new Date(),
      },
    }
  );
}

function isUserLocked(user) {
  return !!(user?.lockUntil && new Date(user.lockUntil).getTime() > Date.now());
}

function getOtpAttemptIdentifier(channel, destination) {
  return `${channel}:${String(destination).toLowerCase()}`;
}

async function trackOtpFailure(identifier, otpDoc) {
  if (!redisReady || !identifier) {
    return { blocked: false, retryAfterSec: 0 };
  }

  const now = Date.now();
  const attemptsKey = `otp:attempt:${identifier}`;
  const cooldownKey = `otp:attempt:${identifier}:cooldown`;
  const cooldownUntil = Number(await redisClient.get(cooldownKey) || 0);

  if (cooldownUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((cooldownUntil - now) / 1000) };
  }

  const attempts = await redisClient.incr(attemptsKey);
  if (attempts === 1) {
    await redisClient.expire(attemptsKey, 24 * 60 * 60);
  }

  if (attempts >= 5) {
    if (otpDoc?._id) {
      await collections.otp().updateOne({ _id: otpDoc._id }, { $set: { status: 'invalidated', invalidatedAt: new Date() } });
    }
    await redisClient.del(attemptsKey);
    await redisClient.del(cooldownKey);
    return { blocked: false, retryAfterSec: 0 };
  }

  const cooldownMs = Math.min(5 * 60 * 1000, 2000 * Math.pow(2, attempts - 1));
  await redisClient.set(cooldownKey, String(now + cooldownMs), { EX: Math.ceil(cooldownMs / 1000) });
  return { blocked: false, retryAfterSec: Math.ceil(cooldownMs / 1000) };
}

async function clearOtpFailures(identifier) {
  if (!redisReady || !identifier) {
    return;
  }
  await redisClient.del(`otp:attempt:${identifier}`);
  await redisClient.del(`otp:attempt:${identifier}:cooldown`);
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      nin: user.nin,
      roles: user.roles || ['citizen'],
      type: 'access',
    },
    jwtSecret,
    { expiresIn: accessTtlSec }
  );
}

function signRefreshToken(userId, jti) {
  return jwt.sign(
    {
      sub: String(userId),
      jti,
      type: 'refresh',
    },
    jwtSecret,
    { expiresIn: refreshTtlSec }
  );
}

async function getRolePermissions(roleNames) {
  const normalizedRoleNames = Array.isArray(roleNames)
    ? roleNames
      .map((role) => String(role || '').trim())
      .filter(Boolean)
    : [];
  if (normalizedRoleNames.length === 0) {
    normalizedRoleNames.push('citizen');
  }

  const roles = await collections
    .roles()
    .find({ name: { $in: normalizedRoleNames } })
    .toArray();

  const combined = Array.from(
    new Set(
      roles.flatMap((role) => (
        Array.isArray(role.permissions)
          ? role.permissions
            .map((permission) => {
              if (typeof permission === 'string') return permission;
              if (permission && typeof permission === 'object') {
                return String(permission.permissionKey || permission.key || '');
              }
              return '';
            })
            .filter(Boolean)
          : []
      ))
    )
  );

  if (normalizedRoleNames.includes('citizen')) {
    for (const permission of citizenFallbackPermissions) {
      if (!combined.includes(permission)) {
        combined.push(permission);
      }
    }
  }

  return combined;
}

async function issueSessionAndTokens(user, meta = {}) {
  const jti = crypto.randomUUID();
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user._id, jti);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + refreshTtlSec * 1000);

  await collections.sessions().insertOne({
    userId: user._id,
    jti,
    issuedAt: now,
    expiresAt,
    revokedAt: null,
    deviceMeta: {
      ip: meta.ip || null,
      userAgent: meta.userAgent || null,
    },
  });

  await redisClient.set(
    `refresh:${jti}`,
    JSON.stringify({ userId: String(user._id), revoked: false }),
    { EX: refreshTtlSec }
  );

  return { accessToken, refreshToken, expiresIn: accessTtlSec, jti };
}

function toUserResponse(user, scope = []) {
  const firstName = user.firstName || null;
  const lastName = user.lastName || null;
  const fullName = user.fullName || [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  return {
    id: String(user._id),
    nin: user.nin,
    firstName,
    lastName,
    otherName: user.otherName || null,
    dob: user.dob || null,
    nationality: user.nationality || 'Nigeria',
    stateOfOrigin: user.stateOfOrigin || null,
    localGovernment: user.localGovernment || null,
    fullName,
    email: user.email || null,
    phone: user.phone || null,
    phoneVerified: !!user.phoneVerified,
    emailVerified: !!user.emailVerified,
    roles: user.roles || ['citizen'],
    status: user.status || 'active',
    requiresPasswordChange: !!user.requiresPasswordChange,
    passwordSetAt: user.passwordSetAt || null,
    failedLoginAttempts: Number(user.failedLoginAttempts || 0),
    lockUntil: user.lockUntil || null,
    scope,
  };
}

function deriveNinProfileDefaults(ninCache = {}, user = {}) {
  return {
    firstName: user.firstName || ninCache.firstName || null,
    lastName: user.lastName || ninCache.lastName || null,
    otherName: user.otherName || ninCache.otherName || null,
    dob: user.dob || ninCache.dob || null,
    nationality: user.nationality || ninCache.nationality || 'Nigeria',
    stateOfOrigin: user.stateOfOrigin || ninCache.stateOfOrigin || ninCache.state || 'Lagos',
    localGovernment: user.localGovernment || ninCache.localGovernment || ninCache.lga || 'Ikeja',
  };
}

function toTimestamp(input) {
  if (!input) return 0;
  const asDate = new Date(input);
  const ts = asDate.getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function stableHash(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex').slice(0, 16);
}

async function getCachedJson(key) {
  if (!redisReady || !key) return null;
  try {
    const raw = await redisClient.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    fastify.log.warn({ err, key }, 'Redis cache get failed');
    return null;
  }
}

async function setCachedJson(key, value, ttlSec) {
  if (!redisReady || !key || !Number.isFinite(ttlSec) || ttlSec <= 0) return;
  try {
    await redisClient.set(key, JSON.stringify(value), { EX: ttlSec });
  } catch (err) {
    fastify.log.warn({ err, key }, 'Redis cache set failed');
  }
}

async function getRbacCacheVersion() {
  if (!redisReady) return '0';
  try {
    const value = await redisClient.get('rbac:version');
    return value || '0';
  } catch (err) {
    fastify.log.warn({ err }, 'Unable to read RBAC cache version');
    return '0';
  }
}

function buildAuthMeCacheKey(user, authorization = '', rbacCacheVersion = '0') {
  if (!user?._id) return null;
  const userId = String(user._id);
  const versionPayload = {
    version: 4,
    updatedAt: toTimestamp(user.updatedAt),
    passwordSetAt: toTimestamp(user.passwordSetAt),
    lockUntil: toTimestamp(user.lockUntil),
    roles: Array.isArray(user.roles)
      ? user.roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean).sort()
      : [],
    status: String(user.status || ''),
    requiresPasswordChange: Boolean(user.requiresPasswordChange),
    tokenType: authorization ? String(authorization).slice(0, 20) : '',
    rbacCacheVersion: String(rbacCacheVersion || '0'),
  };
  return `auth:me:v4:${userId}:${stableHash(JSON.stringify(versionPayload))}`;
}

function buildRbacScopeCacheKey(userId, rbacCacheVersion = '0') {
  if (!userId) return null;
  return `auth:rbac-scope:v3:${String(userId)}:${String(rbacCacheVersion || '0')}`;
}

function buildContextsCacheKey(userId, rbacScopeSummary = null, rbacCacheVersion = '0') {
  if (!userId) return null;
  const scopeFingerprint = stableHash(JSON.stringify({
    version: String(rbacCacheVersion || '0'),
    appRoles: Array.isArray(rbacScopeSummary?.appRoles) ? rbacScopeSummary.appRoles : [],
    appPermissions: Array.isArray(rbacScopeSummary?.appPermissions) ? rbacScopeSummary.appPermissions : [],
    orgRolesByOrganization: rbacScopeSummary?.orgRolesByOrganization || {},
    orgScopePermissions: Array.isArray(rbacScopeSummary?.orgScopePermissions)
      ? rbacScopeSummary.orgScopePermissions.map((entry) => ({
          organizationId: String(entry?.organizationId || '').trim(),
          permissions: Array.isArray(entry?.permissions) ? entry.permissions.map((item) => String(item || '')).sort() : [],
          roles: Array.isArray(entry?.roles) ? entry.roles.map((item) => String(item || '')).sort() : [],
        }))
      : [],
  }));
  return `auth:contexts:v3:${String(userId)}:${scopeFingerprint}`;
}

async function fetchMembershipContexts(userId, authorization) {
  try {
    const response = await fetch(`${membershipApiBaseUrl}/users/${encodeURIComponent(String(userId))}/memberships?includeBranches=true`, {
      method: 'GET',
      headers: {
        authorization,
        'x-internal-token': internalServiceToken,
        'content-type': 'application/json',
      },
    });
    if (!response.ok) return [];
    const body = await response.json();
    const memberships = Array.isArray(body?.memberships) ? body.memberships : [];
    const uniqueMemberships = Array.from(
      memberships.reduce((acc, membership) => {
        const organizationId = String(membership?.organizationId || '').trim();
        if (!organizationId) {
          return acc;
        }

        const normalizedRoles = Array.isArray(membership?.roles)
          ? membership.roles.map((role) => normalizeOrgRole(role)).filter(Boolean)
          : [];
        const normalizedBranches = Array.isArray(membership?.branches)
          ? membership.branches.filter(Boolean)
          : [];
        const existing = acc.get(organizationId);
        if (!existing) {
          acc.set(organizationId, {
            ...membership,
            organizationId,
            organizationName: membership?.organizationName ? String(membership.organizationName).trim() : null,
            name: membership?.name ? String(membership.name).trim() : null,
            roles: normalizedRoles,
            branches: normalizedBranches,
          });
          return acc;
        }

        const existingRoles = Array.isArray(existing.roles) ? existing.roles : [];
        const existingBranches = Array.isArray(existing.branches) ? existing.branches : [];
        const existingStatus = String(existing.membershipStatus || existing.status || '').trim().toLowerCase();
        const incomingStatus = String(membership?.membershipStatus || membership?.status || '').trim().toLowerCase();

        existing.roles = Array.from(new Set([...existingRoles, ...normalizedRoles]));
        existing.branches = [...existingBranches, ...normalizedBranches];
        existing.organizationName = existing.organizationName
          || (membership?.organizationName ? String(membership.organizationName).trim() : null)
          || (membership?.name ? String(membership.name).trim() : null)
          || null;
        existing.name = existing.name
          || (membership?.name ? String(membership.name).trim() : null)
          || (membership?.organizationName ? String(membership.organizationName).trim() : null)
          || null;

        if ((!existingStatus || existingStatus !== 'active') && incomingStatus === 'active') {
          existing.status = membership?.status || 'active';
          existing.membershipStatus = membership?.membershipStatus || membership?.status || 'active';
        }

        return acc;
      }, new Map()).values()
    );

    const operationalChecks = await Promise.all(uniqueMemberships.map(async (membership) => {
      try {
        const orgResponse = await fetch(`${organizationApiBaseUrl}/internal/orgs/${encodeURIComponent(membership.organizationId)}/access`, {
          method: 'GET',
          headers: {
            'x-internal-token': internalServiceToken,
            'content-type': 'application/json',
          },
        });
        if (!orgResponse.ok) {
          return null;
        }
        const orgAccess = await orgResponse.json();
        if (!orgAccess?.allowed) {
          return null;
        }
        const branchAssignments = Array.isArray(membership.branches)
          ? (await Promise.all(membership.branches.map(async (assignment) => {
            const branchId = assignment?.branchId ? String(assignment.branchId).trim() : null;
            const institutionId = assignment?.institutionId ? String(assignment.institutionId).trim() : null;
            const roles = Array.isArray(assignment?.roles)
              ? assignment.roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean)
              : [];
            if ((!branchId && !institutionId) || roles.length === 0) {
              return null;
            }
            let branchName = assignment?.branchName ? String(assignment.branchName).trim() : null;
            let institutionName = assignment?.institutionName ? String(assignment.institutionName).trim() : null;
            if ((!branchName && branchId) || (!institutionName && institutionId)) {
              try {
                const search = new URLSearchParams();
                if (institutionId) search.set('institutionId', institutionId);
                if (branchId) search.set('branchId', branchId);
                const scopeResponse = await fetch(`${organizationApiBaseUrl}/internal/orgs/${encodeURIComponent(membership.organizationId)}/access?${search.toString()}`, {
                  method: 'GET',
                  headers: {
                    'x-internal-token': internalServiceToken,
                    'content-type': 'application/json',
                  },
                });
                if (scopeResponse.ok) {
                  const scopeAccess = await scopeResponse.json();
                  if (scopeAccess?.allowed) {
                    branchName = branchName || (scopeAccess?.branchName ? String(scopeAccess.branchName).trim() : null);
                    institutionName = institutionName || (scopeAccess?.institutionName ? String(scopeAccess.institutionName).trim() : null);
                  }
                }
              } catch (_scopeErr) {
                // Keep the original scope payload if name hydration fails.
              }
            }
            return {
              branchId,
              institutionId,
              institutionName,
              branchName,
              roles,
            };
          }))).filter(Boolean)
          : [];
        return {
          type: 'organization',
          id: membership.organizationId,
          organizationId: membership.organizationId,
          organizationName: orgAccess?.organizationName || membership.organizationName || membership.organizationId,
          name: orgAccess?.organizationName || membership.organizationName || membership.organizationId,
          themeScopeType: 'organization',
          themeScopeId: membership.organizationId,
          membershipStatus: membership.membershipStatus || membership.status || 'active',
          roles: Array.isArray(membership.roles)
            ? membership.roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean)
            : [],
          branchAssignments,
        };
      } catch (_err) {
        return null;
      }
    }));
    return operationalChecks.filter(Boolean);
  } catch (_err) {
    return [];
  }
}

async function fetchEffectiveTheme(scopeType, scopeId) {
  try {
    const search = new URLSearchParams({ scope_type: scopeType });
    if (scopeId) search.set('scope_id', scopeId);
    const response = await fetch(`${uiThemeApiBaseUrl}/ui/theme/effective?${search.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_err) {
    return null;
  }
}

async function fetchEffectiveThemeCached(scopeType, scopeId) {
  const key = `auth:theme:effective:v1:${String(scopeType || 'platform')}:${String(scopeId || 'platform')}`;
  const cached = await getCachedJson(key);
  if (cached) return cached;
  const effective = await fetchEffectiveTheme(scopeType, scopeId);
  if (effective) {
    await setCachedJson(key, effective, authThemeCacheTtlSec);
  }
  return effective;
}

async function fetchRbacScopeSummary(authorization) {
  if (!authorization) {
    return { version: '0', permissions: [], appPermissions: [], orgScopePermissions: [], appRoles: [], orgRolesByOrganization: {} };
  }

  try {
    const response = await fetch(`${rbacApiBaseUrl}/rbac/me/scope`, {
      method: 'GET',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
    });
    if (!response.ok) {
      return { permissions: [], appPermissions: [], orgScopePermissions: [], appRoles: [], orgRolesByOrganization: {} };
    }

    const body = await response.json();
    const cacheVersion = String(body?.cacheVersion ?? body?.version ?? '0');
    const normalizePermissionKeys = (items = []) => (
      (Array.isArray(items) ? items : [])
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            return String(item.permissionKey || item.key || item.permission || '');
          }
          return '';
        })
        .filter(Boolean)
    );

    const appPermissions = Array.from(new Set(normalizePermissionKeys(body?.appScopePermissions).map((item) => String(item))));
    const orgScopePermissions = Array.isArray(body?.orgScopePermissions)
      ? body.orgScopePermissions
        .map((entry) => {
          const organizationId = String(entry?.organizationId || '').trim();
          if (!organizationId) return null;
          const permissions = Array.from(new Set(normalizePermissionKeys(entry?.permissions).map((item) => String(item))));
          const roles = Array.isArray(entry?.roles)
            ? Array.from(new Set(
              entry.roles
                .map((role) => {
                  if (typeof role === 'string') return role;
                  if (!role || typeof role !== 'object') return '';
                  return String(role.name || role.role || role.roleName || '').trim();
                })
                .filter(Boolean),
            ))
            : [];
          return {
            organizationId,
            permissions,
            roles,
          };
        })
        .filter(Boolean)
      : [];
    const appRoles = Array.isArray(body?.rolesUsed?.app)
      ? body.rolesUsed.app
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (!entry || typeof entry !== 'object') return '';
          return String(entry.name || entry.role || entry.roleName || '').trim();
        })
        .filter(Boolean)
      : [];
    const orgRolesByOrganization = {};
    for (const entry of orgScopePermissions) {
      const organizationId = String(entry.organizationId || '').trim();
      if (!organizationId) continue;
      if (Array.isArray(entry.roles) && entry.roles.length > 0) {
        orgRolesByOrganization[organizationId] = entry.roles;
      }
    }
    return {
      version: cacheVersion,
      permissions: appPermissions,
      appPermissions,
      orgScopePermissions,
      appRoles: [...new Set(appRoles.map((item) => String(item).trim()).filter(Boolean))],
      orgRolesByOrganization,
    };
  } catch (_err) {
    return { version: '0', permissions: [], appPermissions: [], orgScopePermissions: [], appRoles: [], orgRolesByOrganization: {} };
  }
}

async function fetchRbacScopeSummaryCached(userId, authorization, rbacCacheVersion = '0') {
  const key = buildRbacScopeCacheKey(userId, rbacCacheVersion);
  const cached = await getCachedJson(key);
  if (cached) return cached;
  const summary = await fetchRbacScopeSummary(authorization);
  await setCachedJson(key, summary, authMeDependencyCacheTtlSec);
  return summary;
}

function toRoleLabel(roleName) {
  const normalized = String(roleName || '').trim().toLowerCase();
  if (!normalized) return 'Member';
  if (normalized === 'owner') return 'Owner';
  if (normalized === 'super_staff') return 'Super Staff';
  return normalized
    .split(/[_\s-]+/)
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ''))
    .join(' ');
}

function normalizeOrgRole(roleName) {
  const normalized = String(roleName || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'org_owner') return 'owner';
  return normalized;
}

function buildContextSubtitle(scopeLabel, roleName, scopeName = null) {
  const readableScopeName = String(scopeName || '').trim();
  if (readableScopeName) {
    return `${scopeLabel}: ${readableScopeName} / ${toRoleLabel(roleName)}`;
  }
  return `${scopeLabel} / ${toRoleLabel(roleName)}`;
}

async function buildAvailableContexts(userId, authorization, rbacScopeSummary = null) {
  const membershipContexts = await fetchMembershipContexts(userId, authorization);
  const rolesByOrganization = rbacScopeSummary?.orgRolesByOrganization && typeof rbacScopeSummary.orgRolesByOrganization === 'object'
    ? rbacScopeSummary.orgRolesByOrganization
    : {};
  const orgRoleContexts = [];
  for (const membership of membershipContexts) {
    const organizationId = String(membership?.id || membership?.organizationId || '').trim();
    if (!organizationId) continue;
    const branchAssignments = Array.isArray(membership?.branchAssignments) ? membership.branchAssignments : [];
    const scopedRoleNames = new Set(
      branchAssignments.flatMap((assignment) => (
        Array.isArray(assignment?.roles)
          ? assignment.roles.map((role) => normalizeOrgRole(role)).filter(Boolean)
          : []
      )),
    );
    const membershipRoles = Array.isArray(membership?.roles)
      ? membership.roles.map((role) => normalizeOrgRole(role)).filter(Boolean)
      : [];
    const rbacRoles = Array.isArray(rolesByOrganization[organizationId])
      ? rolesByOrganization[organizationId].map((role) => normalizeOrgRole(role)).filter(Boolean)
      : [];
    const roleNames = Array.from(new Set([
      ...membershipRoles,
      ...rbacRoles.filter((role) => membershipRoles.includes(role) || !scopedRoleNames.has(role)),
    ]));
    for (const roleName of roleNames) {
      const encodedRole = encodeURIComponent(roleName);
      orgRoleContexts.push({
        type: 'organization',
        id: `org:${organizationId}:role:${encodedRole}`,
        organizationId,
        roleName,
        name: membership.name || membership.organizationName || organizationId,
        subtitle: buildContextSubtitle('Organization', roleName),
        themeScopeType: 'organization',
        themeScopeId: organizationId,
        membershipStatus: membership.membershipStatus || membership.status || 'active',
      });
    }

    for (const assignment of branchAssignments) {
      const institutionId = assignment?.institutionId ? String(assignment.institutionId).trim() : '';
      const branchId = assignment?.branchId ? String(assignment.branchId).trim() : '';
      const assignmentRoles = Array.isArray(assignment?.roles)
        ? assignment.roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean)
        : [];
      for (const roleName of assignmentRoles) {
        const encodedRole = encodeURIComponent(roleName);
        const scopeLabel = branchId ? 'Branch' : 'Institution';
        const scopeName = branchId
          ? assignment?.branchName
          : assignment?.institutionName;
        orgRoleContexts.push({
          type: 'organization',
          id: `org:${organizationId}:institution:${institutionId || 'none'}:branch:${branchId || 'none'}:role:${encodedRole}`,
          organizationId,
          institutionId: institutionId || null,
          branchId: branchId || null,
          roleName,
          name: membership.name || membership.organizationName || organizationId,
          subtitle: buildContextSubtitle(scopeLabel, roleName, scopeName),
          themeScopeType: 'organization',
          themeScopeId: organizationId,
          membershipStatus: membership.membershipStatus || membership.status || 'active',
        });
      }
    }
  }
  const uniqueOrgContexts = Array.from(
    new Map(orgRoleContexts.map((entry) => [`${entry.id}`, entry])).values(),
  );
  const base = {
    type: 'public',
    id: 'platform',
    name: 'NHRS Public',
    themeScopeType: 'platform',
    themeScopeId: null,
  };
  const availableContexts = [base, ...uniqueOrgContexts];
  // Default landing context is always citizen/public unless user explicitly switches in-session.
  const defaultContext = base;
  return { availableContexts, defaultContext };
}

async function buildAvailableContextsCached(userId, authorization, rbacScopeSummary = null, rbacCacheVersion = '0') {
  const key = buildContextsCacheKey(userId, rbacScopeSummary, rbacCacheVersion);
  const cached = await getCachedJson(key);
  if (cached && Array.isArray(cached.availableContexts) && cached.defaultContext) {
    return cached;
  }
  const built = await buildAvailableContexts(userId, authorization, rbacScopeSummary);
  await setCachedJson(key, built, authMeDependencyCacheTtlSec);
  return built;
}

async function requireAuth(req, reply) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const payload = jwt.verify(token, jwtSecret);
    if (payload.type !== 'access') {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    const user = await collections.users().findOne({ _id: new ObjectId(payload.sub) });
    if (!user) {
      return reply.code(401).send({ message: 'Unauthorized' });
    }

    req.user = user;
    req.tokenPayload = payload;
  } catch (err) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
}

async function requireAdmin(req, reply) {
  const roles = Array.isArray(req.user?.roles) ? req.user.roles.map((role) => String(role || '').trim().toLowerCase()) : [];
  if (!roles.includes('super') && !roles.includes('superadmin') && !roles.includes('super_admin') && !roles.includes('super admin')) {
    return reply.code(403).send({ message: 'Admin role required' });
  }
}

async function requireInternal(req, reply) {
  const incoming = req.headers['x-internal-token'];
  if (!incoming || incoming !== internalServiceToken) {
    return reply.code(401).send({ message: 'Unauthorized internal call' });
  }
}

async function closeMongoClientQuietly() {
  if (!mongoClient) return;
  try {
    await mongoClient.close();
  } catch (_err) {
    // Ignore cleanup failures while retrying the auth database connection.
  }
  mongoClient = null;
}

async function ensureMongoIndexes() {
  if (authIndexesReady || !dbReady || !db || !outboxRepo) {
    return;
  }
  await Promise.all([
    collections.ninCache().createIndex({ nin: 1 }, { unique: true }),
    collections.users().createIndex({ nin: 1 }, { unique: true }),
    collections.users().createIndex({ email: 1 }, { sparse: true }),
    collections.users().createIndex({ phone: 1 }, { sparse: true }),
    collections.roles().createIndex({ name: 1 }, { unique: true }),
    collections.otp().createIndex({ destination: 1, channel: 1, status: 1 }),
    collections.sessions().createIndex({ jti: 1 }, { unique: true }),
    collections.users().createIndex({ lockUntil: 1 }),
    outboxRepo.createIndexes(),
  ]);

  await collections.roles().updateOne(
    { name: 'citizen' },
    {
      $set: {
        name: 'citizen',
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
      $addToSet: {
        permissions: { $each: citizenFallbackPermissions },
      },
    },
    { upsert: true }
  );

  await collections.roles().deleteMany({ name: 'admin' });
  authIndexesReady = true;
}

function scheduleMongoReconnect() {
  if (dbReady || mongoReconnectTimer || !mongoUri) {
    return;
  }
  mongoReconnectTimer = setTimeout(() => {
    mongoReconnectTimer = null;
    void ensureMongoConnection();
  }, mongoReconnectDelayMs);
}

async function ensureMongoConnection() {
  if (dbReady) {
    return true;
  }
  if (!mongoUri) {
    fastify.log.warn('Missing MONGODB_URI; starting without database connection');
    return false;
  }
  if (mongoConnectPromise) {
    return mongoConnectPromise;
  }

  mongoConnectPromise = (async () => {
    try {
      await closeMongoClientQuietly();
      mongoClient = new MongoClient(mongoUri, {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        },
      });

      await mongoClient.connect();
      db = mongoClient.db(dbName);
      await db.command({ ping: 1 });
      dbReady = true;
      outboxRepo = createOutboxRepository(db);
      await ensureMongoIndexes();
      fastify.log.info({ dbName }, 'auth-api MongoDB connection ready');
      return true;
    } catch (err) {
      dbReady = false;
      db = null;
      outboxRepo = null;
      fastify.log.warn({ err }, 'MongoDB connection failed; auth-api running in degraded mode');
      await closeMongoClientQuietly();
      scheduleMongoReconnect();
      return false;
    } finally {
      mongoConnectPromise = null;
    }
  })();

  return mongoConnectPromise;
}

async function connect() {
  if (!mongoUri) {
    fastify.log.warn('Missing MONGODB_URI; starting without database connection');
  } else {
    await ensureMongoConnection();
  }

  try {
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => fastify.log.error({ err }, 'Redis client error'));
    await redisClient.connect();
    redisReady = true;
  } catch (err) {
    fastify.log.warn({ err }, 'Redis connection failed; auth-api running in degraded mode');
  }

  fastify.log.info({ dbName, redisUrl, dbReady, redisReady }, 'auth-api dependency status');
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
        const res = await fetch(`${auditApiBaseUrl}/internal/audit/events`, {
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
  if (req.url === '/health') {
    return;
  }
  if (!dbReady) {
    await ensureMongoConnection();
  }
  if (!dbReady || !redisReady) {
    return reply.code(503).send({ message: 'Service dependencies unavailable' });
  }
});

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  redisReady,
  dbName,
}));

fastify.post('/login', async (req, reply) => {
  const { method, nin, email, phone, password } = req.body || {};
  const ipAddress = getClientIp(req);
  const userAgent = req.headers['user-agent'] || null;
  const identifier = normalizeLoginIdentifier(method, { nin, email, phone });

  const ipRate = await addIpAttemptAndCheckLimit(ipAddress);
  if (ipRate.limited) {
    emitAuditEvent({
      userId: null,
      eventType: 'AUTH_LOGIN_FAILURE',
      action: 'auth.login',
      ipAddress,
      userAgent,
      outcome: 'failure',
      failureReason: 'IP_RATE_LIMIT_EXCEEDED',
      metadata: { method, attemptedIdentifier: identifier },
    });
    return reply.code(429).send({ message: 'Too many login attempts from this IP. Please retry later.' });
  }

  if (!method || !password) {
    return reply.code(400).send({ message: 'method and password are required' });
  }

  if (identifier && await getIdentifierLock(identifier)) {
    emitAuditEvent({
      userId: null,
      eventType: 'AUTH_LOGIN_FAILURE',
      action: 'auth.login',
      ipAddress,
      userAgent,
      outcome: 'failure',
      failureReason: 'IDENTIFIER_TEMP_LOCKED',
      metadata: { method, attemptedIdentifier: identifier },
    });
    await applyFailureJitter();
    return reply.code(423).send({ message: 'Account temporarily locked due to multiple failed attempts.' });
  }

  async function failLogin({ status, message, reason, user }) {
    let effectiveStatus = status;
    let lockApplied = false;

    if (identifier && (status === 401 || status === 403)) {
      const tracked = await registerIdentifierFailure(identifier);
      lockApplied = tracked.locked;
      await markUserFailure(user, tracked.locked);
      if (tracked.locked) {
        effectiveStatus = 423;
      }
    }

    emitAuditEvent({
      userId: user?._id ? String(user._id) : null,
      eventType: 'AUTH_LOGIN_FAILURE',
      action: 'auth.login',
      ipAddress,
      userAgent,
      outcome: 'failure',
      failureReason: lockApplied ? 'IDENTIFIER_LOCKED' : reason,
      metadata: { method, attemptedIdentifier: identifier },
    });
    await applyFailureJitter();
    return reply.code(effectiveStatus).send({
      message: lockApplied ? 'Account temporarily locked due to multiple failed attempts.' : message,
    });
  }

  if (method === 'nin') {
    if (!nin || !/^\d{11}$/.test(nin)) {
      return reply.code(400).send({ message: 'nin must be 11 digits' });
    }

    const ninCache = await collections.ninCache().findOne({ nin, isActive: { $ne: false } });
    if (!ninCache) {
      emitAuditEvent({
        userId: null,
        eventType: 'NIN_LOOKUP_FAILURE',
        action: 'nin.lookup',
        resource: { type: 'nin_cache', id: nin },
        ipAddress,
        userAgent,
        outcome: 'failure',
        failureReason: 'NIN_FETCH_UNAVAILABLE',
        metadata: { nin },
      });
      return reply.code(503).send({ message: 'Fetching from NIN is currently not available.' });
    }

    emitAuditEvent({
      userId: null,
      eventType: 'NIN_LOOKUP_SUCCESS',
      action: 'nin.lookup',
      resource: { type: 'nin_cache', id: nin },
      ipAddress,
      userAgent,
      outcome: 'success',
      metadata: { nin },
    });

    let user = await collections.users().findOne({ nin });
    if (!user) {
      const ninProfileDefaults = deriveNinProfileDefaults(ninCache, {});
      const insertResult = await collections.users().insertOne({
        nin,
        email: null,
        phone: null,
        passwordHash: null,
        passwordSetAt: null,
        requiresPasswordChange: true,
        phoneVerified: false,
        emailVerified: false,
        roles: ['citizen'],
        status: 'active',
        failedLoginAttempts: 0,
        lockUntil: null,
        lastFailedLoginAt: null,
        firstName: ninProfileDefaults.firstName,
        lastName: ninProfileDefaults.lastName,
        otherName: ninProfileDefaults.otherName,
        dob: ninProfileDefaults.dob,
        nationality: ninProfileDefaults.nationality,
        stateOfOrigin: ninProfileDefaults.stateOfOrigin,
        localGovernment: ninProfileDefaults.localGovernment,
        fullName: [ninProfileDefaults.firstName, ninProfileDefaults.lastName].filter(Boolean).join(' ').trim() || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      user = await collections.users().findOne({ _id: insertResult.insertedId });
    }

    const ninProfileDefaults = deriveNinProfileDefaults(ninCache, user);
    const profilePatch = {};
    if (!user.firstName && ninProfileDefaults.firstName) profilePatch.firstName = ninProfileDefaults.firstName;
    if (!user.lastName && ninProfileDefaults.lastName) profilePatch.lastName = ninProfileDefaults.lastName;
    if (!user.otherName && ninProfileDefaults.otherName) profilePatch.otherName = ninProfileDefaults.otherName;
    if (!user.dob && ninProfileDefaults.dob) profilePatch.dob = ninProfileDefaults.dob;
    if (!user.nationality && ninProfileDefaults.nationality) profilePatch.nationality = ninProfileDefaults.nationality;
    if (!user.stateOfOrigin && ninProfileDefaults.stateOfOrigin) profilePatch.stateOfOrigin = ninProfileDefaults.stateOfOrigin;
    if (!user.localGovernment && ninProfileDefaults.localGovernment) profilePatch.localGovernment = ninProfileDefaults.localGovernment;
    if ((!user.fullName || String(user.fullName).trim().length === 0) && (ninProfileDefaults.firstName || ninProfileDefaults.lastName)) {
      profilePatch.fullName = [ninProfileDefaults.firstName, ninProfileDefaults.lastName].filter(Boolean).join(' ').trim();
    }
    if (Object.keys(profilePatch).length > 0) {
      await collections.users().updateOne(
        { _id: user._id },
        { $set: { ...profilePatch, updatedAt: new Date() } },
      );
      user = { ...user, ...profilePatch };
    }

    if (isUserLocked(user)) {
      return failLogin({
        status: 423,
        message: 'Account temporarily locked due to multiple failed attempts.',
        reason: 'ACCOUNT_LOCKED',
        user,
      });
    }

    if (!user.passwordHash) {
      if (password !== ninCache.dob) {
        return failLogin({ status: 401, message: 'Invalid credentials', reason: 'INVALID_DOB_BOOTSTRAP', user });
      }

      await collections.users().updateOne(
        { _id: user._id },
        { $set: { requiresPasswordChange: true, updatedAt: new Date() } }
      );

      await clearIdentifierFailures(identifier);
      await clearUserFailureState(user);

      const tokenBundle = await issueSessionAndTokens(user, {
        ip: ipAddress,
        userAgent,
      });

      const scope = await getRolePermissions(user.roles || ['citizen']);

      emitAuditEvent({
        userId: String(user._id),
        eventType: 'AUTH_LOGIN_SUCCESS',
        action: 'auth.login',
        ipAddress,
        userAgent,
        outcome: 'success',
        metadata: { method: 'nin', bootstrap: true },
      });
      syncProfileInternal('/internal/profile/ensure', {
        userId: String(user._id),
        nin: user.nin,
        phone: user.phone,
        email: user.email,
        phoneVerified: !!user.phoneVerified,
        emailVerified: !!user.emailVerified,
        hasSetPassword: false,
        createdFrom: 'nin_login',
      });

      return reply.send({
        ...tokenBundle,
        requiresPasswordChange: true,
        user: toUserResponse({ ...user, requiresPasswordChange: true }, scope),
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return failLogin({ status: 401, message: 'Invalid credentials', reason: 'INVALID_PASSWORD', user });
    }

    await clearIdentifierFailures(identifier);
    await clearUserFailureState(user);

    const tokenBundle = await issueSessionAndTokens(user, {
      ip: ipAddress,
      userAgent,
    });

    const scope = await getRolePermissions(user.roles || ['citizen']);

    emitAuditEvent({
      userId: String(user._id),
      eventType: 'AUTH_LOGIN_SUCCESS',
      action: 'auth.login',
      ipAddress,
      userAgent,
      outcome: 'success',
      metadata: { method: 'nin', bootstrap: false },
    });
    syncProfileInternal('/internal/profile/ensure', {
      userId: String(user._id),
      nin: user.nin,
      phone: user.phone,
      email: user.email,
      phoneVerified: !!user.phoneVerified,
      emailVerified: !!user.emailVerified,
      hasSetPassword: !!user.passwordSetAt && !user.requiresPasswordChange,
      createdFrom: 'nin_login',
    });

    return reply.send({
      ...tokenBundle,
      requiresPasswordChange: !!user.requiresPasswordChange,
      user: toUserResponse(user, scope),
    });
  }

  if (method === 'phone') {
    if (!phone) {
      return reply.code(400).send({ message: 'phone is required' });
    }

    const user = await collections.users().findOne({ phone });
    if (!user || !user.phone) {
      return failLogin({
        status: 403,
        message: 'Phone login not enabled. Please login with NIN first and set your phone number.',
        reason: 'PHONE_LOGIN_NOT_ENABLED',
        user: null,
      });
    }

    if (isUserLocked(user)) {
      return failLogin({
        status: 423,
        message: 'Account temporarily locked due to multiple failed attempts.',
        reason: 'ACCOUNT_LOCKED',
        user,
      });
    }

    if (!user.passwordHash) {
      return failLogin({
        status: 403,
        message: 'Please login with NIN and set a password before using phone login.',
        reason: 'PASSWORD_NOT_SET',
        user,
      });
    }
    if (user.requiresPasswordChange) {
      return failLogin({
        status: 403,
        message: 'Please login with NIN and set a password before using phone login.',
        reason: 'PASSWORD_CHANGE_REQUIRED',
        user,
      });
    }

    if (!user.phoneVerified) {
      return failLogin({
        status: 403,
        message: 'Phone login not enabled until phone number is verified.',
        reason: 'PHONE_NOT_VERIFIED',
        user,
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return failLogin({ status: 401, message: 'Invalid credentials', reason: 'INVALID_PASSWORD', user });
    }

    await clearIdentifierFailures(identifier);
    await clearUserFailureState(user);

    const tokenBundle = await issueSessionAndTokens(user, {
      ip: ipAddress,
      userAgent,
    });
    const scope = await getRolePermissions(user.roles || ['citizen']);

    emitAuditEvent({
      userId: String(user._id),
      eventType: 'AUTH_LOGIN_SUCCESS',
      action: 'auth.login',
      ipAddress,
      userAgent,
      outcome: 'success',
      metadata: { method: 'phone' },
    });
    syncProfileInternal('/internal/profile/ensure', {
      userId: String(user._id),
      nin: user.nin,
      phone: user.phone,
      email: user.email,
      phoneVerified: !!user.phoneVerified,
      emailVerified: !!user.emailVerified,
      hasSetPassword: !!user.passwordSetAt && !user.requiresPasswordChange,
      createdFrom: 'nin_login',
    });

    return reply.send({
      ...tokenBundle,
      requiresPasswordChange: !!user.requiresPasswordChange,
      user: toUserResponse(user, scope),
    });
  }

  if (method === 'email') {
    if (!email) {
      return reply.code(400).send({ message: 'email is required' });
    }

    const user = await collections.users().findOne({ email: String(email).toLowerCase() });
    if (!user || !user.email) {
      return failLogin({
        status: 403,
        message: 'Email login not enabled. Please login with NIN first and set your email.',
        reason: 'EMAIL_LOGIN_NOT_ENABLED',
        user: null,
      });
    }

    if (isUserLocked(user)) {
      return failLogin({
        status: 423,
        message: 'Account temporarily locked due to multiple failed attempts.',
        reason: 'ACCOUNT_LOCKED',
        user,
      });
    }

    if (!user.passwordHash) {
      return failLogin({
        status: 403,
        message: 'Please login with NIN and set a password before using email login.',
        reason: 'PASSWORD_NOT_SET',
        user,
      });
    }
    if (user.requiresPasswordChange) {
      return failLogin({
        status: 403,
        message: 'Please login with NIN and set a password before using email login.',
        reason: 'PASSWORD_CHANGE_REQUIRED',
        user,
      });
    }

    if (!user.emailVerified) {
      return failLogin({
        status: 403,
        message: 'Email login not enabled until email is verified.',
        reason: 'EMAIL_NOT_VERIFIED',
        user,
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return failLogin({ status: 401, message: 'Invalid credentials', reason: 'INVALID_PASSWORD', user });
    }

    await clearIdentifierFailures(identifier);
    await clearUserFailureState(user);

    const tokenBundle = await issueSessionAndTokens(user, {
      ip: ipAddress,
      userAgent,
    });

    const scope = await getRolePermissions(user.roles || ['citizen']);

    emitAuditEvent({
      userId: String(user._id),
      eventType: 'AUTH_LOGIN_SUCCESS',
      action: 'auth.login',
      ipAddress,
      userAgent,
      outcome: 'success',
      metadata: { method: 'email' },
    });
    syncProfileInternal('/internal/profile/ensure', {
      userId: String(user._id),
      nin: user.nin,
      phone: user.phone,
      email: user.email,
      phoneVerified: !!user.phoneVerified,
      emailVerified: !!user.emailVerified,
      hasSetPassword: !!user.passwordSetAt && !user.requiresPasswordChange,
      createdFrom: 'nin_login',
    });

    return reply.send({
      ...tokenBundle,
      requiresPasswordChange: !!user.requiresPasswordChange,
      user: toUserResponse(user, scope),
    });
  }

  return reply.code(400).send({ message: 'Unsupported login method' });
});

fastify.post('/password/set', { preHandler: requireAuth }, async (req, reply) => {
  const {
    currentPassword,
    newPassword,
    profile,
  } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return reply.code(400).send({ message: 'newPassword must be at least 8 characters' });
  }
  if (!currentPassword) {
    return reply.code(400).send({ message: 'currentPassword is required' });
  }

  if (req.user.passwordHash && !req.user.requiresPasswordChange) {
    return reply.code(400).send({ message: 'Password already set. Use /auth/password/change.' });
  }

  if (req.user.passwordHash) {
    const validCurrent = await bcrypt.compare(String(currentPassword), req.user.passwordHash);
    if (!validCurrent) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }
  } else {
    const ninCache = await collections.ninCache().findOne({ nin: req.user.nin, isActive: { $ne: false } });
    const expected = String(ninCache?.dob || '');
    if (!expected || String(currentPassword) !== expected) {
      return reply.code(401).send({ message: 'Invalid credentials' });
    }
  }

  const sanitizedProfile = profile && typeof profile === 'object' ? profile : {};
  const nextFirstName = sanitizedProfile.firstName ? String(sanitizedProfile.firstName).trim() : req.user.firstName || null;
  const nextLastName = sanitizedProfile.lastName ? String(sanitizedProfile.lastName).trim() : req.user.lastName || null;
  const nextOtherName = sanitizedProfile.otherName ? String(sanitizedProfile.otherName).trim() : req.user.otherName || null;
  const nextDob = sanitizedProfile.dob ? String(sanitizedProfile.dob).trim() : req.user.dob || null;
  const nextNationality = sanitizedProfile.nationality ? String(sanitizedProfile.nationality).trim() : (req.user.nationality || 'Nigeria');
  const nextState = sanitizedProfile.stateOfOrigin ? String(sanitizedProfile.stateOfOrigin).trim() : (req.user.stateOfOrigin || 'Lagos');
  const nextLga = sanitizedProfile.localGovernment ? String(sanitizedProfile.localGovernment).trim() : (req.user.localGovernment || 'Ikeja');
  const nextFullName = [nextFirstName, nextLastName].filter(Boolean).join(' ').trim() || req.user.fullName || null;

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await collections.users().updateOne(
    { _id: req.user._id },
    {
      $set: {
        passwordHash,
        passwordSetAt: new Date(),
        requiresPasswordChange: false,
          failedLoginAttempts: 0,
          lockUntil: null,
          lastFailedLoginAt: null,
          firstName: nextFirstName,
          lastName: nextLastName,
          otherName: nextOtherName,
          dob: nextDob,
          nationality: nextNationality,
          stateOfOrigin: nextState,
          localGovernment: nextLga,
          fullName: nextFullName,
          updatedAt: new Date(),
        },
      }
    );

  emitAuditEvent({
    userId: String(req.user._id),
    eventType: 'AUTH_PASSWORD_SET',
    action: 'auth.password.set',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });
  syncProfileInternal('/internal/profile/ensure', {
    userId: String(req.user._id),
    nin: req.user.nin,
    phone: req.user.phone,
    email: req.user.email,
    phoneVerified: !!req.user.phoneVerified,
    emailVerified: !!req.user.emailVerified,
    hasSetPassword: true,
    createdFrom: 'nin_login',
    firstName: nextFirstName,
    lastName: nextLastName,
    fullName: nextFullName,
    dob: nextDob,
  });

  return reply.send({ message: 'Password set successfully' });
});

fastify.post('/password/change', { preHandler: requireAuth }, async (req, reply) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 8) {
    return reply.code(400).send({ message: 'currentPassword and newPassword(min 8) are required' });
  }

  if (!req.user.passwordHash) {
    return reply.code(400).send({ message: 'Password is not set yet. Use /auth/password/set.' });
  }

  const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!ok) {
    return reply.code(401).send({ message: 'Invalid credentials' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await collections.users().updateOne(
    { _id: req.user._id },
    {
      $set: {
        passwordHash,
        passwordSetAt: new Date(),
        requiresPasswordChange: false,
        updatedAt: new Date(),
      },
    }
  );

  emitAuditEvent({
    userId: String(req.user._id),
    eventType: 'AUTH_PASSWORD_CHANGE',
    action: 'auth.password.change',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });
  syncProfileInternal('/internal/profile/ensure', {
    userId: String(req.user._id),
    nin: req.user.nin,
    phone: req.user.phone,
    email: req.user.email,
    phoneVerified: !!req.user.phoneVerified,
    emailVerified: !!req.user.emailVerified,
    hasSetPassword: true,
    createdFrom: 'nin_login',
  });

  return reply.send({ message: 'Password changed successfully' });
});

fastify.post('/password/forgot', async (req, reply) => {
  const { channel, destination } = req.body || {};
  if (!channel || !destination || !['phone', 'email'].includes(channel)) {
    return reply.code(400).send({ message: 'channel(phone|email) and destination are required' });
  }

  let user;
  if (channel === 'phone') {
    user = await collections.users().findOne({ phone: destination, phoneVerified: true });
  } else {
    user = await collections.users().findOne({ email: String(destination).toLowerCase(), emailVerified: true });
  }

  if (!user) {
    if (channel === 'phone') {
      return reply.code(403).send({ message: 'Phone recovery not available for this account.' });
    }
    return reply.code(403).send({ message: 'Email recovery not available for this account.' });
  }

  const code = generateOtpCode();
  const codeHash = hashOtp(code);
  const now = new Date();

  await collections.otp().insertOne({
    userId: user._id,
    channel,
    destination,
    codeHash,
    status: 'pending',
    expiresAt: new Date(now.getTime() + otpTtlMs),
    attempts: 0,
    purpose: 'password_reset',
    createdAt: now,
  });

  emitAuditEvent({
    userId: String(user._id),
    eventType: 'AUTH_PASSWORD_RESET_REQUEST',
    action: 'auth.password.forgot',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { channel, destination },
  });

  fastify.log.info({ channel, destination }, 'OTP generated for password/forgot');

  return reply.send({ message: 'OTP sent', channel, destination });
});

fastify.post('/password/reset', async (req, reply) => {
  const { channel, destination, code, newPassword } = req.body || {};
  if (!channel || !destination || !code || !newPassword || String(newPassword).length < 8) {
    return reply
      .code(400)
      .send({ message: 'channel, destination, code and newPassword(min 8) are required' });
  }

  const otpDoc = await collections.otp().findOne(
    {
      channel,
      destination,
      status: 'pending',
      purpose: 'password_reset',
      expiresAt: { $gt: new Date() },
    },
    { sort: { createdAt: -1 } }
  );

  if (!otpDoc) {
    return reply.code(401).send({ message: 'Invalid or expired OTP' });
  }

  const providedHash = hashOtp(code);
  if (providedHash !== otpDoc.codeHash) {
    await collections.otp().updateOne({ _id: otpDoc._id }, { $inc: { attempts: 1 } });
    const otpState = await trackOtpFailure(getOtpAttemptIdentifier(channel, destination), otpDoc);
    if (otpState.blocked) {
      return reply.code(429).send({ message: `Too many OTP attempts. Retry in ${otpState.retryAfterSec}s.` });
    }
    return reply.code(401).send({ message: 'Invalid or expired OTP' });
  }

  await clearOtpFailures(getOtpAttemptIdentifier(channel, destination));

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await collections.users().updateOne(
    { _id: otpDoc.userId },
    {
      $set: {
        passwordHash,
        passwordSetAt: new Date(),
        requiresPasswordChange: false,
        failedLoginAttempts: 0,
        lockUntil: null,
        lastFailedLoginAt: null,
        updatedAt: new Date(),
      },
    }
  );

  await collections.otp().updateOne(
    { _id: otpDoc._id },
    { $set: { status: 'verified', verifiedAt: new Date() } }
  );

  emitAuditEvent({
    userId: String(otpDoc.userId),
    eventType: 'AUTH_PASSWORD_RESET_COMPLETE',
    action: 'auth.password.reset',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { channel, destination },
  });
  syncProfileInternal('/internal/profile/ensure', {
    userId: String(otpDoc.userId),
    nin: null,
    phone: channel === 'phone' ? destination : undefined,
    email: channel === 'email' ? destination : undefined,
    phoneVerified: channel === 'phone' ? true : undefined,
    emailVerified: channel === 'email' ? true : undefined,
    hasSetPassword: true,
    createdFrom: 'nin_login',
  });

  return reply.send({ message: 'Password reset successful' });
});

fastify.post('/token/refresh', async (req, reply) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return reply.code(400).send({ message: 'refreshToken is required' });
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, jwtSecret);
  } catch (err) {
    return reply.code(401).send({ message: 'Invalid refresh token' });
  }

  if (payload.type !== 'refresh' || !payload.jti) {
    return reply.code(401).send({ message: 'Invalid refresh token' });
  }

  const redisEntry = await redisClient.get(`refresh:${payload.jti}`);
  if (!redisEntry) {
    return reply.code(401).send({ message: 'Refresh token revoked or expired' });
  }

  const user = await collections.users().findOne({ _id: new ObjectId(payload.sub) });
  if (!user) {
    return reply.code(401).send({ message: 'Invalid refresh token' });
  }

  await redisClient.del(`refresh:${payload.jti}`);
  await collections.sessions().updateOne(
    { jti: payload.jti },
    { $set: { revokedAt: new Date() } }
  );

  const tokenBundle = await issueSessionAndTokens(user, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return reply.send(tokenBundle);
});

fastify.post('/logout', async (req, reply) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return reply.code(400).send({ message: 'refreshToken is required' });
  }

  try {
    const payload = jwt.verify(refreshToken, jwtSecret);
    if (payload.type === 'refresh' && payload.jti) {
      await redisClient.del(`refresh:${payload.jti}`);
      await collections.sessions().updateOne(
        { jti: payload.jti },
        { $set: { revokedAt: new Date() } }
      );
      emitAuditEvent({
        userId: String(payload.sub),
        eventType: 'AUTH_LOGOUT',
        action: 'auth.logout',
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'] || null,
        outcome: 'success',
      });
    }
  } catch (err) {
    return reply.code(401).send({ message: 'Invalid refresh token' });
  }

  return reply.send({ message: 'Logged out successfully' });
});

fastify.get('/me', { preHandler: requireAuth }, async (req, reply) => {
  const authorization = req.headers.authorization || '';
  const rbacCacheVersion = await getRbacCacheVersion();
  const meCacheKey = buildAuthMeCacheKey(req.user, authorization, rbacCacheVersion);
  if (authMeCacheTtlSec > 0 && meCacheKey) {
    const cached = await getCachedJson(meCacheKey);
    if (cached) {
      reply.header('x-auth-me-cache', 'hit');
      return reply.send(cached);
    }
  }

  const userId = String(req.user._id);
  const [rbacScope, defaultContextTheme] = await Promise.all([
    fetchRbacScopeSummaryCached(userId, authorization, rbacCacheVersion),
    fetchEffectiveThemeCached('platform', null),
  ]);
  const mergedRoleNames = [
    ...new Set([
      ...((Array.isArray(req.user.roles) ? req.user.roles : ['citizen']).map((role) => String(role).trim()).filter(Boolean)),
      ...(rbacScope.appRoles || []).map((role) => String(role).trim()).filter(Boolean),
    ]),
  ];
  if (mergedRoleNames.length === 0) {
    mergedRoleNames.push('citizen');
  }

  const [roleScope, contextBundle] = await Promise.all([
    getRolePermissions(mergedRoleNames),
    buildAvailableContextsCached(
      req.user._id,
      authorization,
      rbacScope,
      rbacCacheVersion,
    ),
  ]);
  const appPermissions = [...new Set([
    ...roleScope.map((permission) => String(permission)),
    ...((Array.isArray(rbacScope.appPermissions) ? rbacScope.appPermissions : []).map((permission) => String(permission))),
  ])];
  const { availableContexts, defaultContext } = contextBundle;

  const payload = {
    user: toUserResponse({ ...req.user, roles: mergedRoleNames }, appPermissions),
    permissions: appPermissions,
    appPermissions,
    orgPermissions: Array.isArray(rbacScope.orgScopePermissions) ? rbacScope.orgScopePermissions : [],
    rbacScope: {
      version: String(rbacScope.version || rbacCacheVersion || '0'),
      appScopePermissions: appPermissions,
      orgScopePermissions: Array.isArray(rbacScope.orgScopePermissions) ? rbacScope.orgScopePermissions : [],
      appRoles: Array.isArray(rbacScope.appRoles) ? rbacScope.appRoles : [],
      orgRolesByOrganization: rbacScope.orgRolesByOrganization || {},
    },
    availableContexts,
    defaultContext,
    defaultContextTheme,
  };
  if (authMeCacheTtlSec > 0 && meCacheKey) {
    await setCachedJson(meCacheKey, payload, authMeCacheTtlSec);
  }
  reply.header('x-auth-me-cache', 'miss');
  return reply.send(payload);
});

fastify.post('/context/switch', { preHandler: requireAuth }, async (req, reply) => {
  const requested = req.body || {};
  const authorization = req.headers.authorization || '';
  const userId = String(req.user._id);
  const rbacCacheVersion = await getRbacCacheVersion();
  const rbacScope = await fetchRbacScopeSummaryCached(userId, authorization, rbacCacheVersion);
  const { availableContexts } = await buildAvailableContextsCached(req.user._id, authorization, rbacScope, rbacCacheVersion);
  const requestedId = requested.id || requested.contextId || null;
  const requestedType = requested.type ? String(requested.type) : null;
  if (!requestedId) {
    return reply.code(400).send({ message: 'Context id is required' });
  }
  const match = availableContexts.find((ctx) => (
    String(ctx.id) === String(requestedId)
    && (!requestedType || String(ctx.type) === requestedType)
  ));
  if (!match) {
    return reply.code(403).send({ message: 'Requested context is not available for this user' });
  }

  const effectiveTheme = await fetchEffectiveThemeCached(match.themeScopeType, match.themeScopeId);
  return reply.send({
    activeContext: match,
    effectiveTheme,
  });
});

fastify.get('/users/search', { preHandler: requireAuth }, async (req, reply) => {
  const q = String(req.query?.q ?? '').trim();
  const page = Math.max(1, Number(req.query?.page ?? 1));
  const limit = Math.min(50, Math.max(1, Number(req.query?.limit ?? 10)));
  const skip = (page - 1) * limit;

  if (!q || q.length < 1) {
    return reply.send({ items: [], page, limit, total: 0 });
  }

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');

  const baseFilter = {
    $or: [
      { nin: { $regex: regex } },
      { email: { $regex: regex } },
      { phone: { $regex: regex } },
      { firstName: { $regex: regex } },
      { lastName: { $regex: regex } },
      { otherName: { $regex: regex } },
      { fullName: { $regex: regex } },
      { bvn: { $regex: regex } },
    ],
  };

  const directUsers = await collections.users().find(baseFilter).limit(limit).toArray();

  const ninFromCache = await collections
    .ninCache()
    .find({
      $or: [
        { nin: { $regex: regex } },
        { bvn: { $regex: regex } },
        { email: { $regex: regex } },
        { phone: { $regex: regex } },
        { firstName: { $regex: regex } },
        { lastName: { $regex: regex } },
        { otherName: { $regex: regex } },
      ],
    })
    .project({ nin: 1 })
    .limit(limit)
    .toArray();

  const ninSet = new Set(ninFromCache.map((entry) => String(entry.nin || '')).filter(Boolean));
  const usersByNin = ninSet.size > 0
    ? await collections.users().find({ nin: { $in: Array.from(ninSet) } }).limit(limit).toArray()
    : [];

  const merged = new Map();
  for (const row of [...directUsers, ...usersByNin]) {
    merged.set(String(row._id), row);
  }

  const items = Array.from(merged.values())
    .slice(skip, skip + limit)
    .map((user) => ({
      id: String(user._id),
      userId: String(user._id),
      displayName: user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || `User ${user.nin || String(user._id)}`,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      otherName: user.otherName || null,
      nin: user.nin || null,
      bvn: user.bvn || null,
      email: user.email || null,
      phone: user.phone || null,
      roles: Array.isArray(user.roles) ? user.roles : [],
      status: user.status || 'active',
    }));

  return reply.send({
    items,
    page,
    limit,
    total: items.length,
    q,
  });
});

fastify.post('/contact/phone', { preHandler: requireAuth }, async (req, reply) => {
  const { phone } = req.body || {};
  if (!phone) {
    return reply.code(400).send({ message: 'phone is required' });
  }

  await collections.users().updateOne(
    { _id: req.user._id },
    { $set: { phone, phoneVerified: false, updatedAt: new Date() } }
  );

  const code = generateOtpCode();
  await collections.otp().insertOne({
    userId: req.user._id,
    channel: 'phone',
    destination: phone,
    codeHash: hashOtp(code),
    status: 'pending',
    expiresAt: new Date(Date.now() + otpTtlMs),
    attempts: 0,
    purpose: 'contact_verify',
    createdAt: new Date(),
  });

  emitAuditEvent({
    userId: String(req.user._id),
    eventType: 'AUTH_PHONE_ADDED',
    action: 'auth.contact.phone.add',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { phone },
  });

  fastify.log.info({ phone }, 'OTP generated for phone verification');

  return reply.send({ message: 'OTP sent to phone' });
});

fastify.post('/contact/phone/verify', { preHandler: requireAuth }, async (req, reply) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) {
    return reply.code(400).send({ message: 'phone and code are required' });
  }

  const otpDoc = await collections.otp().findOne(
    {
      userId: req.user._id,
      channel: 'phone',
      destination: phone,
      purpose: 'contact_verify',
      status: 'pending',
      expiresAt: { $gt: new Date() },
    },
    { sort: { createdAt: -1 } }
  );

  if (!otpDoc || otpDoc.codeHash !== hashOtp(code)) {
    if (otpDoc?._id) {
      await collections.otp().updateOne({ _id: otpDoc._id }, { $inc: { attempts: 1 } });
    }
    const otpState = await trackOtpFailure(getOtpAttemptIdentifier('phone', phone), otpDoc);
    if (otpState.blocked) {
      return reply.code(429).send({ message: `Too many OTP attempts. Retry in ${otpState.retryAfterSec}s.` });
    }
    return reply.code(401).send({ message: 'Invalid or expired OTP' });
  }

  await clearOtpFailures(getOtpAttemptIdentifier('phone', phone));
  await collections.otp().updateOne({ _id: otpDoc._id }, { $set: { status: 'verified', verifiedAt: new Date() } });
  await collections.users().updateOne({ _id: req.user._id }, { $set: { phoneVerified: true, updatedAt: new Date() } });

  emitAuditEvent({
    userId: String(req.user._id),
    eventType: 'AUTH_PHONE_VERIFIED',
    action: 'auth.contact.phone.verify',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { phone },
  });
  syncProfileInternal('/internal/profile/sync-contact', {
    userId: String(req.user._id),
    phone,
    phoneVerified: true,
  });

  return reply.send({ message: 'Phone verified successfully' });
});

fastify.post('/contact/email', { preHandler: requireAuth }, async (req, reply) => {
  const { email } = req.body || {};
  if (!email) {
    return reply.code(400).send({ message: 'email is required' });
  }

  const normalizedEmail = String(email).toLowerCase();

  await collections.users().updateOne(
    { _id: req.user._id },
    { $set: { email: normalizedEmail, emailVerified: false, updatedAt: new Date() } }
  );

  const code = generateOtpCode();
  await collections.otp().insertOne({
    userId: req.user._id,
    channel: 'email',
    destination: normalizedEmail,
    codeHash: hashOtp(code),
    status: 'pending',
    expiresAt: new Date(Date.now() + otpTtlMs),
    attempts: 0,
    purpose: 'contact_verify',
    createdAt: new Date(),
  });

  emitAuditEvent({
    userId: String(req.user._id),
    eventType: 'AUTH_EMAIL_ADDED',
    action: 'auth.contact.email.add',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { email: normalizedEmail },
  });

  fastify.log.info({ email: normalizedEmail }, 'OTP generated for email verification');

  return reply.send({ message: 'OTP sent to email' });
});

fastify.post('/contact/email/verify', { preHandler: requireAuth }, async (req, reply) => {
  const { email, code } = req.body || {};
  if (!email || !code) {
    return reply.code(400).send({ message: 'email and code are required' });
  }

  const normalizedEmail = String(email).toLowerCase();

  const otpDoc = await collections.otp().findOne(
    {
      userId: req.user._id,
      channel: 'email',
      destination: normalizedEmail,
      purpose: 'contact_verify',
      status: 'pending',
      expiresAt: { $gt: new Date() },
    },
    { sort: { createdAt: -1 } }
  );

  if (!otpDoc || otpDoc.codeHash !== hashOtp(code)) {
    if (otpDoc?._id) {
      await collections.otp().updateOne({ _id: otpDoc._id }, { $inc: { attempts: 1 } });
    }
    const otpState = await trackOtpFailure(getOtpAttemptIdentifier('email', normalizedEmail), otpDoc);
    if (otpState.blocked) {
      return reply.code(429).send({ message: `Too many OTP attempts. Retry in ${otpState.retryAfterSec}s.` });
    }
    return reply.code(401).send({ message: 'Invalid or expired OTP' });
  }

  await clearOtpFailures(getOtpAttemptIdentifier('email', normalizedEmail));
  await collections.otp().updateOne({ _id: otpDoc._id }, { $set: { status: 'verified', verifiedAt: new Date() } });
  await collections.users().updateOne({ _id: req.user._id }, { $set: { emailVerified: true, updatedAt: new Date() } });

  emitAuditEvent({
    userId: String(req.user._id),
    eventType: 'AUTH_EMAIL_VERIFIED',
    action: 'auth.contact.email.verify',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { email: normalizedEmail },
  });
  syncProfileInternal('/internal/profile/sync-contact', {
    userId: String(req.user._id),
    email: normalizedEmail,
    emailVerified: true,
  });

  return reply.send({ message: 'Email verified successfully' });
});

fastify.get('/nin/:nin', async (req, reply) => {
  const { nin } = req.params;
  if (!/^\d{11}$/.test(nin)) {
    return reply.code(400).send({ message: 'nin must be 11 digits' });
  }

  const record = await collections.ninCache().findOne({ nin });
  if (!record) {
    emitAuditEvent({
      userId: null,
      eventType: 'NIN_LOOKUP_FAILURE',
      action: 'nin.lookup',
      resource: { type: 'nin_cache', id: nin },
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      outcome: 'failure',
      failureReason: 'NIN_NOT_FOUND_IN_CACHE',
      metadata: { nin },
    });
    return reply.code(404).send({ message: 'NIN not found in cache' });
  }

  emitAuditEvent({
    userId: null,
    eventType: 'NIN_LOOKUP_SUCCESS',
    action: 'nin.lookup',
    resource: { type: 'nin_cache', id: nin },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { nin },
  });

  return reply.send(record);
});

fastify.post('/nin/refresh/:nin', async (req, reply) => {
  const { nin } = req.params;
  if (!/^\d{11}$/.test(nin)) {
    return reply.code(400).send({ message: 'nin must be 11 digits' });
  }

  await collections.ninCache().updateOne(
    { nin },
    {
      $set: {
        refreshRequested: true,
        lastRefreshedAt: new Date(),
      },
    }
  );

  emitAuditEvent({
    userId: null,
    eventType: 'NIN_REFRESH_REQUESTED',
    action: 'nin.refresh.request',
    resource: { type: 'nin_cache', id: nin },
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { nin },
  });

  return reply.send({ message: 'Fetching from NIN is currently not available.' });
});

fastify.get('/rbac/roles', { preHandler: requireAuth }, async (_req, reply) => {
  const roles = await collections.roles().find({}).toArray();
  return reply.send({ roles });
});

fastify.post('/rbac/roles', { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
  const { name, permissions } = req.body || {};
  if (!name) {
    return reply.code(400).send({ message: 'name is required' });
  }

  await collections.roles().updateOne(
    { name },
    { $set: { name, permissions: Array.isArray(permissions) ? permissions : [] } },
    { upsert: true }
  );

  return reply.send({ message: 'Role upserted successfully' });
});

fastify.post('/rbac/assign-role', { preHandler: [requireAuth, requireAdmin] }, async (req, reply) => {
  const { userId, roleName } = req.body || {};
  if (!userId || !roleName) {
    return reply.code(400).send({ message: 'userId and roleName are required' });
  }
  const targetUserId = toObjectIdOrNull(userId);
  if (!targetUserId) {
    return reply.code(400).send({ message: 'Invalid userId' });
  }

  const role = await collections.roles().findOne({ name: roleName });
  if (!role) {
    return reply.code(404).send({ message: 'Role not found' });
  }

  await collections.users().updateOne(
    { _id: targetUserId },
    { $addToSet: { roles: roleName }, $set: { updatedAt: new Date() } }
  );

  return reply.send({ message: 'Role assigned successfully' });
});

fastify.get('/rbac/user/:userId/scope', { preHandler: requireAuth }, async (req, reply) => {
  const { userId } = req.params;
  const targetUserId = toObjectIdOrNull(userId);
  if (!targetUserId) {
    return reply.code(400).send({ message: 'Invalid userId' });
  }

  if (String(req.user._id) !== userId && !(req.user.roles || []).includes('admin')) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const user = await collections.users().findOne({ _id: targetUserId });
  if (!user) {
    return reply.code(404).send({ message: 'User not found' });
  }

  const scope = await getRolePermissions(user.roles || ['citizen']);

  return reply.send({
    userId,
    roles: user.roles || [],
    scope,
  });
});

fastify.post('/internal/users/roles/remove', { preHandler: requireInternal }, async (req, reply) => {
  const roleName = String(req.body?.roleName || '').trim();
  if (!roleName) {
    return reply.code(400).send({ message: 'roleName is required' });
  }

  const result = await collections.users().updateMany(
    { roles: roleName },
    { $pull: { roles: roleName }, $set: { updatedAt: new Date() } },
  );

  return reply.send({
    message: 'Role removed from users',
    roleName,
    matchedUsers: result.matchedCount || 0,
    modifiedUsers: result.modifiedCount || 0,
  });
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
    if (outboxTimer) {
      clearInterval(outboxTimer);
    }
    if (redisClient) {
      await redisClient.quit();
    }
    if (mongoClient) {
      await mongoClient.close();
    }
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

start();

