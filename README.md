# NHRS Monorepo
National Health Repository System (NHRS) backend monorepo organized by domain-oriented, independently scalable services.
## Quick Start
1. Copy .env.example to .env and update values.
2. Run ./scripts/dev-up.sh.
3. Stop with ./scripts/dev-down.sh.
## Local Flow
Client -> Nginx -> API Gateway -> Internal Services
## Atlas Requirement
MongoDB is Atlas-only via MONGODB_URI. No local MongoDB container is included.

## Phase 1 (Auth + RBAC)
- Service: `services/core-platform/authentication/auth-api`
- Seed NIN cache: `npm run seed:nin-cache` (uses Atlas URI from `.env`)
- Test plan: `docs/infrastructure/phase1-auth-rbac-tests.md`
- Postman collection: `docs/infrastructure/postman-phase1-auth-rbac.postman_collection.json`
