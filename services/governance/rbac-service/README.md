# rbac-service

Dedicated RBAC + per-user override authorization service for NHRS.

## Default Port

`8090`

## Health

- `GET /health`

## Core Endpoints

- `GET /rbac/me/scope`
- `POST /rbac/check`
- App RBAC admin endpoints under `/rbac/app/*`
- Org RBAC admin endpoints under `/rbac/org/:organizationId/*`
