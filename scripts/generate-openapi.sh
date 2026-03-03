#!/usr/bin/env bash
set -euo pipefail

OUT_FILE="${1:-docs/openapi.json}"
API_URL="${API_URL:-http://localhost/openapi.json}"

mkdir -p "$(dirname "$OUT_FILE")"
curl -fsSL "$API_URL" -o "$OUT_FILE"
echo "OpenAPI spec saved to $OUT_FILE"
