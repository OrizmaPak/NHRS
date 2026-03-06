# NHRS API Documentation

## Source of Truth
- Swagger UI: `GET /docs`
- Raw OpenAPI: `GET /openapi.json`
- Exported spec: `docs/openapi.json` (`npm run docs:openapi`)

## Run Locally
1. `./scripts/dev-up.sh`
2. Seed auth/NIN data: `npm run seed:nin-cache`
3. Seed RBAC defaults: `npm run seed:rbac`
4. Seed UI theme defaults: `npm run seed:ui-themes`
5. Export OpenAPI JSON: `npm run docs:openapi`

## Authentication Rules
- Login methods: `nin`, `phone`, `email`.
- NIN bootstrap accepts `nin + password` where first password is DOB (`DDMMYYYY`) only before password is set.
- After first NIN bootstrap login, password change is mandatory.
- Phone login disabled until phone is set + verified and password is set.
- Email login disabled until email is set + verified and password is set.
- If NIN is not in local cache, login returns `503` (`Fetching from NIN is currently not available.`).

## RBAC + Override Rules
- Multi-scope: `app` and `org`.
- Candidate permissions = app roles + org roles (for provided org).
- Role permissions evaluated first.
- User overrides applied last.
- Precedence: user override > role rule.
- Both `allow` and `deny` overrides are supported.
- Decision cache uses Redis with short TTL and invalidates via version bump on updates.

## Common Errors
- `400` validation/body/params errors
- `401` unauthorized/invalid token
- `403` forbidden/permission denied
- `423` account temporarily locked due to repeated failures
- `429` rate-limit exceeded (IP or OTP cooldown)
- `503` dependent service unavailable

## Security Controls
- Login IP rate limit: max `10` attempts per `5` minutes (`429` on exceed).
- Identifier lockout: max `5` failed attempts per NIN/email/phone in `10` minutes, then lock for `15` minutes (`423`).
- OTP verification backoff: exponential cooldown on failures; OTP invalidates at 5 failed attempts.
- Progressive delay: failed logins add 100-500ms jitter.
- Audit logging is async and non-blocking. Passwords and raw OTP values are never logged.
- Audit metadata is defensively sanitized at gateway and audit-log-service. Passwords, OTP values, and token-like fields (`refreshToken`, `accessToken`, `authorization`, `token`, `idToken`, variants) are always stored as `[REDACTED]`.
- Trusted context enforcement: protected provider/governance routes require signed `x-nhrs-context` + `x-nhrs-context-signature` (`MISSING_TRUST_CONTEXT`, `INVALID_TRUST_CONTEXT`, `EXPIRED_TRUST_CONTEXT` on failure).
- Gateway abuse protection: route-tier rate limiting returns `429 { message: "RATE_LIMITED", code: "RATE_LIMITED", retryAfterSeconds }`.
- Critical POST idempotency: gateway supports `Idempotency-Key`; same key+same payload replays stored response, key reuse with different payload returns `409 IDEMPOTENCY_KEY_REUSED`.
- Event delivery reliability: critical audit/notification emissions use outbox workers with retry and consumer idempotency by `eventId`.
- Tracked event types:
  `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILURE`, `AUTH_PASSWORD_SET`, `AUTH_PASSWORD_CHANGE`, `AUTH_PASSWORD_RESET_REQUEST`, `AUTH_PASSWORD_RESET_COMPLETE`, `AUTH_LOGOUT`, `AUTH_PHONE_ADDED`, `AUTH_PHONE_VERIFIED`, `AUTH_EMAIL_ADDED`, `AUTH_EMAIL_VERIFIED`, `RBAC_ROLE_CREATED`, `RBAC_ROLE_UPDATED`, `RBAC_ROLE_DELETED`, `RBAC_PERMISSION_CREATED`, `RBAC_PERMISSION_ASSIGNED`, `RBAC_USER_OVERRIDE_APPLIED`, `RBAC_ACCESS_GRANTED`, `RBAC_ACCESS_DENIED`, `NIN_LOOKUP_SUCCESS`, `NIN_LOOKUP_FAILURE`, `NIN_REFRESH_REQUESTED`.

## Endpoint Tables

