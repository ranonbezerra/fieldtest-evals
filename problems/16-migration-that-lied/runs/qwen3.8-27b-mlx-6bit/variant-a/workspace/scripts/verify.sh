#!/usr/bin/env bash
set -uo pipefail

PGHOST="${1:-localhost}"
PGPORT="${2:-5432}"
PGUSER="${3:-postgres}"
PGDATABASE="${4:-fieldtest}"

PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE")

# Connectivity check
if ! "${PSQL[@]}" -t -A -c "SELECT 1;" > /dev/null 2>&1; then
  echo "ERROR: cannot connect to database at ${PGHOST}:${PGPORT}/${PGDATABASE}" >&2
  exit 2
fi

overall=0

# Check 1: document_embeddings table exists
if "${PSQL[@]}" -t -A -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_name = 'document_embeddings';" \
  2>/dev/null | grep -q '^1$'; then
  echo "PASS document_embeddings table exists"
else
  echo "FAIL document_embeddings table missing"
  overall=1
fi

# Check 2: search_key backfilled
count="$("${PSQL[@]}" -t -A -c \
  "SELECT count(*) FROM documents WHERE search_key IS NOT NULL;" 2>/dev/null || echo 0)"

if [ "$count" -gt 0 ] 2>/dev/null; then
  echo "PASS search_key backfilled (${count} rows)"
else
  echo "FAIL search_key empty (0 rows with non-NULL search_key)"
  overall=1
fi

exit "$overall"
