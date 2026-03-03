# NHRS API Documentation

## Source of Truth
- Swagger UI: `GET /docs`
- Raw OpenAPI: `GET /openapi.json`
- Exported spec: `docs/openapi.json` (`npm run docs:openapi`)

## Run Locally
1. `./scripts/dev-up.sh`
2. Seed auth/NIN data: `npm run seed:nin-cache`
3. Seed RBAC defaults: `npm run seed:rbac`
4. Export OpenAPI JSON: `npm run docs:openapi`

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
- Tracked event types:
  `AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILURE`, `AUTH_PASSWORD_SET`, `AUTH_PASSWORD_CHANGE`, `AUTH_PASSWORD_RESET_REQUEST`, `AUTH_PASSWORD_RESET_COMPLETE`, `AUTH_LOGOUT`, `AUTH_PHONE_ADDED`, `AUTH_PHONE_VERIFIED`, `AUTH_EMAIL_ADDED`, `AUTH_EMAIL_VERIFIED`, `RBAC_ROLE_CREATED`, `RBAC_ROLE_UPDATED`, `RBAC_ROLE_DELETED`, `RBAC_PERMISSION_CREATED`, `RBAC_PERMISSION_ASSIGNED`, `RBAC_USER_OVERRIDE_APPLIED`, `RBAC_ACCESS_GRANTED`, `RBAC_ACCESS_DENIED`, `NIN_LOOKUP_SUCCESS`, `NIN_LOOKUP_FAILURE`, `NIN_REFRESH_REQUESTED`.

## Endpoint Tables

### Auth
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/auth/login` | No | NIN bootstrap + email/phone login |
| POST | `/auth/password/set` | Bearer | Mandatory first set |
| POST | `/auth/password/change` | Bearer | Change password |
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