### Auth
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/auth/login` | No | NIN bootstrap + email/phone login |
| POST | `/auth/password/set` | Bearer | Mandatory first set |
| POST | `/auth/password/change` | Bearer | Change password |
| POST | `/auth/context/switch` | Bearer | Validate/switch active context and return effective theme |
| POST | `/auth/password/forgot` | No | Send reset OTP |
| POST | `/auth/password/reset` | No | Reset with OTP |
| POST | `/auth/token/refresh` | No | Refresh tokens |
| POST | `/auth/logout` | No | Revoke refresh |
| GET | `/auth/me` | Bearer | Current user |
| POST | `/auth/contact/phone` | Bearer | Set phone + send OTP |
| POST | `/auth/contact/phone/verify` | Bearer | Verify phone OTP |
| POST | `/auth/contact/email` | Bearer | Set email + send OTP |
| POST | `/auth/contact/email/verify` | Bearer | Verify email OTP |

### NIN Cache
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/nin/:nin` | Bearer | Read local cached record |
| POST | `/nin/refresh/:nin` | Bearer | Refresh marker only, external unavailable |

### RBAC
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/rbac/me/scope` | Bearer | Effective app/org permissions |
| POST | `/rbac/check` | Bearer | Authorization decision endpoint |
| POST | `/rbac/app/permissions` | Bearer | Platform admin |
| GET | `/rbac/app/permissions` | Bearer | Platform admin |
| POST | `/rbac/app/roles` | Bearer | Platform admin |
| GET | `/rbac/app/roles` | Bearer | Platform admin |
| PATCH | `/rbac/app/roles/:roleId` | Bearer | Platform admin |
| DELETE | `/rbac/app/roles/:roleId` | Bearer | Platform admin |
| POST | `/rbac/app/users/:userId/roles` | Bearer | Platform admin |
| POST | `/rbac/app/users/:userId/overrides` | Bearer | Platform admin |
| GET | `/rbac/app/users/:userId/access` | Bearer | Platform admin |
| POST | `/rbac/org/:organizationId/permissions` | Bearer | Org admin (or platform admin) |
| GET | `/rbac/org/:organizationId/permissions` | Bearer | Org admin (or platform admin) |
| POST | `/rbac/org/:organizationId/roles` | Bearer | Org admin (or platform admin) |
| GET | `/rbac/org/:organizationId/roles` | Bearer | Org admin (or platform admin) |
| PATCH | `/rbac/org/:organizationId/roles/:roleId` | Bearer | Org admin (or platform admin) |
| DELETE | `/rbac/org/:organizationId/roles/:roleId` | Bearer | Org admin (or platform admin) |
| POST | `/rbac/org/:organizationId/users/:userId/roles` | Bearer | Org admin (or platform admin) |
| POST | `/rbac/org/:organizationId/users/:userId/overrides` | Bearer | Org admin (or platform admin) |
| GET | `/rbac/org/:organizationId/users/:userId/access` | Bearer | Org admin (or platform admin) |

### Audit
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/audit/events` | Bearer | Admin/auditor only; supports `userId,eventType,organizationId,from,to,page,limit` |
| GET | `/audit/events/:eventId` | Bearer | Admin/auditor only |

### User Profile
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/profile/me` | Bearer | Merged profile view (profile + NIN summary + RBAC scope + optional memberships) |
| PATCH | `/profile/me` | Bearer | Editable fields only: `displayName`, `address`, `preferences` |
| POST | `/profile/me/request-nin-refresh` | Bearer | Triggers NIN refresh request through NIN cache service |
| GET | `/profile/me/status` | Bearer | Onboarding score and next steps |
| GET | `/profile/search` | Bearer | Staff/admin search with rate limiting |
| GET | `/profile/:userId` | Bearer | Staff/admin profile lookup |
| GET | `/profile/by-nin/:nin` | Bearer | Registered check + NIN summary (authorized only) |
| POST | `/profile/create-placeholder` | Bearer | Create non-auth placeholder reference by NIN |

### UI Branding & Accessibility
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/ui/theme/platform` | Public | Platform default public theme (cacheable with ETag) |
| GET | `/ui/theme/effective?scope_type=&scope_id=` | Public | Resolved theme: platform -> parent -> tenant |
| GET | `/ui/theme` | Bearer | Admin list by scope filters |
| POST | `/ui/theme` | Bearer | Create scope theme (`platform`, `organization`, `state`, `taskforce`) |
| PATCH | `/ui/theme/:id` | Bearer | Update theme tokens/accessibility defaults |
| POST | `/ui/theme/:id/logo` | Bearer | Logo update by URL or direct base64 upload flow |
| DELETE | `/ui/theme/:id` | Bearer | Soft delete scope theme |

