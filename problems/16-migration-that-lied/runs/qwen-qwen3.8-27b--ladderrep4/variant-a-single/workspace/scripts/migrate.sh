#!/usr/bin/env bash
# scripts/migrate.sh — apply the Drizzle migrations exactly as the deploy pipeline does.
# ASSUMPTION: this script was not present in the shown workspace; it is reconstructed
# from README.md (which invokes ./scripts/migrate.sh) and package.json
# ("db:migrate": "drizzle-kit migrate").
set -euo pipefail

cd "$(dirname "$0")/.."

# Pick up DATABASE_URL from .env if the caller has not exported it.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL is required; copy .env.example to .env first}"

# Wait for Postgres to accept connections (compose healthcheck may still be pending).
for _ in $(seq 1 60); do
  if psql "$DATABASE_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

npx drizzle-kit migrate
