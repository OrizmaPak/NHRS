#!/usr/bin/env bash
set -euo pipefail
docker compose -f docker/compose/docker-compose.dev.yml --env-file .env up -d --build