Context switching support:
- `GET /auth/me` now includes `availableContexts`, `defaultContext`, and `defaultContextTheme` so frontend can apply theme immediately when context is selected.

Theme caching strategy:
- Theme reads return `ETag` derived from theme source `id:version` chain.
- Clients should send `If-None-Match`; service returns `304 Not Modified` when unchanged.
- `version` increments on every update/delete, including logo updates, making cache invalidation deterministic.

### Organization & Membership Onboarding
Owner vs creator:
- Creator is the actor who submits `POST /orgs`.
- Owner is the accountable tenant owner and can be assigned by NIN/user separately.

Membership vs branch assignment:
- Membership links a person to an organization tenant.
- Branch assignments link one membership to one or many branches with independent role coverage.

Multi-branch coverage:
- One membership can hold multiple active branch assignments at the same time.
- Regional/floating coverage is represented by assignment-level roles/departments and active windows.

Movement history:
- Transfers and assignment updates are preserved through `activeFrom/activeTo`; history is queryable via user and member history endpoints.

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/orgs` | Bearer | Create organization with owner as `ownerUserId` or `ownerNin` |
| GET | `/orgs` | Bearer | List organizations (policy/RBAC-controlled) |
| GET | `/orgs/:orgId` | Bearer | Read one organization |
| PATCH | `/orgs/:orgId` | Bearer | Update organization metadata/status |
| PATCH | `/orgs/:orgId/owner` | Bearer | Change owner with owner history tracking |
| POST | `/orgs/:orgId/assign-owner` | Bearer | Assign owner by `ownerNin` |
| GET | `/orgs/search` | Bearer | Search organizations |
| POST | `/orgs/:orgId/branches` | Bearer | Create branch in org |
| GET | `/orgs/:orgId/branches` | Bearer | List branches in org |
| GET | `/orgs/:orgId/branches/:branchId` | Bearer | Read one branch |
| PATCH | `/orgs/:orgId/branches/:branchId` | Bearer | Update branch |
| DELETE | `/orgs/:orgId/branches/:branchId` | Bearer | Soft delete/close branch |
| POST | `/orgs/:orgId/members` | Bearer | Add member by NIN; creates membership even when user is not registered |
| GET | `/orgs/:orgId/members` | Bearer | List members (paginated) |
| GET | `/orgs/:orgId/members/:memberId` | Bearer | Get member with assignments |
| PATCH | `/orgs/:orgId/members/:memberId` | Bearer | Update membership metadata/start/end dates |
| PATCH | `/orgs/:orgId/members/:memberId/status` | Bearer | Change member status |
| POST | `/orgs/:orgId/members/:memberId/branches` | Bearer | Assign to a branch (supports multi-branch) |
| PATCH | `/orgs/:orgId/members/:memberId/branches/:assignmentId` | Bearer | Update assignment roles/departments/status |
| DELETE | `/orgs/:orgId/members/:memberId/branches/:assignmentId` | Bearer | Remove assignment (soft) |
| POST | `/orgs/:orgId/members/:memberId/transfer` | Bearer | Transfer between branches with history event |
| GET | `/orgs/:orgId/members/:memberId/history` | Bearer | Movement history timeline |
| POST | `/orgs/:orgId/memberships/invite` | Bearer | Invite/add by NIN + optional roles/branchIds |
| POST | `/orgs/:orgId/memberships/:membershipId/branches` | Bearer | Assign membership to multiple branches |
| PATCH | `/orgs/:orgId/memberships/:membershipId/branches/:branchId` | Bearer | Update a branch assignment by branchId |
| GET | `/orgs/:orgId/memberships` | Bearer | List memberships in org |
| GET | `/orgs/:orgId/memberships/:membershipId` | Bearer | Read membership in org |
| GET | `/users/:userId/memberships` | Bearer | Read memberships by user |
| GET | `/users/:userId/movement-history` | Bearer | Chronological org/branch movement timeline |
| GET | `/orgs/:orgId/memberships/me?userId=&branchId=` | Internal token | Gateway scope check endpoint used for org/branch membership validation |

Multi-branch model:
One membership can have multiple active `branch_assignments` with independent `roles`, `departments`, `coverageType`, and validity dates.

User-linking model:
When a citizen with matching NIN logs in, auth calls `POST /internal/memberships/link-user` so pending NIN memberships are attached to the real `userId`.

### Health Records Timeline Index
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/records/me` | Bearer | Citizen timeline metadata with `contributingInstitutions` derived only from entry attribution |
| GET | `/records/:nin` | Bearer + `x-org-id` | Provider read by NIN, applies hide rules (`hiddenFromOrgs` / `hiddenFromRoles`) and emits `RECORD_ACCESSED` |
| POST | `/records/me/symptoms` | Bearer | Citizen creates `citizen_symptom` entry (record auto-created if missing) |
| POST | `/records/:nin/entries` | Bearer + `x-org-id` | Provider creates timeline metadata entry with attribution and 24h edit window |
| PATCH | `/records/entries/:entryId` | Bearer | Citizen can edit own citizen entries; provider can edit own provider entries only within 24h (`EDIT_WINDOW_EXPIRED_USE_TASKFORCE_WORKFLOW` on expiry) |
| POST | `/records/entries/:entryId/hide` | Bearer | Citizen-owner updates visibility (`hidden`, `hiddenFromOrgs`, `hiddenFromRoles`) |

