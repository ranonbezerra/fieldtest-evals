#!/usr/bin/env bash
#
# scripts/verify.sh
#
# Assert that the database is in the CORRECTED state after the migration
# set 0000..0004 has been applied.
#
#   exit 0  corrected: the vector extension is installed,
#           document_embeddings exists with an embedding vector(768) column,
#           and every document has a backfilled search_key.
#   exit 1  broken: any check fails, or the database is unreachable.
#
# Usage (from the repo root):
#   ./scripts/verify.sh                     # reads .env
#   DATABASE_URL=... ./scripts/verify.sh    # explicit
#
# Requires psql on PATH (macOS: brew install libpq).

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "error: DATABASE_URL is not set (cp .env.example .env, or export it)" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql is not on PATH (macOS: brew install libpq)" >&2
  exit 1
fi

PSQL=(psql "$DATABASE_URL" -X -q -t -A -v ON_ERROR_STOP=1)

if ! "${PSQL[@]}" -c "SELECT 1" >/dev/null 2>&1; then
  echo "error: cannot connect to the database using DATABASE_URL" >&2
  exit 1
fi

passed=0
failed=0

# check <name> <expected> <actual>
check() {
  local name="$1" expected="$2" actual="$3"
  [ -n "$actual" ] || actual='<empty>'
  if [ "$actual" = "$expected" ]; then
    printf 'PASS  %-36s value=%s\n' "$name" "$actual"
    passed=$((passed + 1))
  else
    printf 'FAIL  %-36s expected=%s actual=%s\n' "$name" "$expected" "$actual"
    failed=$((failed + 1))
  fi
}

q() { "${PSQL[@]}" -c "$1"; }

# D-1: the embeddings table exists (its migration was missing from the journal).
check "document_embeddings table exists" "t" \
  "$(q "SELECT to_regclass('public.document_embeddings') IS NOT NULL")"

# F-1: the vector extension is installed (the image pin had to provide it).
check "vector extension installed" "1" \
  "$(q "SELECT count(*) FROM pg_available_extensions
       WHERE name = 'vector' AND installed_version IS NOT NULL")"

# Guard: at least one document, so the backfill check below cannot pass
# vacuously on an empty table.
doc_count="$(q "SELECT count(*) FROM documents")"
if [ -n "$doc_count" ] && [ "$doc_count" -ge 1 ]; then
  printf 'PASS  %-36s value=%s\n' "documents present (non-vacuous)" "$doc_count"
  passed=$((passed + 1))
else
  printf 'FAIL  %-36s expected=at least 1 actual=%s\n' \
    "documents present (non-vacuous)" "${doc_count:-<empty>}"
  failed=$((failed + 1))
fi

# D-2: every document has a backfilled search_key.
check "search_key backfilled (null count)" "0" \
  "$(q "SELECT count(*) FROM documents WHERE search_key IS NULL")"

# F-1 guard: the embedding column is vector(768), not a downgraded type.
check "embedding column type" "vector(768)" \
  "$(q "SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'document_embeddings'
          AND a.attname = 'embedding'
          AND NOT a.attisdropped")"

total=$((passed + failed))
if [ "$failed" -eq 0 ]; then
  echo "verify: CORRECTED ($total/$total checks passed)"
  exit 0
else
  echo "verify: BROKEN ($failed of $total checks failed)"
  exit 1
fi
