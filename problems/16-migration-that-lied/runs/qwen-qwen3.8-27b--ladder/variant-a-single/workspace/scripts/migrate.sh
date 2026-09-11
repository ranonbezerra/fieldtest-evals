#!/usr/bin/env bash
# What the deploy pipeline runs.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is not set}"

echo "==> applying migrations"
npx drizzle-kit migrate
echo "==> migrations applied successfully"

echo "==> done"
