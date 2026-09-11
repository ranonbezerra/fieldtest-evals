#!/usr/bin/env bash
#
# scripts/verify.sh — assert the database is in the corrected state (issue #133).
#
#   exit 0  corrected (all checks pass)
#   exit 1  broken, or database unreachable
#
# Requires psql on PATH. Connection comes from $DATABASE_URL
# (default: the compose credentials on host port 55432).

set -u

DATABASE_URL="${DATABASE_URL:-postgres://app:app@localhost:55432/app}"

run_sql() {
  command psql "$DATABASE_URL" -X -tA -v ON_ERROR_STOP=1 -c "$1"
}

status=0

check() { # $1 label, $2 expected, $3 actual
  if [ "$3" = "$2" ]; then
    echo "PASS $1"
  else
    echo "FAIL $1: expected $2, got $3"
    status=1
  fi
}

# Preflight: an unreachable database is a broken state, not a pass.
if [ -z "$(run_sql 'SELECT 1;' 2>/dev/null)" ]; then
  echo "FAIL database unreachable at $DATABASE_URL"
  echo "RESULT: BROKEN"
  exit 1
fi

# 1) The embeddings table exists.
#    Broken: 0003_embeddings had no journal entry, so the runner never applied it.
check "document_embeddings relation exists" "t" \
  "$(run_sql "SELECT to_regclass('public.document_embeddings') IS NOT NULL;")"

# 2) ...and the embedding column is still vector(768).
#    A downgrade to text/jsonb to dodge the missing extension fails here, on purpose.
check "document_embeddings.embedding is vector(768)" "vector(768)" \
  "$(run_sql "SELECT COALESCE((SELECT format_type(a.atttypid, a.atttypmod)
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = 'document_embeddings'
         AND a.attname = 'embedding'
         AND a.attnum > 0),
       '<missing>');")"

# 3) The vector extension is installed (needs a pgvector-capable image).
check "vector extension installed" "t" \
  "$(run_sql "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector');")"

# 4) Every document carries the backfilled search_key.
#    Broken: 0002's LIKE 'slug:%' filter matched nothing after 0001 stripped the
#    prefix, so all five seeded documents are NULL.
check "all documents have search_key = lower(public_ref)" "0" \
  "$(run_sql "SELECT count(*) FROM \"documents\"
       WHERE \"search_key\" IS NULL OR \"search_key\" <> lower(\"public_ref\");")"

if [ "$status" -eq 0 ]; then
  echo "RESULT: OK"
else
  echo "RESULT: BROKEN"
fi

exit "$status"
