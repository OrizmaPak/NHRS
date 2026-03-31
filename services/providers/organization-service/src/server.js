const fastify = require('fastify')({ logger: true });
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { buildEventEnvelope, createOutboxRepository, deliverOutboxBatch } = require('../../../../libs/shared/src/outbox');
const { createContextVerificationHook } = require('../../../../libs/shared/src/nhrs-context');
const { enforceProductionSecrets } = require('../../../../libs/shared/src/env');
const { setStandardErrorHandler } = require('../../../../libs/shared/src/errors');
const nigeriaGeoSeed = require('./data/nigeria-geo-seed.json');
const globalServicesSeed = require('./data/global-services-seed.json');

const serviceName = 'organization-service';
const port = Number(process.env.PORT) || 8093;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_organization_db';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const rbacApiBaseUrl = process.env.RBAC_API_BASE_URL || 'http://rbac-service:8090';
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const notificationApiBaseUrl = process.env.NOTIFICATION_API_BASE_URL || 'http://notification-service:8101';
const membershipApiBaseUrl = process.env.MEMBERSHIP_API_BASE_URL || 'http://membership-service:8103';
const fileDocumentApiBaseUrl = process.env.FILE_DOCUMENT_API_BASE_URL || 'http://file-document-service:8102';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 20;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;
const maxUploadBytes = Number(process.env.ORG_UPLOAD_MAX_BYTES) || 10 * 1024 * 1024;

let dbReady = false;
let mongoClient;
let db;
let fetchClient = (...args) => fetch(...args);
let outboxRepo = null;
let outboxTimer = null;

const collections = {
  organizations: () => db.collection('organizations'),
  institutions: () => db.collection('institutions'),
  ownerHistory: () => db.collection('organization_owner_history'),
  branches: () => db.collection('branches'),
  globalServices: () => db.collection('global_services'),
  geoRegions: () => db.collection('geo_regions'),
  geoStates: () => db.collection('geo_states'),
  geoStateRegions: () => db.collection('geo_state_regions'),
  geoLgas: () => db.collection('geo_lgas'),
};

function now() {
  return new Date();
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
      token,
      roles: Array.isArray(payload.roles) ? payload.roles.map((item) => String(item).trim().toLowerCase()) : [],
    };
  } catch (_err) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
}

async function requireInternalToken(req, reply) {
  const incoming = req.headers['x-internal-token'];
  if (!incoming || incoming !== internalServiceToken) {
    return reply.code(401).send({ message: 'Unauthorized internal call' });
  }
}

async function callJson(url, options = {}) {
  const res = await fetchClient(url, options);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_err) {
      body = { message: text };
    }
  }
  return { ok: res.ok, status: res.status, body };
}

async function resolveUserIdentityByNin(authorization, nin) {
  const normalizedNin = String(nin || '').trim();
  if (!normalizedNin) return null;
  try {
    const response = await callJson(
      `${process.env.AUTH_API_BASE_URL || 'http://auth-api:8081'}/users/search?q=${encodeURIComponent(normalizedNin)}&limit=10`,
      {
        method: 'GET',
        headers: {
          authorization,
          'content-type': 'application/json',
        },
      },
    );
    if (!response.ok || !Array.isArray(response.body?.items)) return null;
    const exact = response.body.items.find((item) => String(item?.nin || '').trim() === normalizedNin);
    if (!exact?.userId && !exact?.id) return null;
    return {
      userId: String(exact.userId || exact.id),
      nin: normalizedNin,
    };
  } catch (_err) {
    return null;
  }
}

function emitAuditEvent(event, req = null) {
  if (!outboxRepo) return;
  outboxRepo.enqueueOutboxEvent(buildEventEnvelope({
    eventType: event.eventType || 'AUDIT_EVENT',
    sourceService: serviceName,
    aggregateType: event.resource?.type || 'organization',
    aggregateId: event.resource?.id || event.organizationId || null,
    payload: event,
    trace: {
      requestId: req?.headers?.['x-request-id'] || null,
      userId: req?.auth?.userId || event.userId || null,
      orgId: event.organizationId || req?.headers?.['x-org-id'] || null,
      branchId: req?.headers?.['x-branch-id'] || null,
    },
    destination: 'audit',
  })).catch((err) => {
    fastify.log.warn({ err, eventType: event?.eventType }, 'Organization outbox enqueue failed');
  });
}

function collectNotificationTargets(organization) {
  const targets = [];
  const ownerUserId = organization?.ownerUserId ? String(organization.ownerUserId).trim() : '';
  const creatorUserId = organization?.createdByUserId ? String(organization.createdByUserId).trim() : '';
  if (ownerUserId) targets.push({ userId: ownerUserId });
  if (creatorUserId && creatorUserId !== ownerUserId) targets.push({ userId: creatorUserId });
  return targets;
}

function emitNotificationEvent(event, req = null) {
  if (!outboxRepo) return;
  outboxRepo.enqueueOutboxEvent(buildEventEnvelope({
    eventType: event.eventType || 'ORG_NOTIFICATION',
    sourceService: serviceName,
    aggregateType: event.resource?.type || 'organization',
    aggregateId: event.resource?.id || event.organizationId || null,
    payload: event,
    trace: {
      requestId: req?.headers?.['x-request-id'] || null,
      userId: req?.auth?.userId || event.userId || null,
      orgId: event.organizationId || req?.headers?.['x-org-id'] || null,
      branchId: req?.headers?.['x-branch-id'] || null,
    },
    destination: 'notification',
  })).catch((err) => {
    fastify.log.warn({ err, eventType: event?.eventType }, 'Organization notification enqueue failed');
  });
}

async function checkPermission(req, permissionKey, organizationId = null) {
  return callJson(`${rbacApiBaseUrl}/rbac/check`, {
    method: 'POST',
    headers: {
      authorization: req.headers.authorization,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      permissionKey,
      organizationId,
      activeContextId: req.headers['x-active-context-id'] || null,
      activeContextName: req.headers['x-active-context-name'] || null,
      activeContextType: req.headers['x-active-context-type'] || null,
    }),
  });
}

async function enforceAnyPermission(req, reply, permissionKeys, organizationId = null) {
  const requiredPermissions = Array.from(new Set(
    (Array.isArray(permissionKeys) ? permissionKeys : [permissionKeys])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
  ));
  const primaryPermissionKey = requiredPermissions[0] || null;

  let checked = { ok: false, status: 403, body: null };
  for (const permissionKey of requiredPermissions) {
    checked = await checkPermission(req, permissionKey, organizationId);
    if (checked.ok && checked.body?.allowed) {
      return false;
    }
    if (checked.status === 401) {
      break;
    }
  }

  reply.code(checked.status === 401 ? 401 : 403).send({ message: 'Forbidden' });
  emitAuditEvent({
    userId: req.auth?.userId || null,
    organizationId,
    eventType: 'RBAC_ACCESS_DENIED',
    action: 'organization.permission.check',
    permissionKey: primaryPermissionKey,
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'failure',
    failureReason: checked.body?.reason || 'PERMISSION_DENIED',
    metadata: {
      path: req.routeOptions?.url || req.url,
      method: req.method,
      requiredPermissions,
    },
  });
  return true;
}

async function enforcePermission(req, reply, permissionKey, organizationId = null) {
  return enforceAnyPermission(req, reply, [permissionKey], organizationId);
}

function getPermissionOrgId(req) {
  const orgIdHeader = req?.headers?.['x-org-id'];
  return orgIdHeader ? String(orgIdHeader).trim() || null : null;
}

const INSTITUTION_TYPES = ['hospital', 'laboratory', 'pharmacy', 'clinic', 'government', 'emergency', 'catalog'];
const BRANCH_CAPABILITIES = ['hospital', 'clinic', 'laboratory', 'pharmacy'];
const OWNER_TYPES = ['government', 'private', 'non_profit', 'faith_based', 'ngo', 'public_private_partnership', 'other'];
const SUPER_ROLE_ALIASES = new Set(['super', 'superadmin', 'super_admin', 'super admin', 'platform_admin', 'app_admin']);
const ORG_APPROVAL_STATUSES = ['pending', 'approved', 'declined', 'revoked'];
const ORG_LIFECYCLE_STATUSES = ['active', 'suspended', 'delete_pending', 'deleted'];
const INSTITUTION_STATUSES = ['active', 'inactive', 'suspended', 'deleted'];
const BRANCH_STATUSES = ['active', 'closed', 'suspended', 'deleted'];
const GEO_STATUSES = ['active', 'inactive'];
const LOGO_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const CAC_CONTENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const INSTITUTION_DOCUMENT_CONTENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

const GEO_REGION_SEEDS = Array.isArray(nigeriaGeoSeed?.regions) ? nigeriaGeoSeed.regions : [];
const GEO_STATE_SEEDS = Array.isArray(nigeriaGeoSeed?.states) ? nigeriaGeoSeed.states : [];
const GEO_STATE_REGION_SEEDS = Array.isArray(nigeriaGeoSeed?.stateRegions) ? nigeriaGeoSeed.stateRegions : [];
const GEO_LGA_SEEDS = Array.isArray(nigeriaGeoSeed?.lgas) ? nigeriaGeoSeed.lgas : [];
const GLOBAL_SERVICE_SEEDS = Array.isArray(globalServicesSeed) ? globalServicesSeed : [];

function normalizeRoleName(value) {
  return String(value || '').trim().toLowerCase();
}

function hasSuperRole(roles = []) {
  return (Array.isArray(roles) ? roles : []).some((role) => SUPER_ROLE_ALIASES.has(normalizeRoleName(role)));
}

function canBypassOrgVisibility(req) {
  return hasSuperRole(req?.auth?.roles);
}

async function hasAppPermission(req, permissionKey, organizationId = null) {
  try {
    const checked = await callJson(`${rbacApiBaseUrl}/rbac/check`, {
      method: 'POST',
      headers: {
        authorization: req.headers.authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        permissionKey,
        organizationId,
        activeContextId: req.headers['x-active-context-id'] || null,
        activeContextName: req.headers['x-active-context-name'] || null,
        activeContextType: req.headers['x-active-context-type'] || null,
      }),
    });
    return Boolean(checked.ok && checked.body?.allowed);
  } catch (_err) {
    return false;
  }
}

async function canListAllOrganizations(req) {
  if (canBypassOrgVisibility(req)) return true;
  return hasAppPermission(req, 'org.list_all', null);
}

function normalizeInstitutionType(value, fallback = null) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return INSTITUTION_TYPES.includes(normalized) ? normalized : fallback;
}

function normalizeInstitutionCode(value, fallbackName) {
  const explicit = String(value || '').trim().toUpperCase();
  if (explicit) return explicit;
  const compact = String(fallbackName || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
  return compact.slice(0, 12) || `INST${Math.floor(Math.random() * 9000 + 1000)}`;
}

function normalizeOwnerType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return OWNER_TYPES.includes(normalized) ? normalized : null;
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeDocumentList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry && typeof entry === 'object' ? entry : null))
    .filter(Boolean)
    .map((entry) => ({
      documentId: String(entry.documentId || crypto.randomUUID()),
      title: entry.title ? String(entry.title).trim() : null,
      type: entry.type ? String(entry.type).trim().toLowerCase() : 'other',
      url: entry.url ? String(entry.url).trim() : null,
      uploadedAt: normalizeIsoDate(entry.uploadedAt) || now().toISOString(),
      notes: entry.notes ? String(entry.notes).trim() : null,
    }))
    .filter((entry) => entry.url);
}

function isSafeSvg(raw) {
  const text = raw.toString('utf8').toLowerCase();
  if (!text.includes('<svg')) return false;
  const blocked = ['<script', 'onload=', 'onerror=', 'javascript:'];
  return !blocked.some((token) => text.includes(token));
}

function normalizeApprovalStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ORG_APPROVAL_STATUSES.includes(normalized) ? normalized : null;
}

function normalizeLifecycleStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ORG_LIFECYCLE_STATUSES.includes(normalized) ? normalized : null;
}

function normalizeGeoName(value) {
  return String(value || '').trim();
}

