# Phase 1 Auth + RBAC Test Plan

Base URL: `http://localhost`

## 1. Seed NIN cache (100 records)

```bash
node scripts/seed-nin-cache.js
```

Expected sample login credentials after seed:
- `nin`: `90000000001`
- bootstrap password (DOB): `01011985`

## 2. Login flows

### NIN bootstrap login

```bash
curl -X POST http://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{"method":"nin","nin":"90000000001","password":"01011985"}'
```

Expected:
- `200`
- returns `accessToken`, `refreshToken`, `requiresPasswordChange=true`

### Set mandatory password

```bash
curl -X POST http://localhost/auth/password/set \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"newPassword":"Str0ngPass!234"}'
```

Expected:
- `200`
- message `Password set successfully`

### Phone login blocked before phone is set

```bash
curl -X POST http://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{"method":"phone","phone":"08000000001","password":"Str0ngPass!234"}'
```

Expected:
- `403`
- `Phone login not enabled. Please login with NIN first and set your phone number.`

### Add phone and verify OTP

```bash
curl -X POST http://localhost/auth/contact/phone \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"phone":"08000000001"}'
```

Check auth-api logs for OTP code, then verify:

```bash
curl -X POST http://localhost/auth/contact/phone/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"phone":"08000000001","code":"<OTP_FROM_LOGS>"}'
```

### Phone login success

```bash
curl -X POST http://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{"method":"phone","phone":"08000000001","password":"Str0ngPass!234"}'
```

### Add email and verify OTP

```bash
curl -X POST http://localhost/auth/contact/email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"email":"citizen001@example.com"}'
```

```bash
curl -X POST http://localhost/auth/contact/email/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -d '{"email":"citizen001@example.com","code":"<OTP_FROM_LOGS>"}'
```

### Email login success

```bash
curl -X POST http://localhost/auth/login \
  -H "Content-Type: application/json" \
  -d '{"method":"email","email":"citizen001@example.com","password":"Str0ngPass!234"}'
```

## 3. Password recovery

### Forgot password

```bash
curl -X POST http://localhost/auth/password/forgot \
  -H "Content-Type: application/json" \
  -d '{"channel":"phone","destination":"08000000001"}'
```

### Reset password

```bash
curl -X POST http://localhost/auth/password/reset \
  -H "Content-Type: application/json" \
  -d '{"channel":"phone","destination":"08000000001","code":"<OTP_FROM_LOGS>","newPassword":"N3wPass!456"}'
```

## 4. Token and session

### Refresh token

```bash
curl -X POST http://localhost/auth/token/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<REFRESH_TOKEN>"}'
```

### Logout (revoke refresh token)

```bash
curl -X POST http://localhost/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<REFRESH_TOKEN>"}'
```

## 5. NIN cache endpoints

### Get NIN details

```bash
curl http://localhost/nin/90000000001
```

### Request refresh (external disabled in Phase 1)

```bash
curl -X POST http://localhost/nin/refresh/90000000001
```

Expected message:
- `Fetching from NIN is currently not available.`

## 6. RBAC endpoints

### List roles

```bash
curl http://localhost/rbac/roles \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### Create role (admin only)

```bash
curl -X POST http://localhost/rbac/roles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \
  -d '{"name":"support_agent","permissions":["ticket:read","ticket:update"]}'
```

### Assign role (admin only)

```bash
curl -X POST http://localhost/rbac/assign-role \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \
  -d '{"userId":"<USER_ID>","roleName":"support_agent"}'
```

### User scope

```bash
curl http://localhost/rbac/user/<USER_ID>/scope \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```
