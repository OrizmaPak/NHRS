const fastify = require('fastify')({ logger: true });
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const { evaluatePermission, mergeRules } = require('./engine');
const { buildScopedPermissionCatalog, filterRulesToAllowedKeys } = require('./permission-catalog');
const { buildEventEnvelope, createOutboxRepository, deliverOutboxBatch } = require('../../../../libs/shared/src/outbox');
const { enforceProductionSecrets } = require('../../../../libs/shared/src/env');
const { setStandardErrorHandler } = require('../../../../libs/shared/src/errors');

const serviceName = 'rbac-service';
const port = Number(process.env.PORT) || 8090;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'nhrs_rbac_db';
const membershipDbName = process.env.MEMBERSHIP_DB_NAME || 'nhrs_membership_db';
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';
const jwtSecret = process.env.JWT_SECRET || 'change-me';
const cacheTtlSec = Number(process.env.RBAC_CACHE_TTL_SEC) || 60;
const auditApiBaseUrl = process.env.AUDIT_API_BASE_URL || 'http://audit-log-service:8091';
const authApiBaseUrl = process.env.AUTH_API_BASE_URL || 'http://auth-api:8081';
const membershipApiBaseUrl = process.env.MEMBERSHIP_API_BASE_URL || 'http://membership-service:8103';
const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || 'change-me-internal-token';
const nhrsContextSecret = process.env.NHRS_CONTEXT_HMAC_SECRET || 'change-me-context-secret';
const outboxIntervalMs = Number(process.env.OUTBOX_INTERVAL_MS) || 2000;
const outboxBatchSize = Number(process.env.OUTBOX_BATCH_SIZE) || 50;
const outboxMaxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS) || 20;
const mongoReconnectDelayMs = Math.max(1000, Number(process.env.MONGO_RECONNECT_DELAY_MS) || 10000);

let dbReady = false;
let dbWritable = false;
let redisReady = false;
let mongoClient;
let redisClient;
let db;
let outboxRepo = null;
let outboxTimer = null;
let mongoConnectPromise = null;
let mongoWritableRecoveryPromise = null;
let mongoReconnectTimer = null;
let orgLeadershipAuditStarted = false;

const collections = {
  permissions: () => db.collection('permissions'),
  roles: () => db.collection('roles'),
  userAccess: () => db.collection('user_access'),
  roleAssignments: () => db.collection('user_role_assignments'),
};

const membershipCollections = {
  orgMemberships: () => mongoClient.db(membershipDbName).collection('org_memberships'),
};

const orgWorkspacePermissionTemplates = [
  { key: 'auth.me.read', name: 'Read own profile', module: 'auth', actions: ['read'] },
  { key: 'care.workspace.read', name: 'Access patient care workspace', module: 'care', actions: ['read'] },
  { key: 'profile.search', name: 'Search patient profiles', module: 'profile', actions: ['read'] },
  { key: 'profile.user.read', name: 'Read patient profile', module: 'profile', actions: ['read'] },
  { key: 'profile.user.update', name: 'Update user profile', module: 'profile', actions: ['update'] },
  { key: 'profile.placeholder.create', name: 'Register patient into organization care register', module: 'care', actions: ['create'] },
  { key: 'records.nin.read', name: 'Read patient timeline by NIN', module: 'records', actions: ['read'] },
  { key: 'encounters.read', name: 'Read encounters', module: 'encounters', actions: ['read'] },
  { key: 'labs.read', name: 'Read lab workflows', module: 'labs', actions: ['read'] },
  { key: 'pharmacy.read', name: 'Read pharmacy workflows', module: 'pharmacy', actions: ['read'] },
  { key: 'ui.theme.read', name: 'Read UI themes', module: 'ui-theme', actions: ['read'] },
  { key: 'ui.theme.write', name: 'Write UI themes', module: 'ui-theme', actions: ['create', 'update'] },
  { key: 'ui.theme.delete', name: 'Delete UI themes', module: 'ui-theme', actions: ['delete'] },
  { key: 'integrations.view', name: 'View integrations', module: 'integrations', actions: ['read'] },
  { key: 'api.keys.manage', name: 'Manage API keys', module: 'integrations', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'rbac.org.manage', name: 'Manage org RBAC', module: 'rbac', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'org.list', name: 'List organizations', module: 'organization', actions: ['read'] },
  { key: 'org.read', name: 'Read organization', module: 'organization', actions: ['read'] },
  { key: 'org.update', name: 'Update organization', module: 'organization', actions: ['update'] },
  { key: 'org.owner.assign', name: 'Assign organization owner', module: 'organization', actions: ['update'] },
  { key: 'global.services.manage', name: 'Manage global services catalog', module: 'catalog', actions: ['create', 'read', 'update', 'delete'] },
  { key: 'global.services.create', name: 'Create global service', module: 'catalog', actions: ['create'] },
  { key: 'global.services.update', name: 'Update global service', module: 'catalog', actions: ['update'] },
  { key: 'global.services.delete', name: 'Delete global service', module: 'catalog', actions: ['delete'] },
  { key: 'org.branch.create', name: 'Create branch', module: 'organization', actions: ['create'] },
  { key: 'org.branch.read', name: 'Read branch', module: 'organization', actions: ['read'] },
  { key: 'org.branch.update', name: 'Update branch', module: 'organization', actions: ['update'] },
  { key: 'org.branch.delete', name: 'Delete branch', module: 'organization', actions: ['delete'] },
  { key: 'org.member.add', name: 'Add org member', module: 'membership', actions: ['create'] },
  { key: 'org.member.invite', name: 'Invite org member', module: 'membership', actions: ['create'] },
  { key: 'org.member.read', name: 'Read org member', module: 'membership', actions: ['read'] },
  { key: 'org.member.list', name: 'List org members', module: 'membership', actions: ['read'] },
  { key: 'org.member.update', name: 'Update org member', module: 'membership', actions: ['update'] },
  { key: 'org.member.status.update', name: 'Change org member status', module: 'membership', actions: ['update'] },
  { key: 'org.branch.assign', name: 'Assign branches to membership', module: 'membership', actions: ['create'] },
  { key: 'org.branch.assignment.update', name: 'Update branch assignment', module: 'membership', actions: ['update'] },
  { key: 'org.member.branch.assign', name: 'Assign member to branch', module: 'membership', actions: ['create'] },
  { key: 'org.member.branch.update', name: 'Update member branch assignment', module: 'membership', actions: ['update'] },
  { key: 'org.member.branch.remove', name: 'Remove member branch assignment', module: 'membership', actions: ['delete'] },
  { key: 'org.member.transfer', name: 'Transfer member branch assignment', module: 'membership', actions: ['create'] },
  { key: 'org.member.history.read', name: 'Read membership history', module: 'membership', actions: ['read'] },
];

const orgWorkspacePermissionKeys = orgWorkspacePermissionTemplates.map((entry) => entry.key);
const scopedCareFoundationPermissionKeys = [
  'auth.me.read',
  'care.workspace.read',
  'profile.search',
  'profile.user.read',
  'profile.placeholder.create',
  'records.nin.read',
];

