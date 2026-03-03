# auth-api

NHRS Phase 1 Authentication + RBAC foundation service.

## Default Port

`8081`

## Health Check

- `GET /health`

## Exposed Endpoints (through Nginx)

- `POST /auth/login`
- `POST /auth/password/set`
- `POST /auth/password/change`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `POST /auth/token/refresh`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/contact/phone`
- `POST /auth/contact/phone/verify`
- `POST /auth/contact/email`
- `POST /auth/contact/email/verify`
- `GET /nin/:nin`
- `POST /nin/refresh/:nin`
- `GET /rbac/roles`
- `POST /rbac/roles`
- `POST /rbac/assign-role`
- `GET /rbac/user/:userId/scope`

## Notes

- MongoDB is Atlas-only via env vars (`MONGODB_URI`, `DB_NAME`).
- Redis stores refresh token/session state.
- OTP is logged for development only; replace with SMS/Email provider in later phases.