function normalizeGeoCode(value, fallback = '') {
  const source = String(value || fallback || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return source.slice(0, 32);
}

function slugGeoName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toDisplayWords(value) {
  return String(value || '')
    .trim()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

function normalizeGlobalServiceName(value) {
  return toDisplayWords(value);
}

function normalizeGlobalServiceLookup(value) {
  return normalizeGlobalServiceName(value).toLowerCase();
}

function normalizeGlobalServiceDescription(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function decorateGlobalService(service) {
  if (!service) return null;
  return {
    serviceId: String(service.serviceId || ''),
    name: String(service.name || ''),
    description: service.description ? String(service.description) : '',
    createdAt: service.createdAt || null,
    updatedAt: service.updatedAt || null,
  };
}

function buildGeoStateRegionCode(stateCode, stateRegionName) {
  return normalizeGeoCode(`${stateCode}_${slugGeoName(stateRegionName)}`);
}

function buildGeoLgaSeeds() {
  return GEO_LGA_SEEDS.map((entry) => ({
    name: normalizeGeoName(entry.name),
    stateCode: normalizeGeoCode(entry.stateCode),
    code: normalizeGeoCode(entry.code, `${normalizeGeoCode(entry.stateCode)}_${slugGeoName(entry.name)}`),
    stateRegionName: entry.stateRegionName ? normalizeGeoName(entry.stateRegionName) : null,
  }));
}

async function seedGlobalServices() {
  const ops = GLOBAL_SERVICE_SEEDS
    .map((entry) => {
      const name = normalizeGlobalServiceName(entry?.name);
      if (!name) return null;
      return {
        updateOne: {
          filter: { normalizedName: normalizeGlobalServiceLookup(name) },
          update: {
            $setOnInsert: {
              serviceId: crypto.randomUUID(),
              createdAt: now(),
            },
            $set: {
              name,
              description: normalizeGlobalServiceDescription(entry?.description),
              normalizedName: normalizeGlobalServiceLookup(name),
              updatedAt: now(),
            },
          },
          upsert: true,
        },
      };
    })
    .filter(Boolean);

  if (ops.length === 0) return;
  await collections.globalServices().bulkWrite(ops, { ordered: false });
}

function isOrganizationApproved(organization) {
  if (!organization) return false;
  const approval = String(organization.approvalStatus || '').trim().toLowerCase();
  const lifecycle = String(organization.lifecycleStatus || 'active').trim().toLowerCase();
  return approval === 'approved' && lifecycle === 'active';
}

function canMutateOrgHierarchy(organization) {
  if (!organization) {
    return { ok: false, reason: 'Organization not found', code: 404 };
  }
  const lifecycle = normalizeLifecycleStatus(organization.lifecycleStatus) || 'active';
  if (lifecycle === 'deleted') {
    return { ok: false, reason: 'Organization has been deleted', code: 409 };
  }
  if (lifecycle === 'delete_pending') {
    return { ok: false, reason: 'Organization deletion is pending approval', code: 409 };
  }
  if (!isOrganizationApproved(organization)) {
    return { ok: false, reason: 'Organization is not approved yet', code: 409 };
  }
  if (lifecycle === 'suspended') {
    return { ok: false, reason: 'Organization is suspended', code: 409 };
  }
  return { ok: true };
}

function decorateOrganization(organization) {
  if (!organization || typeof organization !== 'object') return organization;
  const lifecycleStatus = normalizeLifecycleStatus(organization.lifecycleStatus)
    || (String(organization.status || '').toLowerCase() === 'deleted'
      ? 'deleted'
      : String(organization.status || '').toLowerCase() === 'suspended'
        ? 'suspended'
        : 'active');
  const approvalStatus = normalizeApprovalStatus(organization.approvalStatus)
    || (String(organization.status || '').toLowerCase() === 'pending_approval' ? 'pending' : 'approved');
  return {
    ...organization,
    lifecycleStatus,
    approvalStatus,
    status: organization.status || (approvalStatus === 'pending' ? 'pending_approval' : lifecycleStatus),
  };
}

function activeOrgVisibilityFilter(includeDeleted = false) {
  if (includeDeleted) return {};
  return {
    $or: [
      { lifecycleStatus: { $exists: false } },
      { lifecycleStatus: { $ne: 'deleted' } },
    ],
  };
}

async function uploadOrgFileViaFileService(upload, contentTypeAllowlist) {
  const raw = Buffer.from(String(upload?.contentBase64 || ''), 'base64');
  if (!raw.length) {
    return { error: 'Invalid base64 payload' };
  }
  if (raw.length > maxUploadBytes) {
    return { error: `File exceeds max size (${maxUploadBytes} bytes)` };
  }
  const contentType = String(upload?.contentType || '').trim().toLowerCase();
  if (!contentTypeAllowlist.has(contentType)) {
    return { error: 'Unsupported content type' };
  }
  if (contentType === 'image/svg+xml' && !isSafeSvg(raw)) {
    return { error: 'Unsafe SVG payload' };
  }

  const formData = new FormData();
  const filename = String(upload?.filename || `org-file-${Date.now()}`);
  formData.append('file', new Blob([raw], { type: contentType }), filename);

  const response = await fetchClient(`${fileDocumentApiBaseUrl}/files/upload`, {
    method: 'POST',
    body: formData,
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_err) {
      body = { message: text };
    }
  }
  if (!response.ok) {
    return { error: body?.message || `File upload failed: ${response.status}` };
  }
  const url = body?.file?.secureUrl || body?.file?.url || null;
  if (!url) return { error: 'Upload did not return URL' };
  return { url, metadata: body?.file || null };
}

async function syncMembershipOrgState(organizationId, action, metadata = {}) {
  const endpointByAction = {
    suspend: `/internal/memberships/org/${encodeURIComponent(String(organizationId))}/suspend`,
    resume: `/internal/memberships/org/${encodeURIComponent(String(organizationId))}/resume`,
    archiveDelete: `/internal/memberships/org/${encodeURIComponent(String(organizationId))}/archive-delete`,
    restoreArchive: `/internal/memberships/org/${encodeURIComponent(String(organizationId))}/restore`,
  };
  const target = endpointByAction[action];
  if (!target) return;
  try {
    const response = await callJson(`${membershipApiBaseUrl}${target}`, {
      method: 'POST',
      headers: {
        'x-internal-token': internalServiceToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ organizationId, ...metadata }),
    });
    if (!response.ok) {
      fastify.log.warn({ organizationId, action, response }, 'Membership lifecycle sync failed');
    }
  } catch (err) {
    fastify.log.warn({ err, organizationId, action }, 'Membership lifecycle sync errored');
  }
}

async function cascadeOrganizationState(organizationId, action) {
  const timestamp = now();
  if (action === 'suspend') {
    await collections.institutions().updateMany(
      { organizationId, status: { $nin: ['deleted', 'suspended'] } },
      [{
        $set: {
          statusBeforeOrgSuspension: { $ifNull: ['$statusBeforeOrgSuspension', '$status'] },
          orgSuspendedByParent: true,
          status: 'suspended',
          updatedAt: timestamp,
        },
      }],
    );
    await collections.branches().updateMany(
      { organizationId, status: { $nin: ['deleted', 'suspended'] } },
      [{
        $set: {
          statusBeforeOrgSuspension: { $ifNull: ['$statusBeforeOrgSuspension', '$status'] },
          orgSuspendedByParent: true,
          status: 'suspended',
          updatedAt: timestamp,
        },
      }],
    );
    await syncMembershipOrgState(organizationId, 'suspend', { reason: 'ORG_SUSPENDED_OR_APPROVAL_REVOKED' });
    return;
  }

  if (action === 'resume') {
    await collections.institutions().updateMany(
      { organizationId, status: 'suspended', orgSuspendedByParent: true },
      [{
        $set: {
          status: {
            $cond: [
              { $in: ['$statusBeforeOrgSuspension', ['active', 'inactive', 'suspended']] },
              '$statusBeforeOrgSuspension',
              'active',
            ],
          },
          updatedAt: timestamp,
        },
      }, { $unset: ['statusBeforeOrgSuspension', 'orgSuspendedByParent'] }],
    );
    await collections.branches().updateMany(
      { organizationId, status: 'suspended', orgSuspendedByParent: true },
      [{
        $set: {
          status: {
            $cond: [
              { $in: ['$statusBeforeOrgSuspension', ['active', 'closed', 'suspended']] },
              '$statusBeforeOrgSuspension',
              'active',
            ],
          },
          updatedAt: timestamp,
        },
      }, { $unset: ['statusBeforeOrgSuspension', 'orgSuspendedByParent'] }],
    );
    await syncMembershipOrgState(organizationId, 'resume', { reason: 'ORG_REACTIVATED' });
    return;
  }

  if (action === 'delete') {
    await collections.institutions().updateMany(
      { organizationId, status: { $ne: 'deleted' } },
      [{
        $set: {
          statusBeforeOrgDelete: { $ifNull: ['$statusBeforeOrgDelete', '$status'] },
          status: 'deleted',
          deletedAt: timestamp,
          updatedAt: timestamp,
        },
      }],
    );
    await collections.branches().updateMany(
      { organizationId, status: { $ne: 'deleted' } },
      [{
        $set: {
          statusBeforeOrgDelete: { $ifNull: ['$statusBeforeOrgDelete', '$status'] },
          status: 'deleted',
          deletedAt: timestamp,
          updatedAt: timestamp,
        },
      }],
    );
    await syncMembershipOrgState(organizationId, 'archiveDelete', { reason: 'ORG_DELETED' });
    return;
  }

  if (action === 'restore') {
    await collections.institutions().updateMany(
      { organizationId, status: 'deleted' },
      [{
        $set: {
          status: {
            $cond: [
              { $in: ['$statusBeforeOrgDelete', ['active', 'inactive', 'suspended']] },
              '$statusBeforeOrgDelete',
              'inactive',
            ],
          },
          updatedAt: timestamp,
        },
      }, { $unset: ['statusBeforeOrgDelete', 'deletedAt'] }],
    );
    await collections.branches().updateMany(
      { organizationId, status: 'deleted' },
      [{
        $set: {
          status: {
            $cond: [
              { $in: ['$statusBeforeOrgDelete', ['active', 'closed', 'suspended']] },
              '$statusBeforeOrgDelete',
              'closed',
            ],
          },
          updatedAt: timestamp,
        },
      }, { $unset: ['statusBeforeOrgDelete', 'deletedAt'] }],
    );
    await syncMembershipOrgState(organizationId, 'restoreArchive', { reason: 'ORG_RESTORED' });
  }
}

function isElevatedOrgRole(roles = []) {
  const elevated = new Set(['owner', 'super_staff', 'org_owner', 'org_admin', 'regional_manager', 'supervisor']);
  return (Array.isArray(roles) ? roles : []).some((role) => elevated.has(normalizeRoleName(role)));
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function fetchUserMembershipSummaries(userId, authorization) {
  if (!userId || !authorization) return [];
  try {
    const response = await callJson(
      `${membershipApiBaseUrl}/users/${encodeURIComponent(String(userId))}/memberships?includeBranches=true`,
      {
        method: 'GET',
        headers: {
          authorization,
          'x-internal-token': internalServiceToken,
          'content-type': 'application/json',
        },
      },
    );
    if (!response.ok) return [];
    return Array.isArray(response.body?.memberships) ? response.body.memberships : [];
  } catch (_err) {
    return [];
  }
}

async function resolveViewerScope(req, organizationId) {
  if (canBypassOrgVisibility(req)) {
    return {
      level: 'organization',
      reason: 'SUPER_ROLE',
      organizationId,
      institutionIds: [],
      branchIds: [],
      message: 'You have full organization visibility as an app super user.',
      hasAccess: true,
    };
  }

  const memberships = await fetchUserMembershipSummaries(req.auth?.userId, req.headers.authorization);
  const membership = memberships.find((entry) => String(entry?.organizationId || '') === String(organizationId));
  if (!membership) {
    const org = await collections.organizations().findOne({ organizationId: String(organizationId) });
    const userId = String(req.auth?.userId || '');
    if (org && String(org.ownerUserId || '') === userId) {
      return {
        level: 'organization',
        reason: 'OWNER',
        organizationId,
        institutionIds: [],
        branchIds: [],
        message: 'You are owner of this organization and can view it.',
        hasAccess: true,
      };
    }
    return {
      level: 'none',
      reason: 'NOT_AFFILIATED',
      organizationId,
      institutionIds: [],
      branchIds: [],
      message: 'You are not affiliated with this organization.',
      hasAccess: false,
    };
  }

  const roles = Array.isArray(membership.roles) ? membership.roles : [];
  const assignments = Array.isArray(membership.branches) ? membership.branches : [];
  const branchIds = unique(assignments.map((item) => String(item?.branchId || '')).filter(Boolean));
  const explicitInstitutionIds = unique(assignments.map((item) => String(item?.institutionId || '')).filter(Boolean));

  let institutionIds = explicitInstitutionIds;
  if (institutionIds.length === 0 && branchIds.length > 0) {
    const linkedBranches = await collections
      .branches()
      .find({ organizationId: String(organizationId), branchId: { $in: branchIds } })
      .toArray();
    institutionIds = unique(linkedBranches.map((item) => String(item?.institutionId || '')).filter(Boolean));
  }

  if (isElevatedOrgRole(roles)) {
    return {
      level: 'organization',
      reason: 'ORG_LEVEL_MEMBERSHIP',
      organizationId,
      institutionIds,
      branchIds,
      message: 'You are assigned at organization level and can oversee all institutions and branches.',
      hasAccess: true,
    };
  }

  if (institutionIds.length > 0 && branchIds.length === 0) {
    return {
      level: 'institution',
      reason: 'INSTITUTION_LEVEL_AFFILIATION',
      organizationId,
      institutionIds,
      branchIds,
      message: 'You are assigned at institution level. Open your institution to continue.',
      hasAccess: true,
    };
  }

  if (branchIds.length > 0) {
    return {
      level: 'branch',
      reason: 'BRANCH_LEVEL_AFFILIATION',
      organizationId,
      institutionIds,
      branchIds,
      message: 'You are assigned to branch scope. Go to your branch workspace to continue.',
      hasAccess: true,
    };
  }

  return {
    level: 'organization',
    reason: 'ORG_MEMBERSHIP_FALLBACK',
    organizationId,
    institutionIds,
    branchIds,
    message: 'Organization membership found.',
    hasAccess: true,
  };
}

function buildVisibilityFilter({ userId, superBypass, memberships, includeDeleted = false }) {
  const nonDeleted = activeOrgVisibilityFilter(includeDeleted);
  if (superBypass) return nonDeleted;
  const orgIds = unique((Array.isArray(memberships) ? memberships : []).map((entry) => String(entry?.organizationId || '')).filter(Boolean));
  return {
    $and: [
      nonDeleted,
      {
        $or: [
          { ownerUserId: String(userId) },
          ...(orgIds.length > 0 ? [{ organizationId: { $in: orgIds } }] : []),
        ],
      },
    ],
  };
}

async function resolveAccessibleInstitutionIds(organizationId, viewerScope) {
  if (!viewerScope?.hasAccess) return [];
  if (viewerScope.level === 'organization') return null;
  if (viewerScope.level === 'institution') {
    return unique(Array.isArray(viewerScope.institutionIds) ? viewerScope.institutionIds : []);
  }
  if (viewerScope.level === 'branch') {
    const branchIds = unique(Array.isArray(viewerScope.branchIds) ? viewerScope.branchIds : []);
    if (branchIds.length === 0) return [];
    const rows = await collections.branches().find({
      organizationId: String(organizationId),
      branchId: { $in: branchIds },
    }).toArray();
    return unique(rows.map((entry) => String(entry?.institutionId || '')).filter(Boolean));
  }
  return [];
}

async function resolveCrossOrgScope(req) {
  if (canBypassOrgVisibility(req)) return { global: true, byOrg: new Map() };
  const byOrg = new Map();
  const memberships = await fetchUserMembershipSummaries(req.auth?.userId, req.headers.authorization);

  for (const membership of memberships) {
    const orgId = String(membership?.organizationId || '').trim();
    if (!orgId) continue;
    const roles = Array.isArray(membership.roles) ? membership.roles : [];
    const assignments = Array.isArray(membership.branches) ? membership.branches : [];
    const existing = byOrg.get(orgId) || { all: false, branchIds: new Set(), institutionIds: new Set() };
    if (isElevatedOrgRole(roles)) {
      existing.all = true;
    }
    for (const assignment of assignments) {
      const branchId = String(assignment?.branchId || '').trim();
      const institutionId = String(assignment?.institutionId || '').trim();
      if (branchId) existing.branchIds.add(branchId);
      if (institutionId) existing.institutionIds.add(institutionId);
    }
    byOrg.set(orgId, existing);
  }

  const userId = String(req.auth?.userId || '').trim();
  if (userId) {
    const ownedOrganizations = await collections.organizations().find({
      ownerUserId: userId,
    }).project({ organizationId: 1 }).toArray();
    for (const entry of ownedOrganizations) {
      const orgId = String(entry?.organizationId || '').trim();
      if (!orgId) continue;
      const existing = byOrg.get(orgId) || { all: false, branchIds: new Set(), institutionIds: new Set() };
      existing.all = true;
      byOrg.set(orgId, existing);
    }
  }

  const branchLookups = [];
  for (const [orgId, scope] of byOrg.entries()) {
    if (scope.all || scope.branchIds.size === 0) continue;
    branchLookups.push({ orgId, branchIds: Array.from(scope.branchIds) });
  }
  if (branchLookups.length > 0) {
    const clauses = branchLookups.map((item) => ({
      organizationId: item.orgId,
      branchId: { $in: item.branchIds },
    }));
    const mappedBranches = await collections.branches().find({ $or: clauses }).toArray();
    for (const branch of mappedBranches) {
      const orgId = String(branch?.organizationId || '').trim();
      const institutionId = String(branch?.institutionId || '').trim();
      if (!orgId || !institutionId) continue;
      const scope = byOrg.get(orgId);
      if (!scope) continue;
      scope.institutionIds.add(institutionId);
    }
  }

  return { global: false, byOrg };
}

function normalizeSearchRegex(query) {
  const text = String(query || '').trim();
  if (!text) return null;
  return { $regex: text, $options: 'i' };
}

function normalizeBranchCapabilities(input) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => BRANCH_CAPABILITIES.includes(item))
    )
  );
}

function branchTypeToCapability(type) {
  const value = String(type || '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'lab') return 'laboratory';
  if (BRANCH_CAPABILITIES.includes(value)) return value;
  return null;
}

function unwrapFindOneAndUpdateResult(result) {
  if (!result) return null;
  if (Object.prototype.hasOwnProperty.call(result, 'value')) {
    return result.value || null;
  }
  return result;
}

function unwrapFindOneAndDeleteResult(result) {
  if (!result) return null;
  if (Object.prototype.hasOwnProperty.call(result, 'value')) {
    return result.value || null;
  }
  return result;
}

async function bootstrapOrgDefaults(_authorization, organizationId, ownerUserId, createdByUserId = null, previousOwnerUserId = null) {
  try {
    await callJson(`${rbacApiBaseUrl}/internal/rbac/bootstrap-org/${organizationId}`, {
      method: 'POST',
      headers: {
        'x-internal-token': internalServiceToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ownerUserId: ownerUserId || null,
        createdByUserId: createdByUserId || null,
        previousOwnerUserId: previousOwnerUserId || null,
      }),
    });
  } catch (err) {
    fastify.log.warn({ err, organizationId }, 'Failed to bootstrap default org roles');
  }
}

async function bootstrapInitialMembership(organizationId, createdByUserId, ownerUserId, ownerNin, organizationName = null) {
  try {
    await callJson(`${membershipApiBaseUrl}/internal/memberships/bootstrap`, {
      method: 'POST',
      headers: {
        'x-internal-token': internalServiceToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        organizationName: organizationName || null,
        createdByUserId: createdByUserId || null,
        ownerUserId: ownerUserId || null,
        ownerNin: ownerNin || null,
      }),
    });
  } catch (err) {
    fastify.log.warn({ err, organizationId }, 'Failed to bootstrap initial memberships');
  }
}

async function seedGeoData() {
  const nowIso = now().toISOString();

  for (let index = 0; index < GEO_REGION_SEEDS.length; index += 1) {
    const region = GEO_REGION_SEEDS[index];
    const code = normalizeGeoCode(region.code, region.name);
    await collections.geoRegions().updateOne(
      { code },
      {
        $setOnInsert: {
          regionId: crypto.randomUUID(),
          code,
          name: normalizeGeoName(region.name),
          status: 'active',
          order: index + 1,
          isSystem: true,
          createdAt: nowIso,
        },
        $set: {
          updatedAt: nowIso,
        },
      },
      { upsert: true },
    );
  }

  const regions = await collections.geoRegions().find({}).toArray();
  const regionByCode = regions.reduce((acc, region) => {
    acc[String(region.code)] = region;
    return acc;
  }, {});

  for (let index = 0; index < GEO_STATE_SEEDS.length; index += 1) {
    const state = GEO_STATE_SEEDS[index];
    const code = normalizeGeoCode(state.code, state.name);
    const region = regionByCode[normalizeGeoCode(state.regionCode)];
    if (!region) continue;
    await collections.geoStates().updateOne(
      { code },
      {
        $setOnInsert: {
          stateId: crypto.randomUUID(),
          code,
          name: normalizeGeoName(state.name),
          regionId: region.regionId,
          regionCode: region.code,
          status: 'active',
          order: index + 1,
          isSystem: true,
          createdAt: nowIso,
        },
        $set: {
          updatedAt: nowIso,
        },
      },
      { upsert: true },
    );
  }

  const states = await collections.geoStates().find({}).toArray();
  const stateByCode = states.reduce((acc, state) => {
    acc[String(state.code)] = state;
    return acc;
  }, {});

  for (let index = 0; index < GEO_STATE_REGION_SEEDS.length; index += 1) {
    const stateRegion = GEO_STATE_REGION_SEEDS[index];
    const state = stateByCode[normalizeGeoCode(stateRegion.stateCode)];
    if (!state) continue;
    const name = normalizeGeoName(stateRegion.name);
    if (!name) continue;
    const code = buildGeoStateRegionCode(state.code, name);
    await collections.geoStateRegions().updateOne(
      { code },
      {
        $setOnInsert: {
          stateRegionId: crypto.randomUUID(),
          code,
          name,
          stateId: state.stateId,
          stateCode: state.code,
          regionId: state.regionId,
          regionCode: state.regionCode,
          status: 'active',
          order: index + 1,
          isSystem: true,
          createdAt: nowIso,
        },
        $set: {
          updatedAt: nowIso,
        },
      },
      { upsert: true },
    );
  }

  const stateRegions = await collections.geoStateRegions().find({}).toArray();
  const stateRegionByStateAndName = stateRegions.reduce((acc, entry) => {
    const key = `${String(entry.stateCode || '')}::${slugGeoName(entry.name)}`;
    acc[key] = entry;
    return acc;
  }, {});

  const lgaSeeds = buildGeoLgaSeeds();
  const lgaOps = [];
  for (let index = 0; index < lgaSeeds.length; index += 1) {
    const lga = lgaSeeds[index];
    const state = stateByCode[normalizeGeoCode(lga.stateCode)];
    if (!state) continue;
    const stateRegionKey = lga.stateRegionName ? `${state.code}::${slugGeoName(lga.stateRegionName)}` : null;
    const stateRegion = stateRegionKey ? stateRegionByStateAndName[stateRegionKey] : null;
    lgaOps.push({
      updateOne: {
        filter: { code: lga.code },
        update: {
          $setOnInsert: {
            lgaId: crypto.randomUUID(),
            code: lga.code,
            name: normalizeGeoName(lga.name),
            stateId: state.stateId,
            stateCode: state.code,
            regionId: state.regionId,
            regionCode: state.regionCode,
            status: 'active',
            order: index + 1,
            isSystem: true,
            createdAt: nowIso,
          },
          $set: {
            stateRegionId: stateRegion?.stateRegionId || null,
            stateRegionCode: stateRegion?.code || null,
            updatedAt: nowIso,
          },
        },
        upsert: true,
      },
    });
  }

  const geoSeedBatchSize = 200;
  for (let start = 0; start < lgaOps.length; start += geoSeedBatchSize) {
    await collections.geoLgas().bulkWrite(lgaOps.slice(start, start + geoSeedBatchSize), { ordered: false });
  }
}