const systemPermissions = [
  { key: 'nin.profile.read', name: 'Read NIN profile', scope: 'app', module: 'auth', actions: ['read'], isSystem: true },
  { key: 'auth.contact.phone.write', name: 'Write phone contact', scope: 'app', module: 'auth', actions: ['update'], isSystem: true },
  { key: 'auth.contact.email.write', name: 'Write email contact', scope: 'app', module: 'auth', actions: ['update'], isSystem: true },
  { key: 'auth.password.change', name: 'Change password', scope: 'app', module: 'auth', actions: ['update'], isSystem: true },
  { key: 'rbac.app.manage', name: 'Manage app RBAC', scope: 'app', module: 'rbac', actions: ['create', 'read', 'update', 'delete'], isSystem: true },
  { key: 'rbac.org.manage', name: 'Manage org RBAC', scope: 'org', module: 'rbac', actions: ['create', 'read', 'update', 'delete'], isSystem: true },
  { key: 'org.manage', name: 'Manage organization', scope: 'org', module: 'providers', actions: ['create', 'read', 'update', 'delete'], isSystem: true },
  { key: 'lab.results.write', name: 'Write lab results', scope: 'org', module: 'lab', actions: ['create', 'update'], isSystem: true },
  { key: 'audit.read', name: 'Read audit logs', scope: 'app', module: 'audit', actions: ['read'], isSystem: true },
  { key: 'auth.me.read', name: 'Read own profile', scope: 'app', module: 'auth', actions: ['read'], isSystem: true },
  { key: 'care.workspace.read', name: 'Access patient care workspace', scope: 'org', module: 'care', actions: ['read'], isSystem: true },
  { key: 'profile.me.read', name: 'Read own profile record', scope: 'app', module: 'profile', actions: ['read'], isSystem: true },
  { key: 'profile.me.update', name: 'Update own profile record', scope: 'app', module: 'profile', actions: ['update'], isSystem: true },
  { key: 'profile.search', name: 'Search profiles', scope: 'app', module: 'profile', actions: ['read'], isSystem: true },
  { key: 'profile.user.read', name: 'Read user profile', scope: 'app', module: 'profile', actions: ['read'], isSystem: true },
  { key: 'profile.user.update', name: 'Update user profile', scope: 'app', module: 'profile', actions: ['update'], isSystem: true },
  { key: 'ui.theme.read', name: 'Read UI themes', scope: 'app', module: 'ui-theme', actions: ['read'], isSystem: true },
  { key: 'ui.theme.write', name: 'Write UI themes', scope: 'app', module: 'ui-theme', actions: ['create', 'update'], isSystem: true },
  { key: 'ui.theme.delete', name: 'Delete UI themes', scope: 'app', module: 'ui-theme', actions: ['delete'], isSystem: true },
  { key: 'profile.search', name: 'Search profiles', scope: 'org', module: 'profile', actions: ['read'], isSystem: true },
  { key: 'profile.user.read', name: 'Read user profile', scope: 'org', module: 'profile', actions: ['read'], isSystem: true },
  { key: 'profile.user.update', name: 'Update user profile', scope: 'org', module: 'profile', actions: ['update'], isSystem: true },
  { key: 'profile.placeholder.create', name: 'Register patient into organization care register', scope: 'org', module: 'care', actions: ['create'], isSystem: true },
  { key: 'profile.nin.refresh.request', name: 'Request NIN refresh for profile', scope: 'app', module: 'profile', actions: ['create'], isSystem: true },
  { key: 'org.create', name: 'Create organization', scope: 'app', module: 'organization', actions: ['create'], isSystem: true },
  { key: 'org.list', name: 'List organizations', scope: 'app', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.deleted.read', name: 'Read deleted organizations', scope: 'app', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.list_all', name: 'List all organizations', scope: 'app', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.read', name: 'Read organization', scope: 'app', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.update', name: 'Update organization', scope: 'app', module: 'organization', actions: ['update'], isSystem: true },
  { key: 'org.owner.assign', name: 'Assign organization owner', scope: 'app', module: 'organization', actions: ['update'], isSystem: true },
  { key: 'org.search', name: 'Search organizations', scope: 'app', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'geo.manage', name: 'Manage geo mapping (regions/states/lgas)', scope: 'app', module: 'geography', actions: ['create', 'read', 'update', 'delete'], isSystem: true },
  { key: 'integrations.view', name: 'View integrations', scope: 'app', module: 'integrations', actions: ['read'], isSystem: true },
  { key: 'api.keys.manage', name: 'Manage API keys', scope: 'app', module: 'integrations', actions: ['create', 'read', 'update', 'delete'], isSystem: true },
  { key: 'global.services.manage', name: 'Manage global services catalog', scope: 'app', module: 'catalog', actions: ['create', 'read', 'update', 'delete'], isSystem: true },
  { key: 'global.services.create', name: 'Create global service', scope: 'app', module: 'catalog', actions: ['create'], isSystem: true },
  { key: 'global.services.update', name: 'Update global service', scope: 'app', module: 'catalog', actions: ['update'], isSystem: true },
  { key: 'global.services.delete', name: 'Delete global service', scope: 'app', module: 'catalog', actions: ['delete'], isSystem: true },
  { key: 'admin.settings.manage', name: 'Manage admin system settings', scope: 'app', module: 'admin', actions: ['read', 'update'], isSystem: true },
  { key: 'analytics.view', name: 'View analytics dashboards', scope: 'app', module: 'analytics', actions: ['read'], isSystem: true },
  { key: 'reports.view', name: 'View reports', scope: 'app', module: 'reports', actions: ['read'], isSystem: true },
  { key: 'compliance.view', name: 'View compliance dashboards', scope: 'app', module: 'compliance', actions: ['read'], isSystem: true },
  { key: 'institution.dashboard.view', name: 'View institution dashboard', scope: 'app', module: 'institution', actions: ['read'], isSystem: true },
  { key: 'sync.monitor.view', name: 'View sync monitor', scope: 'app', module: 'integrations', actions: ['read'], isSystem: true },
  { key: 'notifications.view', name: 'View notifications', scope: 'app', module: 'system', actions: ['read'], isSystem: true },
  { key: 'alerts.view', name: 'View alerts', scope: 'app', module: 'system', actions: ['read'], isSystem: true },
  { key: 'system.activity.view', name: 'View system activity', scope: 'app', module: 'system', actions: ['read'], isSystem: true },
  { key: 'system.monitoring.view', name: 'View system monitoring', scope: 'app', module: 'system', actions: ['read'], isSystem: true },
  { key: 'system.configuration.manage', name: 'Manage system configuration', scope: 'app', module: 'system', actions: ['read', 'update'], isSystem: true },
  { key: 'system.observability.view', name: 'View system observability', scope: 'app', module: 'system', actions: ['read'], isSystem: true },
  { key: 'system.health.view', name: 'View system health', scope: 'app', module: 'system', actions: ['read'], isSystem: true },
  { key: 'dev.tools.view', name: 'View developer tools', scope: 'app', module: 'system', actions: ['read'], isSystem: true },
  { key: 'org.branch.create', name: 'Create branch', scope: 'org', module: 'organization', actions: ['create'], isSystem: true },
  { key: 'org.branch.read', name: 'Read branch', scope: 'org', module: 'organization', actions: ['read'], isSystem: true },
  { key: 'org.branch.update', name: 'Update branch', scope: 'org', module: 'organization', actions: ['update'], isSystem: true },
  { key: 'org.branch.delete', name: 'Delete branch', scope: 'org', module: 'organization', actions: ['delete'], isSystem: true },
  { key: 'org.member.add', name: 'Add org member', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.invite', name: 'Invite org member', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.read', name: 'Read org member', scope: 'org', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'org.member.list', name: 'List org members', scope: 'org', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'org.member.update', name: 'Update org member', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.member.status.update', name: 'Change org member status', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.branch.assign', name: 'Assign branches to membership', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.branch.assignment.update', name: 'Update branch assignment', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.member.branch.assign', name: 'Assign member to branch', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.branch.update', name: 'Update member branch assignment', scope: 'org', module: 'membership', actions: ['update'], isSystem: true },
  { key: 'org.member.branch.remove', name: 'Remove member branch assignment', scope: 'org', module: 'membership', actions: ['delete'], isSystem: true },
  { key: 'org.member.transfer', name: 'Transfer member branch assignment', scope: 'org', module: 'membership', actions: ['create'], isSystem: true },
  { key: 'org.member.history.read', name: 'Read membership history', scope: 'org', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'membership.user.read', name: 'Read memberships by user', scope: 'app', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'membership.user.history.read', name: 'Read user movement history', scope: 'app', module: 'membership', actions: ['read'], isSystem: true },
  { key: 'records.me.read', name: 'Read own timeline records', scope: 'app', module: 'records', actions: ['read'], isSystem: true },
  { key: 'records.nin.read', name: 'Read timeline records by NIN', scope: 'org', module: 'records', actions: ['read'], isSystem: true },
  { key: 'encounters.read', name: 'Read encounters', scope: 'org', module: 'encounters', actions: ['read'], isSystem: true },
  { key: 'encounters.create', name: 'Create encounter', scope: 'org', module: 'encounters', actions: ['create'], isSystem: true },
  { key: 'encounters.update', name: 'Update encounter', scope: 'org', module: 'encounters', actions: ['update'], isSystem: true },
  { key: 'encounters.finalize', name: 'Finalize encounter', scope: 'org', module: 'encounters', actions: ['update'], isSystem: true },
  { key: 'labs.read', name: 'Read lab workflows', scope: 'org', module: 'labs', actions: ['read'], isSystem: true },
  { key: 'labs.create', name: 'Create lab request', scope: 'org', module: 'labs', actions: ['create'], isSystem: true },
  { key: 'labs.update', name: 'Update lab result', scope: 'org', module: 'labs', actions: ['update'], isSystem: true },
  { key: 'labs.complete', name: 'Complete lab result', scope: 'org', module: 'labs', actions: ['update'], isSystem: true },
  { key: 'pharmacy.read', name: 'Read pharmacy workflows', scope: 'org', module: 'pharmacy', actions: ['read'], isSystem: true },
  { key: 'pharmacy.create', name: 'Create prescription', scope: 'org', module: 'pharmacy', actions: ['create'], isSystem: true },
  { key: 'pharmacy.update', name: 'Update prescription', scope: 'org', module: 'pharmacy', actions: ['update'], isSystem: true },
  { key: 'pharmacy.dispense', name: 'Dispense prescription', scope: 'org', module: 'pharmacy', actions: ['update'], isSystem: true },
  { key: 'records.symptoms.create', name: 'Create own symptom record', scope: 'app', module: 'records', actions: ['create'], isSystem: true },
  { key: 'records.entry.create', name: 'Create provider timeline entry', scope: 'org', module: 'records', actions: ['create'], isSystem: true },
  { key: 'records.entry.update', name: 'Update timeline entry', scope: 'app', module: 'records', actions: ['update'], isSystem: true },
  { key: 'records.entry.hide', name: 'Hide timeline entry', scope: 'app', module: 'records', actions: ['update'], isSystem: true },
  { key: 'doctor.search', name: 'Search doctor registry', scope: 'app', module: 'doctor-registry', actions: ['read'], isSystem: true },
  { key: 'doctor.register', name: 'Register doctor profile', scope: 'app', module: 'doctor-registry', actions: ['create'], isSystem: true },
  { key: 'doctor.read', name: 'Read doctor profile', scope: 'app', module: 'doctor-registry', actions: ['read'], isSystem: true },
  { key: 'doctor.verify', name: 'Verify doctor license', scope: 'app', module: 'doctor-registry', actions: ['update'], isSystem: true },
  { key: 'doctor.suspend', name: 'Suspend doctor license', scope: 'app', module: 'doctor-registry', actions: ['update'], isSystem: true },
  { key: 'doctor.revoke', name: 'Revoke doctor license', scope: 'app', module: 'doctor-registry', actions: ['update'], isSystem: true },
  { key: 'doctor.reinstate', name: 'Reinstate doctor license', scope: 'app', module: 'doctor-registry', actions: ['update'], isSystem: true },
  { key: 'emergency.request.create', name: 'Create emergency request', scope: 'app', module: 'emergency', actions: ['create'], isSystem: true },
  { key: 'emergency.request.read', name: 'Read emergency request', scope: 'app', module: 'emergency', actions: ['read'], isSystem: true },
  { key: 'emergency.request.update_status', name: 'Update emergency request status', scope: 'org', module: 'emergency', actions: ['update'], isSystem: true },
  { key: 'emergency.response.create', name: 'Create emergency response', scope: 'org', module: 'emergency', actions: ['create'], isSystem: true },
  { key: 'emergency.room.read', name: 'Read emergency room', scope: 'app', module: 'emergency', actions: ['read'], isSystem: true },
  { key: 'emergency.room.message.create', name: 'Create emergency room message', scope: 'app', module: 'emergency', actions: ['create'], isSystem: true },
  { key: 'emergency.inventory.upsert', name: 'Upsert provider inventory', scope: 'org', module: 'emergency', actions: ['update'], isSystem: true },
  { key: 'emergency.inventory.search', name: 'Search provider inventory', scope: 'app', module: 'emergency', actions: ['read'], isSystem: true },
  { key: 'taskforce.unit.create', name: 'Create taskforce unit', scope: 'app', module: 'governance', actions: ['create'], isSystem: true },
  { key: 'taskforce.unit.read', name: 'Read taskforce units', scope: 'app', module: 'governance', actions: ['read'], isSystem: true },
  { key: 'taskforce.unit.update', name: 'Update taskforce unit', scope: 'app', module: 'governance', actions: ['update'], isSystem: true },
  { key: 'taskforce.member.manage', name: 'Manage taskforce members', scope: 'app', module: 'governance', actions: ['create', 'update', 'delete'], isSystem: true },
  { key: 'governance.case.create', name: 'Create governance case', scope: 'app', module: 'governance', actions: ['create'], isSystem: true },
  { key: 'governance.case.read', name: 'Read governance cases', scope: 'app', module: 'governance', actions: ['read'], isSystem: true },
  { key: 'governance.case.update_status', name: 'Update governance case status', scope: 'app', module: 'governance', actions: ['update'], isSystem: true },
  { key: 'governance.correction.propose', name: 'Propose governance correction', scope: 'app', module: 'governance', actions: ['create'], isSystem: true },
  { key: 'governance.correction.approve', name: 'Approve governance correction', scope: 'app', module: 'governance', actions: ['update'], isSystem: true },
  { key: 'governance.correction.reject', name: 'Reject governance correction', scope: 'app', module: 'governance', actions: ['update'], isSystem: true },
  { key: 'governance.case.escalate', name: 'Escalate governance case', scope: 'app', module: 'governance', actions: ['update'], isSystem: true },
  { key: 'governance.case.room.read', name: 'Read governance case room', scope: 'app', module: 'governance', actions: ['read'], isSystem: true },
  { key: 'governance.case.room.message.create', name: 'Create governance case room message', scope: 'app', module: 'governance', actions: ['create'], isSystem: true },
];

for (const permission of orgWorkspacePermissionTemplates) {
  if (!systemPermissions.some((entry) => entry.scope === 'org' && entry.key === permission.key)) {
    systemPermissions.push({
      key: permission.key,
      name: permission.name,
      scope: 'org',
      module: permission.module,
      actions: permission.actions,
      isSystem: true,
    });
  }
}

const orgScopedSystemPermissionTemplates = systemPermissions.filter((entry) => entry.scope === 'org');

const systemRoles = [
  {
    name: 'citizen',
    description: 'Default citizen role',
    scope: 'app',
    organizationId: null,
    isSystem: true,
    permissions: [
      { permissionKey: 'auth.me.read', effect: 'allow' },
      { permissionKey: 'auth.password.change', effect: 'allow' },
      { permissionKey: 'auth.contact.phone.write', effect: 'allow' },
      { permissionKey: 'auth.contact.email.write', effect: 'allow' },
      { permissionKey: 'nin.profile.read', effect: 'allow' },
      { permissionKey: 'profile.me.read', effect: 'allow' },
      { permissionKey: 'profile.me.update', effect: 'allow' },
      { permissionKey: 'profile.nin.refresh.request', effect: 'allow' },
      { permissionKey: 'records.me.read', effect: 'allow' },
      { permissionKey: 'records.symptoms.create', effect: 'allow' },
      { permissionKey: 'records.entry.update', effect: 'allow' },
      { permissionKey: 'records.entry.hide', effect: 'allow' },
      { permissionKey: 'doctor.register', effect: 'allow' },
      { permissionKey: 'emergency.request.create', effect: 'allow' },
      { permissionKey: 'emergency.request.read', effect: 'allow' },
      { permissionKey: 'emergency.room.read', effect: 'allow' },
      { permissionKey: 'emergency.room.message.create', effect: 'allow' },
      { permissionKey: 'emergency.inventory.search', effect: 'allow' },
      { permissionKey: 'governance.case.create', effect: 'allow' },
      { permissionKey: 'governance.case.read', effect: 'allow' },
      { permissionKey: 'governance.case.room.read', effect: 'allow' },
      { permissionKey: 'governance.case.room.message.create', effect: 'allow' },
    ],
  },
  {
    name: 'super',
    description: 'Super administrator',
    scope: 'app',
    organizationId: null,
    isSystem: true,
    permissions: [{ permissionKey: '*', effect: 'allow' }],
  },
];

function emitAuditEvent(event) {
  if (!outboxRepo) return;
  outboxRepo.enqueueOutboxEvent(buildEventEnvelope({
    eventType: event.eventType || 'AUDIT_EVENT',
    sourceService: serviceName,
    aggregateType: event.resource?.type || 'rbac',
    aggregateId: event.resource?.id || event.userId || null,
    payload: event,
    trace: {
      requestId: event.metadata?.requestId || null,
      userId: event.userId || null,
      orgId: event.organizationId || null,
      branchId: event.metadata?.branchId || null,
    },
    destination: 'audit',
  })).catch((err) => {
    fastify.log.warn({ err, eventType: event?.eventType }, 'RBAC outbox enqueue failed');
  });
}

function normalizeOrgId(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizeRoleName(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRoleAlias(value) {
  const normalized = normalizeRoleName(value);
  if (!normalized) return '';
  if (['superadmin', 'super_admin', 'super admin'].includes(normalized)) return 'super';
  return normalized;
}

function rolesMatch(left, right) {
  const l = normalizeRoleAlias(left);
  const r = normalizeRoleAlias(right);
  return Boolean(l) && Boolean(r) && l === r;
}

function parseActiveAppRoleFromContext(context = {}) {
  const contextId = String(context.activeContextId || '').trim().toLowerCase();
  const contextType = String(context.activeContextType || '').trim().toLowerCase();
  const contextName = String(context.activeContextName || '').trim().toLowerCase();
  const explicit = normalizeRoleAlias(context.activeRole || context.activeRoleName);
  if (explicit) return explicit;
  if (contextId === 'app:super') return 'super';
  if (contextId === 'app:citizen') return 'citizen';
  if (contextId.startsWith('app:role:')) {
    return normalizeRoleAlias(contextId.replace('app:role:', ''));
  }
  if (contextType === 'platform' && contextName) {
    return normalizeRoleAlias(contextName);
  }
  return null;
}

function parseActiveOrgRoleFromContext(context = {}) {
  const contextId = String(context.activeContextId || '').trim().toLowerCase();
  const contextType = String(context.activeContextType || '').trim().toLowerCase();
  const explicit = normalizeRoleAlias(context.activeOrgRole || context.activeOrgRoleName);
  if (explicit) return explicit;
  if (contextType !== 'organization') return null;
  const contextParts = contextId.split(':');
  const roleIndex = contextParts.findIndex((part) => part.toLowerCase() === 'role');
  if (roleIndex !== -1 && contextParts[roleIndex + 1]) {
    return normalizeRoleAlias(decodeURIComponent(contextParts[roleIndex + 1]));
  }
  return null;
}

function parseActiveOrgScopeFromContext(context = {}) {
  const contextType = String(context.activeContextType || '').trim().toLowerCase();
  const explicitScopeType = String(context.scopeType || context.activeScopeType || '').trim().toLowerCase();
  const explicitInstitutionId = String(context.institutionId || context.activeInstitutionId || '').trim();
  const explicitBranchId = String(context.branchId || context.activeBranchId || '').trim();

  if (explicitScopeType === 'branch' && explicitBranchId) {
    return {
      scopeType: 'branch',
      institutionId: explicitInstitutionId || null,
      branchId: explicitBranchId,
    };
  }

  if (explicitScopeType === 'institution' && explicitInstitutionId) {
    return {
      scopeType: 'institution',
      institutionId: explicitInstitutionId,
      branchId: null,
    };
  }

  if (explicitScopeType === 'organization') {
    return {
      scopeType: 'organization',
      institutionId: null,
      branchId: null,
    };
  }

  if (contextType !== 'organization') {
    return null;
  }

  const contextId = String(context.activeContextId || '').trim();
  if (!contextId) {
    return { scopeType: 'organization', institutionId: null, branchId: null };
  }

  const parts = contextId.split(':');
  const institutionIndex = parts.findIndex((part) => String(part || '').trim().toLowerCase() === 'institution');
  const branchIndex = parts.findIndex((part) => String(part || '').trim().toLowerCase() === 'branch');
  const institutionId = institutionIndex !== -1 && parts[institutionIndex + 1] && parts[institutionIndex + 1] !== 'none'
    ? decodeURIComponent(parts[institutionIndex + 1])
    : null;
  const branchId = branchIndex !== -1 && parts[branchIndex + 1] && parts[branchIndex + 1] !== 'none'
    ? decodeURIComponent(parts[branchIndex + 1])
    : null;

  if (branchId) {
    return {
      scopeType: 'branch',
      institutionId,
      branchId,
    };
  }

  if (institutionId) {
    return {
      scopeType: 'institution',
      institutionId,
      branchId: null,
    };
  }

  return {
    scopeType: 'organization',
    institutionId: null,
    branchId: null,
  };
}

function normalizeOverrideScope(entry = {}) {
  const scopeType = String(entry.scopeType || entry.scope || '').trim().toLowerCase();
  const institutionId = normalizeOrgId(entry.institutionId || entry.institution || null);
  const branchId = normalizeOrgId(entry.branchId || entry.branch || null);

  if (scopeType === 'branch' && branchId) {
    return {
      scopeType: 'branch',
      institutionId: institutionId || null,
      branchId,
    };
  }

  if (scopeType === 'institution' && institutionId) {
    return {
      scopeType: 'institution',
      institutionId,
      branchId: null,
    };
  }

  if (scopeType === 'organization') {
    return {
      scopeType: 'organization',
      institutionId: null,
      branchId: null,
    };
  }

  return {
    scopeType: null,
    institutionId: null,
    branchId: null,
  };
}

function matchesOverrideScope(entry = {}, activeScopeType = 'organization', activeInstitutionId = null, activeBranchId = null) {
  const normalizedScope = normalizeOverrideScope(entry);
  const scopeType = String(activeScopeType || 'organization').trim().toLowerCase() || 'organization';
  const institutionId = normalizeOrgId(activeInstitutionId);
  const branchId = normalizeOrgId(activeBranchId);

  if (!normalizedScope.scopeType || normalizedScope.scopeType === 'organization') {
    return true;
  }

  if (normalizedScope.scopeType === 'institution') {
    if (!normalizedScope.institutionId) return false;
    if (scopeType !== 'institution' && scopeType !== 'branch') return false;
    return normalizedScope.institutionId === institutionId;
  }

  if (normalizedScope.scopeType === 'branch') {
    if (!normalizedScope.branchId) return false;
    if (scopeType !== 'branch') return false;
    return normalizedScope.branchId === branchId;
  }

  return false;
}

function getActiveContextFromRequest(req) {
  return {
    activeContextId: req.headers['x-active-context-id'] || null,
    activeContextName: req.headers['x-active-context-name'] || null,
    activeContextType: req.headers['x-active-context-type'] || null,
  };
}

function filterAppRolesByActiveRole(roles = [], activeRoleName = null) {
  const roleName = normalizeRoleAlias(activeRoleName);
  if (!roleName) return roles;
  return roles.filter((role) => rolesMatch(role?.name, roleName));
}

function isOrgLeadershipRoleName(roleName) {
  const normalized = normalizeRoleAlias(roleName);
  return normalized === 'owner' || normalized === 'super_staff';
}

function filterOrgRolesByActiveRole(roles = [], activeRoleName = null) {
  const roleName = normalizeRoleAlias(activeRoleName);
  if (!roleName) return roles;
  return roles.filter((role) => {
    const normalizedRole = normalizeRoleAlias(role?.name);
    if (!normalizedRole) return false;
    if (rolesMatch(normalizedRole, roleName)) return true;
    return isOrgLeadershipRoleName(normalizedRole);
  });
}

function filterOverridesByActiveRole(overrides = [], activeRoleName = null) {
  const roleName = normalizeRoleAlias(activeRoleName);
  if (!roleName) return overrides;
  return (Array.isArray(overrides) ? overrides : []).filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const scopedRole = normalizeRoleAlias(entry.roleName || entry.role || entry.contextRole);
    if (!scopedRole) return true;
    return rolesMatch(scopedRole, roleName);
  });
}

function filterOrgOverridesByActiveRole(
  overrides = [],
  activeRoleName = null,
  activeScopeType = 'organization',
  activeInstitutionId = null,
  activeBranchId = null,
) {
  const roleName = normalizeRoleAlias(activeRoleName);
  if (!roleName) {
    return (Array.isArray(overrides) ? overrides : []).filter((entry) =>
      entry && typeof entry === 'object' && matchesOverrideScope(entry, activeScopeType, activeInstitutionId, activeBranchId),
    );
  }
  return (Array.isArray(overrides) ? overrides : []).filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (!matchesOverrideScope(entry, activeScopeType, activeInstitutionId, activeBranchId)) return false;
    const scopedRole = normalizeRoleAlias(entry.roleName || entry.role || entry.contextRole);
    if (!scopedRole) return true;
    if (rolesMatch(scopedRole, roleName)) return true;
    return isOrgLeadershipRoleName(scopedRole);
  });
}

