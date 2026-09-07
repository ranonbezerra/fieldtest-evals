#!/usr/bin/env bash
# scripts/verify.sh
# Exits with non‑zero if the database is in the broken state, zero otherwise.
# Used by the CI pipeline and by the runbook.

set -euo pipefail

# Load environment variables from .env if present
if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  source .env
fi

DB_URL="${DATABASE_URL:?Missing DATABASE_URL environment variable}"

# Helper to run a psql query and trim whitespace
run_psql() {
  psql "$DB_URL" -tAc "$1"
}

# 1️⃣ Verify that the `document_embeddings` table exists
TABLE_EXISTS=$(run_psql "SELECT to_regclass('public.document_embeddings');")
if [[ -z "$TABLE_EXISTS" || "$TABLE_EXISTS" != "document_embeddings" ]]; then
  echo "ERROR: table \"document_embeddings\" does not exist"
  exit 1
fi

# 2️⃣ Verify that every document has a non‑NULL `search_key`
MISSING_COUNT=$(run_psql "SELECT COUNT(*) FROM documents WHERE search_key IS NULL;")
if [[ "$MISSING_COUNT" != "0" ]]; then
  echo "ERROR: $MISSING_COUNT documents are missing a search_key"
  exit 1
fi

echo "✅ Database verification passed"
exit 0
