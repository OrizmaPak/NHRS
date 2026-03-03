# api-gateway

NHRS API Gateway for Phase 1 endpoint routing + OpenAPI docs.

## Default Port

`8080`

## Health Check

- `GET /health`

## API Docs

- `GET /docs` (Swagger UI)
- `GET /openapi.json` (raw OpenAPI 3.1)

## Routed Domains

- `/auth/*` -> `auth-api`
- `/nin/*` -> `auth-api`
- `/rbac/*` -> `auth-api`