function sanitizeOverrideRules(overrides = []) {
  if (!Array.isArray(overrides)) return [];
  return overrides
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const permissionKey = String(entry.permissionKey || entry.key || '').trim();
      if (!permissionKey) return null;
      const effect = String(entry.effect || entry.value || '').trim().toLowerCase() === 'deny' ? 'deny' : 'allow';
      const roleName = normalizeRoleAlias(entry.roleName || entry.role || entry.contextRole);
      const overrideScope = normalizeOverrideScope(entry);
      const rule = { permissionKey, effect };
      if (roleName) {
        rule.roleName = roleName;
      }
      if (overrideScope.scopeType) {
        rule.scopeType = overrideScope.scopeType;
      }
      if (overrideScope.institutionId) {
        rule.institutionId = overrideScope.institutionId;
      }
      if (overrideScope.branchId) {
        rule.branchId = overrideScope.branchId;
      }
      return rule;
    })
    .filter(Boolean);
}

function isLockedAppRoleName(name) {
  return String(name || '').trim().toLowerCase() === 'super';
}

function isLockedOrgRoleName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return normalized === 'owner' || normalized === 'super_staff';
}

function normalizeUserId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

async function syncExclusiveOrgLeadershipRoles({
  organizationId,
  ownerUserId = null,
  createdByUserId = null,
  previousOwnerUserId = null,
}) {
  const roles = await ensureDefaultOrgRoles(organizationId);
  const ownerRole = roles.find((role) => normalizeRoleAlias(role?.name) === 'owner') || null;
  const superStaffRole = roles.find((role) => normalizeRoleAlias(role?.name) === 'super_staff') || null;
  const ownerRoleId = ownerRole ? String(ownerRole._id) : null;
  const superStaffRoleId = superStaffRole ? String(superStaffRole._id) : null;
  const specialRoleIds = [ownerRoleId, superStaffRoleId].filter(Boolean);

  async function mergeExclusiveRoles(userId, desiredExclusiveRoleId = null) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return;
    const existing = await collections.roleAssignments().findOne({
      userId: normalizedUserId,
      scope: 'org',
      organizationId,
    });
    const existingRoleIds = Array.isArray(existing?.roleIds) ? existing.roleIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
    const existingRoleDocs = await getRoleDocsByIds(existingRoleIds);
    const validExistingRoleIds = new Set(existingRoleDocs
      .filter((role) => String(role.scope || '') === 'org' && normalizeOrgId(role.organizationId) === normalizeOrgId(organizationId))
      .map((role) => String(role._id)));
    const preservedRoleIds = existingRoleIds.filter((roleId) => validExistingRoleIds.has(roleId) && !specialRoleIds.includes(roleId));
    const nextRoleIds = desiredExclusiveRoleId ? [...preservedRoleIds, desiredExclusiveRoleId] : preservedRoleIds;

    await collections.roleAssignments().updateOne(
      { userId: normalizedUserId, scope: 'org', organizationId },
      {
        $set: {
          userId: normalizedUserId,
          scope: 'org',
          organizationId,
          roleIds: nextRoleIds,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }

  const normalizedOwnerUserId = normalizeUserId(ownerUserId);
  const normalizedCreatorUserId = normalizeUserId(createdByUserId);
  const normalizedPreviousOwnerUserId = normalizeUserId(previousOwnerUserId);

  if (normalizedPreviousOwnerUserId
    && normalizedPreviousOwnerUserId !== normalizedOwnerUserId
    && normalizedPreviousOwnerUserId !== normalizedCreatorUserId) {
    await mergeExclusiveRoles(normalizedPreviousOwnerUserId, null);
  }

  if (normalizedOwnerUserId) {
    await mergeExclusiveRoles(normalizedOwnerUserId, ownerRoleId);
  }

  if (normalizedCreatorUserId) {
    const creatorDesiredRoleId = normalizedCreatorUserId === normalizedOwnerUserId ? ownerRoleId : superStaffRoleId;
    await mergeExclusiveRoles(normalizedCreatorUserId, creatorDesiredRoleId);
  }

  return {
    roles,
    ownerRole,
    superStaffRole,
  };
}

async function sanitizeExclusiveLeadershipRoleIds(roleIds = [], organizationId = null) {
  const normalizedRoleIds = Array.isArray(roleIds)
    ? roleIds.map((roleId) => String(roleId || '').trim()).filter(Boolean)
    : [];
  if (!organizationId || normalizedRoleIds.length === 0) return normalizedRoleIds;

  const leadershipRoles = await collections.roles().find({
    scope: 'org',
    organizationId,
    name: { $in: ['owner', 'super_staff'] },
  }).toArray();
  const ownerRoleId = leadershipRoles.find((role) => normalizeRoleAlias(role?.name) === 'owner')?._id;
  const superStaffRoleId = leadershipRoles.find((role) => normalizeRoleAlias(role?.name) === 'super_staff')?._id;
  const ownerRoleIdString = ownerRoleId ? String(ownerRoleId) : null;
  const superStaffRoleIdString = superStaffRoleId ? String(superStaffRoleId) : null;
  if (!ownerRoleIdString || !superStaffRoleIdString) return normalizedRoleIds;
  if (!normalizedRoleIds.includes(ownerRoleIdString) || !normalizedRoleIds.includes(superStaffRoleIdString)) {
    return normalizedRoleIds;
  }
  return normalizedRoleIds.filter((roleId) => roleId !== superStaffRoleIdString);
}

async function resolveOrgRoleDocsByIds(roleIds = [], organizationId = null) {
  const normalizedOrganizationId = normalizeOrgId(organizationId);
  if (!normalizedOrganizationId) return [];
  const docs = await getRoleDocsByIds(roleIds);
  return docs.filter((role) => String(role.scope || '') === 'org' && normalizeOrgId(role.organizationId) === normalizedOrganizationId);
}

async function resolveOrgRoleIdsByNames(roleNames = [], organizationId = null) {
  const normalizedOrganizationId = normalizeOrgId(organizationId);
  const normalizedRoleNames = Array.isArray(roleNames)
    ? Array.from(new Set(
      roleNames
        .map((roleName) => normalizeRoleAlias(roleName))
        .filter(Boolean),
    ))
    : [];
  if (!normalizedOrganizationId || normalizedRoleNames.length === 0) {
    return { roleIds: [], roleDocs: [], missingRoleNames: [] };
  }

  const roleDocs = await getRoleDocsByNames(normalizedRoleNames, 'org', normalizedOrganizationId);
  const roleNameMap = new Map(roleDocs.map((role) => [normalizeRoleAlias(role?.name), role]));
  const missingRoleNames = normalizedRoleNames.filter((roleName) => !roleNameMap.has(roleName));
  return {
    roleIds: roleDocs.map((role) => String(role._id)),
    roleDocs,
    missingRoleNames,
  };
}

async function syncMembershipRolesFromOrgAssignment(organizationId, userId, roleIds = []) {
  const normalizedOrganizationId = normalizeOrgId(organizationId);
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedOrganizationId || !normalizedUserId) return;

  const roleDocs = await resolveOrgRoleDocsByIds(roleIds, normalizedOrganizationId);
  const roleNames = roleDocs
    .map((role) => String(role?.name || '').trim())
    .filter(Boolean);

  try {
    const response = await fetch(`${membershipApiBaseUrl}/internal/memberships/org/${encodeURIComponent(normalizedOrganizationId)}/users/${encodeURIComponent(normalizedUserId)}/roles`, {
      method: 'POST',
      headers: {
        'x-internal-token': internalServiceToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ roles: roleNames }),
    });
    if (response.status === 404) {
      return;
    }
    if (!response.ok) {
      const text = await response.text();
      fastify.log.warn({ organizationId: normalizedOrganizationId, userId: normalizedUserId, status: response.status, body: text }, 'Failed to sync membership roles from RBAC assignment');
    }
  } catch (err) {
    fastify.log.warn({ err, organizationId: normalizedOrganizationId, userId: normalizedUserId }, 'Membership role sync request failed');
  }
}

