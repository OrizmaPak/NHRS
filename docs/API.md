# NHRS API Documentation (Phase 1)

## Overview
This document indexes the currently implemented NHRS Phase 1 endpoints:
- Authentication
- NIN Cache
- RBAC

Source of truth:
- Swagger UI: `GET /docs`
- Raw OpenAPI: `GET /openapi.json`
- Versioned file: `docs/openapi.json`

## Run Locally
1. `cp .env.example .env` (or create `.env` on Windows from `.env.example`)
2. `./scripts/dev-up.sh`
3. `npm run generate:openapi`

## Auth Rules (Important)
- Login methods: `nin`, `phone`, `email`.
- NIN bootstrap:
  - Requires `nin` (11 digits) + `password`.
  - If user has no password set, password must match cached DOB (`DDMMYYYY`).
  - On success, `requiresPasswordChange=true`.
- Phone login is disabled until:
  - phone is set and verified, and
  - password is set.
- Email login is disabled until:
  - email is set and verified, and
  - password is set.
- If NIN is missing in local cache, login returns:
  - `503 Fetching from NIN is currently not available.`

## Error Codes
- `400`: Validation / bad payload
- `401`: Invalid credentials / unauthorized
- `403`: Method disabled or forbidden
- `429`: Rate limit (reserved for enforcement layer)
- `503`: NIN unavailable in cache flow

## Endpoints

### Auth
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | No | Login with `nin`, `phone`, or `email` |
| POST | `/auth/password/set` | Bearer | Mandatory first-time password set |
| POST | `/auth/password/change` | Bearer | Change current password |
| POST | `/auth/password/forgot` | No | Request OTP for reset |
| POST | `/auth/password/reset` | No | Reset password with OTP |
| POST | `/auth/token/refresh` | No | Rotate refresh/access token |
| POST | `/auth/logout` | No | Revoke refresh session |
| GET | `/auth/me` | Bearer | Current user + roles + scope |
| POST | `/auth/contact/phone` | Bearer | Set phone and send OTP |
| POST | `/auth/contact/phone/verify` | Bearer | Verify phone OTP |
| POST | `/auth/contact/email` | Bearer | Set email and send OTP |
| POST | `/auth/contact/email/verify` | Bearer | Verify email OTP |

### NIN Cache
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/nin/:nin` | No | Read local NIN cache record |
| POST | `/nin/refresh/:nin` | No | Mark refresh request; returns unavailable message |

### RBAC
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/rbac/roles` | Bearer | List roles |
| POST | `/rbac/roles` | Bearer (admin) | Create/update role |
| POST | `/rbac/assign-role` | Bearer (admin) | Assign role to user |
| GET | `/rbac/user/:userId/scope` | Bearer | Read user scope (self/admin) |

## cURL Examples

### Login (NIN bootstrap)
```bash
curl -X POST http://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{"method":"nin","nin":"90000000001","password":"01011985"}'
```

### Set Password
```bash
curl -X POST http://localhost/auth/password/set \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"Str0ngPass!234"}'
```

### Phone Login Gate (expected 403 before setup/verify)
```bash
curl -X POST http://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{"method":"phone","phone":"08000000001","password":"Str0ngPass!234"}'
```

### Email Login Gate (expected 403 before setup/verify)
```bash
curl -X POST http://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{"method":"email","email":"citizen001@example.com","password":"Str0ngPass!234"}'
```

### Me
```bash
curl http://localhost/auth/me \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### NIN Fetch
```bash
curl http://localhost/nin/90000000001
```

### NIN Refresh (Phase 1)
```bash
curl -X POST http://localhost/nin/refresh/90000000001
```

### List Roles
```bash
curl http://localhost/rbac/roles \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Create Role (admin)
```bash
curl -X POST http://localhost/rbac/roles \
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"support_agent","permissions":["ticket:read","ticket:update"]}'
```

### Assign Role (admin)
```bash
curl -X POST http://localhost/rbac/assign-role \
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"userId":"<USER_ID>","roleName":"support_agent"}'
```

### User Scope
```bash
curl http://localhost/rbac/user/<USER_ID>/scope \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Change Password
```bash
curl -X POST http://localhost/auth/password/change \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Str0ngPass!234","newPassword":"N3wPass!456"}'
```

### Forgot Password
```bash
curl -X POST http://localhost/auth/password/forgot \
  -H "Content-Type: application/json" \
  -d '{"channel":"phone","destination":"08000000001"}'
```

### Reset Password
```bash
curl -X POST http://localhost/auth/password/reset \
  -H "Content-Type: application/json" \
  -d '{"channel":"phone","destination":"08000000001","code":"<OTP>","newPassword":"Str0ngPass!234"}'
```

### Token Refresh
```bash
curl -X POST http://localhost/auth/token/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<REFRESH_TOKEN>"}'
```

### Logout
```bash
curl -X POST http://localhost/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<REFRESH_TOKEN>"}'
```

### Set Phone + Verify Phone
```bash
curl -X POST http://localhost/auth/contact/phone \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"phone":"08000000001"}'

curl -X POST http://localhost/auth/contact/phone/verify \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"phone":"08000000001","code":"<OTP>"}'
```

### Set Email + Verify Email
```bash
curl -X POST http://localhost/auth/contact/email \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"email":"citizen001@example.com"}'

curl -X POST http://localhost/auth/contact/email/verify \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"email":"citizen001@example.com","code":"<OTP>"}'
```