### Provider Record Modules
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/encounters/:nin` | Bearer + `x-org-id` | Create encounter content and register index pointer (`service=clinical-encounter-service`); doctor status must be `verified` else `DOCTOR_LICENSE_NOT_VERIFIED` |
| GET | `/encounters/:nin` | Bearer + `x-org-id` | List encounters by NIN (supports `from,to,page,limit`) |
| GET | `/encounters/id/:encounterId` | Bearer + `x-org-id` | Read one encounter |
| PATCH | `/encounters/id/:encounterId` | Bearer + `x-org-id` | Creator-only update within 24h |
| POST | `/labs/:nin/results` | Bearer + `x-org-id` | Create lab result and register index pointer (`service=laboratory-result-service`) |
| GET | `/labs/:nin/results` | Bearer + `x-org-id` | List lab results by NIN (supports `from,to,page,limit`) |
| GET | `/labs/results/id/:resultId` | Bearer + `x-org-id` | Read one lab result |
| PATCH | `/labs/results/id/:resultId` | Bearer + `x-org-id` | Creator-only update within 24h |
| POST | `/pharmacy/:nin/dispenses` | Bearer + `x-org-id` | Create pharmacy dispense content and register index pointer (`service=pharmacy-dispense-service`) |
| GET | `/pharmacy/:nin/dispenses` | Bearer + `x-org-id` | List dispenses by NIN (supports `from,to,page,limit`) |
| GET | `/pharmacy/dispenses/id/:dispenseId` | Bearer + `x-org-id` | Read one dispense |
| PATCH | `/pharmacy/dispenses/id/:dispenseId` | Bearer + `x-org-id` | Creator-only update within 24h |

### Doctor Registry
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/doctors/register` | Bearer | Create doctor profile in `pending` state |
| GET | `/doctors/search` | Public | Public lookup of verified doctors only |
| GET | `/doctors/:doctorId` | Bearer | Full doctor details + license history |
| POST | `/licenses/:doctorId/verify` | Bearer | Verify license (regulator/taskforce authority) |
| POST | `/licenses/:doctorId/suspend` | Bearer | Suspend license |
| POST | `/licenses/:doctorId/revoke` | Bearer | Revoke license |
| POST | `/licenses/:doctorId/reinstate` | Bearer | Reinstate license to verified |