async function persistOrgRoleAssignment(organizationId, userId, roleIds = []) {
  const normalizedOrganizationId = normalizeOrgId(organizationId);
  const normalizedUserId = normalizeUserId(userId);
  const sanitizedRoleIds = await sanitizeExclusiveLeadershipRoleIds(roleIds, normalizedOrganizationId);

  if (!normalizedOrganizationId || !normalizedUserId) {
    return [];
  }

  if (sanitizedRoleIds.length === 0) {
    await collections.roleAssignments().deleteOne({ userId: normalizedUserId, scope: 'org', organizationId: normalizedOrganizationId });
  } else {
    await collections.roleAssignments().updateOne(
      { userId: normalizedUserId, scope: 'org', organizationId: normalizedOrganizationId },
      {
        $set: {
          userId: normalizedUserId,
          scope: 'org',
          organizationId: normalizedOrganizationId,
          roleIds: sanitizedRoleIds,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }

  await syncMembershipRolesFromOrgAssignment(normalizedOrganizationId, normalizedUserId, sanitizedRoleIds);
  await bumpCacheVersion();
  return sanitizedRoleIds;
}

async function findAppRoleByAnyIdentifier(roleIdentifier) {
  const value = String(roleIdentifier || '').trim();
  if (!value) return null;
  if (ObjectId.isValid(value)) {
    const byId = await collections.roles().findOne({ _id: new ObjectId(value), scope: 'app', organizationId: null });
    if (byId) return byId;
  }
  return collections.roles().findOne({ name: value, scope: 'app', organizationId: null });
}

async function resolveRoleNamesFromIds(roleIds = [], scope = 'app', organizationId = null) {
  const ids = Array.isArray(roleIds) ? roleIds : [];
  if (ids.length === 0) return [];
  const byIdObjectIds = ids
    .filter((id) => ObjectId.isValid(String(id)))
    .map((id) => new ObjectId(String(id)));
  const byIdRows = byIdObjectIds.length > 0
    ? await collections.roles().find({ _id: { $in: byIdObjectIds }, scope, organizationId }).toArray()
    : [];

  const unresolvedNames = ids
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .filter((id) => !ObjectId.isValid(id));

  const byNameRows = unresolvedNames.length > 0
    ? await collections.roles().find({ name: { $in: unresolvedNames }, scope, organizationId }).toArray()
    : [];

  return Array.from(new Set([...byIdRows, ...byNameRows].map((role) => String(role.name || '').trim().toLowerCase()).filter(Boolean)));
}

function parseAuthHeader(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

async function getCacheVersion() {
  if (!redisReady) {
    return '0';
  }
  const val = await redisClient.get('rbac:version');
  return val || '0';
}

async function bumpCacheVersion() {
  if (!redisReady) {
    return;
  }
  await redisClient.incr('rbac:version');
}

async function requireAuth(req, reply) {
  const token = parseAuthHeader(req);
  if (!token) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    const context = getActiveContextFromRequest(req);
    const activeOrgScope = parseActiveOrgScopeFromContext(context);
    req.auth = {
      userId: String(payload.sub),
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      tokenPayload: payload,
      activeContext: context,
      activeAppRoleName: parseActiveAppRoleFromContext(context),
      activeOrgRoleName: parseActiveOrgRoleFromContext(context),
      activeOrgScopeType: activeOrgScope?.scopeType || null,
      activeInstitutionId: activeOrgScope?.institutionId || null,
      activeBranchId: activeOrgScope?.branchId || null,
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

async function connect() {
  if (!mongoUri) {
    fastify.log.warn('MONGODB_URI missing; RBAC service running in degraded mode');
  } else {
    void ensureMongoConnection();
  }

  if (!redisClient) {
    redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => fastify.log.error({ err }, 'Redis error'));
  }

  if (!redisReady) {
    try {
      await redisClient.connect();
      redisReady = true;
    } catch (err) {
      fastify.log.warn({ err }, 'Redis connection failed; continuing without cache');
    }
  }
}

async function closeMongoClientQuietly() {
  if (!mongoClient) return;
  try {
    await mongoClient.close();
  } catch (_err) {
    // Ignore cleanup failures while retrying the RBAC database connection.
  }
  mongoClient = null;
}

function isMongoConnectivityError(err) {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const name = String(err.name || '');
  const message = String(err.message || '').toLowerCase();
  return [
    'MongoExpiredSessionError',
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongoNotConnectedError',
    'MongoRuntimeError',
    'MongoServerSelectionError',
    'MongoTopologyClosedError',
  ].includes(name)
    || message.includes('session that has ended')
    || message.includes('topology is closed')
    || message.includes('timed out')
    || message.includes('socket connection establishment was cancelled');
}

async function degradeMongoConnection(err, logMessage) {
  dbReady = false;
  dbWritable = false;
  db = null;
  outboxRepo = null;
  if (logMessage) {
    fastify.log.warn({ err }, logMessage);
  }
  await closeMongoClientQuietly();
  scheduleMongoReconnect();
}

function degradeMongoWritableState(err, logMessage) {
  dbWritable = false;
  outboxRepo = null;
  if (logMessage) {
    fastify.log.warn({ err }, logMessage);
  }
  void ensureMongoWritableState();
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

function createMongoConnectionClient() {
  return new MongoClient(mongoUri, {
    connectTimeoutMS: 10000,
    readPreference: 'secondaryPreferred',
    serverSelectionTimeoutMS: 15000,
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
}

async function ensureMongoConnection() {
  if (dbReady) {
    return true;
  }
  if (!mongoUri) {
    fastify.log.warn('MONGODB_URI missing; RBAC service running in degraded mode');
    return false;
  }
  if (mongoConnectPromise) {
    return mongoConnectPromise;
  }

  mongoConnectPromise = (async () => {
    try {
      await closeMongoClientQuietly();
      mongoClient = createMongoConnectionClient();
      await mongoClient.connect();
      db = mongoClient.db(dbName);
      await db.command({ ping: 1 });
      dbReady = true;
      dbWritable = false;
      outboxRepo = null;

      try {
        outboxRepo = createOutboxRepository(db);
        await Promise.all([
          collections.permissions().createIndex({ key: 1, scope: 1, organizationId: 1 }, { unique: true }),
          collections.roles().createIndex({ name: 1, scope: 1, organizationId: 1 }, { unique: true }),
          collections.userAccess().createIndex({ userId: 1, scope: 1, organizationId: 1 }, { unique: true }),
          collections.roleAssignments().createIndex({ userId: 1, scope: 1, organizationId: 1 }, { unique: true }),
          outboxRepo.createIndexes(),
        ]);

        // Compatibility cleanup for older schema versions that used `code` instead of `key`.
        // This prevents duplicate-key failures on legacy `code_1` unique index during bootstrapping.
        try {
          const permissionIndexes = await collections.permissions().indexes();
          if (permissionIndexes.some((idx) => idx.name === 'code_1')) {
            await collections.permissions().dropIndex('code_1');
          }
        } catch (err) {
          fastify.log.warn({ err }, 'Failed to cleanup legacy RBAC permission indexes');
        }

        try {
          const roleIndexes = await collections.roles().indexes();
          if (roleIndexes.some((idx) => idx.name === 'name_1')) {
            await collections.roles().dropIndex('name_1');
          }
        } catch (err) {
          fastify.log.warn({ err }, 'Failed to cleanup legacy RBAC role indexes');
        }

        for (const perm of systemPermissions) {
          await collections.permissions().updateOne(
            { key: perm.key, scope: perm.scope, organizationId: null },
            {
              $set: {
                key: perm.key,
                name: perm.name,
                description: perm.description || perm.name,
                scope: perm.scope,
                module: perm.module,
                actions: perm.actions,
                isSystem: true,
                organizationId: null,
                updatedAt: new Date(),
              },
              $setOnInsert: { createdAt: new Date() },
            },
            { upsert: true }
          );
        }

        for (const role of systemRoles.filter((r) => r.scope === 'app')) {
          await collections.roles().updateOne(
            { name: role.name, scope: 'app', organizationId: null },
            {
              $set: {
                name: role.name,
                description: role.description,
                scope: 'app',
                organizationId: null,
                permissions: role.permissions,
                isSystem: true,
                updatedAt: new Date(),
              },
              $setOnInsert: { createdAt: new Date() },
            },
            { upsert: true }
          );
        }

        // Remove legacy app system roles so only citizen/super remain as defaults.
        // Do not remove org system roles here; owner/super_staff are per-org built-ins.
        await collections.roles().deleteMany({
          isSystem: true,
          scope: 'app',
          name: { $nin: ['citizen', 'super'] },
        });

        if (redisReady) {
          await redisClient.setNX('rbac:version', '1');
        }

        dbWritable = true;
      } catch (err) {
        outboxRepo = null;
        if (isMongoConnectivityError(err)) {
          fastify.log.warn({ err }, 'RBAC writable bootstrap unavailable; continuing in read-only mode');
        } else {
          throw err;
        }
      }

      fastify.log.info({ dbName, redisReady, dbWritable }, 'RBAC service initialized');
      if (fastify.server && fastify.server.listening && dbWritable) {
        startOrgLeadershipAudit();
      }
      return true;
    } catch (err) {
      await degradeMongoConnection(err, 'MongoDB connection failed; RBAC service in degraded mode');
      return false;
    } finally {
      mongoConnectPromise = null;
    }
  })();

  return mongoConnectPromise;
}

async function ensureMongoWritableState() {
  if (dbWritable) {
    return true;
  }
  if (!mongoUri) {
    fastify.log.warn('MONGODB_URI missing; RBAC service cannot restore writable mode');
    return false;
  }
  if (mongoWritableRecoveryPromise) {
    return mongoWritableRecoveryPromise;
  }

  mongoWritableRecoveryPromise = (async () => {
    if (mongoConnectPromise) {
      const connected = await mongoConnectPromise;
      return Boolean(connected && dbWritable);
    }

    if (!dbReady) {
      const connected = await ensureMongoConnection();
      return Boolean(connected && dbWritable);
    }

    dbReady = false;
    dbWritable = false;
    db = null;
    outboxRepo = null;
    await closeMongoClientQuietly();

    const connected = await ensureMongoConnection();
    if (connected && dbWritable) {
      fastify.log.info({ dbName }, 'RBAC writable state recovered');
      return true;
    }
    return false;
  })().finally(() => {
    mongoWritableRecoveryPromise = null;
  });

  return mongoWritableRecoveryPromise;
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
  outboxTimer = setInterval(() => {
    void flushOutboxOnce().catch(async (err) => {
      if (isMongoConnectivityError(err)) {
        degradeMongoWritableState(err, 'RBAC outbox lost MongoDB write connectivity; continuing in read-only mode');
        return;
      }
      fastify.log.warn({ err }, 'RBAC outbox flush failed');
    });
  }, outboxIntervalMs);
}

function assertDependencyReady(reply) {
  if (!dbReady) {
    void ensureMongoConnection();
    reply.code(503).send({ message: 'RBAC storage unavailable' });
    return false;
  }
  return true;
}

async function getRoleDocsByIds(roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    return [];
  }
  const objectIds = roleIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (objectIds.length === 0) {
    return [];
  }
  return collections.roles().find({ _id: { $in: objectIds } }).toArray();
}

async function getRoleDocsByNames(roleNames, scope = 'app', organizationId = null) {
  if (!Array.isArray(roleNames) || roleNames.length === 0) {
    return [];
  }
  const names = roleNames
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean);
  const expanded = new Set(names);
  for (const name of names) {
    if (name === 'superadmin' || name === 'super_admin' || name === 'super admin') {
      expanded.add('super');
    }
  }
  const expandedNames = Array.from(expanded);
  if (expandedNames.length === 0) {
    return [];
  }
  const exactMatches = await collections.roles().find({ name: { $in: expandedNames }, scope, organizationId }).toArray();
  const matchedAliases = new Set(exactMatches.map((role) => normalizeRoleAlias(role?.name)).filter(Boolean));
  const unresolved = expandedNames.filter((name) => !matchedAliases.has(name));
  if (unresolved.length === 0) {
    return exactMatches;
  }
  const fallbackMatches = await collections.roles().find({ scope, organizationId }).toArray();
  const resolvedFallbacks = fallbackMatches.filter((role) => unresolved.includes(normalizeRoleAlias(role?.name)));
  return Array.from(new Map(
    [...exactMatches, ...resolvedFallbacks].map((role) => [String(role._id), role]),
  ).values());
}

function normalizePermissionRuleList(rules = []) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule) => {
      if (typeof rule === 'string') {
        const permissionKey = String(rule).trim();
        if (!permissionKey) return null;
        return { permissionKey, effect: 'allow' };
      }
      if (!rule || typeof rule !== 'object') return null;
      const permissionKey = String(rule.permissionKey || rule.key || '').trim();
      if (!permissionKey) return null;
      const normalized = {
        permissionKey,
        effect: String(rule.effect || rule.value || '').trim().toLowerCase() === 'deny' ? 'deny' : 'allow',
      };
      const roleName = normalizeRoleAlias(rule.roleName || rule.role || rule.contextRole);
      if (roleName) {
        normalized.roleName = roleName;
      }
      return normalized;
    })
    .filter(Boolean);
}

function serializeRoleDoc(role) {
  if (!role || typeof role !== 'object') return null;
  return {
    _id: role._id ? String(role._id) : null,
    name: String(role.name || '').trim(),
    description: role.description ? String(role.description) : '',
    scope: role.scope ? String(role.scope) : null,
    organizationId: role.organizationId ? String(role.organizationId) : null,
    permissions: normalizePermissionRuleList(role.permissions),
    isSystem: !!role.isSystem,
  };
}

function serializeRoleDocs(roles = []) {
  return (Array.isArray(roles) ? roles : [])
    .map((role) => serializeRoleDoc(role))
    .filter(Boolean);
}

function serializeAssignmentDoc(assignment) {
  if (!assignment || typeof assignment !== 'object') return null;
  return {
    _id: assignment._id ? String(assignment._id) : null,
    userId: assignment.userId ? String(assignment.userId) : null,
    scope: assignment.scope ? String(assignment.scope) : null,
    organizationId: assignment.organizationId ? String(assignment.organizationId) : null,
    roleIds: Array.isArray(assignment.roleIds) ? assignment.roleIds.map((id) => String(id)) : [],
    createdAt: assignment.createdAt || null,
    updatedAt: assignment.updatedAt || null,
  };
}

function serializeOverridesDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;
  return {
    _id: doc._id ? String(doc._id) : null,
    userId: doc.userId ? String(doc.userId) : null,
    scope: doc.scope ? String(doc.scope) : null,
    organizationId: doc.organizationId ? String(doc.organizationId) : null,
    overrides: sanitizeOverrideRules(doc.overrides || []),
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

async function fetchMembershipScopeSummary(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return null;
  }

  try {
    const response = await fetch(`${membershipApiBaseUrl}/internal/memberships/summary/${encodeURIComponent(normalizedUserId)}`, {
      method: 'GET',
      headers: {
        'x-internal-token': internalServiceToken,
        'content-type': 'application/json',
      },
    });
    if (!response.ok) {
      fastify.log.warn({ status: response.status, userId: normalizedUserId }, 'Failed to fetch membership scope summary');
      return null;
    }
    return await response.json();
  } catch (err) {
    fastify.log.warn({ err, userId: normalizedUserId }, 'Failed to fetch membership scope summary');
    return null;
  }
}

function collectScopedRoleNamesFromSummary(summary, organizationId, activeScopeType, institutionId = null, branchId = null) {
  const normalizedOrganizationId = normalizeOrgId(organizationId);
  if (!normalizedOrganizationId || !summary || typeof summary !== 'object') {
    return [];
  }

  const assignments = Array.isArray(summary.activeAssignments) ? summary.activeAssignments : [];
  const matchingAssignments = assignments.filter((assignment) => {
    if (!assignment || typeof assignment !== 'object') return false;
    if (normalizeOrgId(assignment.organizationId) !== normalizedOrganizationId) return false;
    if (activeScopeType === 'branch') {
      return String(assignment.branchId || '').trim() === String(branchId || '').trim();
    }
    if (activeScopeType === 'institution') {
      return String(assignment.institutionId || '').trim() === String(institutionId || '').trim()
        && !String(assignment.branchId || '').trim();
    }
    return false;
  });

  return Array.from(new Set(
    matchingAssignments.flatMap((assignment) => (
      Array.isArray(assignment.roles)
        ? assignment.roles.map((role) => normalizeRoleAlias(role)).filter(Boolean)
        : []
    )),
  ));
}

function buildArtifactsCacheKey(userId, organizationId, fallbackRoleNames = [], options = {}, cacheVersion = 1) {
  const orgId = normalizeOrgId(organizationId) || 'app';
  const fallbackRoles = Array.isArray(fallbackRoleNames)
    ? Array.from(new Set(
      fallbackRoleNames
        .map((role) => normalizeRoleAlias(role))
        .filter(Boolean),
    )).sort().join(',') || 'none'
    : 'none';
  const activeAppRoleName = normalizeRoleAlias(options.activeAppRoleName) || 'all-app-roles';
  const activeOrgRoleName = normalizeRoleAlias(options.activeOrgRoleName) || 'all-org-roles';
  const activeScopeType = String(options.activeScopeType || 'organization').trim().toLowerCase() || 'organization';
  const activeInstitutionId = String(options.activeInstitutionId || 'none').trim() || 'none';
  const activeBranchId = String(options.activeBranchId || 'none').trim() || 'none';
  return `rbac:artifacts:v${cacheVersion}:${String(userId)}:${orgId}:${fallbackRoles}:${activeAppRoleName}:${activeOrgRoleName}:${activeScopeType}:${activeInstitutionId}:${activeBranchId}`;
}

async function getUserScopeArtifactsUncached(userId, organizationId, fallbackRoleNames = [], options = {}) {
  const orgId = normalizeOrgId(organizationId);
  const activeAppRoleName = normalizeRoleAlias(options.activeAppRoleName);
  const activeOrgRoleName = normalizeRoleAlias(options.activeOrgRoleName);
  const activeScopeType = String(options.activeScopeType || 'organization').trim().toLowerCase() || 'organization';
  const activeInstitutionId = String(options.activeInstitutionId || '').trim() || null;
  const activeBranchId = String(options.activeBranchId || '').trim() || null;

  const appAssignment = await collections.roleAssignments().findOne({
    userId,
    scope: 'app',
    organizationId: null,
  });
  const orgAssignment = orgId
    ? await collections.roleAssignments().findOne({ userId, scope: 'org', organizationId: orgId })
    : null;

  const appRolesByAssignment = await getRoleDocsByIds(appAssignment?.roleIds || []);
  const appRolesByToken = await getRoleDocsByNames(fallbackRoleNames, 'app', null);
  const appRoleMap = new Map();
  for (const role of [...appRolesByAssignment, ...appRolesByToken]) {
    appRoleMap.set(String(role._id), role);
  }
  let appRoles = Array.from(appRoleMap.values());
  if (appRoles.length === 0) {
    const citizenRole = await collections.roles().findOne({ name: 'citizen', scope: 'app', organizationId: null });
    if (citizenRole) {
      appRoles.push(citizenRole);
    }
  }
  appRoles = filterAppRolesByActiveRole(appRoles, activeAppRoleName);
  const orgRolesByAssignment = await getRoleDocsByIds(orgAssignment?.roleIds || []);
  const scopedRoleNames = orgId && activeScopeType !== 'organization'
    ? collectScopedRoleNamesFromSummary(
      await fetchMembershipScopeSummary(userId),
      orgId,
      activeScopeType,
      activeInstitutionId,
      activeBranchId,
    )
    : [];
  const scopedOrgRoles = orgId && scopedRoleNames.length > 0
    ? await getRoleDocsByNames(scopedRoleNames, 'org', orgId)
    : [];

  const orgRoleMap = new Map();
  const roleSources = activeScopeType === 'organization'
    ? orgRolesByAssignment
    : [
      ...orgRolesByAssignment.filter((role) => isOrgLeadershipRoleName(role?.name)),
      ...scopedOrgRoles,
    ];
  for (const role of roleSources) {
    orgRoleMap.set(String(role._id), role);
  }
  let orgRoles = Array.from(orgRoleMap.values());
  orgRoles = filterOrgRolesByActiveRole(orgRoles, activeOrgRoleName);

  const appOverridesDoc = await collections.userAccess().findOne({
    userId,
    scope: 'app',
    organizationId: null,
  });

  const orgOverridesDoc = orgId
    ? await collections.userAccess().findOne({ userId, scope: 'org', organizationId: orgId })
    : null;

  const leadershipOrgPermissionRules = orgId && orgRoles.some((role) => isOrgLeadershipRoleName(role?.name))
    ? (await collections.permissions().find({ scope: 'org', organizationId: orgId }).toArray())
      .map((permission) => ({
        permissionKey: String(permission?.key || '').trim(),
        effect: 'allow',
      }))
      .filter((rule) => rule.permissionKey)
    : [];
  const scopedCareFoundationRules = activeScopeType !== 'organization' && roleSources.length > 0
    ? scopedCareFoundationPermissionKeys.map((permissionKey) => ({
      permissionKey,
      effect: 'allow',
    }))
    : [];

  const roleRules = [
    ...appRoles.flatMap((r) => r.permissions || []),
    ...orgRoles.flatMap((r) => r.permissions || []),
    ...scopedCareFoundationRules,
    ...leadershipOrgPermissionRules,
  ];

  const filteredAppOverrides = filterOverridesByActiveRole(appOverridesDoc?.overrides || [], activeAppRoleName);
  const filteredOrgOverrides = filterOrgOverridesByActiveRole(
    orgOverridesDoc?.overrides || [],
    activeOrgRoleName,
    activeScopeType,
    activeInstitutionId,
    activeBranchId,
  );
  const overrideRules = [
    ...filteredAppOverrides,
    ...filteredOrgOverrides,
  ];

  return {
    appRoles: serializeRoleDocs(appRoles),
    orgRoles: serializeRoleDocs(orgRoles),
    roleRules: normalizePermissionRuleList(roleRules),
    overrideRules: normalizePermissionRuleList(overrideRules),
    appAssignment: serializeAssignmentDoc(appAssignment),
    orgAssignment: serializeAssignmentDoc(orgAssignment),
    appOverridesDoc: serializeOverridesDoc(appOverridesDoc),
    orgOverridesDoc: serializeOverridesDoc(orgOverridesDoc),
    activeAppRoleName: activeAppRoleName || null,
    activeOrgRoleName: activeOrgRoleName || null,
    activeScopeType,
    activeInstitutionId,
    activeBranchId,
    filteredAppOverrides: sanitizeOverrideRules(filteredAppOverrides),
    filteredOrgOverrides: sanitizeOverrideRules(filteredOrgOverrides),
  };
}

async function getUserScopeArtifacts(userId, organizationId, fallbackRoleNames = [], options = {}) {
  if (!redisReady) {
    return getUserScopeArtifactsUncached(userId, organizationId, fallbackRoleNames, options);
  }

  const cacheVersion = Number.isFinite(Number(options.cacheVersion))
    ? Number(options.cacheVersion)
    : await getCacheVersion();
  const cacheKey = buildArtifactsCacheKey(userId, organizationId, fallbackRoleNames, options, cacheVersion);
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const artifacts = await getUserScopeArtifactsUncached(userId, organizationId, fallbackRoleNames, options);
  await redisClient.set(cacheKey, JSON.stringify(artifacts), { EX: cacheTtlSec });
  return artifacts;
}

async function computeCheckResult({
  userId,
  permissionKey,
  organizationId,
  branchId = null,
  fallbackRoleNames = [],
  activeAppRoleName = null,
  activeOrgRoleName = null,
  activeScopeType = 'organization',
  activeInstitutionId = null,
  activeBranchId = null,
}) {
  const orgId = normalizeOrgId(organizationId);
  const branchScope = String(activeBranchId || branchId || 'all');
  const appRoleScope = normalizeRoleAlias(activeAppRoleName) || 'all-app-roles';
  const orgRoleScope = normalizeRoleAlias(activeOrgRoleName) || 'all-org-roles';
  const scopeType = String(activeScopeType || 'organization').trim().toLowerCase() || 'organization';
  const institutionScope = String(activeInstitutionId || 'none').trim() || 'none';

  const cacheVersion = await getCacheVersion();
  const cacheKey = `rbac:check:v${cacheVersion}:${userId}:${orgId || 'app'}:${scopeType}:${institutionScope}:${branchScope}:${appRoleScope}:${orgRoleScope}:${permissionKey}`;
  if (redisReady) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return { ...JSON.parse(cached), fromCache: true };
    }
  }

  const artifacts = await getUserScopeArtifacts(userId, orgId, fallbackRoleNames, {
    activeAppRoleName,
    activeOrgRoleName,
    activeScopeType: scopeType,
    activeInstitutionId,
    activeBranchId: activeBranchId || branchId || null,
    cacheVersion,
  });

  const result = evaluatePermission({
    permissionKey,
    roleRules: artifacts.roleRules,
    overrideRules: artifacts.overrideRules,
  });

  const response = {
    allowed: result.allowed,
    reason: result.reason,
    effectiveFrom: result.effectiveFrom,
    matchedRules: {
      roleRules: result.matchedRules.roleRules,
      overrideRules: result.matchedRules.overrideRules,
      roleNames: [...artifacts.appRoles, ...artifacts.orgRoles].map((r) => r.name),
      activeAppRoleName: artifacts.activeAppRoleName,
      activeOrgRoleName: artifacts.activeOrgRoleName,
      activeScopeType: artifacts.activeScopeType,
    },
    organizationId: orgId,
    institutionId: activeInstitutionId ? String(activeInstitutionId) : null,
    branchId: activeBranchId ? String(activeBranchId) : (branchId ? String(branchId) : null),
  };

  if (redisReady) {
    await redisClient.set(cacheKey, JSON.stringify(response), { EX: cacheTtlSec });
  }

  return response;
}

async function isPlatformAdmin(userId, fallbackRoleNames = [], activeAppRoleName = null) {
  const normalizedActive = normalizeRoleAlias(activeAppRoleName);
  const lowered = Array.isArray(fallbackRoleNames)
    ? fallbackRoleNames.map((role) => String(role || '').trim().toLowerCase())
    : [];
  const activeRoleLocksScope = Boolean(normalizedActive) && !rolesMatch(normalizedActive, 'super');
  if (!activeRoleLocksScope && (lowered.includes('super') || lowered.includes('superadmin') || lowered.includes('super_admin') || lowered.includes('super admin'))) {
    return true;
  }
  const result = await computeCheckResult({
    userId,
    permissionKey: 'rbac.app.manage',
    organizationId: null,
    fallbackRoleNames,
    activeAppRoleName: normalizedActive || null,
  });
  return result.allowed;
}

async function isOrgAdmin(userId, organizationId, fallbackRoleNames = [], activeOrgRoleName = null, activeAppRoleName = null) {
  const result = await computeCheckResult({
    userId,
    permissionKey: 'rbac.org.manage',
    organizationId,
    fallbackRoleNames,
    activeOrgRoleName: normalizeRoleAlias(activeOrgRoleName) || null,
    activeAppRoleName: normalizeRoleAlias(activeAppRoleName) || null,
    activeScopeType: 'organization',
    activeInstitutionId: null,
    activeBranchId: null,
  });
  return result.allowed;
}

async function ensureDefaultOrgRoles(organizationId) {
  const orgId = normalizeOrgId(organizationId);
  if (!orgId) return [];

  const orgPermissionTemplates = orgScopedSystemPermissionTemplates.filter((entry) => orgWorkspacePermissionKeys.includes(entry.key));
  for (const perm of orgPermissionTemplates) {
    await collections.permissions().updateOne(
      { key: perm.key, scope: 'org', organizationId: orgId },
      {
        $set: {
          key: perm.key,
          name: perm.name,
          description: perm.description || perm.name,
          scope: 'org',
          module: perm.module,
          actions: Array.isArray(perm.actions) ? perm.actions : [],
          isSystem: true,
          organizationId: orgId,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }

  const orgWorkspacePermissions = Array.from(new Set(orgPermissionTemplates.map((entry) => entry.key)))
    .map((permissionKey) => ({ permissionKey, effect: 'allow' }));

  const defaults = [
    {
      name: 'owner',
      description: 'Organization owner role',
      permissions: orgWorkspacePermissions,
    },
    {
      name: 'super_staff',
      description: 'Organization super staff role',
      permissions: orgWorkspacePermissions,
    },
  ];

  const roles = [];
  for (const role of defaults) {
    await collections.roles().updateOne(
      { name: role.name, scope: 'org', organizationId: orgId },
      {
        $set: {
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          scope: 'org',
          organizationId: orgId,
          isSystem: true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
    const created = await collections.roles().findOne({ name: role.name, scope: 'org', organizationId: orgId });
    if (created) roles.push(created);
  }

  return roles;
}

async function auditExistingOrgWorkspaceAccess() {
  const orgIds = new Set();

  async function collectOrganizationIds(collection, match) {
    const rows = await collection.aggregate([
      { $match: match },
      { $group: { _id: '$organizationId' } },
    ]).toArray();
    for (const row of rows) {
      const normalized = normalizeOrgId(row?._id);
      if (normalized) orgIds.add(normalized);
    }
  }

  await collectOrganizationIds(collections.permissions(), { scope: 'org' });
  await collectOrganizationIds(collections.roles(), { scope: 'org' });
  await collectOrganizationIds(collections.roleAssignments(), { scope: 'org' });
  await collectOrganizationIds(membershipCollections.orgMemberships(), {});

  let audited = 0;
  let sanitizedRoles = 0;
  let sanitizedOverrides = 0;
  for (const organizationId of orgIds) {
    await ensureDefaultOrgRoles(organizationId);
    const sanitized = await sanitizeOrgScopedArtifacts(organizationId);
    sanitizedRoles += sanitized.rolesUpdated;
    sanitizedOverrides += sanitized.overridesUpdated;
    audited += 1;
  }
  return { auditedOrganizations: audited, sanitizedRoles, sanitizedOverrides };
}

function arraysEqualAsStrings(left = [], right = []) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (String(left[i] || '') !== String(right[i] || '')) {
      return false;
    }
  }
  return true;
}

function permissionRulesEqual(left = [], right = []) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const leftRule = left[i] || {};
    const rightRule = right[i] || {};
    if (String(leftRule.permissionKey || '') !== String(rightRule.permissionKey || '')) return false;
    if (String(leftRule.effect || '') !== String(rightRule.effect || '')) return false;
    if (String(leftRule.roleName || '') !== String(rightRule.roleName || '')) return false;
    if (String(leftRule.scopeType || '') !== String(rightRule.scopeType || '')) return false;
    if (String(leftRule.institutionId || '') !== String(rightRule.institutionId || '')) return false;
    if (String(leftRule.branchId || '') !== String(rightRule.branchId || '')) return false;
  }
  return true;
}

async function getOrgPermissionCatalog(organizationId) {
  const orgId = normalizeOrgId(organizationId);
  if (!orgId) return [];
  const customPermissions = await collections.permissions().find({ scope: 'org', organizationId: orgId }).toArray();
  return buildScopedPermissionCatalog(orgScopedSystemPermissionTemplates, customPermissions, 'org', orgId);
}

async function sanitizeOrgScopedArtifacts(organizationId) {
  const orgId = normalizeOrgId(organizationId);
  if (!orgId) {
    return { rolesUpdated: 0, overridesUpdated: 0 };
  }

  const allowedKeys = new Set(
    (await getOrgPermissionCatalog(orgId))
      .map((entry) => String(entry?.key || '').trim())
      .filter(Boolean),
  );

  let rolesUpdated = 0;
  let overridesUpdated = 0;

  const roles = await collections.roles().find({ scope: 'org', organizationId: orgId }).toArray();
  for (const role of roles) {
    const currentPermissions = normalizePermissionRuleList(role.permissions);
    const sanitizedPermissions = filterRulesToAllowedKeys(currentPermissions, allowedKeys);
    if (permissionRulesEqual(currentPermissions, sanitizedPermissions)) {
      continue;
    }
    await collections.roles().updateOne(
      { _id: role._id, scope: 'org', organizationId: orgId },
      { $set: { permissions: sanitizedPermissions, updatedAt: new Date() } },
    );
    rolesUpdated += 1;
  }

  const overrideDocs = await collections.userAccess().find({ scope: 'org', organizationId: orgId }).toArray();
  for (const doc of overrideDocs) {
    const currentOverrides = sanitizeOverrideRules(doc.overrides || []);
    const sanitizedOverrides = currentOverrides.filter((rule) => allowedKeys.has(rule.permissionKey));
    if (permissionRulesEqual(currentOverrides, sanitizedOverrides)) {
      continue;
    }
    await collections.userAccess().updateOne(
      { _id: doc._id, scope: 'org', organizationId: orgId },
      { $set: { overrides: sanitizedOverrides, updatedAt: new Date() } },
    );
    overridesUpdated += 1;
  }

  return { rolesUpdated, overridesUpdated };
}

async function repairOrgLeadershipAssignments() {
  const rows = await membershipCollections.orgMemberships().find({
    status: 'active',
    roles: { $in: ['owner', 'super_staff'] },
  }).project({
    organizationId: 1,
    userId: 1,
    roles: 1,
  }).toArray();

  const membershipsByOrg = new Map();
  for (const row of rows) {
    const organizationId = normalizeOrgId(row?.organizationId);
    const userId = normalizeUserId(row?.userId);
    if (!organizationId || !userId) continue;
    if (!membershipsByOrg.has(organizationId)) {
      membershipsByOrg.set(organizationId, []);
    }
    membershipsByOrg.get(organizationId).push(row);
  }

  let organizations = 0;
  let updatedAssignments = 0;

  for (const [organizationId, memberships] of membershipsByOrg.entries()) {
    const roles = await ensureDefaultOrgRoles(organizationId);
    const ownerRoleId = roles.find((role) => normalizeRoleAlias(role?.name) === 'owner')?._id;
    const superStaffRoleId = roles.find((role) => normalizeRoleAlias(role?.name) === 'super_staff')?._id;
    const ownerRoleIdString = ownerRoleId ? String(ownerRoleId) : null;
    const superStaffRoleIdString = superStaffRoleId ? String(superStaffRoleId) : null;
    const specialRoleIds = new Set([ownerRoleIdString, superStaffRoleIdString].filter(Boolean));
    if (specialRoleIds.size === 0) {
      continue;
    }

    const desiredRoleByUser = new Map();
    for (const membership of memberships) {
      const userId = normalizeUserId(membership?.userId);
      if (!userId) continue;
      const normalizedRoles = Array.isArray(membership?.roles)
        ? membership.roles.map((role) => normalizeRoleAlias(role)).filter(Boolean)
        : [];
      if (normalizedRoles.includes('owner') && ownerRoleIdString) {
        desiredRoleByUser.set(userId, ownerRoleIdString);
        continue;
      }
      if (normalizedRoles.includes('super_staff') && superStaffRoleIdString) {
        desiredRoleByUser.set(userId, superStaffRoleIdString);
      }
    }

    const existingAssignments = await collections.roleAssignments().find({
      scope: 'org',
      organizationId,
    }).toArray();
    const assignmentByUserId = new Map(existingAssignments.map((assignment) => [String(assignment.userId || ''), assignment]));
    const usersToProcess = new Set([
      ...Array.from(assignmentByUserId.keys()).filter(Boolean),
      ...Array.from(desiredRoleByUser.keys()),
    ]);

    for (const userId of usersToProcess) {
      const existing = assignmentByUserId.get(userId) || null;
      const existingRoleIds = Array.isArray(existing?.roleIds)
        ? existing.roleIds.map((roleId) => String(roleId || '').trim()).filter(Boolean)
        : [];
      const existingRoleDocs = await getRoleDocsByIds(existingRoleIds);
      const validExistingRoleIds = new Set(existingRoleDocs
        .filter((role) => String(role.scope || '') === 'org' && normalizeOrgId(role.organizationId) === organizationId)
        .map((role) => String(role._id)));
      const preservedRoleIds = existingRoleIds.filter((roleId) => validExistingRoleIds.has(roleId) && !specialRoleIds.has(roleId));
      const desiredSpecialRoleId = desiredRoleByUser.get(userId) || null;
      const nextRoleIds = desiredSpecialRoleId
        ? [...preservedRoleIds, desiredSpecialRoleId]
        : preservedRoleIds;

      if (existing && arraysEqualAsStrings(existingRoleIds, nextRoleIds)) {
        continue;
      }

      if (!existing && nextRoleIds.length === 0) {
        continue;
      }

      await collections.roleAssignments().updateOne(
        { userId, scope: 'org', organizationId },
        {
          $set: {
            userId,
            scope: 'org',
            organizationId,
            roleIds: nextRoleIds,
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
      updatedAssignments += 1;
    }

    organizations += 1;
  }

  if (updatedAssignments > 0) {
    await bumpCacheVersion();
  }

  return { organizations, updatedAssignments };
}

function startOrgLeadershipAudit() {
  if (orgLeadershipAuditStarted || !dbWritable) {
    return;
  }
  orgLeadershipAuditStarted = true;
  setImmediate(async () => {
    try {
      const orgWorkspaceAudit = await auditExistingOrgWorkspaceAccess();
      const repairedLeadershipAssignments = await repairOrgLeadershipAssignments();
      fastify.log.info({
        auditedOrganizations: orgWorkspaceAudit.auditedOrganizations,
        sanitizedRoles: orgWorkspaceAudit.sanitizedRoles,
        sanitizedOverrides: orgWorkspaceAudit.sanitizedOverrides,
        repairedLeadershipAssignments: repairedLeadershipAssignments.updatedAssignments,
        repairedOrganizations: repairedLeadershipAssignments.organizations,
      }, 'RBAC org leadership audit completed');
    } catch (err) {
      orgLeadershipAuditStarted = false;
      fastify.log.warn({ err }, 'RBAC org leadership audit failed');
    }
  });
}

fastify.addHook('onRequest', async (req) => {
  if (req.url === '/health') {
    return;
  }
  if (!dbReady) {
    await ensureMongoConnection();
  }
});

fastify.addHook('preHandler', async (req, reply) => {
  const routePath = req.routeOptions?.url || req.url.split('?')[0];
  const readOnlyPostRoutes = new Set(['/rbac/check']);
  if ((req.method === 'GET' || req.method === 'HEAD') || readOnlyPostRoutes.has(routePath)) {
    return;
  }
  if (!dbWritable) {
    const writableReady = await ensureMongoWritableState();
    if (writableReady) {
      return;
    }
    return reply.code(503).send({ message: 'RBAC storage unavailable' });
  }
});

fastify.get('/health', async () => ({
  status: 'ok',
  service: serviceName,
  dbReady,
  dbWritable,
  redisReady,
  dbName,
}));

fastify.get('/rbac/me/scope', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }

  const userId = req.auth.userId;
  const cacheVersion = await getCacheVersion();
  const appArtifacts = await getUserScopeArtifacts(userId, null, req.auth.roles, { cacheVersion });
  const orgAssignments = await collections.roleAssignments().find({ userId, scope: 'org' }).toArray();

  const appScopePermissions = mergeRules(appArtifacts.roleRules, appArtifacts.overrideRules);
  const orgScopePermissions = [];

  for (const assignment of orgAssignments) {
    const orgArtifacts = await getUserScopeArtifacts(userId, assignment.organizationId, req.auth.roles, { cacheVersion });
    orgScopePermissions.push({
      organizationId: assignment.organizationId,
      permissions: mergeRules(orgArtifacts.roleRules, orgArtifacts.overrideRules),
      roles: orgArtifacts.orgRoles.map((r) => ({ id: String(r._id), name: r.name })),
      overrides: orgArtifacts.orgOverridesDoc?.overrides || [],
    });
  }

  return reply.send({
    userId,
    cacheVersion: String(cacheVersion || '0'),
    appScopePermissions,
    orgScopePermissions,
    rolesUsed: {
      app: appArtifacts.appRoles.map((r) => ({ id: String(r._id), name: r.name })),
      org: orgScopePermissions.map((s) => ({ organizationId: s.organizationId, roles: s.roles })),
    },
    overridesUsed: {
      app: appArtifacts.appOverridesDoc?.overrides || [],
      org: orgScopePermissions.map((s) => ({ organizationId: s.organizationId, overrides: s.overrides })),
    },
  });
});

fastify.post('/rbac/check', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }

  const { permissionKey, organizationId = null, branchId = null, resource = null } = req.body || {};
  if (!permissionKey) {
    return reply.code(400).send({ message: 'permissionKey is required' });
  }

  const contextPayload = { ...getActiveContextFromRequest(req), ...(req.body || {}) };
  const activeAppRoleName = parseActiveAppRoleFromContext(contextPayload);
  const activeOrgRoleName = parseActiveOrgRoleFromContext(contextPayload);
  const activeOrgScope = parseActiveOrgScopeFromContext(contextPayload);

  const result = await computeCheckResult({
    userId: req.auth.userId,
    permissionKey,
    organizationId,
    branchId,
    fallbackRoleNames: req.auth.roles,
    activeAppRoleName,
    activeOrgRoleName,
    activeScopeType: activeOrgScope?.scopeType || 'organization',
    activeInstitutionId: activeOrgScope?.institutionId || null,
    activeBranchId: activeOrgScope?.branchId || branchId || null,
  });

  return reply.send({
    userId: req.auth.userId,
    ...result,
    resource,
  });
});

fastify.post('/internal/rbac/bootstrap-org/:organizationId', { preHandler: requireInternal }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }

  const { organizationId } = req.params;
  const ownerUserId = req.body?.ownerUserId ? String(req.body.ownerUserId) : null;
  const createdByUserId = req.body?.createdByUserId ? String(req.body.createdByUserId) : null;
  const previousOwnerUserId = req.body?.previousOwnerUserId ? String(req.body.previousOwnerUserId) : null;
  const { roles } = await syncExclusiveOrgLeadershipRoles({
    organizationId,
    ownerUserId,
    createdByUserId,
    previousOwnerUserId,
  });

  await bumpCacheVersion();
  return reply.send({
    message: 'Organization RBAC defaults bootstrapped',
    organizationId,
    roleNames: roles.map((r) => r.name),
    ownerUserId,
    createdByUserId,
    previousOwnerUserId,
  });
});

