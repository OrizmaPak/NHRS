# Docker Architecture

## Request Flow

Client requests enter through Nginx, then route to the API Gateway for orchestration and policy checks, and finally route to internal services as required.

Client -> Nginx -> API Gateway -> Internal Services

Auth paths are routed directly by Nginx to auth-api for identity entrypoint operations.

## Service Discovery

All containers in development join a shared Docker network named nhrs_net.
Services discover each other by service name DNS provided by Docker Compose, for example:
- api-gateway resolves to the API Gateway container
- auth-api resolves to the authentication API container
- otp-service resolves to OTP container

This keeps internal communication decoupled from host machine ports.

## Atlas Connectivity

MongoDB is Atlas-only.
Services read domain-specific cluster URI variables and service-specific DB names:
- IDENTITY_MONGODB_URI
- GOVERNANCE_MONGODB_URI
- HEALTHDATA_MONGODB_URI
- SUPPORT_MONGODB_URI
- <SERVICE>_DB_NAME

No local MongoDB container is defined in Docker Compose.

## Independent Scaling

Services are loosely coupled and containerized independently, allowing per-service scaling in Docker Compose.
Examples:
- docker compose -f docker/compose/docker-compose.dev.yml up -d --scale auth-api=3
- docker compose -f docker/compose/docker-compose.dev.yml up -d --scale otp-service=2

This lets high-traffic services scale without scaling all services.

## Monitoring Stack

Local monitoring is available through:
- Grafana: http://localhost:3000
- Prometheus: http://localhost:9090
- cAdvisor (container metrics): http://localhost:8088
- Node Exporter metrics: http://localhost:9100/metrics

Grafana is pre-provisioned with a Prometheus datasource and an "NHRS Service Monitoring" dashboard.
As new NHRS services are added to Compose, container metrics appear automatically in the dashboard via cAdvisor labels.

## Database Isolation Strategy

Use grouped cluster URIs plus one database per service.

- IDENTITY_MONGODB_URI: auth-api, otp-service, session-service, token-service, nin-linking-service
- GOVERNANCE_MONGODB_URI: rbac-service, audit-log-service
- HEALTHDATA_MONGODB_URI: health-records-service, encounter-notes-service, laboratory-service, pharmacy-dispensing-service
- SUPPORT_MONGODB_URI: notification-service, file-document-service, catalog-service, emergency-requests-service

Each service still gets its own DB name (for example AUTH_DB_NAME, LAB_DB_NAME, AUDIT_DB_NAME).

This supports:
- Option 2 now: all four URI variables can point to the same Atlas cluster URI
- Option 3 later: point each URI variable to a different Atlas cluster without changing service code

