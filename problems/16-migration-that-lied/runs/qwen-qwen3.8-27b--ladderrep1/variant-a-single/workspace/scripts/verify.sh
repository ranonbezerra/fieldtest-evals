#!/usr/bin/env bash
#
# scripts/verify.sh
#
# Asserts the post-migration state the migrations claim to produce.
# Exit 0 = corrected database, exit 1 = broken database.
#
# ASSUMPTION: DATABASE_URL falls back to the docker-compose.yml credentials
# (app/app on localhost:55432); the README flow sources .env, which supplies
# the same value.
set -u

DB_URL="${DATABASE_URL:-postgresql://app:app@localhost:55432/app}"
status=0

q() { psql "$DB_URL" -tAc "$1" 2>/dev/null; }

# Defect 1: document_embeddings must exist (created by 0003_embeddings,
# which only runs if it is listed in drizzle/meta/_journal.json).
if [ "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'document_embeddings';")" = "1" ]; then
  echo "OK document_embeddings present"
else
  echo "FAIL document_embeddings missing"
  status=1
fi

# Defect 2: every document must have a backfilled search_key.
total=$(q "SELECT count(*) FROM documents;")
missing=$(q "SELECT count(*) FROM documents WHERE search_key IS NULL;")
if [ "$total" != "0" ] && [ "$missing" = "0" ]; then
  echo "OK search_key set on ${total}/${total} documents"
else
  echo "FAIL search_key missing on ${missing:-?}/${total:-?} documents"
  status=1
fi

# Defect 3: the image must provide the vector extension that 0003 requires.
if [ "$(q "SELECT count(*) FROM pg_extension WHERE extname = 'vector';")" = "1" ]; then
  echo "OK vector extension installed"
else
  echo "FAIL vector extension not installed"
  status=1
fi

if [ "$status" -ne 0 ]; then
  echo "RESULT BROKEN (exit 1)"
  exit 1
fi

echo "RESULT OK (exit 0)"
exit 0
