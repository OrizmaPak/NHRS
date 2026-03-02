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
Every service reads the connection string from the shared environment variable:
- MONGODB_URI=<mongodb atlas connection string>

No local MongoDB container is defined in Docker Compose.

## Independent Scaling

Services are loosely coupled and containerized independently, allowing per-service scaling in Docker Compose.
Examples:
- docker compose -f docker/compose/docker-compose.dev.yml up -d --scale auth-api=3
- docker compose -f docker/compose/docker-compose.dev.yml up -d --scale otp-service=2

This lets high-traffic services scale without scaling all services.
