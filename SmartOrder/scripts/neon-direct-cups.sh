#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-SmartOrder-postgres}"
NEON_HOST="${NEON_HOST:-}"
NEON_DATABASE="${NEON_DATABASE:-neondb}"
NEON_USER="${NEON_USER:-neondb_owner}"
NEON_PASSWORD="${NEON_PASSWORD:-}"
NEON_SCHEMA="${NEON_SCHEMA:-public}"

if [[ -z "$NEON_HOST" ]]; then
  echo "NEON_HOST est requis. Utilisez le host direct Neon, sans '-pooler'." >&2
  echo "Exemple: export NEON_HOST='ep-patient-glitter-ap87duj2.c-7.us-east-1.aws.neon.tech'" >&2
  exit 1
fi

if [[ "$NEON_HOST" == *"-pooler."* ]]; then
  echo "Le host fourni est le pooler Neon. Pour CAP hybrid, utilisez le host direct sans '-pooler'." >&2
  exit 1
fi

if [[ -z "$NEON_PASSWORD" ]]; then
  echo "NEON_PASSWORD est requis." >&2
  exit 1
fi

payload="$(mktemp)"
trap 'rm -f "$payload"' EXIT

cat > "$payload" <<JSON
{
  "host": "$NEON_HOST",
  "port": 5432,
  "database": "$NEON_DATABASE",
  "user": "$NEON_USER",
  "password": "$NEON_PASSWORD",
  "sslmode": "require",
  "schema": "$NEON_SCHEMA"
}
JSON

if cf service "$SERVICE_NAME" >/dev/null 2>&1; then
  cf uups "$SERVICE_NAME" -p "$payload"
else
  cf cups "$SERVICE_NAME" -p "$payload"
fi

cds bind db --to "$SERVICE_NAME" --for hybrid --kind postgres
echo "OK - $SERVICE_NAME pointe maintenant vers Neon direct host."