fastify.post('/rbac/app/permissions', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const { key, name, description, module, actions = [] } = req.body || {};
  if (!key || !name || !module) {
    return reply.code(400).send({ message: 'key, name, module are required' });
  }

  await collections.permissions().updateOne(
    { key, scope: 'app', organizationId: null },
    {
      $set: {
        key,
        name,
        description: description || name,
        module,
        actions: Array.isArray(actions) ? actions : [],
        scope: 'app',
        organizationId: null,
        isSystem: false,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_PERMISSION_CREATED',
    action: 'rbac.app.permission.upsert',
    resource: { type: 'permission', id: key },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app', module },
  });
  return reply.code(201).send({ message: 'Permission upserted' });
});

fastify.get('/rbac/app/permissions', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const permissions = await collections.permissions().find({ scope: 'app', organizationId: null }).toArray();
  return reply.send({ permissions });
});

fastify.post('/rbac/app/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const { name, description, permissions = [] } = req.body || {};
  if (!name) {
    return reply.code(400).send({ message: 'name is required' });
  }
  if (isLockedAppRoleName(name)) {
    return reply.code(403).send({ message: 'SUPER_ROLE_LOCKED' });
  }

  await collections.roles().updateOne(
    { name, scope: 'app', organizationId: null },
    {
      $set: {
        name,
        description: description || name,
        permissions: Array.isArray(permissions) ? permissions : [],
        scope: 'app',
        organizationId: null,
        isSystem: false,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_ROLE_CREATED',
    action: 'rbac.app.role.upsert',
    resource: { type: 'role', id: name },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app' },
  });
  return reply.code(201).send({ message: 'Role upserted' });
});