async function connect() {
  if (!mongoUri) {
    fastify.log.warn('Missing MONGODB_URI; organization-service running in degraded mode');
    return;
  }

  try {
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

    await Promise.all([
      collections.organizations().createIndex({ organizationId: 1 }, { unique: true }),
      collections.organizations().createIndex({ ownerUserId: 1 }),
      collections.organizations().createIndex({ ownerNin: 1 }),
      collections.organizations().createIndex({ registrationNumber: 1 }),
      collections.organizations().createIndex({ lifecycleStatus: 1, approvalStatus: 1 }),
      collections.organizations().createIndex({ deletedAt: -1 }),
      collections.organizations().createIndex({ 'location.state': 1, 'location.lga': 1 }),
      collections.organizations().createIndex({ name: 1 }),
      collections.institutions().createIndex({ institutionId: 1 }, { unique: true }),
      collections.institutions().createIndex({ organizationId: 1, code: 1 }, { unique: true }),
      collections.institutions().createIndex({ organizationId: 1, status: 1 }),
      collections.institutions().createIndex({ organizationId: 1, isHeadquarters: 1 }),
      collections.branches().createIndex({ branchId: 1 }, { unique: true }),
      collections.branches().createIndex({ organizationId: 1, institutionId: 1, code: 1 }, { unique: true }),
      collections.branches().createIndex({ organizationId: 1, capabilities: 1 }),
      collections.branches().createIndex({ organizationId: 1, institutionId: 1 }),
      collections.branches().createIndex({ organizationId: 1, status: 1 }),
      collections.globalServices().createIndex({ serviceId: 1 }, { unique: true }),
      collections.globalServices().createIndex({ normalizedName: 1 }, { unique: true }),
      collections.globalServices().createIndex({ name: 1 }),
      collections.ownerHistory().createIndex({ organizationId: 1, timestamp: -1 }),
      collections.geoRegions().createIndex({ regionId: 1 }, { unique: true }),
      collections.geoRegions().createIndex({ code: 1 }, { unique: true }),
      collections.geoRegions().createIndex({ name: 1 }),
      collections.geoStates().createIndex({ stateId: 1 }, { unique: true }),
      collections.geoStates().createIndex({ code: 1 }, { unique: true }),
      collections.geoStates().createIndex({ regionId: 1, name: 1 }),
      collections.geoStateRegions().createIndex({ stateRegionId: 1 }, { unique: true }),
      collections.geoStateRegions().createIndex({ code: 1 }, { unique: true }),
      collections.geoStateRegions().createIndex({ stateId: 1, name: 1 }),
      collections.geoLgas().createIndex({ lgaId: 1 }, { unique: true }),
      collections.geoLgas().createIndex({ code: 1 }, { unique: true }),
      collections.geoLgas().createIndex({ stateId: 1, name: 1 }),
      collections.geoLgas().createIndex({ stateRegionId: 1, name: 1 }),
      outboxRepo.createIndexes(),
    ]);
    await seedGeoData();
    await seedGlobalServices();
  } catch (err) {
    fastify.log.warn({ err }, 'MongoDB connection failed');
  }
}

fastify.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  if (!dbReady) {
    return reply.code(503).send({ message: 'Organization storage unavailable' });
  }
});

fastify.addHook('onRequest', createContextVerificationHook({
  secret: nhrsContextSecret,
  requiredMatcher: (req) => req.url.startsWith('/orgs/'),
}));

