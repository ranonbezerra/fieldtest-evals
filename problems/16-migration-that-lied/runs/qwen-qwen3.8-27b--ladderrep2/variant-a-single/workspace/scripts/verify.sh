#!/usr/bin/env bash
# scripts/verify.sh
#
# Asserts that the search-service database is in the state the migrations
# promise. Prints one line per check plus a verdict.
#
#   exit 0  all checks pass (corrected database)
#   exit 1  one or more checks fail (broken database)
#   exit 2  environment problem (psql missing)
#
# Checks:
#   1. public.document_embeddings exists             (0003)
#   2. the vector extension is installed
#   3. document_embeddings.embedding is vector(768)
#   4. no document has a NULL search_key             (0002/0004)

set -u

# Load .env the same way the README pipeline does (DATABASE_URL, ...).
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

export PGPASSWORD="${PGPASSWORD:-app}"

PSQL=(psql -X -q -A -t -v ON_ERROR_STOP=1)
if [[ -n "${DATABASE_URL:-}" ]]; then
  PSQL+=(-d "${DATABASE_URL}")
else
  PSQL+=(-h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-55432}" -U "${PGUSER:-app}" -d "${PGDATABASE:-app}")
fi

if ! command -v psql > /dev/null 2>&1; then
  echo "[verify] psql is not on PATH (macOS: brew install libpq)"
  exit 2
fi

fail=0

check() {
  local label="$1" sql="$2" expected="$3" actual
  if ! actual="$("${PSQL[@]}" -c "$sql" 2>&1)"; then
    echo "[verify] ${label}: QUERY FAILED (${actual})"
    fail=1
    return
  fi
  if [[ "${actual}" == "${expected}" ]]; then
    echo "[verify] ${label}: OK (${actual})"
  else
    echo "[verify] ${label}: MISMATCH, got '${actual}' want '${expected}'"
    fail=1
  fi
}

# 1. the embeddings table was created
check "document_embeddings table exists" \
  "SELECT EXISTS (
       SELECT 1
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema()
         AND c.relname = 'document_embeddings'
         AND c.relkind = 'r'
     );" \
  "t"

# 2. the extension the table depends on
check "vector extension installed" \
  "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector');" \
  "t"

# 3. the embedding column kept its declared type (guards against a
#    type-downgrade workaround for the missing extension)
check "embedding column is vector(768)" \
  "SELECT coalesce((
       SELECT format_type(a.atttypid, a.atttypmod)
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema()
         AND c.relname = 'document_embeddings'
         AND a.attname = 'embedding'
         AND a.attnum > 0
     ), 'missing');" \
  "vector(768)"

# 4. every document carries a backfilled search_key (null/total)
check "search_key backfilled (null/total)" \
  "SELECT (SELECT count(*) FROM documents WHERE search_key IS NULL)
         || '/' ||
         (SELECT count(*) FROM documents);" \
  "0/5"

if [[ "${fail}" -eq 0 ]]; then
  echo "[verify] RESULT: OK"
  exit 0
fi

echo "[verify] RESULT: BROKEN"
exit 1