fastify.get('/rbac/app/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const roles = await collections.roles().find({ scope: 'app', organizationId: null }).toArray();
  return reply.send({ roles });
});

fastify.patch('/rbac/app/roles/:roleId', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const { roleId } = req.params;
  if (!ObjectId.isValid(roleId)) {
    return reply.code(400).send({ message: 'Invalid roleId' });
  }
  const existingRole = await collections.roles().findOne({ _id: new ObjectId(roleId), scope: 'app', organizationId: null });
  if (!existingRole) {
    return reply.code(404).send({ message: 'Role not found' });
  }
  if (isLockedAppRoleName(existingRole.name) || isLockedAppRoleName(req.body?.name)) {
    return reply.code(403).send({ message: 'SUPER_ROLE_LOCKED' });
  }

  const update = {};
  if (req.body?.name) update.name = req.body.name;
  if (req.body?.description) update.description = req.body.description;
  if (Array.isArray(req.body?.permissions)) update.permissions = req.body.permissions;
  update.updatedAt = new Date();

  await collections.roles().updateOne({ _id: new ObjectId(roleId), scope: 'app', organizationId: null }, { $set: update });
  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_ROLE_UPDATED',
    action: 'rbac.app.role.update',
    resource: { type: 'role', id: roleId },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app' },
  });
  return reply.send({ message: 'Role updated' });
});