async function flushOutboxOnce() {
  if (!outboxRepo) return;
  await deliverOutboxBatch({
    outboxRepo,
    logger: fastify.log,
    batchSize: outboxBatchSize,
    maxAttempts: outboxMaxAttempts,
    handlers: {
      notification: async (event) => {
        const res = await fetchClient(`${notificationApiBaseUrl}/internal/notifications/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ eventId: event.eventId, ...event.payload, createdAt: event.createdAt }),
        });
        if (!res.ok) throw new Error(`notification delivery failed: ${res.status}`);
      },
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

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  dbName,
}));

fastify.get('/geo/regions', {
  schema: {
    tags: ['Geography'],
    summary: 'List geopolitical regions',
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        includeInactive: { type: 'boolean' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const includeInactive = req.query?.includeInactive === true || req.query?.includeInactive === 'true';
  const q = normalizeSearchRegex(req.query?.q);
  const filter = {
    ...(includeInactive ? {} : { status: 'active' }),
    ...(q ? { $or: [{ name: q }, { code: q }] } : {}),
  };
  const items = await collections.geoRegions().find(filter).sort({ order: 1, name: 1 }).toArray();
  return reply.send({ items });
});

fastify.get('/geo/states', {
  schema: {
    tags: ['Geography'],
    summary: 'List states',
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        regionId: { type: 'string' },
        regionCode: { type: 'string' },
        includeInactive: { type: 'boolean' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const includeInactive = req.query?.includeInactive === true || req.query?.includeInactive === 'true';
  const q = normalizeSearchRegex(req.query?.q);
  const filter = {
    ...(includeInactive ? {} : { status: 'active' }),
  };
  if (q) {
    filter.$or = [{ name: q }, { code: q }];
  }
  if (req.query?.regionId) {
    filter.regionId = String(req.query.regionId).trim();
  } else if (req.query?.regionCode) {
    filter.regionCode = normalizeGeoCode(req.query.regionCode);
  }

  const items = await collections.geoStates().find(filter).sort({ name: 1 }).toArray();
  if (items.length === 0) return reply.send({ items: [] });

  const regionIds = Array.from(new Set(items.map((entry) => String(entry.regionId || '')).filter(Boolean)));
  const regions = regionIds.length > 0
    ? await collections.geoRegions().find({ regionId: { $in: regionIds } }).toArray()
    : [];
  const regionById = regions.reduce((acc, entry) => {
    acc[String(entry.regionId)] = entry;
    return acc;
  }, {});

  return reply.send({
    items: items.map((entry) => ({
      ...entry,
      regionName: regionById[String(entry.regionId)]?.name || null,
    })),
  });
});

fastify.get('/geo/state-regions', {
  schema: {
    tags: ['Geography'],
    summary: 'List state regions',
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        stateId: { type: 'string' },
        stateCode: { type: 'string' },
        regionId: { type: 'string' },
        includeInactive: { type: 'boolean' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const includeInactive = req.query?.includeInactive === true || req.query?.includeInactive === 'true';
  const q = normalizeSearchRegex(req.query?.q);
  const filter = {
    ...(includeInactive ? {} : { status: 'active' }),
  };
  if (q) filter.$or = [{ name: q }, { code: q }];
  if (req.query?.stateId) filter.stateId = String(req.query.stateId).trim();
  if (req.query?.stateCode) filter.stateCode = normalizeGeoCode(req.query.stateCode);
  if (req.query?.regionId) filter.regionId = String(req.query.regionId).trim();

  const items = await collections.geoStateRegions().find(filter).sort({ stateCode: 1, order: 1, name: 1 }).toArray();
  if (items.length === 0) return reply.send({ items: [] });

  const stateIds = Array.from(new Set(items.map((entry) => String(entry.stateId || '')).filter(Boolean)));
  const states = stateIds.length > 0 ? await collections.geoStates().find({ stateId: { $in: stateIds } }).toArray() : [];
  const stateById = states.reduce((acc, entry) => {
    acc[String(entry.stateId)] = entry;
    return acc;
  }, {});

  return reply.send({
    items: items.map((entry) => ({
      ...entry,
      stateName: stateById[String(entry.stateId)]?.name || null,
    })),
  });
});

fastify.get('/geo/lgas', {
  schema: {
    tags: ['Geography'],
    summary: 'List local governments',
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        stateId: { type: 'string' },
        stateCode: { type: 'string' },
        regionId: { type: 'string' },
        stateRegionId: { type: 'string' },
        includeInactive: { type: 'boolean' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const includeInactive = req.query?.includeInactive === true || req.query?.includeInactive === 'true';
  const q = normalizeSearchRegex(req.query?.q);
  const filter = {
    ...(includeInactive ? {} : { status: 'active' }),
  };
  if (q) {
    filter.$or = [{ name: q }, { code: q }];
  }
  if (req.query?.stateId) filter.stateId = String(req.query.stateId).trim();
  if (req.query?.stateCode) filter.stateCode = normalizeGeoCode(req.query.stateCode);
  if (req.query?.regionId) filter.regionId = String(req.query.regionId).trim();
  if (req.query?.stateRegionId) filter.stateRegionId = String(req.query.stateRegionId).trim();

  const items = await collections.geoLgas().find(filter).sort({ name: 1 }).toArray();
  if (items.length === 0) return reply.send({ items: [] });

  const stateIds = Array.from(new Set(items.map((entry) => String(entry.stateId || '')).filter(Boolean)));
  const regionIds = Array.from(new Set(items.map((entry) => String(entry.regionId || '')).filter(Boolean)));
  const stateRegionIds = Array.from(new Set(items.map((entry) => String(entry.stateRegionId || '')).filter(Boolean)));
  const [states, regions, stateRegions] = await Promise.all([
    stateIds.length > 0 ? collections.geoStates().find({ stateId: { $in: stateIds } }).toArray() : Promise.resolve([]),
    regionIds.length > 0 ? collections.geoRegions().find({ regionId: { $in: regionIds } }).toArray() : Promise.resolve([]),
    stateRegionIds.length > 0 ? collections.geoStateRegions().find({ stateRegionId: { $in: stateRegionIds } }).toArray() : Promise.resolve([]),
  ]);
  const stateById = states.reduce((acc, entry) => {
    acc[String(entry.stateId)] = entry;
    return acc;
  }, {});
  const regionById = regions.reduce((acc, entry) => {
    acc[String(entry.regionId)] = entry;
    return acc;
  }, {});
  const stateRegionById = stateRegions.reduce((acc, entry) => {
    acc[String(entry.stateRegionId)] = entry;
    return acc;
  }, {});

  return reply.send({
    items: items.map((entry) => ({
      ...entry,
      stateName: stateById[String(entry.stateId)]?.name || null,
      regionName: regionById[String(entry.regionId)]?.name || null,
      stateRegionName: stateRegionById[String(entry.stateRegionId)]?.name || null,
    })),
  });
});

fastify.get('/geo/hierarchy', {
  schema: {
    tags: ['Geography'],
    summary: 'Get full region/state/lga hierarchy',
    response: {
      200: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'geo.manage');
  if (denied) return;
  const [regions, states, stateRegions, lgas] = await Promise.all([
    collections.geoRegions().find({}).sort({ order: 1, name: 1 }).toArray(),
    collections.geoStates().find({}).sort({ name: 1 }).toArray(),
    collections.geoStateRegions().find({}).sort({ stateCode: 1, order: 1, name: 1 }).toArray(),
    collections.geoLgas().find({}).sort({ name: 1 }).toArray(),
  ]);

  const lgasByStateRegionId = lgas.reduce((acc, entry) => {
    const stateRegionId = String(entry.stateRegionId || '');
    if (!stateRegionId) return acc;
    if (!acc[stateRegionId]) acc[stateRegionId] = [];
    acc[stateRegionId].push(entry);
    return acc;
  }, {});
  const lgasByStateId = lgas.reduce((acc, entry) => {
    const stateId = String(entry.stateId || '');
    if (!stateId) return acc;
    if (!acc[stateId]) acc[stateId] = [];
    acc[stateId].push(entry);
    return acc;
  }, {});
  const stateRegionsByStateId = stateRegions.reduce((acc, entry) => {
    const stateId = String(entry.stateId || '');
    if (!stateId) return acc;
    if (!acc[stateId]) acc[stateId] = [];
    acc[stateId].push({
      ...entry,
      lgas: lgasByStateRegionId[String(entry.stateRegionId)] || [],
    });
    return acc;
  }, {});
  const statesByRegionId = states.reduce((acc, entry) => {
    const regionId = String(entry.regionId || '');
    if (!regionId) return acc;
    if (!acc[regionId]) acc[regionId] = [];
    acc[regionId].push({
      ...entry,
      stateRegions: stateRegionsByStateId[String(entry.stateId)] || [],
      lgas: lgasByStateId[String(entry.stateId)] || [],
    });
    return acc;
  }, {});
  return reply.send({
    items: regions.map((region) => ({
      ...region,
      states: statesByRegionId[String(region.regionId)] || [],
    })),
  });
});

fastify.post('/geo/regions', {
  preHandler: requireAuth,
  schema: {
    tags: ['Geography'],
    summary: 'Create geography region',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string' },
        status: { type: 'string', enum: GEO_STATUSES },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'geo.manage');
  if (denied) return;
  const name = normalizeGeoName(req.body?.name);
  const code = normalizeGeoCode(req.body?.code, name);
  if (!name || !code) return reply.code(400).send({ message: 'name is required' });
  const record = {
    regionId: crypto.randomUUID(),
    name,
    code,
    status: GEO_STATUSES.includes(String(req.body?.status || '').toLowerCase())
      ? String(req.body.status).toLowerCase()
      : 'active',
    isSystem: false,
    createdAt: now(),
    updatedAt: now(),
  };
  try {
    await collections.geoRegions().insertOne(record);
  } catch (err) {
    if (err?.code === 11000) return reply.code(400).send({ message: 'Region code already exists' });
    throw err;
  }
  return reply.code(201).send({ region: record });
});

fastify.patch('/geo/regions/:regionId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Geography'],
    summary: 'Update geography region',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['regionId'],
      properties: { regionId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string' },
        status: { type: 'string', enum: GEO_STATUSES },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'geo.manage');
  if (denied) return;
  const update = { updatedAt: now() };
  if (req.body?.name !== undefined) update.name = normalizeGeoName(req.body.name);
  if (req.body?.code !== undefined) update.code = normalizeGeoCode(req.body.code, req.body.name);
  if (req.body?.status !== undefined) update.status = GEO_STATUSES.includes(String(req.body.status).toLowerCase())
    ? String(req.body.status).toLowerCase()
    : 'active';
  const result = await collections.geoRegions().findOneAndUpdate(
    { regionId: req.params.regionId },
    { $set: update },
    { returnDocument: 'after' },
  );
  const region = unwrapFindOneAndUpdateResult(result);
  if (!region) return reply.code(404).send({ message: 'Region not found' });
  return reply.send({ region });
});

fastify.post('/geo/states', {
  preHandler: requireAuth,
  schema: {
    tags: ['Geography'],
    summary: 'Create state',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['name', 'regionId'],
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string' },
        regionId: { type: 'string' },
        status: { type: 'string', enum: GEO_STATUSES },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'geo.manage');
  if (denied) return;
  const region = await collections.geoRegions().findOne({ regionId: String(req.body?.regionId || '').trim() });
  if (!region) return reply.code(404).send({ message: 'Region not found' });
  const name = normalizeGeoName(req.body?.name);
  const code = normalizeGeoCode(req.body?.code, name);
  if (!name || !code) return reply.code(400).send({ message: 'name is required' });
  const record = {
    stateId: crypto.randomUUID(),
    name,
    code,
    regionId: region.regionId,
    regionCode: region.code,
    status: GEO_STATUSES.includes(String(req.body?.status || '').toLowerCase())
      ? String(req.body.status).toLowerCase()
      : 'active',
    isSystem: false,
    createdAt: now(),
    updatedAt: now(),
  };
  try {
    await collections.geoStates().insertOne(record);
  } catch (err) {
    if (err?.code === 11000) return reply.code(400).send({ message: 'State code already exists' });
    throw err;
  }
  return reply.code(201).send({ state: record });
});

fastify.patch('/geo/states/:stateId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Geography'],
    summary: 'Update state',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['stateId'],
      properties: { stateId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string' },
        regionId: { type: 'string' },
        status: { type: 'string', enum: GEO_STATUSES },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'geo.manage');
  if (denied) return;
  const update = { updatedAt: now() };
  if (req.body?.name !== undefined) update.name = normalizeGeoName(req.body.name);
  if (req.body?.code !== undefined) update.code = normalizeGeoCode(req.body.code, req.body.name);
  if (req.body?.status !== undefined) update.status = GEO_STATUSES.includes(String(req.body.status).toLowerCase())
    ? String(req.body.status).toLowerCase()
    : 'active';
  if (req.body?.regionId !== undefined) {
    const region = await collections.geoRegions().findOne({ regionId: String(req.body.regionId).trim() });
    if (!region) return reply.code(404).send({ message: 'Region not found' });
    update.regionId = region.regionId;
    update.regionCode = region.code;
  }
  const result = await collections.geoStates().findOneAndUpdate(
    { stateId: req.params.stateId },
    { $set: update },
    { returnDocument: 'after' },
  );
  const state = unwrapFindOneAndUpdateResult(result);
  if (!state) return reply.code(404).send({ message: 'State not found' });

  if (update.regionId || update.regionCode) {
    await collections.geoLgas().updateMany(
      { stateId: state.stateId },
      { $set: { regionId: state.regionId, regionCode: state.regionCode, updatedAt: now() } },
    );
  }
  return reply.send({ state });
});

fastify.post('/geo/state-regions', {
  preHandler: requireAuth,
  schema: {
    tags: ['Geography'],
    summary: 'Create state region',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['name', 'stateId'],
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string' },
        stateId: { type: 'string' },
        status: { type: 'string', enum: GEO_STATUSES },
      },
      additionalProperties: false,
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'geo.manage');
  if (denied) return;
  const state = await collections.geoStates().findOne({ stateId: String(req.body?.stateId || '').trim() });
  if (!state) return reply.code(404).send({ message: 'State not found' });
  const name = normalizeGeoName(req.body?.name);
  const code = normalizeGeoCode(req.body?.code, buildGeoStateRegionCode(state.code, name));
  if (!name || !code) return reply.code(400).send({ message: 'name is required' });

  const record = {
    stateRegionId: crypto.randomUUID(),
    name,
    code,
    stateId: state.stateId,
    stateCode: state.code,
    regionId: state.regionId,
    regionCode: state.regionCode,
    status: GEO_STATUSES.includes(String(req.body?.status || '').toLowerCase())
      ? String(req.body.status).toLowerCase()
      : 'active',
    isSystem: false,
    createdAt: now(),
    updatedAt: now(),
  };
  try {
    await collections.geoStateRegions().insertOne(record);
  } catch (err) {
    if (err?.code === 11000) return reply.code(400).send({ message: 'State region code already exists' });
    throw err;
  }
  return reply.code(201).send({ stateRegion: record });
});

fastify.patch('/geo/state-regions/:stateRegionId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Geography'],
    summary: 'Update state region',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['stateRegionId'],
      properties: { stateRegionId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string' },
        stateId: { type: 'string' },
        status: { type: 'string', enum: GEO_STATUSES },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'geo.manage');
  if (denied) return;
  const existing = await collections.geoStateRegions().findOne({ stateRegionId: req.params.stateRegionId });
  if (!existing) return reply.code(404).send({ message: 'State region not found' });

  const update = { updatedAt: now() };
  if (req.body?.name !== undefined) update.name = normalizeGeoName(req.body.name);
  if (req.body?.status !== undefined) {
    update.status = GEO_STATUSES.includes(String(req.body.status).toLowerCase())
      ? String(req.body.status).toLowerCase()
      : 'active';
  }

  let resolvedState = null;
  if (req.body?.stateId !== undefined) {
    resolvedState = await collections.geoStates().findOne({ stateId: String(req.body.stateId).trim() });
    if (!resolvedState) return reply.code(404).send({ message: 'State not found' });
    update.stateId = resolvedState.stateId;
    update.stateCode = resolvedState.code;
    update.regionId = resolvedState.regionId;
    update.regionCode = resolvedState.regionCode;
  } else {
    resolvedState = await collections.geoStates().findOne({ stateId: String(existing.stateId || '').trim() });
  }

  if (req.body?.code !== undefined) {
    const nameForCode = update.name || existing.name;
    const stateCodeForCode = update.stateCode || existing.stateCode;
    update.code = normalizeGeoCode(req.body.code, buildGeoStateRegionCode(stateCodeForCode, nameForCode));
  } else if (update.name || update.stateCode) {
    const stateCodeForCode = update.stateCode || existing.stateCode;
    const nameForCode = update.name || existing.name;
    update.code = buildGeoStateRegionCode(stateCodeForCode, nameForCode);
  }

  const result = await collections.geoStateRegions().findOneAndUpdate(
    { stateRegionId: req.params.stateRegionId },
    { $set: update },
    { returnDocument: 'after' },
  );
  const stateRegion = unwrapFindOneAndUpdateResult(result);
  if (!stateRegion) return reply.code(404).send({ message: 'State region not found' });

  await collections.geoLgas().updateMany(
    { stateRegionId: stateRegion.stateRegionId },
    {
      $set: {
        stateId: stateRegion.stateId,
        stateCode: stateRegion.stateCode,
        regionId: stateRegion.regionId,
        regionCode: stateRegion.regionCode,
        stateRegionCode: stateRegion.code,
        updatedAt: now(),
      },
    },
  );

  return reply.send({ stateRegion });
});

fastify.post('/geo/lgas', {
  preHandler: requireAuth,
  schema: {
    tags: ['Geography'],
    summary: 'Create local government area',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['name', 'stateId'],
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string' },
        stateId: { type: 'string' },
        stateRegionId: { type: 'string' },
        status: { type: 'string', enum: GEO_STATUSES },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'geo.manage');
  if (denied) return;
  const state = await collections.geoStates().findOne({ stateId: String(req.body?.stateId || '').trim() });
  if (!state) return reply.code(404).send({ message: 'State not found' });
  let stateRegion = null;
  if (req.body?.stateRegionId) {
    stateRegion = await collections.geoStateRegions().findOne({ stateRegionId: String(req.body.stateRegionId).trim() });
    if (!stateRegion) return reply.code(404).send({ message: 'State region not found' });
    if (String(stateRegion.stateId) !== String(state.stateId)) {
      return reply.code(400).send({ message: 'State region does not belong to selected state' });
    }
  }
  const name = normalizeGeoName(req.body?.name);
  const code = normalizeGeoCode(req.body?.code, `${state.code}_${slugGeoName(name)}`);
  if (!name || !code) return reply.code(400).send({ message: 'name is required' });
  const record = {
    lgaId: crypto.randomUUID(),
    name,
    code,
    stateId: state.stateId,
    stateCode: state.code,
    regionId: state.regionId,
    regionCode: state.regionCode,
    stateRegionId: stateRegion?.stateRegionId || null,
    stateRegionCode: stateRegion?.code || null,
    status: GEO_STATUSES.includes(String(req.body?.status || '').toLowerCase())
      ? String(req.body.status).toLowerCase()
      : 'active',
    isSystem: false,
    createdAt: now(),
    updatedAt: now(),
  };
  try {
    await collections.geoLgas().insertOne(record);
  } catch (err) {
    if (err?.code === 11000) return reply.code(400).send({ message: 'LGA code already exists' });
    throw err;
  }
  return reply.code(201).send({ lga: record });
});

fastify.patch('/geo/lgas/:lgaId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Geography'],
    summary: 'Update local government area',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['lgaId'],
      properties: { lgaId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string' },
        stateId: { type: 'string' },
        stateRegionId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        status: { type: 'string', enum: GEO_STATUSES },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'geo.manage');
  if (denied) return;
  const existing = await collections.geoLgas().findOne({ lgaId: req.params.lgaId });
  if (!existing) return reply.code(404).send({ message: 'LGA not found' });

  const update = { updatedAt: now() };
  if (req.body?.name !== undefined) update.name = normalizeGeoName(req.body.name);
  if (req.body?.code !== undefined) update.code = normalizeGeoCode(req.body.code, req.body.name);
  if (req.body?.status !== undefined) update.status = GEO_STATUSES.includes(String(req.body.status).toLowerCase())
    ? String(req.body.status).toLowerCase()
    : 'active';
  if (req.body?.stateId !== undefined) {
    const state = await collections.geoStates().findOne({ stateId: String(req.body.stateId).trim() });
    if (!state) return reply.code(404).send({ message: 'State not found' });
    update.stateId = state.stateId;
    update.stateCode = state.code;
    update.regionId = state.regionId;
    update.regionCode = state.regionCode;
    if (req.body?.stateRegionId === undefined) {
      update.stateRegionId = null;
      update.stateRegionCode = null;
    }
  }

  if (req.body?.stateRegionId !== undefined) {
    if (!req.body.stateRegionId) {
      update.stateRegionId = null;
      update.stateRegionCode = null;
    } else {
      const stateRegion = await collections.geoStateRegions().findOne({ stateRegionId: String(req.body.stateRegionId).trim() });
      if (!stateRegion) return reply.code(404).send({ message: 'State region not found' });
      const effectiveStateId = update.stateId || existing.stateId;
      if (String(stateRegion.stateId) !== String(effectiveStateId)) {
        return reply.code(400).send({ message: 'State region does not belong to selected state' });
      }
      update.stateRegionId = stateRegion.stateRegionId;
      update.stateRegionCode = stateRegion.code;
      update.regionId = stateRegion.regionId;
      update.regionCode = stateRegion.regionCode;
      update.stateCode = stateRegion.stateCode;
      update.stateId = stateRegion.stateId;
    }
  }
  const result = await collections.geoLgas().findOneAndUpdate(
    { lgaId: req.params.lgaId },
    { $set: update },
    { returnDocument: 'after' },
  );
  const lga = unwrapFindOneAndUpdateResult(result);
  if (!lga) return reply.code(404).send({ message: 'LGA not found' });
  return reply.send({ lga });
});

fastify.get('/global-services', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'List global service catalog',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'auth.me.read');
  if (denied) return;

  const safeLimit = Math.max(1, Math.min(Number(req.query?.limit || 200), 500));
  const q = String(req.query?.q || '').trim();
  const filter = {};
  if (q) {
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { description: { $regex: q, $options: 'i' } },
    ];
  }

  const items = await collections.globalServices().find(filter).sort({ name: 1 }).limit(safeLimit).toArray();
  return reply.send({
    items: items.map((entry) => decorateGlobalService(entry)).filter(Boolean),
    total: items.length,
  });
});

fastify.post('/global-services', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Create global service catalog entry',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['name', 'description'],
      properties: {
        name: { type: 'string', minLength: 2 },
        description: { type: 'string', minLength: 8 },
      },
      additionalProperties: false,
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      409: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforceAnyPermission(
    req,
    reply,
    ['global.services.create', 'global.services.manage'],
    getPermissionOrgId(req),
  );
  if (denied) return;

  const name = normalizeGlobalServiceName(req.body?.name);
  const description = normalizeGlobalServiceDescription(req.body?.description);
  if (!name) {
    return reply.code(400).send({ message: 'Service name is required' });
  }
  if (description.length < 8) {
    return reply.code(400).send({ message: 'Service description is required' });
  }

  const record = {
    serviceId: crypto.randomUUID(),
    name,
    description,
    normalizedName: normalizeGlobalServiceLookup(name),
    createdAt: now(),
    updatedAt: now(),
  };

  try {
    await collections.globalServices().insertOne(record);
  } catch (err) {
    if (err?.code === 11000) {
      return reply.code(409).send({ message: 'A global service with this name already exists' });
    }
    throw err;
  }

  return reply.code(201).send({ service: decorateGlobalService(record) });
});

fastify.patch('/global-services/:serviceId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Update global service catalog entry',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['serviceId'],
      properties: {
        serviceId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      required: ['name', 'description'],
      properties: {
        name: { type: 'string', minLength: 2 },
        description: { type: 'string', minLength: 8 },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
      409: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforceAnyPermission(
    req,
    reply,
    ['global.services.update', 'global.services.manage'],
    getPermissionOrgId(req),
  );
  if (denied) return;

  const name = normalizeGlobalServiceName(req.body?.name);
  const description = normalizeGlobalServiceDescription(req.body?.description);
  if (!name) {
    return reply.code(400).send({ message: 'Service name is required' });
  }
  if (description.length < 8) {
    return reply.code(400).send({ message: 'Service description is required' });
  }

  let updated;
  try {
    const result = await collections.globalServices().findOneAndUpdate(
      { serviceId: req.params.serviceId },
      {
        $set: {
          name,
          description,
          normalizedName: normalizeGlobalServiceLookup(name),
          updatedAt: now(),
        },
      },
      { returnDocument: 'after' },
    );
    updated = unwrapFindOneAndUpdateResult(result);
  } catch (err) {
    if (err?.code === 11000) {
      return reply.code(409).send({ message: 'A global service with this name already exists' });
    }
    throw err;
  }

  if (!updated) {
    return reply.code(404).send({ message: 'Global service not found' });
  }

  return reply.send({ service: decorateGlobalService(updated) });
});

fastify.delete('/global-services/:serviceId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Delete global service catalog entry',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['serviceId'],
      properties: {
        serviceId: { type: 'string' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforceAnyPermission(
    req,
    reply,
    ['global.services.delete', 'global.services.manage'],
    getPermissionOrgId(req),
  );
  if (denied) return;

  const service = await collections.globalServices().findOneAndDelete({ serviceId: req.params.serviceId });
  const deleted = unwrapFindOneAndDeleteResult(service);
  if (!deleted) {
    return reply.code(404).send({ message: 'Global service not found' });
  }

  return reply.send({
    message: 'Global service deleted',
    service: decorateGlobalService(deleted),
  });
});

fastify.get('/internal/orgs/:orgId/access', {
  preHandler: requireInternalToken,
  schema: {
    tags: ['Organization'],
    summary: 'Internal org operational access check',
    params: {
      type: 'object',
      required: ['orgId'],
      properties: {
        orgId: { type: 'string' },
      },
    },
    querystring: {
      type: 'object',
      properties: {
        branchId: { type: 'string' },
        institutionId: { type: 'string' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) {
    return reply.code(404).send({ allowed: false, reason: 'ORG_NOT_FOUND' });
  }

  const lifecycle = String(organization.lifecycleStatus || 'active').toLowerCase();
  const approval = String(organization.approvalStatus || 'pending').toLowerCase();
  if (lifecycle === 'deleted') return reply.send({ allowed: false, reason: 'ORG_DELETED' });
  if (lifecycle === 'delete_pending') return reply.send({ allowed: false, reason: 'ORG_DELETE_PENDING' });
  if (lifecycle === 'suspended') return reply.send({ allowed: false, reason: 'ORG_SUSPENDED' });
  if (approval !== 'approved') return reply.send({ allowed: false, reason: 'ORG_NOT_APPROVED' });

  const branchId = req.query?.branchId ? String(req.query.branchId).trim() : '';
  const institutionId = req.query?.institutionId ? String(req.query.institutionId).trim() : '';

  let resolvedInstitutionId = institutionId;
  if (branchId) {
    const branch = await collections.branches().findOne({ organizationId: req.params.orgId, branchId });
    if (!branch) return reply.send({ allowed: false, reason: 'BRANCH_NOT_FOUND' });
    if (String(branch.status || '').toLowerCase() !== 'active') return reply.send({ allowed: false, reason: 'BRANCH_SUSPENDED' });
    resolvedInstitutionId = String(branch.institutionId || '').trim();
  }

  if (resolvedInstitutionId) {
    const institution = await collections.institutions().findOne({
      organizationId: req.params.orgId,
      institutionId: resolvedInstitutionId,
    });
    if (!institution) return reply.send({ allowed: false, reason: 'INSTITUTION_NOT_FOUND' });
    if (String(institution.status || '').toLowerCase() !== 'active') return reply.send({ allowed: false, reason: 'INSTITUTION_SUSPENDED' });
  }

  return reply.send({
    allowed: true,
    organizationId: req.params.orgId,
    organizationName: String(organization.name || organization.organizationId || req.params.orgId),
    branchId: branchId || null,
    branchName: branchId
      ? String((await collections.branches().findOne({ organizationId: req.params.orgId, branchId }))?.name || branchId)
      : null,
    institutionId: resolvedInstitutionId || null,
    institutionName: resolvedInstitutionId
      ? String((await collections.institutions().findOne({
        organizationId: req.params.orgId,
        institutionId: resolvedInstitutionId,
      }))?.name || resolvedInstitutionId)
      : null,
  });
});

fastify.post('/orgs', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Create organization',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['name', 'location'],
      properties: {
        name: { type: 'string', minLength: 2 },
        description: { type: 'string' },
        registrationNumber: { type: 'string' },
        ownerType: { type: 'string', enum: OWNER_TYPES },
        foundedAt: { type: 'string', format: 'date-time' },
        openedAt: { type: 'string', format: 'date-time' },
        website: { type: 'string' },
        logoUrl: { type: 'string' },
        cacDocumentUrl: { type: 'string' },
        cscDocumentUrl: { type: 'string', deprecated: true },
        metadata: { type: 'object', additionalProperties: true },
        documents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              documentId: { type: 'string' },
              title: { type: 'string' },
              type: { type: 'string' },
              url: { type: 'string' },
              uploadedAt: { type: 'string', format: 'date-time' },
              notes: { type: 'string' },
            },
            additionalProperties: true,
          },
        },
        location: {
          type: 'object',
          required: ['state', 'lga'],
          properties: {
            state: { type: 'string', minLength: 2 },
            lga: { type: 'string', minLength: 2 },
          },
          additionalProperties: true,
        },
        contact: { type: 'object', additionalProperties: true },
        ownerUserId: { type: 'string' },
        ownerNin: { type: 'string', pattern: '^\\d{11}$' },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      503: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.create');
  if (denied) return;

  const {
    name,
    description = null,
    registrationNumber = null,
    ownerType = null,
    foundedAt = null,
    openedAt = null,
    website = null,
    logoUrl = null,
    cacDocumentUrl = null,
    cscDocumentUrl = null,
    metadata = null,
    documents = [],
    location = null,
    contact = null,
    ownerUserId = null,
    ownerNin = null,
  } = req.body || {};
  if (ownerUserId && ownerNin) {
    return reply.code(400).send({ message: 'Provide ownerUserId or ownerNin, not both' });
  }

  const locationObject = location && typeof location === 'object' ? location : null;
  const normalizedState = locationObject?.state ? String(locationObject.state).trim() : '';
  const normalizedLga = locationObject?.lga ? String(locationObject.lga).trim() : '';
  if (!normalizedState || !normalizedLga) {
    return reply.code(400).send({ message: 'location.state and location.lga are required' });
  }

  const creatorUserId = String(req.auth.userId);
  let normalizedOwnerUserId = ownerUserId ? String(ownerUserId).trim() : null;
  const normalizedOwnerNin = ownerNin ? String(ownerNin).trim() : null;
  const resolvedOwnerIdentity = !normalizedOwnerUserId && normalizedOwnerNin
    ? await resolveUserIdentityByNin(req.headers.authorization, normalizedOwnerNin)
    : null;
  if (!normalizedOwnerUserId && resolvedOwnerIdentity?.userId) {
    normalizedOwnerUserId = resolvedOwnerIdentity.userId;
  }
  const creatorIsOwner = (!normalizedOwnerNin || normalizedOwnerUserId === creatorUserId)
    && (!normalizedOwnerUserId || normalizedOwnerUserId === creatorUserId);
  const effectiveOwnerUserId = creatorIsOwner ? creatorUserId : normalizedOwnerUserId;

  const organizationId = crypto.randomUUID();
  const doc = {
    organizationId,
    name: String(name).trim(),
    description: description ? String(description).trim() : null,
    registrationNumber: registrationNumber ? String(registrationNumber).trim() : null,
    ownerType: normalizeOwnerType(ownerType),
    foundedAt: normalizeIsoDate(foundedAt),
    openedAt: normalizeIsoDate(openedAt),
    website: website ? String(website).trim() : null,
    logoUrl: logoUrl ? String(logoUrl).trim() : null,
    cacDocumentUrl: (cacDocumentUrl || cscDocumentUrl) ? String(cacDocumentUrl || cscDocumentUrl).trim() : null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    documents: normalizeDocumentList(documents),
    location: {
      ...(locationObject || {}),
      state: normalizedState,
      lga: normalizedLga,
    },
    contact: contact && typeof contact === 'object' ? contact : null,
    createdByUserId: creatorUserId,
    ownerUserId: effectiveOwnerUserId || null,
    ownerNin: normalizedOwnerNin || null,
    approvalStatus: 'pending',
    lifecycleStatus: 'active',
    status: 'pending_approval',
    approvalReviewedByUserId: null,
    approvalReviewedAt: null,
    approvalNotes: null,
    deletionRequestedAt: null,
    deletionRequestedByUserId: null,
    deletionReason: null,
    deletedAt: null,
    deletedByUserId: null,
    hqInstitutionId: null,
    createdAt: now(),
    updatedAt: now(),
  };

  await collections.organizations().insertOne(doc);
  await collections.ownerHistory().insertOne({
    eventId: crypto.randomUUID(),
    organizationId,
    fromOwnerUserId: null,
    fromOwnerNin: null,
    toOwnerUserId: doc.ownerUserId,
    toOwnerNin: doc.ownerNin,
    changedByUserId: req.auth.userId,
    reason: 'initial_owner_assignment',
    timestamp: now(),
  });

  bootstrapOrgDefaults(req.headers.authorization, organizationId, doc.ownerUserId, creatorUserId, null);
  bootstrapInitialMembership(
    organizationId,
    creatorUserId,
    doc.ownerUserId,
    doc.ownerNin,
    doc.name,
  );

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'ORG_CREATED',
    action: 'org.create',
    resource: { type: 'organization', id: organizationId },
    permissionKey: 'org.create',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { ownerUserId: doc.ownerUserId, ownerNin: doc.ownerNin },
  });

  const advisories = [];
  if (!creatorIsOwner) {
    advisories.push({
      code: 'CREATOR_NOT_OWNER_ADD_SELF_AS_STAFF',
      message: 'You set a different owner. Add yourself as organization staff if you still need access to this organization.',
    });
  }

  return reply.code(201).send({
    organization: decorateOrganization(doc),
    advisories,
  });
});

fastify.get('/orgs', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'List organizations',
    description: 'Lists organizations visible to the caller.',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        q: { type: 'string' },
        includeDeleted: { type: 'boolean' },
        scope: { type: 'string', enum: ['affiliated', 'all'] },
        lifecycleStatus: { type: 'string', enum: ORG_LIFECYCLE_STATUSES },
        approvalStatus: { type: 'string', enum: ORG_APPROVAL_STATUSES },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.list');
  if (denied) return;
  const page = Math.max(Number(req.query?.page) || 1, 1);
  const limit = Math.min(Number(req.query?.limit) || 20, 100);
  const includeDeleted = req.query?.includeDeleted === true || req.query?.includeDeleted === 'true';
  const q = req.query?.q ? String(req.query.q).trim() : '';
  const requestedScope = String(req.query?.scope || 'affiliated').trim().toLowerCase();
  const wantsAllScope = requestedScope === 'all';
  const listAllAllowed = await canListAllOrganizations(req);
  const appliedScope = wantsAllScope && listAllAllowed ? 'all' : 'affiliated';
  const memberships = await fetchUserMembershipSummaries(req.auth.userId, req.headers.authorization);
  const visibilityFilter = appliedScope === 'all'
    ? activeOrgVisibilityFilter(includeDeleted)
    : buildVisibilityFilter({
      userId: req.auth.userId,
      superBypass: canBypassOrgVisibility(req),
      memberships,
      includeDeleted,
    });
  const filter = { ...visibilityFilter };
  if (req.query?.lifecycleStatus) {
    filter.lifecycleStatus = normalizeLifecycleStatus(req.query.lifecycleStatus);
  }
  if (req.query?.approvalStatus) {
    filter.approvalStatus = normalizeApprovalStatus(req.query.approvalStatus);
  }
  if (q) {
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { organizationId: { $regex: q, $options: 'i' } },
      { registrationNumber: { $regex: q, $options: 'i' } },
    ];
  }
  const [items, total] = await Promise.all([
    collections.organizations().find(filter).skip((page - 1) * limit).limit(limit).toArray(),
    collections.organizations().countDocuments(filter),
  ]);

  const scopeByOrg = new Map();
  for (const membership of memberships) {
    const orgId = String(membership?.organizationId || '');
    if (!orgId) continue;
    const roles = Array.isArray(membership.roles) ? membership.roles : [];
    const branches = Array.isArray(membership.branches) ? membership.branches : [];
    scopeByOrg.set(orgId, {
      level: isElevatedOrgRole(roles) ? 'organization' : (branches.length > 0 ? 'branch' : 'institution'),
      branchIds: unique(branches.map((item) => String(item?.branchId || '')).filter(Boolean)),
    });
  }

  const enrichedItems = items.map((item) => ({
    ...decorateOrganization(item),
    viewerScope: canBypassOrgVisibility(req)
      ? { level: 'organization', branchIds: [] }
      : (scopeByOrg.get(String(item.organizationId)) || { level: 'organization', branchIds: [] }),
  }));

  return reply.send({
    page,
    limit,
    total,
    scope: appliedScope,
    canListAll: listAllAllowed,
    items: enrichedItems,
  });
});

fastify.get('/orgs/deleted', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'List deleted organizations with hierarchy preview',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        scope: { type: 'string', enum: ['affiliated', 'all'] },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.list');
  if (denied) return;

  const page = Math.max(Number(req.query?.page) || 1, 1);
  const limit = Math.min(Number(req.query?.limit) || 20, 100);
  const requestedScope = String(req.query?.scope || 'affiliated').trim().toLowerCase();
  const wantsAllScope = requestedScope === 'all';
  const listAllAllowed = await canListAllOrganizations(req);
  const appliedScope = wantsAllScope && listAllAllowed ? 'all' : 'affiliated';
  const memberships = await fetchUserMembershipSummaries(req.auth.userId, req.headers.authorization);
  const visibilityFilter = appliedScope === 'all'
    ? activeOrgVisibilityFilter(true)
    : buildVisibilityFilter({
      userId: req.auth.userId,
      superBypass: canBypassOrgVisibility(req),
      memberships,
      includeDeleted: true,
    });
  const filter = {
    $and: [
      visibilityFilter,
      { lifecycleStatus: 'deleted' },
    ],
  };

  const [organizations, total] = await Promise.all([
    collections.organizations().find(filter).skip((page - 1) * limit).limit(limit).toArray(),
    collections.organizations().countDocuments(filter),
  ]);
  const orgIds = organizations.map((entry) => String(entry.organizationId)).filter(Boolean);
  const [institutions, branches] = orgIds.length > 0
    ? await Promise.all([
      collections.institutions().find({ organizationId: { $in: orgIds } }).toArray(),
      collections.branches().find({ organizationId: { $in: orgIds } }).toArray(),
    ])
    : [[], []];

  const institutionsByOrg = institutions.reduce((acc, institution) => {
    const key = String(institution.organizationId || '');
    if (!acc[key]) acc[key] = [];
    acc[key].push(institution);
    return acc;
  }, {});
  const branchesByOrg = branches.reduce((acc, branch) => {
    const key = String(branch.organizationId || '');
    if (!acc[key]) acc[key] = [];
    acc[key].push(branch);
    return acc;
  }, {});

  const items = organizations.map((organization) => ({
    ...decorateOrganization(organization),
    institutions: institutionsByOrg[String(organization.organizationId)] || [],
    branches: branchesByOrg[String(organization.organizationId)] || [],
  }));

  return reply.send({
    page,
    limit,
    total,
    scope: appliedScope,
    canListAll: listAllAllowed,
    items,
  });
});

fastify.get('/orgs/:orgId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Get organization',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: {
        orgId: { type: 'string' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const canReadOrganization = await hasAppPermission(req, 'org.read', req.params.orgId);
  const canListOrganization = canReadOrganization
    ? true
    : await hasAppPermission(req, 'org.list', req.params.orgId);
  if (!canReadOrganization && !canListOrganization) {
    reply.code(403).send({ message: 'Forbidden' });
    emitAuditEvent({
      userId: req.auth?.userId || null,
      organizationId: req.params.orgId,
      eventType: 'RBAC_ACCESS_DENIED',
      action: 'organization.permission.check',
      permissionKey: 'org.read|org.list',
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      outcome: 'failure',
      failureReason: 'PERMISSION_DENIED',
      metadata: { path: req.routeOptions?.url || req.url, method: req.method },
    });
    return;
  }
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) {
    return reply.code(404).send({ message: 'Organization not found' });
  }
  const viewerScope = await resolveViewerScope(req, req.params.orgId);
  if (!viewerScope.hasAccess) {
    return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
  }
  return reply.send({ organization: decorateOrganization(organization), viewerScope });
});

fastify.patch('/orgs/:orgId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Update organization',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: {
        orgId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2 },
        description: { type: 'string' },
        registrationNumber: { type: 'string' },
        ownerType: { type: 'string', enum: OWNER_TYPES },
        foundedAt: { type: 'string', format: 'date-time' },
        openedAt: { type: 'string', format: 'date-time' },
        website: { type: 'string' },
        logoUrl: { type: 'string' },
        cacDocumentUrl: { type: 'string' },
        cscDocumentUrl: { type: 'string', deprecated: true },
        metadata: { type: 'object', additionalProperties: true },
        documents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              documentId: { type: 'string' },
              title: { type: 'string' },
              type: { type: 'string' },
              url: { type: 'string' },
              uploadedAt: { type: 'string', format: 'date-time' },
              notes: { type: 'string' },
            },
            additionalProperties: true,
          },
        },
        location: { type: 'object', additionalProperties: true },
        contact: { type: 'object', additionalProperties: true },
        status: { type: 'string', enum: ['active', 'suspended'], deprecated: true },
        lifecycleStatus: { type: 'string', enum: ORG_LIFECYCLE_STATUSES },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.update', req.params.orgId);
  if (denied) return;
  const existingOrg = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!existingOrg) {
    return reply.code(404).send({ message: 'Organization not found' });
  }
  if (String(existingOrg.lifecycleStatus || '').toLowerCase() === 'deleted') {
    return reply.code(409).send({ message: 'Deleted organization cannot be updated. Restore first.' });
  }

  const update = { updatedAt: now() };
  if (req.body?.name) update.name = String(req.body.name).trim();
  if (req.body?.description !== undefined) update.description = req.body.description ? String(req.body.description).trim() : null;
  if (req.body?.registrationNumber !== undefined) update.registrationNumber = req.body.registrationNumber ? String(req.body.registrationNumber).trim() : null;
  if (req.body?.ownerType !== undefined) update.ownerType = normalizeOwnerType(req.body.ownerType);
  if (req.body?.foundedAt !== undefined) update.foundedAt = normalizeIsoDate(req.body.foundedAt);
  if (req.body?.openedAt !== undefined) update.openedAt = normalizeIsoDate(req.body.openedAt);
  if (req.body?.website !== undefined) update.website = req.body.website ? String(req.body.website).trim() : null;
  if (req.body?.logoUrl !== undefined) update.logoUrl = req.body.logoUrl ? String(req.body.logoUrl).trim() : null;
  if (req.body?.cacDocumentUrl !== undefined || req.body?.cscDocumentUrl !== undefined) {
    const next = req.body?.cacDocumentUrl !== undefined ? req.body.cacDocumentUrl : req.body.cscDocumentUrl;
    update.cacDocumentUrl = next ? String(next).trim() : null;
  }
  if (req.body?.metadata !== undefined) update.metadata = req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  if (req.body?.documents !== undefined) update.documents = normalizeDocumentList(req.body.documents);
  if (req.body?.location !== undefined) update.location = req.body.location;
  if (req.body?.contact !== undefined) update.contact = req.body.contact;
  if (req.body?.status) {
    update.lifecycleStatus = req.body.status === 'suspended' ? 'suspended' : 'active';
    update.status = req.body.status;
  }
  if (req.body?.lifecycleStatus) {
    const normalizedLifecycle = normalizeLifecycleStatus(req.body.lifecycleStatus);
    if (normalizedLifecycle) {
      update.lifecycleStatus = normalizedLifecycle;
      update.status = normalizedLifecycle === 'suspended' ? 'suspended' : (normalizedLifecycle === 'active' ? 'active' : normalizedLifecycle);
    }
  }

  const result = await collections.organizations().findOneAndUpdate(
    { organizationId: req.params.orgId },
    { $set: update },
    { returnDocument: 'after' }
  );
  const updatedOrganization = unwrapFindOneAndUpdateResult(result);
  if (!updatedOrganization) return reply.code(404).send({ message: 'Organization not found' });

  const previousLifecycle = String(existingOrg.lifecycleStatus || 'active').toLowerCase();
  const nextLifecycle = String(updatedOrganization.lifecycleStatus || 'active').toLowerCase();
  if (previousLifecycle !== nextLifecycle) {
    if (nextLifecycle === 'suspended') {
      await cascadeOrganizationState(req.params.orgId, 'suspend');
    } else if (nextLifecycle === 'active' && String(updatedOrganization.approvalStatus || '').toLowerCase() === 'approved') {
      await cascadeOrganizationState(req.params.orgId, 'resume');
    }
  }

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_UPDATED',
    action: 'org.update',
    resource: { type: 'organization', id: req.params.orgId },
    permissionKey: 'org.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { fields: Object.keys(req.body || {}) },
  });

  return reply.send({ organization: decorateOrganization(updatedOrganization) });
});

fastify.post('/orgs/:orgId/approval', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Review organization approval state',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: {
        orgId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      required: ['decision'],
      properties: {
        decision: { type: 'string', enum: ['approve', 'decline', 'revoke'] },
        notes: { type: 'string' },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.update', req.params.orgId);
  if (denied) return;
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) return reply.code(404).send({ message: 'Organization not found' });
  if (String(organization.lifecycleStatus || '').toLowerCase() === 'deleted') {
    return reply.code(409).send({ message: 'Deleted organization cannot be reviewed; restore first.' });
  }

  const decision = String(req.body?.decision || '').trim().toLowerCase();
  const notes = req.body?.notes ? String(req.body.notes).trim() : null;
  const update = {
    approvalReviewedByUserId: req.auth.userId,
    approvalReviewedAt: now(),
    approvalNotes: notes,
    updatedAt: now(),
  };

  if (decision === 'approve') {
    update.approvalStatus = 'approved';
    if (String(organization.lifecycleStatus || '').toLowerCase() !== 'delete_pending') {
      update.lifecycleStatus = 'active';
      update.status = 'active';
    }
    if (String(organization.approvalStatus || '').toLowerCase() === 'revoked') {
      await cascadeOrganizationState(req.params.orgId, 'resume');
    }
  } else if (decision === 'decline') {
    update.approvalStatus = 'declined';
    update.status = 'declined';
    if (!organization.lifecycleStatus || String(organization.lifecycleStatus).toLowerCase() === 'active') {
      update.lifecycleStatus = 'suspended';
    }
    await cascadeOrganizationState(req.params.orgId, 'suspend');
  } else if (decision === 'revoke') {
    update.approvalStatus = 'revoked';
    update.lifecycleStatus = 'suspended';
    update.status = 'suspended';
    await cascadeOrganizationState(req.params.orgId, 'suspend');
  } else {
    return reply.code(400).send({ message: 'Invalid decision' });
  }

  const result = await collections.organizations().findOneAndUpdate(
    { organizationId: req.params.orgId },
    { $set: update },
    { returnDocument: 'after' },
  );
  const updatedOrganization = unwrapFindOneAndUpdateResult(result);

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_APPROVAL_REVIEWED',
    action: 'org.approval.review',
    resource: { type: 'organization', id: req.params.orgId },
    permissionKey: 'org.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { decision, notes },
  });

  const organizationName = String(updatedOrganization?.name || organization?.name || req.params.orgId);
  const approvalMessages = {
    approve: `${organizationName} has been approved and is now active.`,
    decline: `${organizationName} approval was declined.`,
    revoke: `${organizationName} approval was revoked.`,
  };
  emitNotificationEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_APPROVAL_STATUS_CHANGED',
    action: 'org.approval.review',
    resource: { type: 'organization', id: req.params.orgId },
    title: 'Organization Approval Update',
    message: approvalMessages[decision] || `${organizationName} approval status changed.`,
    targets: collectNotificationTargets(updatedOrganization || organization),
    metadata: { decision, notes },
  }, req);

  return reply.send({ organization: decorateOrganization(updatedOrganization) });
});

fastify.post('/orgs/:orgId/deletion/request', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Request organization deletion',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.update', req.params.orgId);
  if (denied) return;
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) return reply.code(404).send({ message: 'Organization not found' });
  if (String(organization.lifecycleStatus || '').toLowerCase() === 'deleted') {
    return reply.code(409).send({ message: 'Organization already deleted' });
  }

  const update = {
    lifecycleStatus: 'delete_pending',
    status: 'delete_pending',
    lifecycleStatusBeforeDeleteRequest: String(organization.lifecycleStatus || 'active').toLowerCase(),
    deletionRequestedAt: now(),
    deletionRequestedByUserId: req.auth.userId,
    deletionReason: req.body?.reason ? String(req.body.reason).trim() : null,
    updatedAt: now(),
  };
  const result = await collections.organizations().findOneAndUpdate(
    { organizationId: req.params.orgId },
    { $set: update },
    { returnDocument: 'after' },
  );
  const updatedOrganization = unwrapFindOneAndUpdateResult(result);

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_DELETION_REQUESTED',
    action: 'org.deletion.request',
    resource: { type: 'organization', id: req.params.orgId },
    permissionKey: 'org.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { reason: update.deletionReason },
  });

  return reply.send({ organization: decorateOrganization(updatedOrganization) });
});

fastify.post('/orgs/:orgId/deletion/review', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Approve or decline organization deletion request',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['decision'],
      properties: {
        decision: { type: 'string', enum: ['approve', 'decline'] },
        notes: { type: 'string' },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.update', req.params.orgId);
  if (denied) return;
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) return reply.code(404).send({ message: 'Organization not found' });
  if (String(organization.lifecycleStatus || '').toLowerCase() !== 'delete_pending') {
    return reply.code(409).send({ message: 'Organization deletion is not pending review' });
  }

  const decision = String(req.body?.decision || '').trim().toLowerCase();
  const reviewNotes = req.body?.notes ? String(req.body.notes).trim() : null;
  const update = {
    updatedAt: now(),
    approvalReviewedByUserId: req.auth.userId,
    approvalReviewedAt: now(),
    approvalNotes: reviewNotes,
  };

  if (decision === 'approve') {
    update.lifecycleStatus = 'deleted';
    update.status = 'deleted';
    update.deletedAt = now();
    update.deletedByUserId = req.auth.userId;
    await cascadeOrganizationState(req.params.orgId, 'delete');
  } else if (decision === 'decline') {
    const previousLifecycle = normalizeLifecycleStatus(organization.lifecycleStatusBeforeDeleteRequest)
      || (isOrganizationApproved(organization) ? 'active' : 'suspended');
    update.lifecycleStatus = previousLifecycle;
    update.status = previousLifecycle === 'suspended'
      ? 'suspended'
      : (isOrganizationApproved(organization) ? 'active' : 'pending_approval');
    update.deletionRequestedAt = null;
    update.deletionRequestedByUserId = null;
    update.deletionReason = null;
    update.lifecycleStatusBeforeDeleteRequest = null;
  } else {
    return reply.code(400).send({ message: 'Invalid decision' });
  }

  const result = await collections.organizations().findOneAndUpdate(
    { organizationId: req.params.orgId },
    { $set: update },
    { returnDocument: 'after' },
  );
  const updatedOrganization = unwrapFindOneAndUpdateResult(result);

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_DELETION_REVIEWED',
    action: 'org.deletion.review',
    resource: { type: 'organization', id: req.params.orgId },
    permissionKey: 'org.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { decision, notes: reviewNotes },
  });

  const organizationName = String(updatedOrganization?.name || organization?.name || req.params.orgId);
  const deletionMessages = {
    approve: `${organizationName} was deleted after review.`,
    decline: `${organizationName} deletion request was declined.`,
  };
  emitNotificationEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_DELETION_STATUS_CHANGED',
    action: 'org.deletion.review',
    resource: { type: 'organization', id: req.params.orgId },
    title: 'Organization Deletion Update',
    message: deletionMessages[decision] || `${organizationName} deletion status changed.`,
    targets: collectNotificationTargets(updatedOrganization || organization),
    metadata: { decision, notes: reviewNotes },
  }, req);

  return reply.send({ organization: decorateOrganization(updatedOrganization) });
});

fastify.post('/orgs/:orgId/restore', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Restore deleted organization with staff and hierarchy',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.update', req.params.orgId);
  if (denied) return;
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) return reply.code(404).send({ message: 'Organization not found' });
  if (String(organization.lifecycleStatus || '').toLowerCase() !== 'deleted') {
    return reply.code(409).send({ message: 'Only deleted organizations can be restored' });
  }

  await cascadeOrganizationState(req.params.orgId, 'restore');
  const update = {
    lifecycleStatus: 'active',
    status: 'active',
    approvalStatus: 'approved',
    deletedAt: null,
    deletedByUserId: null,
    deletionRequestedAt: null,
    deletionRequestedByUserId: null,
    deletionReason: null,
    lifecycleStatusBeforeDeleteRequest: null,
    updatedAt: now(),
  };
  const result = await collections.organizations().findOneAndUpdate(
    { organizationId: req.params.orgId },
    { $set: update },
    { returnDocument: 'after' },
  );
  const updatedOrganization = unwrapFindOneAndUpdateResult(result);

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_RESTORED',
    action: 'org.restore',
    resource: { type: 'organization', id: req.params.orgId },
    permissionKey: 'org.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { reason: req.body?.reason ? String(req.body.reason).trim() : null },
  });

  return reply.send({ organization: decorateOrganization(updatedOrganization) });
});

fastify.post('/orgs/:orgId/files/upload', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Upload organization logo or CAC document via file-document-service',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: {
        orgId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      required: ['kind', 'upload'],
      properties: {
        kind: { type: 'string', enum: ['logo', 'cac'] },
        upload: {
          type: 'object',
          required: ['contentType', 'contentBase64'],
          properties: {
            filename: { type: 'string' },
            contentType: { type: 'string' },
            contentBase64: { type: 'string' },
          },
        },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
      502: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.update', req.params.orgId);
  if (denied) return;
  const existing = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!existing) return reply.code(404).send({ message: 'Organization not found' });
  if (String(existing.lifecycleStatus || '').toLowerCase() === 'deleted') {
    return reply.code(409).send({ message: 'Cannot upload files for deleted organization' });
  }

  const kind = String(req.body?.kind || '').trim().toLowerCase();
  const allowlist = kind === 'logo' ? LOGO_CONTENT_TYPES : kind === 'cac' ? CAC_CONTENT_TYPES : null;
  if (!allowlist) {
    return reply.code(400).send({ message: 'kind must be logo or cac' });
  }

  const uploaded = await uploadOrgFileViaFileService(req.body.upload, allowlist);
  if (uploaded.error) {
    return reply.code(400).send({ message: uploaded.error });
  }

  const patch = {
    updatedAt: now(),
    ...(kind === 'logo' ? { logoUrl: uploaded.url } : { cacDocumentUrl: uploaded.url }),
  };
  const result = await collections.organizations().findOneAndUpdate(
    { organizationId: req.params.orgId },
    { $set: patch },
    { returnDocument: 'after' },
  );
  const organization = unwrapFindOneAndUpdateResult(result);
  return reply.send({
    message: 'File uploaded successfully',
    kind,
    url: uploaded.url,
    organization,
    file: uploaded.metadata || null,
  });
});

fastify.patch('/orgs/:orgId/owner', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Change organization owner',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: {
        orgId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      properties: {
        ownerUserId: { type: 'string' },
        ownerNin: { type: 'string', pattern: '^\\d{11}$' },
        reason: { type: 'string' },
      },
      oneOf: [
        { required: ['ownerUserId'] },
        { required: ['ownerNin'] },
      ],
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.owner.assign', req.params.orgId);
  if (denied) return;

  const existing = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!existing) {
    return reply.code(404).send({ message: 'Organization not found' });
  }

  const { ownerUserId = null, ownerNin = null, reason = null } = req.body || {};
  const update = {
    ownerUserId: ownerUserId ? String(ownerUserId) : null,
    ownerNin: ownerNin ? String(ownerNin) : null,
    updatedAt: now(),
  };

  await collections.organizations().updateOne(
    { organizationId: req.params.orgId },
    { $set: update }
  );

  await collections.ownerHistory().insertOne({
    eventId: crypto.randomUUID(),
    organizationId: req.params.orgId,
    fromOwnerUserId: existing.ownerUserId || null,
    fromOwnerNin: existing.ownerNin || null,
    toOwnerUserId: update.ownerUserId,
    toOwnerNin: update.ownerNin,
    changedByUserId: req.auth.userId,
    reason: reason || 'manual_owner_change',
    timestamp: now(),
  });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_OWNER_CHANGED',
    action: 'org.owner.assign',
    resource: { type: 'organization', id: req.params.orgId },
    permissionKey: 'org.owner.assign',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { fromOwnerUserId: existing.ownerUserId || null, toOwnerUserId: update.ownerUserId || null, toOwnerNin: update.ownerNin || null },
  });

  bootstrapOrgDefaults(
    req.headers.authorization,
    req.params.orgId,
    update.ownerUserId,
    existing.createdByUserId || null,
    existing.ownerUserId || null,
  );

  return reply.send({ message: 'Owner updated' });
});

fastify.post('/orgs/:orgId/assign-owner', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Assign organization owner by NIN',
    description: 'Assigns owner using ownerNin and records owner history.',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['ownerNin'],
      properties: {
        ownerNin: { type: 'string', pattern: '^\\d{11}$' },
        reason: { type: 'string' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.owner.assign', req.params.orgId);
  if (denied) return;
  const existing = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!existing) return reply.code(404).send({ message: 'Organization not found' });

  const ownerNin = String(req.body.ownerNin);
  const resolvedOwnerIdentity = await resolveUserIdentityByNin(req.headers.authorization, ownerNin);
  const resolvedOwnerUserId = resolvedOwnerIdentity?.userId || null;
  await collections.organizations().updateOne(
    { organizationId: req.params.orgId },
    { $set: { ownerNin, ownerUserId: resolvedOwnerUserId, updatedAt: now() } }
  );
  await collections.ownerHistory().insertOne({
    eventId: crypto.randomUUID(),
    organizationId: req.params.orgId,
    fromOwnerUserId: existing.ownerUserId || null,
    fromOwnerNin: existing.ownerNin || null,
    toOwnerUserId: resolvedOwnerUserId,
    toOwnerNin: ownerNin,
    changedByUserId: req.auth.userId,
    reason: req.body.reason || 'assign_owner_by_nin',
    timestamp: now(),
  });
  bootstrapOrgDefaults(
    req.headers.authorization,
    req.params.orgId,
    resolvedOwnerUserId,
    existing.createdByUserId || null,
    existing.ownerUserId || null,
  );
  bootstrapInitialMembership(req.params.orgId, null, resolvedOwnerUserId, ownerNin, existing.name || null);
  return reply.send({ message: 'Owner assigned' });
});

fastify.get('/orgs/search', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Search organizations',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        status: { type: 'string' },
        lifecycleStatus: { type: 'string', enum: ORG_LIFECYCLE_STATUSES },
        approvalStatus: { type: 'string', enum: ORG_APPROVAL_STATUSES },
        state: { type: 'string' },
        lga: { type: 'string' },
        includeDeleted: { type: 'boolean' },
        scope: { type: 'string', enum: ['affiliated', 'all'] },
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.list');
  if (denied) return;

  const {
    q,
    status,
    lifecycleStatus,
    approvalStatus,
    state,
    lga,
    includeDeleted = false,
    scope = 'affiliated',
    page = 1,
    limit = 20,
  } = req.query || {};
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const safePage = Math.max(Number(page) || 1, 1);

  const filter = {};
  if (status) filter.status = status;
  if (lifecycleStatus) filter.lifecycleStatus = normalizeLifecycleStatus(lifecycleStatus);
  if (approvalStatus) filter.approvalStatus = normalizeApprovalStatus(approvalStatus);
  if (state) filter['location.state'] = String(state).trim();
  if (lga) filter['location.lga'] = String(lga).trim();
  if (q) {
    filter.$or = [
      { name: { $regex: String(q), $options: 'i' } },
      { organizationId: { $regex: String(q), $options: 'i' } },
      { registrationNumber: { $regex: String(q), $options: 'i' } },
    ];
  }

  const memberships = await fetchUserMembershipSummaries(req.auth.userId, req.headers.authorization);
  const requestedScope = String(scope || 'affiliated').trim().toLowerCase();
  const wantsAllScope = requestedScope === 'all';
  const listAllAllowed = await canListAllOrganizations(req);
  const appliedScope = wantsAllScope && listAllAllowed ? 'all' : 'affiliated';
  const visibilityFilter = appliedScope === 'all'
    ? activeOrgVisibilityFilter(includeDeleted === true || includeDeleted === 'true')
    : buildVisibilityFilter({
      userId: req.auth.userId,
      superBypass: canBypassOrgVisibility(req),
      memberships,
      includeDeleted: includeDeleted === true || includeDeleted === 'true',
    });
  const combinedFilter = Object.keys(visibilityFilter).length === 0 ? filter : { $and: [filter, visibilityFilter] };

  const [items, total] = await Promise.all([
    collections.organizations().find(combinedFilter).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
    collections.organizations().countDocuments(combinedFilter),
  ]);

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'ORG_SEARCHED',
    action: 'org.search',
    permissionKey: 'org.list',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { page: safePage, limit: safeLimit, hasQ: !!q },
  });

  return reply.send({
    page: safePage,
    limit: safeLimit,
    total,
    scope: appliedScope,
    canListAll: listAllAllowed,
    items: items.map((entry) => decorateOrganization(entry)),
  });
});

fastify.get('/public/organizations', {
  schema: {
    tags: ['Organization'],
    summary: 'Public organization directory search',
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        state: { type: 'string' },
        lga: { type: 'string' },
        institutionType: { type: 'string' },
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      503: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const safePage = Math.max(Number(req.query?.page) || 1, 1);
  const safeLimit = Math.min(Number(req.query?.limit) || 20, 100);

  const filter = {
    approvalStatus: 'approved',
    lifecycleStatus: 'active',
  };

  const searchRegex = normalizeSearchRegex(req.query?.q);
  if (searchRegex) {
    filter.$or = [
      { name: searchRegex },
      { organizationId: searchRegex },
      { registrationNumber: searchRegex },
    ];
  }
  if (req.query?.state) filter['location.state'] = String(req.query.state).trim();
  if (req.query?.lga) filter['location.lga'] = String(req.query.lga).trim();

  const normalizedInstitutionType = normalizeInstitutionType(req.query?.institutionType, null);
  if (req.query?.institutionType && !normalizedInstitutionType) {
    return reply.code(400).send({ message: 'Invalid institutionType' });
  }

  if (normalizedInstitutionType) {
    const matchingOrgIds = await collections.institutions().distinct('organizationId', {
      type: normalizedInstitutionType,
      status: { $ne: 'deleted' },
    });
    if (matchingOrgIds.length === 0) {
      return reply.send({ page: safePage, limit: safeLimit, total: 0, items: [] });
    }
    filter.organizationId = { $in: matchingOrgIds.map((entry) => String(entry || '').trim()).filter(Boolean) };
  }

  const [organizations, total] = await Promise.all([
    collections.organizations()
      .find(filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .toArray(),
    collections.organizations().countDocuments(filter),
  ]);

  const orgIds = organizations.map((entry) => String(entry.organizationId || '')).filter(Boolean);
  const institutionFilter = {
    organizationId: { $in: orgIds },
    status: { $ne: 'deleted' },
    ...(normalizedInstitutionType ? { type: normalizedInstitutionType } : {}),
  };
  const institutions = orgIds.length > 0
    ? await collections.institutions().find(institutionFilter).toArray()
    : [];
  const institutionsByOrg = institutions.reduce((acc, institution) => {
    const orgId = String(institution.organizationId || '');
    if (!orgId) return acc;
    if (!acc[orgId]) acc[orgId] = [];
    acc[orgId].push({
      institutionId: institution.institutionId,
      name: institution.name,
      type: institution.type,
      status: institution.status,
      state: institution?.location?.state || null,
      lga: institution?.location?.lga || null,
    });
    return acc;
  }, {});

  const items = organizations.map((organization) => {
    const orgMetadata = organization?.metadata && typeof organization.metadata === 'object' ? organization.metadata : {};
    const listedInstitutions = institutionsByOrg[String(organization.organizationId)] || [];
    return {
      ...decorateOrganization(organization),
      publicInfo: orgMetadata.publicInfo || orgMetadata.announcement || orgMetadata.announcements || null,
      openingHours: orgMetadata.openingHours || null,
      institutionsCount: listedInstitutions.length,
      institutions: listedInstitutions.slice(0, 6),
    };
  });

  return reply.send({
    page: safePage,
    limit: safeLimit,
    total,
    items,
  });
});

fastify.get('/public/organizations/:orgId', {
  schema: {
    tags: ['Organization'],
    summary: 'Public organization profile',
    params: {
      type: 'object',
      required: ['orgId'],
      properties: {
        orgId: { type: 'string' },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const organization = await collections.organizations().findOne({
    organizationId: req.params.orgId,
    approvalStatus: 'approved',
    lifecycleStatus: 'active',
  });
  if (!organization) {
    return reply.code(404).send({ message: 'Organization not found' });
  }

  const [institutions, branches] = await Promise.all([
    collections.institutions().find({
      organizationId: req.params.orgId,
      status: { $ne: 'deleted' },
    }).toArray(),
    collections.branches().find({
      organizationId: req.params.orgId,
      status: { $ne: 'deleted' },
    }).toArray(),
  ]);

  const metadata = organization?.metadata && typeof organization.metadata === 'object' ? organization.metadata : {};
  return reply.send({
    organization: {
      ...decorateOrganization(organization),
      publicInfo: metadata.publicInfo || metadata.announcement || metadata.announcements || null,
      openingHours: metadata.openingHours || null,
    },
    institutions,
    branches,
  });
});

fastify.get('/institutions', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'List institutions across accessible scope',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
      properties: {
        orgId: { type: 'string' },
        q: { type: 'string' },
        status: { type: 'string' },
        type: { type: 'string' },
        state: { type: 'string' },
        lga: { type: 'string' },
        includeDeleted: { type: 'boolean' },
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.list');
  if (denied) return;

  const safePage = Math.max(Number(req.query?.page) || 1, 1);
  const safeLimit = Math.min(Number(req.query?.limit) || 20, 100);
  const includeDeleted = req.query?.includeDeleted === true || req.query?.includeDeleted === 'true';
  const andClauses = [];

  const baseFilter = {};
  if (req.query?.status) baseFilter.status = String(req.query.status).trim();
  if (!req.query?.status && !includeDeleted) baseFilter.status = { $ne: 'deleted' };
  if (req.query?.type) {
    const normalizedType = normalizeInstitutionType(req.query.type, null);
    if (normalizedType) baseFilter.type = normalizedType;
  }
  if (req.query?.state) baseFilter['location.state'] = String(req.query.state).trim();
  if (req.query?.lga) baseFilter['location.lga'] = String(req.query.lga).trim();
  if (Object.keys(baseFilter).length > 0) andClauses.push(baseFilter);

  const searchRegex = normalizeSearchRegex(req.query?.q);
  if (searchRegex) {
    andClauses.push({
      $or: [
        { name: searchRegex },
        { code: searchRegex },
        { institutionId: searchRegex },
        { organizationId: searchRegex },
      ],
    });
  }

  const selectedOrgId = String(req.query?.orgId || '').trim();
  if (selectedOrgId) {
    const viewerScope = await resolveViewerScope(req, selectedOrgId);
    if (!viewerScope.hasAccess) {
      return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
    }
    const accessibleInstitutionIds = await resolveAccessibleInstitutionIds(selectedOrgId, viewerScope);
    const scopeClause = {
      organizationId: selectedOrgId,
      ...(Array.isArray(accessibleInstitutionIds) ? { institutionId: { $in: accessibleInstitutionIds } } : {}),
    };
    andClauses.push(scopeClause);
  } else {
    const crossScope = await resolveCrossOrgScope(req);
    if (!crossScope.global) {
      const scopeClauses = [];
      for (const [orgId, scope] of crossScope.byOrg.entries()) {
        if (scope.all) {
          scopeClauses.push({ organizationId: orgId });
          continue;
        }
        if (scope.institutionIds.size > 0) {
          scopeClauses.push({
            organizationId: orgId,
            institutionId: { $in: Array.from(scope.institutionIds) },
          });
        }
      }
      if (scopeClauses.length === 0) {
        return reply.send({ page: safePage, limit: safeLimit, total: 0, items: [] });
      }
      andClauses.push({ $or: scopeClauses });
    }
  }

  const filter = andClauses.length === 0 ? {} : andClauses.length === 1 ? andClauses[0] : { $and: andClauses };
  const [items, total] = await Promise.all([
    collections.institutions().find(filter).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
    collections.institutions().countDocuments(filter),
  ]);

  const organizationIds = Array.from(new Set(items.map((item) => String(item.organizationId || '')).filter(Boolean)));
  const organizations = organizationIds.length > 0
    ? await collections.organizations().find({ organizationId: { $in: organizationIds } }).project({ organizationId: 1, name: 1 }).toArray()
    : [];
  const organizationNameById = organizations.reduce((acc, item) => {
    acc[String(item.organizationId)] = String(item.name || item.organizationId);
    return acc;
  }, {});

  const enrichedItems = items.map((item) => ({
    ...item,
    organizationName: organizationNameById[String(item.organizationId)] || null,
  }));

  return reply.send({ page: safePage, limit: safeLimit, total, items: enrichedItems });
});

fastify.get('/institutions/:institutionId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Get institution by id',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['institutionId'],
      properties: { institutionId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const institution = await collections.institutions().findOne({ institutionId: req.params.institutionId });
  if (!institution) return reply.code(404).send({ message: 'Institution not found' });
  if (String(institution.status || '').toLowerCase() === 'deleted') {
    return reply.code(404).send({ message: 'Institution not found' });
  }

  const denied = await enforcePermission(req, reply, 'org.read', institution.organizationId);
  if (denied) return;
  const viewerScope = await resolveViewerScope(req, institution.organizationId);
  if (!viewerScope.hasAccess) {
    return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
  }
  const accessibleInstitutionIds = await resolveAccessibleInstitutionIds(institution.organizationId, viewerScope);
  if (Array.isArray(accessibleInstitutionIds) && !accessibleInstitutionIds.includes(institution.institutionId)) {
    return reply.code(403).send({ message: 'Go to your assigned institution or branch scope to continue.' });
  }

  const organization = await collections.organizations().findOne(
    { organizationId: institution.organizationId },
    { projection: { name: 1 } },
  );

  return reply.send({
    institution: {
      ...institution,
      organizationName: organization?.name || null,
    },
    viewerScope,
  });
});

fastify.get('/branches', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'List branches across accessible scope',
    security: [{ bearerAuth: [] }],
    querystring: {
      type: 'object',
      properties: {
        orgId: { type: 'string' },
        institutionId: { type: 'string' },
        q: { type: 'string' },
        status: { type: 'string' },
        type: { type: 'string' },
        capability: { type: 'string' },
        state: { type: 'string' },
        lga: { type: 'string' },
        includeDeleted: { type: 'boolean' },
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.list');
  if (denied) return;

  const safePage = Math.max(Number(req.query?.page) || 1, 1);
  const safeLimit = Math.min(Number(req.query?.limit) || 20, 100);
  const includeDeleted = req.query?.includeDeleted === true || req.query?.includeDeleted === 'true';
  const andClauses = [];

  const baseFilter = {};
  if (req.query?.status) baseFilter.status = String(req.query.status).trim();
  if (!req.query?.status && !includeDeleted) baseFilter.status = { $ne: 'deleted' };
  if (req.query?.type) baseFilter.type = String(req.query.type).trim().toLowerCase();
  if (req.query?.capability) baseFilter.capabilities = String(req.query.capability).trim().toLowerCase();
  if (req.query?.state) baseFilter['location.state'] = String(req.query.state).trim();
  if (req.query?.lga) baseFilter['location.lga'] = String(req.query.lga).trim();
  if (req.query?.institutionId) baseFilter.institutionId = String(req.query.institutionId).trim();
  if (Object.keys(baseFilter).length > 0) andClauses.push(baseFilter);

  const searchRegex = normalizeSearchRegex(req.query?.q);
  if (searchRegex) {
    andClauses.push({
      $or: [
        { name: searchRegex },
        { code: searchRegex },
        { branchId: searchRegex },
        { organizationId: searchRegex },
      ],
    });
  }

  const selectedOrgId = String(req.query?.orgId || '').trim();
  if (selectedOrgId) {
    const viewerScope = await resolveViewerScope(req, selectedOrgId);
    if (!viewerScope.hasAccess) {
      return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
    }

    const scopeClause = { organizationId: selectedOrgId };
    if (viewerScope.level === 'branch' && Array.isArray(viewerScope.branchIds) && viewerScope.branchIds.length > 0) {
      scopeClause.branchId = { $in: viewerScope.branchIds };
    } else {
      const accessibleInstitutionIds = await resolveAccessibleInstitutionIds(selectedOrgId, viewerScope);
      if (Array.isArray(accessibleInstitutionIds)) {
        scopeClause.institutionId = { $in: accessibleInstitutionIds };
      }
    }
    andClauses.push(scopeClause);
  } else {
    const crossScope = await resolveCrossOrgScope(req);
    if (!crossScope.global) {
      const scopeClauses = [];
      for (const [orgId, scope] of crossScope.byOrg.entries()) {
        if (scope.all) {
          scopeClauses.push({ organizationId: orgId });
          continue;
        }
        if (scope.branchIds.size > 0) {
          scopeClauses.push({
            organizationId: orgId,
            branchId: { $in: Array.from(scope.branchIds) },
          });
        }
      }
      if (scopeClauses.length === 0) {
        return reply.send({ page: safePage, limit: safeLimit, total: 0, items: [] });
      }
      andClauses.push({ $or: scopeClauses });
    }
  }

  const filter = andClauses.length === 0 ? {} : andClauses.length === 1 ? andClauses[0] : { $and: andClauses };
  const [items, total] = await Promise.all([
    collections.branches().find(filter).skip((safePage - 1) * safeLimit).limit(safeLimit).toArray(),
    collections.branches().countDocuments(filter),
  ]);

  const organizationIds = Array.from(new Set(items.map((item) => String(item.organizationId || '')).filter(Boolean)));
  const institutionIds = Array.from(new Set(items.map((item) => String(item.institutionId || '')).filter(Boolean)));
  const [organizations, institutions] = await Promise.all([
    organizationIds.length > 0
      ? collections.organizations().find({ organizationId: { $in: organizationIds } }).project({ organizationId: 1, name: 1 }).toArray()
      : Promise.resolve([]),
    institutionIds.length > 0
      ? collections.institutions().find({ institutionId: { $in: institutionIds } }).project({ institutionId: 1, name: 1 }).toArray()
      : Promise.resolve([]),
  ]);

  const organizationNameById = organizations.reduce((acc, item) => {
    acc[String(item.organizationId)] = String(item.name || item.organizationId);
    return acc;
  }, {});
  const institutionNameById = institutions.reduce((acc, item) => {
    acc[String(item.institutionId)] = String(item.name || item.institutionId);
    return acc;
  }, {});

  const enrichedItems = items.map((item) => ({
    ...item,
    organizationName: organizationNameById[String(item.organizationId)] || null,
    institutionName: institutionNameById[String(item.institutionId)] || null,
  }));

  return reply.send({ page: safePage, limit: safeLimit, total, items: enrichedItems });
});

fastify.get('/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Get branch by id',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['branchId'],
      properties: { branchId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const branch = await collections.branches().findOne({ branchId: req.params.branchId });
  if (!branch) return reply.code(404).send({ message: 'Branch not found' });
  if (String(branch.status || '').toLowerCase() === 'deleted') {
    return reply.code(404).send({ message: 'Branch not found' });
  }

  const denied = await enforcePermission(req, reply, 'org.read', branch.organizationId);
  if (denied) return;
  const viewerScope = await resolveViewerScope(req, branch.organizationId);
  if (!viewerScope.hasAccess) {
    return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
  }
  if (viewerScope.level === 'branch' && Array.isArray(viewerScope.branchIds) && viewerScope.branchIds.length > 0) {
    if (!viewerScope.branchIds.includes(branch.branchId)) {
      return reply.code(403).send({ message: 'Go to your assigned branch scope to continue.' });
    }
  } else {
    const accessibleInstitutionIds = await resolveAccessibleInstitutionIds(branch.organizationId, viewerScope);
    if (Array.isArray(accessibleInstitutionIds) && !accessibleInstitutionIds.includes(branch.institutionId)) {
      return reply.code(403).send({ message: 'Go to your assigned institution or branch scope to continue.' });
    }
  }

  const [organization, institution] = await Promise.all([
    collections.organizations().findOne(
      { organizationId: branch.organizationId },
      { projection: { name: 1 } },
    ),
    collections.institutions().findOne(
      { institutionId: branch.institutionId },
      { projection: { name: 1 } },
    ),
  ]);

  return reply.send({
    branch: {
      ...branch,
      organizationName: organization?.name || null,
      institutionName: institution?.name || null,
    },
    viewerScope,
  });
});

fastify.post('/orgs/:orgId/institutions', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Create institution under organization',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string' },
        type: { type: 'string', enum: INSTITUTION_TYPES },
        description: { type: 'string' },
        address: { type: 'object', additionalProperties: true },
        location: { type: 'object', additionalProperties: true },
        contact: { type: 'object', additionalProperties: true },
        documents: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              documentId: { type: 'string' },
              title: { type: 'string' },
              type: { type: 'string' },
              url: { type: 'string' },
              uploadedAt: { type: 'string', format: 'date-time' },
              notes: { type: 'string' },
            },
          },
        },
        metadata: { type: 'object', additionalProperties: true },
        status: { type: 'string', enum: INSTITUTION_STATUSES.filter((entry) => entry !== 'deleted') },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.create', req.params.orgId);
  if (denied) return;

  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) {
    return reply.code(404).send({ message: 'Organization not found' });
  }
  const canMutate = canMutateOrgHierarchy(organization);
  if (!canMutate.ok) {
    return reply.code(canMutate.code || 409).send({ message: canMutate.reason });
  }

  const institutionId = crypto.randomUUID();
  const body = req.body || {};
  const institution = {
    institutionId,
    organizationId: req.params.orgId,
    name: String(body.name || '').trim(),
    code: normalizeInstitutionCode(body.code, body.name),
    type: normalizeInstitutionType(body.type, 'hospital') || 'hospital',
    description: body.description ? String(body.description).trim() : null,
    address: body.address && typeof body.address === 'object' ? body.address : null,
    location: body.location && typeof body.location === 'object' ? body.location : null,
    contact: body.contact && typeof body.contact === 'object' ? body.contact : null,
    documents: normalizeDocumentList(body.documents),
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    status: INSTITUTION_STATUSES.includes(String(body.status || '').trim().toLowerCase())
      ? String(body.status).trim().toLowerCase()
      : 'active',
    isHeadquarters: true,
    createdByUserId: req.auth.userId,
    createdAt: now(),
    updatedAt: now(),
  };

  try {
    await collections.institutions().insertOne(institution);
  } catch (err) {
    if (err?.code === 11000) {
      return reply.code(400).send({ message: 'Institution code already exists in this organization' });
    }
    throw err;
  }

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_INSTITUTION_CREATED',
    action: 'org.institution.create',
    resource: { type: 'institution', id: institutionId },
    permissionKey: 'org.branch.create',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { institutionType: institution.type, code: institution.code },
  });

  return reply.code(201).send({ institution });
});

fastify.get('/orgs/:orgId/institutions', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'List institutions in organization',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.read', req.params.orgId);
  if (denied) return;

  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) {
    return reply.code(404).send({ message: 'Organization not found' });
  }

  const viewerScope = await resolveViewerScope(req, req.params.orgId);
  if (!viewerScope.hasAccess) {
    return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
  }
  const accessibleInstitutionIds = await resolveAccessibleInstitutionIds(req.params.orgId, viewerScope);
  const filter = {
    organizationId: req.params.orgId,
    status: { $ne: 'deleted' },
    ...(Array.isArray(accessibleInstitutionIds) ? { institutionId: { $in: accessibleInstitutionIds } } : {}),
  };
  const items = await collections.institutions().find(filter).toArray();
  return reply.send({ items, viewerScope });
});

fastify.get('/orgs/:orgId/institutions/:institutionId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Get institution',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'institutionId'],
      properties: { orgId: { type: 'string' }, institutionId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.read', req.params.orgId);
  if (denied) return;

  const viewerScope = await resolveViewerScope(req, req.params.orgId);
  if (!viewerScope.hasAccess) {
    return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
  }
  const accessibleInstitutionIds = await resolveAccessibleInstitutionIds(req.params.orgId, viewerScope);
  if (Array.isArray(accessibleInstitutionIds) && !accessibleInstitutionIds.includes(req.params.institutionId)) {
    return reply.code(403).send({ message: 'Go to your assigned branch or institution scope to continue.' });
  }

  const institution = await collections.institutions().findOne({
    organizationId: req.params.orgId,
    institutionId: req.params.institutionId,
  });
  if (!institution) return reply.code(404).send({ message: 'Institution not found' });
  if (String(institution.status || '').toLowerCase() === 'deleted') {
    return reply.code(404).send({ message: 'Institution not found' });
  }
  return reply.send({ institution, viewerScope });
});

fastify.patch('/orgs/:orgId/institutions/:institutionId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Update institution',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'institutionId'],
      properties: { orgId: { type: 'string' }, institutionId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string' },
        type: { type: 'string', enum: INSTITUTION_TYPES },
        description: { type: 'string' },
        address: { type: 'object', additionalProperties: true },
        location: { type: 'object', additionalProperties: true },
        contact: { type: 'object', additionalProperties: true },
        documents: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              documentId: { type: 'string' },
              title: { type: 'string' },
              type: { type: 'string' },
              url: { type: 'string' },
              uploadedAt: { type: 'string', format: 'date-time' },
              notes: { type: 'string' },
            },
          },
        },
        metadata: { type: 'object', additionalProperties: true },
        status: { type: 'string', enum: INSTITUTION_STATUSES.filter((entry) => entry !== 'deleted') },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.update', req.params.orgId);
  if (denied) return;
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  const canMutate = canMutateOrgHierarchy(organization);
  if (!canMutate.ok && canMutate.reason !== 'Organization is not approved yet') {
    return reply.code(canMutate.code || 409).send({ message: canMutate.reason });
  }

  const update = { updatedAt: now() };
  if (req.body?.name) update.name = String(req.body.name).trim();
  if (req.body?.code) update.code = normalizeInstitutionCode(req.body.code, req.body.name || '');
  if (req.body?.type !== undefined) update.type = normalizeInstitutionType(req.body.type, null);
  if (req.body?.description !== undefined) update.description = req.body.description ? String(req.body.description).trim() : null;
  if (req.body?.address !== undefined) update.address = req.body.address && typeof req.body.address === 'object' ? req.body.address : null;
  if (req.body?.location !== undefined) update.location = req.body.location;
  if (req.body?.contact !== undefined) update.contact = req.body.contact;
  if (req.body?.documents !== undefined) update.documents = normalizeDocumentList(req.body.documents);
  if (req.body?.metadata !== undefined) update.metadata = req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  if (req.body?.status) {
    const normalized = String(req.body.status).trim().toLowerCase();
    if (INSTITUTION_STATUSES.includes(normalized)) {
      update.status = normalized;
    }
  }

  const result = await collections.institutions().findOneAndUpdate(
    { organizationId: req.params.orgId, institutionId: req.params.institutionId },
    { $set: update },
    { returnDocument: 'after' },
  );
  const institution = unwrapFindOneAndUpdateResult(result);
  if (!institution) {
    return reply.code(404).send({ message: 'Institution not found' });
  }

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_INSTITUTION_UPDATED',
    action: 'org.institution.update',
    resource: { type: 'institution', id: req.params.institutionId },
    permissionKey: 'org.branch.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { fields: Object.keys(req.body || {}) },
  });

  return reply.send({ institution });
});

fastify.post('/orgs/:orgId/institutions/:institutionId/files/upload', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Upload institution government documents via file-document-service',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'institutionId'],
      properties: {
        orgId: { type: 'string' },
        institutionId: { type: 'string' },
      },
    },
    body: {
      type: 'object',
      required: ['uploads'],
      properties: {
        uploads: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['contentType', 'contentBase64'],
            properties: {
              filename: { type: 'string' },
              contentType: { type: 'string' },
              contentBase64: { type: 'string' },
              title: { type: 'string' },
              type: { type: 'string' },
              notes: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
      409: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.update', req.params.orgId);
  if (denied) return;

  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) return reply.code(404).send({ message: 'Organization not found' });
  const canMutate = canMutateOrgHierarchy(organization);
  if (!canMutate.ok) {
    return reply.code(canMutate.code || 409).send({ message: canMutate.reason });
  }

  const existing = await collections.institutions().findOne({
    organizationId: req.params.orgId,
    institutionId: req.params.institutionId,
  });
  if (!existing) return reply.code(404).send({ message: 'Institution not found' });
  if (String(existing.status || '').toLowerCase() === 'deleted') {
    return reply.code(409).send({ message: 'Cannot upload files for deleted institution' });
  }

  const uploads = Array.isArray(req.body?.uploads) ? req.body.uploads : [];
  if (uploads.length === 0) {
    return reply.code(400).send({ message: 'At least one upload is required' });
  }

  const uploadedDocuments = [];
  for (let index = 0; index < uploads.length; index += 1) {
    const item = uploads[index];
    const uploaded = await uploadOrgFileViaFileService(item, INSTITUTION_DOCUMENT_CONTENT_TYPES);
    if (uploaded.error) {
      return reply.code(400).send({ message: `Upload ${index + 1} failed: ${uploaded.error}` });
    }
    uploadedDocuments.push({
      documentId: crypto.randomUUID(),
      title: item?.title ? String(item.title).trim() : String(item?.filename || `Document ${index + 1}`).trim(),
      type: item?.type ? String(item.type).trim().toLowerCase() : 'government_document',
      url: uploaded.url,
      uploadedAt: now().toISOString(),
      notes: item?.notes ? String(item.notes).trim() : null,
    });
  }

  const nextDocuments = normalizeDocumentList([
    ...(Array.isArray(existing.documents) ? existing.documents : []),
    ...uploadedDocuments,
  ]);

  const result = await collections.institutions().findOneAndUpdate(
    { organizationId: req.params.orgId, institutionId: req.params.institutionId },
    { $set: { documents: nextDocuments, updatedAt: now() } },
    { returnDocument: 'after' },
  );
  const institution = unwrapFindOneAndUpdateResult(result);

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_INSTITUTION_DOCUMENTS_UPLOADED',
    action: 'org.institution.documents.upload',
    resource: { type: 'institution', id: req.params.institutionId },
    permissionKey: 'org.branch.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { uploadedCount: uploadedDocuments.length },
  });

  return reply.send({
    message: 'Institution documents uploaded successfully',
    institution,
    uploadedDocuments,
  });
});

fastify.delete('/orgs/:orgId/institutions/:institutionId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Deactivate institution',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'institutionId'],
      properties: { orgId: { type: 'string' }, institutionId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.delete', req.params.orgId);
  if (denied) return;

  const org = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!org) return reply.code(404).send({ message: 'Organization not found' });
  const result = await collections.institutions().findOneAndUpdate(
    { organizationId: req.params.orgId, institutionId: req.params.institutionId },
    { $set: { status: 'inactive', updatedAt: now() } },
    { returnDocument: 'after' },
  );
  const institution = unwrapFindOneAndUpdateResult(result);
  if (!institution) return reply.code(404).send({ message: 'Institution not found' });

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_INSTITUTION_DELETED',
    action: 'org.institution.delete',
    resource: { type: 'institution', id: req.params.institutionId },
    permissionKey: 'org.branch.delete',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ message: 'Institution deactivated' });
});

fastify.get('/orgs/:orgId/hierarchy', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Get organization hierarchy',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.read', req.params.orgId);
  if (denied) return;
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!organization) return reply.code(404).send({ message: 'Organization not found' });

  const viewerScope = await resolveViewerScope(req, req.params.orgId);
  if (!viewerScope.hasAccess) return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
  const accessibleInstitutionIds = await resolveAccessibleInstitutionIds(req.params.orgId, viewerScope);

  const institutionFilter = {
    organizationId: req.params.orgId,
    ...(String(organization.lifecycleStatus || '').toLowerCase() === 'deleted' ? {} : { status: { $ne: 'deleted' } }),
    ...(Array.isArray(accessibleInstitutionIds) ? { institutionId: { $in: accessibleInstitutionIds } } : {}),
  };
  const institutions = await collections.institutions().find(institutionFilter).toArray();
  const institutionIds = institutions.map((item) => item.institutionId);
  const branchFilter = {
    organizationId: req.params.orgId,
    ...(String(organization.lifecycleStatus || '').toLowerCase() === 'deleted' ? {} : { status: { $ne: 'deleted' } }),
    ...(Array.isArray(accessibleInstitutionIds) ? { institutionId: { $in: institutionIds } } : {}),
  };
  const branches = await collections.branches().find(branchFilter).toArray();
  return reply.send({ organization: decorateOrganization(organization), institutions, branches, viewerScope });
});

fastify.post('/orgs/:orgId/branches', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Create branch',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['name', 'code', 'institutionId'],
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string', minLength: 2 },
        institutionId: { type: 'string' },
        type: { type: 'string', enum: ['hospital', 'clinic', 'laboratory', 'pharmacy'] },
        capabilities: {
          type: 'array',
          items: { type: 'string', enum: ['hospital', 'clinic', 'laboratory', 'pharmacy'] },
          minItems: 1,
          uniqueItems: true,
        },
        address: { type: 'object', additionalProperties: true },
        location: { type: 'object', additionalProperties: true },
        contact: { type: 'object', additionalProperties: true },
        metadata: { type: 'object', additionalProperties: true },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.create', req.params.orgId);
  if (denied) return;

  const org = await collections.organizations().findOne({ organizationId: req.params.orgId });
  if (!org) {
    return reply.code(404).send({ message: 'Organization not found' });
  }
  const canMutate = canMutateOrgHierarchy(org);
  if (!canMutate.ok) {
    return reply.code(canMutate.code || 409).send({ message: canMutate.reason });
  }
  const institutionId = String(req.body?.institutionId || '').trim();
  if (!institutionId) {
    return reply.code(400).send({ message: 'institutionId is required' });
  }
  const institution = await collections.institutions().findOne({ organizationId: req.params.orgId, institutionId });
  if (!institution) {
    return reply.code(404).send({ message: 'Institution not found' });
  }
  if (String(institution.status || '').toLowerCase() !== 'active') {
    return reply.code(409).send({ message: 'Institution must be active before adding branches' });
  }

  const branchId = crypto.randomUUID();
  const explicitCapabilities = normalizeBranchCapabilities(req.body?.capabilities);
  const mappedCapability = branchTypeToCapability(req.body?.type);
  const capabilities = explicitCapabilities.length > 0
    ? explicitCapabilities
    : (mappedCapability ? [mappedCapability] : []);

  const branch = {
    branchId,
    organizationId: req.params.orgId,
    institutionId,
    name: String(req.body.name).trim(),
    code: String(req.body.code).trim().toUpperCase(),
    type: req.body?.type ? String(req.body.type).trim().toLowerCase() : null,
    capabilities,
    address: req.body.address || null,
    location: req.body.location || null,
    contact: req.body.contact || null,
    metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };

  try {
    await collections.branches().insertOne(branch);
  } catch (err) {
    if (err?.code === 11000) {
      return reply.code(400).send({ message: 'Branch code already exists in this organization' });
    }
    throw err;
  }

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_BRANCH_CREATED',
    action: 'org.branch.create',
    resource: { type: 'branch', id: branchId },
    permissionKey: 'org.branch.create',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { code: branch.code },
  });

  return reply.code(201).send({ branch });
});

fastify.get('/orgs/:orgId/branches', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'List organization branches',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId'],
      properties: { orgId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.read', req.params.orgId);
  if (denied) return;

  const viewerScope = await resolveViewerScope(req, req.params.orgId);
  if (!viewerScope.hasAccess) {
    return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
  }

  const filter = { organizationId: req.params.orgId, status: { $ne: 'deleted' } };
  if (viewerScope.level === 'branch' && Array.isArray(viewerScope.branchIds) && viewerScope.branchIds.length > 0) {
    filter.branchId = { $in: viewerScope.branchIds };
  } else {
    const accessibleInstitutionIds = await resolveAccessibleInstitutionIds(req.params.orgId, viewerScope);
    if (Array.isArray(accessibleInstitutionIds)) {
      filter.institutionId = { $in: accessibleInstitutionIds };
    }
  }

  const branches = await collections.branches().find(filter).toArray();
  return reply.send({ items: branches, viewerScope });
});

fastify.get('/orgs/:orgId/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Get one branch',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'branchId'],
      properties: { orgId: { type: 'string' }, branchId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.read', req.params.orgId);
  if (denied) return;

  const viewerScope = await resolveViewerScope(req, req.params.orgId);
  if (!viewerScope.hasAccess) {
    return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
  }
  if (viewerScope.level === 'branch' && Array.isArray(viewerScope.branchIds) && viewerScope.branchIds.length > 0) {
    if (!viewerScope.branchIds.includes(req.params.branchId)) {
      return reply.code(403).send({ message: 'Go to your assigned branch scope to continue.' });
    }
  }

  const branch = await collections.branches().findOne({ organizationId: req.params.orgId, branchId: req.params.branchId });
  if (!branch) {
    return reply.code(404).send({ message: 'Branch not found' });
  }
  if (String(branch.status || '').toLowerCase() === 'deleted') {
    return reply.code(404).send({ message: 'Branch not found' });
  }
  return reply.send({ branch, viewerScope });
});

fastify.patch('/orgs/:orgId/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Update branch',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'branchId'],
      properties: { orgId: { type: 'string' }, branchId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        code: { type: 'string' },
        institutionId: { type: 'string' },
        type: { type: 'string', enum: ['hospital', 'clinic', 'laboratory', 'pharmacy'] },
        capabilities: {
          type: 'array',
          items: { type: 'string', enum: ['hospital', 'clinic', 'laboratory', 'pharmacy'] },
          minItems: 1,
          uniqueItems: true,
        },
        address: { type: 'object', additionalProperties: true },
        location: { type: 'object', additionalProperties: true },
        contact: { type: 'object', additionalProperties: true },
        metadata: { type: 'object', additionalProperties: true },
        status: { type: 'string', enum: BRANCH_STATUSES.filter((entry) => entry !== 'deleted') },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.update', req.params.orgId);
  if (denied) return;
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  const canMutate = canMutateOrgHierarchy(organization);
  if (!canMutate.ok && canMutate.reason !== 'Organization is not approved yet') {
    return reply.code(canMutate.code || 409).send({ message: canMutate.reason });
  }

  if (req.body?.institutionId) {
    const institution = await collections.institutions().findOne({
      organizationId: req.params.orgId,
      institutionId: String(req.body.institutionId),
    });
    if (!institution) {
      return reply.code(404).send({ message: 'Institution not found' });
    }
  }

  const update = { updatedAt: now() };
  if (req.body?.name) update.name = req.body.name;
  if (req.body?.code) update.code = String(req.body.code).trim().toUpperCase();
  if (req.body?.institutionId) update.institutionId = String(req.body.institutionId).trim();
  if (req.body?.type !== undefined) update.type = req.body.type ? String(req.body.type).trim().toLowerCase() : null;
  if (req.body?.capabilities !== undefined) {
    update.capabilities = normalizeBranchCapabilities(req.body.capabilities);
  } else if (req.body?.type) {
    const mappedCapability = branchTypeToCapability(req.body.type);
    if (mappedCapability) update.capabilities = [mappedCapability];
  }
  if (req.body?.address !== undefined) update.address = req.body.address;
  if (req.body?.location !== undefined) update.location = req.body.location;
  if (req.body?.contact !== undefined) update.contact = req.body.contact;
  if (req.body?.metadata !== undefined) update.metadata = req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  if (req.body?.status) {
    const normalized = String(req.body.status).trim().toLowerCase();
    if (BRANCH_STATUSES.includes(normalized)) {
      update.status = normalized;
    }
  }

  const result = await collections.branches().findOneAndUpdate(
    { organizationId: req.params.orgId, branchId: req.params.branchId },
    { $set: update },
    { returnDocument: 'after' }
  );
  const updatedBranch = unwrapFindOneAndUpdateResult(result);
  if (!updatedBranch) {
    return reply.code(404).send({ message: 'Branch not found' });
  }

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_BRANCH_UPDATED',
    action: 'org.branch.update',
    resource: { type: 'branch', id: req.params.branchId },
    permissionKey: 'org.branch.update',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
    metadata: { fields: Object.keys(req.body || {}) },
  });

  return reply.send({ branch: updatedBranch });
});

fastify.delete('/orgs/:orgId/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Soft-delete branch',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'branchId'],
      properties: { orgId: { type: 'string' }, branchId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.delete', req.params.orgId);
  if (denied) return;

  const result = await collections.branches().findOneAndUpdate(
    { organizationId: req.params.orgId, branchId: req.params.branchId },
    { $set: { status: 'closed', updatedAt: now() } },
    { returnDocument: 'after' }
  );
  const closedBranch = unwrapFindOneAndUpdateResult(result);
  if (!closedBranch) {
    return reply.code(404).send({ message: 'Branch not found' });
  }

  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: req.params.orgId,
    eventType: 'ORG_BRANCH_DELETED',
    action: 'org.branch.delete',
    resource: { type: 'branch', id: req.params.branchId },
    permissionKey: 'org.branch.delete',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    outcome: 'success',
  });

  return reply.send({ message: 'Branch closed' });
});

fastify.post('/orgs/:orgId/institutions/:institutionId/branches', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Create branch under institution',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'institutionId'],
      properties: { orgId: { type: 'string' }, institutionId: { type: 'string' } },
    },
    body: {
      type: 'object',
      required: ['name', 'code'],
      properties: {
        name: { type: 'string', minLength: 2 },
        code: { type: 'string', minLength: 2 },
        type: { type: 'string', enum: ['hospital', 'clinic', 'laboratory', 'pharmacy'] },
        capabilities: {
          type: 'array',
          items: { type: 'string', enum: ['hospital', 'clinic', 'laboratory', 'pharmacy'] },
          minItems: 1,
          uniqueItems: true,
        },
        address: { type: 'object', additionalProperties: true },
        location: { type: 'object', additionalProperties: true },
        contact: { type: 'object', additionalProperties: true },
        metadata: { type: 'object', additionalProperties: true },
      },
    },
    response: {
      201: { type: 'object', additionalProperties: true },
      400: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.create', req.params.orgId);
  if (denied) return;
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  const canMutate = canMutateOrgHierarchy(organization);
  if (!canMutate.ok) {
    return reply.code(canMutate.code || 409).send({ message: canMutate.reason });
  }

  const institution = await collections.institutions().findOne({
    organizationId: req.params.orgId,
    institutionId: req.params.institutionId,
  });
  if (!institution) return reply.code(404).send({ message: 'Institution not found' });
  if (String(institution.status || '').toLowerCase() !== 'active') {
    return reply.code(409).send({ message: 'Institution must be active before adding branches' });
  }

  const branchId = crypto.randomUUID();
  const explicitCapabilities = normalizeBranchCapabilities(req.body?.capabilities);
  const mappedCapability = branchTypeToCapability(req.body?.type);
  const capabilities = explicitCapabilities.length > 0
    ? explicitCapabilities
    : (mappedCapability ? [mappedCapability] : []);

  const branch = {
    branchId,
    organizationId: req.params.orgId,
    institutionId: req.params.institutionId,
    name: String(req.body.name).trim(),
    code: String(req.body.code).trim().toUpperCase(),
    type: req.body?.type ? String(req.body.type).trim().toLowerCase() : null,
    capabilities,
    address: req.body.address || null,
    location: req.body.location || null,
    contact: req.body.contact || null,
    metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };

  try {
    await collections.branches().insertOne(branch);
  } catch (err) {
    if (err?.code === 11000) {
      return reply.code(400).send({ message: 'Branch code already exists in this institution' });
    }
    throw err;
  }
  return reply.code(201).send({ branch });
});

fastify.get('/orgs/:orgId/institutions/:institutionId/branches', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'List branches by institution',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'institutionId'],
      properties: { orgId: { type: 'string' }, institutionId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.read', req.params.orgId);
  if (denied) return;

  const viewerScope = await resolveViewerScope(req, req.params.orgId);
  if (!viewerScope.hasAccess) return reply.code(403).send({ message: viewerScope.message || 'Forbidden' });
  const accessibleInstitutionIds = await resolveAccessibleInstitutionIds(req.params.orgId, viewerScope);
  if (Array.isArray(accessibleInstitutionIds) && !accessibleInstitutionIds.includes(req.params.institutionId)) {
    return reply.code(403).send({ message: 'Go to your assigned institution or branch scope to continue.' });
  }

  const filter = {
    organizationId: req.params.orgId,
    institutionId: req.params.institutionId,
    status: { $ne: 'deleted' },
  };
  if (viewerScope.level === 'branch' && Array.isArray(viewerScope.branchIds) && viewerScope.branchIds.length > 0) {
    filter.branchId = { $in: viewerScope.branchIds };
  }
  const items = await collections.branches().find(filter).toArray();
  return reply.send({ items, viewerScope });
});

fastify.get('/orgs/:orgId/institutions/:institutionId/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Get one branch by institution',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'institutionId', 'branchId'],
      properties: { orgId: { type: 'string' }, institutionId: { type: 'string' }, branchId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.read', req.params.orgId);
  if (denied) return;

  const branch = await collections.branches().findOne({
    organizationId: req.params.orgId,
    institutionId: req.params.institutionId,
    branchId: req.params.branchId,
  });
  if (!branch) return reply.code(404).send({ message: 'Branch not found' });
  if (String(branch.status || '').toLowerCase() === 'deleted') {
    return reply.code(404).send({ message: 'Branch not found' });
  }
  return reply.send({ branch });
});

fastify.patch('/orgs/:orgId/institutions/:institutionId/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Update branch by institution',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'institutionId', 'branchId'],
      properties: { orgId: { type: 'string' }, institutionId: { type: 'string' }, branchId: { type: 'string' } },
    },
    body: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        code: { type: 'string' },
        type: { type: 'string', enum: ['hospital', 'clinic', 'laboratory', 'pharmacy'] },
        capabilities: {
          type: 'array',
          items: { type: 'string', enum: ['hospital', 'clinic', 'laboratory', 'pharmacy'] },
          minItems: 1,
          uniqueItems: true,
        },
        address: { type: 'object', additionalProperties: true },
        location: { type: 'object', additionalProperties: true },
        contact: { type: 'object', additionalProperties: true },
        metadata: { type: 'object', additionalProperties: true },
        status: { type: 'string', enum: BRANCH_STATUSES.filter((entry) => entry !== 'deleted') },
      },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.update', req.params.orgId);
  if (denied) return;
  const organization = await collections.organizations().findOne({ organizationId: req.params.orgId });
  const canMutate = canMutateOrgHierarchy(organization);
  if (!canMutate.ok && canMutate.reason !== 'Organization is not approved yet') {
    return reply.code(canMutate.code || 409).send({ message: canMutate.reason });
  }

  const update = { updatedAt: now() };
  if (req.body?.name) update.name = req.body.name;
  if (req.body?.code) update.code = String(req.body.code).trim().toUpperCase();
  if (req.body?.type !== undefined) update.type = req.body.type ? String(req.body.type).trim().toLowerCase() : null;
  if (req.body?.capabilities !== undefined) {
    update.capabilities = normalizeBranchCapabilities(req.body.capabilities);
  } else if (req.body?.type) {
    const mappedCapability = branchTypeToCapability(req.body.type);
    if (mappedCapability) update.capabilities = [mappedCapability];
  }
  if (req.body?.address !== undefined) update.address = req.body.address;
  if (req.body?.location !== undefined) update.location = req.body.location;
  if (req.body?.contact !== undefined) update.contact = req.body.contact;
  if (req.body?.metadata !== undefined) update.metadata = req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  if (req.body?.status) {
    const normalized = String(req.body.status).trim().toLowerCase();
    if (BRANCH_STATUSES.includes(normalized)) {
      update.status = normalized;
    }
  }

  const result = await collections.branches().findOneAndUpdate(
    { organizationId: req.params.orgId, institutionId: req.params.institutionId, branchId: req.params.branchId },
    { $set: update },
    { returnDocument: 'after' },
  );
  const branch = unwrapFindOneAndUpdateResult(result);
  if (!branch) return reply.code(404).send({ message: 'Branch not found' });
  return reply.send({ branch });
});

fastify.delete('/orgs/:orgId/institutions/:institutionId/branches/:branchId', {
  preHandler: requireAuth,
  schema: {
    tags: ['Organization'],
    summary: 'Close branch by institution',
    security: [{ bearerAuth: [] }],
    params: {
      type: 'object',
      required: ['orgId', 'institutionId', 'branchId'],
      properties: { orgId: { type: 'string' }, institutionId: { type: 'string' }, branchId: { type: 'string' } },
    },
    response: {
      200: { type: 'object', additionalProperties: true },
      401: { type: 'object', additionalProperties: true },
      403: { type: 'object', additionalProperties: true },
      404: { type: 'object', additionalProperties: true },
    },
  },
}, async (req, reply) => {
  const denied = await enforcePermission(req, reply, 'org.branch.delete', req.params.orgId);
  if (denied) return;
  const result = await collections.branches().findOneAndUpdate(
    { organizationId: req.params.orgId, institutionId: req.params.institutionId, branchId: req.params.branchId },
    { $set: { status: 'closed', updatedAt: now() } },
    { returnDocument: 'after' },
  );
  const branch = unwrapFindOneAndUpdateResult(result);
  if (!branch) return reply.code(404).send({ message: 'Branch not found' });
  return reply.send({ message: 'Branch closed', branch });
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