### Emergency Inventory Module
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/emergency/requests` | Bearer | Create emergency request, auto-create incident room, route scope alerts |
| GET | `/emergency/requests` | Bearer | List requests with filters (`status,scopeLevel,state,lga,page,limit`) |
| GET | `/emergency/requests/:requestId` | Bearer | Read request + roomId + responses summary |
| PATCH | `/emergency/requests/:requestId/status` | Bearer | Update status and add room system message |
| POST | `/emergency/requests/:requestId/responses` | Bearer + `x-org-id` | Provider response with availability/ETA/transfer options |
| GET | `/emergency/requests/:requestId/responses` | Bearer | List provider responses |
| GET | `/emergency/requests/:requestId/room` | Bearer | Incident room details and participants |
| POST | `/emergency/rooms/:roomId/messages` | Bearer | Post incident room message |
| GET | `/emergency/rooms/:roomId/messages` | Bearer | Paginated room messages (newest last) |
| PUT | `/emergency/inventory/me` | Bearer + `x-org-id` | Upsert provider inventory for discovery |
| GET | `/emergency/inventory/search` | Bearer | Search inventory by item/scope |

### Governance Taskforce Module
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/taskforce/units` | Bearer | Create taskforce unit (NATIONAL/REGION/STATE/LGA) |
| GET | `/taskforce/units` | Bearer | List units by level/coverage filters |
| PATCH | `/taskforce/units/:unitId` | Bearer | Update unit metadata/status |
| POST | `/taskforce/units/:unitId/members` | Bearer | Add taskforce member with roles (`reviewer`,`approver`,`dispatcher`) |
| GET | `/taskforce/units/:unitId/members` | Bearer | List unit members |
| DELETE | `/taskforce/units/:unitId/members/:memberId` | Bearer | Remove member from unit |
| POST | `/cases` | Bearer | Create case, auto-route by location, auto-create case room, notify assigned unit |
| GET | `/cases` | Bearer | List cases by status/type/assigned unit |
| GET | `/cases/:caseId` | Bearer | Case details + recent actions + room id |
| PATCH | `/cases/:caseId/status` | Bearer | Validate transition and append action |
| POST | `/cases/:caseId/corrections/propose` | Bearer | Reviewer proposes correction; status -> `awaiting_approval` |
| POST | `/cases/:caseId/corrections/approve` | Bearer | Approver/NATIONAL approves and appends amendment to records index |
| POST | `/cases/:caseId/corrections/reject` | Bearer | Approver/NATIONAL rejects correction |
| GET | `/cases/:caseId/room` | Bearer | Get case room |
| POST | `/case-rooms/:roomId/messages` | Bearer | Send case room message |
| GET | `/case-rooms/:roomId/messages` | Bearer | Paginated room messages |
| POST | `/cases/:caseId/escalate` | Bearer | Escalate case up hierarchy and add next-unit participants |

### Tokens
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/auth/token/refresh` | No | Implemented in auth-api |
| POST | `/auth/logout` | No | Refresh revoke |

### OTP
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/auth/password/forgot` | No | OTP issue for password reset |
| POST | `/auth/password/reset` | No | OTP verification + reset |
| POST | `/auth/contact/phone/verify` | Bearer | Contact OTP verification |
| POST | `/auth/contact/email/verify` | Bearer | Contact OTP verification |

### Sessions
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/auth/login` | No | Session creation |
| POST | `/auth/token/refresh` | No | Session rotation |
| POST | `/auth/logout` | No | Session revoke |

## cURL Examples

### 1) Citizen login + me
```bash
curl -X POST http://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{"method":"nin","nin":"90000000001","password":"01011985"}'

curl http://localhost/auth/me -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### 2) RBAC check
```bash
curl -X POST http://localhost/rbac/check \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"permissionKey":"nin.profile.read","organizationId":"org-123"}'
```

### 3) App role creation (platform admin)
```bash
curl -X POST http://localhost/rbac/app/roles \
  -H "Authorization: Bearer <PLATFORM_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"support_agent","permissions":[{"permissionKey":"nin.profile.read","effect":"allow"}]}'
```

### 4) Org role assignment (org admin)
```bash
curl -X POST http://localhost/rbac/org/org-123/users/user-777/roles \
  -H "Authorization: Bearer <ORG_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"roleIds":["<ORG_ROLE_ID>"]}'
```

### 5) Override deny over allow
```bash
curl -X POST http://localhost/rbac/org/org-123/users/user-777/overrides \
  -H "Authorization: Bearer <ORG_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"overrides":[{"permissionKey":"nin.profile.read","effect":"deny"}]}'
```

### 6) Override allow over deny
```bash
curl -X POST http://localhost/rbac/org/org-123/users/user-777/overrides \
  -H "Authorization: Bearer <ORG_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"overrides":[{"permissionKey":"lab.results.write","effect":"allow"}]}'
```