fastify.delete('/rbac/app/roles/:roleId', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const roleIdParam = String(req.params.roleId || '').trim();
  if (!roleIdParam) {
    return reply.code(400).send({ message: 'roleId is required' });
  }

  const role = await findAppRoleByAnyIdentifier(roleIdParam);
  if (!role) {
    return reply.code(404).send({ message: 'Role not found' });
  }
  if (isLockedAppRoleName(role.name)) {
    return reply.code(403).send({ message: 'SUPER_ROLE_LOCKED' });
  }

  const roleObjectId = role._id instanceof ObjectId ? role._id : null;
  const roleObjectIdString = roleObjectId ? String(roleObjectId) : null;
  const roleName = String(role.name || '').trim();

  await collections.roles().deleteOne({ _id: role._id, scope: 'app' });

  const pullCandidates = [roleName];
  if (roleObjectIdString) {
    pullCandidates.push(roleObjectIdString);
    pullCandidates.push(new ObjectId(roleObjectIdString));
  }

  const roleAssignmentsUpdate = await collections.roleAssignments().updateMany(
    { scope: 'app' },
    { $pull: { roleIds: { $in: pullCandidates } }, $set: { updatedAt: new Date() } },
  );
  const userOverridesUpdate = roleName
    ? await collections.userAccess().updateMany(
      { scope: 'app', organizationId: null },
      { $pull: { overrides: { roleName } }, $set: { updatedAt: new Date() } },
    )
    : { modifiedCount: 0 };

  let authUsersUpdated = 0;
  if (roleName) {
    try {
      const authSyncResponse = await fetch(`${authApiBaseUrl}/internal/users/roles/remove`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': internalServiceToken,
        },
        body: JSON.stringify({ roleName }),
      });
      if (authSyncResponse.ok) {
        const payload = await authSyncResponse.json().catch(() => ({}));
        authUsersUpdated = Number(payload?.matchedUsers || payload?.modifiedUsers || 0);
      } else {
        fastify.log.warn({ status: authSyncResponse.status, roleName }, 'Auth role cleanup call failed');
      }
    } catch (err) {
      fastify.log.warn({ err, roleName }, 'Auth role cleanup call failed');
    }
  }

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_ROLE_DELETED',
    action: 'rbac.app.role.delete',
    resource: { type: 'role', id: roleObjectIdString || roleName },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: {
      scope: 'app',
      roleName: roleName || null,
      assignmentDocsUpdated: roleAssignmentsUpdate.modifiedCount || 0,
      overrideDocsUpdated: userOverridesUpdate.modifiedCount || 0,
      authUsersUpdated,
    },
  });
  return reply.send({
    message: 'Role deleted',
    roleName: roleName || null,
    assignmentDocsUpdated: roleAssignmentsUpdate.modifiedCount || 0,
    overrideDocsUpdated: userOverridesUpdate.modifiedCount || 0,
    authUsersUpdated,
  });
});

fastify.post('/rbac/app/users/:userId/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const { userId } = req.params;
  const { roleIds = [] } = req.body || {};
  const resolvedRoleNames = await resolveRoleNamesFromIds(roleIds, 'app', null);
  if (resolvedRoleNames.includes('super')) {
    return reply.code(403).send({ message: 'SUPER_ROLE_ASSIGNMENT_BLOCKED' });
  }
  await collections.roleAssignments().updateOne(
    { userId, scope: 'app', organizationId: null },
    {
      $set: {
        userId,
        scope: 'app',
        organizationId: null,
        roleIds: Array.isArray(roleIds) ? roleIds : [],
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_PERMISSION_ASSIGNED',
    action: 'rbac.app.assign.roles',
    resource: { type: 'user', id: userId },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app', roleIds: Array.isArray(roleIds) ? roleIds : [] },
  });
  return reply.send({ message: 'App roles assigned' });
});

fastify.post('/rbac/app/users/:userId/overrides', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  if (!(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  const { userId } = req.params;
  const { overrides = [] } = req.body || {};
  const sanitizedOverrides = sanitizeOverrideRules(overrides);

  await collections.userAccess().updateOne(
    { userId, scope: 'app', organizationId: null },
    {
      $set: {
        userId,
        scope: 'app',
        organizationId: null,
        overrides: sanitizedOverrides,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId: null,
    eventType: 'RBAC_USER_OVERRIDE_APPLIED',
    action: 'rbac.app.user.overrides',
    resource: { type: 'user', id: userId },
    permissionKey: 'rbac.app.manage',
    outcome: 'success',
    metadata: { scope: 'app', overrides: sanitizedOverrides.length },
  });
  return reply.send({ message: 'App overrides updated' });
});

fastify.get('/rbac/app/users/:userId/access', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { userId } = req.params;
  const isSelf = String(req.auth.userId) === String(userId);
  const platformAdmin = await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName);
  if (!platformAdmin && !isSelf) {
    return reply.code(403).send({ message: 'Forbidden' });
  }
  const activeAppRoleName = normalizeRoleAlias(
    req.query?.activeRole
    || req.query?.activeRoleName
    || req.body?.activeRole
    || req.body?.activeRoleName
  );
  const cacheVersion = await getCacheVersion();
  const artifacts = await getUserScopeArtifacts(userId, null, [], { activeAppRoleName, cacheVersion });
  return reply.send({
    userId,
    scope: 'app',
    roles: artifacts.appRoles,
    assignment: artifacts.appAssignment,
    overrides: activeAppRoleName ? artifacts.filteredAppOverrides : (artifacts.appOverridesDoc?.overrides || []),
    effectivePermissions: mergeRules(artifacts.roleRules, artifacts.overrideRules),
    activeRole: artifacts.activeAppRoleName,
  });
});

fastify.post('/rbac/org/:organizationId/permissions', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles, req.auth.activeOrgRoleName, req.auth.activeAppRoleName)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const { key, name, description, module, actions = [] } = req.body || {};
  if (!key || !name || !module) {
    return reply.code(400).send({ message: 'key, name, module are required' });
  }

  const existingPermission = await collections.permissions().findOne({ key, scope: 'org', organizationId });
  if (existingPermission?.isSystem) {
    return reply.code(403).send({ message: 'SYSTEM_PERMISSION_LOCKED' });
  }

  await collections.permissions().updateOne(
    { key, scope: 'org', organizationId },
    {
      $set: {
        key,
        name,
        description: description || name,
        module,
        actions: Array.isArray(actions) ? actions : [],
        scope: 'org',
        organizationId,
        isSystem: false,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_PERMISSION_CREATED',
    action: 'rbac.org.permission.upsert',
    resource: { type: 'permission', id: key },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org', module },
  });
  return reply.code(201).send({ message: 'Org permission upserted' });
});

fastify.delete('/rbac/org/:organizationId/permissions/:permissionKey', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, permissionKey } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles, req.auth.activeOrgRoleName, req.auth.activeAppRoleName)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }
  const key = decodeURIComponent(String(permissionKey || '').trim());
  if (!key) {
    return reply.code(400).send({ message: 'permissionKey is required' });
  }

  const existingPermission = await collections.permissions().findOne({ key, scope: 'org', organizationId });
  if (!existingPermission) {
    return reply.code(404).send({ message: 'Permission not found' });
  }
  if (existingPermission.isSystem) {
    return reply.code(403).send({ message: 'SYSTEM_PERMISSION_LOCKED' });
  }

  await collections.permissions().deleteOne({ key, scope: 'org', organizationId, isSystem: { $ne: true } });
  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_PERMISSION_DELETED',
    action: 'rbac.org.permission.delete',
    resource: { type: 'permission', id: key },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org', key },
  });
  return reply.send({ message: 'Org permission deleted' });
});

fastify.get('/rbac/org/:organizationId/permissions', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles, req.auth.activeOrgRoleName, req.auth.activeAppRoleName)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const permissions = await getOrgPermissionCatalog(organizationId);
  return reply.send({ permissions });
});

fastify.post('/rbac/org/:organizationId/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles, req.auth.activeOrgRoleName, req.auth.activeAppRoleName)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const { name, description, permissions = [] } = req.body || {};
  if (!name) {
    return reply.code(400).send({ message: 'name is required' });
  }
  const existingSystemRole = await collections.roles().findOne({
    name,
    scope: 'org',
    organizationId,
    isSystem: true,
  });
  if (existingSystemRole || isLockedOrgRoleName(name)) {
    return reply.code(403).send({ message: 'SYSTEM_ROLE_LOCKED' });
  }

  const allowedKeys = new Set(
    (await getOrgPermissionCatalog(organizationId))
      .map((entry) => String(entry?.key || '').trim())
      .filter(Boolean),
  );
  const sanitizedPermissions = filterRulesToAllowedKeys(permissions, allowedKeys);

  await collections.roles().updateOne(
    { name, scope: 'org', organizationId },
    {
      $set: {
        name,
        description: description || name,
        permissions: sanitizedPermissions,
        scope: 'org',
        organizationId,
        isSystem: false,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_ROLE_CREATED',
    action: 'rbac.org.role.upsert',
    resource: { type: 'role', id: name },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org' },
  });
  return reply.code(201).send({ message: 'Org role upserted' });
});

fastify.get('/rbac/org/:organizationId/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles, req.auth.activeOrgRoleName, req.auth.activeAppRoleName)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }
  const roles = await collections.roles().find({ scope: 'org', organizationId }).toArray();
  return reply.send({ roles });
});

fastify.patch('/rbac/org/:organizationId/roles/:roleId', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, roleId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles, req.auth.activeOrgRoleName, req.auth.activeAppRoleName)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }
  if (!ObjectId.isValid(roleId)) {
    return reply.code(400).send({ message: 'Invalid roleId' });
  }
  const existingRole = await collections.roles().findOne({ _id: new ObjectId(roleId), scope: 'org', organizationId });
  if (!existingRole) {
    return reply.code(404).send({ message: 'Role not found' });
  }
  if (existingRole.isSystem || isLockedOrgRoleName(existingRole.name) || isLockedOrgRoleName(req.body?.name)) {
    return reply.code(403).send({ message: 'SYSTEM_ROLE_LOCKED' });
  }

  const update = {};
  if (req.body?.name) update.name = req.body.name;
  if (req.body?.description) update.description = req.body.description;
  if (Array.isArray(req.body?.permissions)) {
    const allowedKeys = new Set(
      (await getOrgPermissionCatalog(organizationId))
        .map((entry) => String(entry?.key || '').trim())
        .filter(Boolean),
    );
    update.permissions = filterRulesToAllowedKeys(req.body.permissions, allowedKeys);
  }
  update.updatedAt = new Date();

  await collections.roles().updateOne(
    { _id: new ObjectId(roleId), scope: 'org', organizationId },
    { $set: update }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_ROLE_UPDATED',
    action: 'rbac.org.role.update',
    resource: { type: 'role', id: roleId },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org' },
  });
  return reply.send({ message: 'Org role updated' });
});

fastify.delete('/rbac/org/:organizationId/roles/:roleId', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, roleId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles, req.auth.activeOrgRoleName, req.auth.activeAppRoleName)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }
  if (!ObjectId.isValid(roleId)) {
    return reply.code(400).send({ message: 'Invalid roleId' });
  }
  const existingRole = await collections.roles().findOne({ _id: new ObjectId(roleId), scope: 'org', organizationId });
  if (!existingRole) {
    return reply.code(404).send({ message: 'Role not found' });
  }
  if (existingRole.isSystem || isLockedOrgRoleName(existingRole.name)) {
    return reply.code(403).send({ message: 'SYSTEM_ROLE_LOCKED' });
  }

  await collections.roles().deleteOne({ _id: new ObjectId(roleId), scope: 'org', organizationId, isSystem: { $ne: true } });
  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_ROLE_DELETED',
    action: 'rbac.org.role.delete',
    resource: { type: 'role', id: roleId },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org' },
  });
  return reply.send({ message: 'Org role deleted' });
});

fastify.post('/rbac/org/:organizationId/users/:userId/roles', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, userId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles, req.auth.activeOrgRoleName, req.auth.activeAppRoleName)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const { roleIds = [] } = req.body || {};
  const sanitizedRoleIds = await persistOrgRoleAssignment(organizationId, userId, roleIds);
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_PERMISSION_ASSIGNED',
    action: 'rbac.org.assign.roles',
    resource: { type: 'user', id: userId },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org', roleIds: sanitizedRoleIds },
  });
  return reply.send({ message: 'Org roles assigned' });
});

fastify.post('/internal/rbac/org/:organizationId/users/:userId/roles', { preHandler: requireInternal }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }

  const { organizationId, userId } = req.params;
  const { roleNames = [], roleIds = [] } = req.body || {};
  let desiredRoleIds = Array.isArray(roleIds) ? roleIds : [];

  if (desiredRoleIds.length === 0 && Array.isArray(roleNames) && roleNames.length > 0) {
    const resolved = await resolveOrgRoleIdsByNames(roleNames, organizationId);
    if (resolved.missingRoleNames.length > 0) {
      return reply.code(400).send({
        message: 'Unknown organization roles',
        missingRoleNames: resolved.missingRoleNames,
      });
    }
    desiredRoleIds = resolved.roleIds;
  }

  const sanitizedRoleIds = await persistOrgRoleAssignment(organizationId, userId, desiredRoleIds);
  return reply.send({ message: 'Org roles assigned', roleIds: sanitizedRoleIds });
});

fastify.post('/rbac/org/:organizationId/users/:userId/overrides', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, userId } = req.params;
  if (!(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles, req.auth.activeOrgRoleName, req.auth.activeAppRoleName)) && !(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const { overrides = [] } = req.body || {};
  const sanitizedOverrides = sanitizeOverrideRules(overrides);
  await collections.userAccess().updateOne(
    { userId, scope: 'org', organizationId },
    {
      $set: {
        userId,
        scope: 'org',
        organizationId,
        overrides: sanitizedOverrides,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await bumpCacheVersion();
  emitAuditEvent({
    userId: req.auth.userId,
    organizationId,
    eventType: 'RBAC_USER_OVERRIDE_APPLIED',
    action: 'rbac.org.user.overrides',
    resource: { type: 'user', id: userId },
    permissionKey: 'rbac.org.manage',
    outcome: 'success',
    metadata: { scope: 'org', overrides: sanitizedOverrides.length },
  });
  return reply.send({ message: 'Org overrides updated' });
});

fastify.get('/rbac/org/:organizationId/users/:userId/access', { preHandler: requireAuth }, async (req, reply) => {
  if (!assertDependencyReady(reply)) {
    return;
  }
  const { organizationId, userId } = req.params;
  const isSelf = String(req.auth.userId) === String(userId);
  if (!isSelf
    && !(await isOrgAdmin(req.auth.userId, organizationId, req.auth.roles, req.auth.activeOrgRoleName, req.auth.activeAppRoleName))
    && !(await isPlatformAdmin(req.auth.userId, req.auth.roles, req.auth.activeAppRoleName))) {
    return reply.code(403).send({ message: 'Org admin required' });
  }

  const activeOrgRoleName = normalizeRoleAlias(
    req.query?.activeOrgRole
    || req.query?.activeOrgRoleName
    || req.body?.activeOrgRole
    || req.body?.activeOrgRoleName
  );
  const explicitScopeContext = {
    activeContextId: req.headers['x-active-context-id'] || null,
    activeContextName: req.headers['x-active-context-name'] || null,
    activeContextType: 'organization',
    scopeType: req.query?.scopeType || req.body?.scopeType || null,
    institutionId: req.query?.institutionId || req.body?.institutionId || null,
    branchId: req.query?.branchId || req.body?.branchId || null,
  };
  const activeOrgScope = parseActiveOrgScopeFromContext(explicitScopeContext);
  const cacheVersion = await getCacheVersion();
  const artifacts = await getUserScopeArtifacts(userId, organizationId, [], {
    activeAppRoleName: null,
    activeOrgRoleName,
    activeScopeType: activeOrgScope?.scopeType || 'organization',
    activeInstitutionId: activeOrgScope?.institutionId || null,
    activeBranchId: activeOrgScope?.branchId || null,
    cacheVersion,
  });
  return reply.send({
    userId,
    scope: 'org',
    organizationId,
    scopeType: activeOrgScope?.scopeType || 'organization',
    institutionId: activeOrgScope?.institutionId || null,
    branchId: activeOrgScope?.branchId || null,
    roles: artifacts.orgRoles,
    assignment: artifacts.orgAssignment,
    overrides: activeOrgRoleName ? artifacts.filteredOrgOverrides : (artifacts.orgOverridesDoc?.overrides || []),
    effectivePermissions: mergeRules(artifacts.roleRules, artifacts.overrideRules),
    activeRole: artifacts.activeOrgRoleName,
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
    startOrgLeadershipAudit();
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
    if (mongoReconnectTimer) {
      clearTimeout(mongoReconnectTimer);
    }
    if (redisClient) {
      await redisClient.quit();
    }
    await closeMongoClientQuietly();
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




