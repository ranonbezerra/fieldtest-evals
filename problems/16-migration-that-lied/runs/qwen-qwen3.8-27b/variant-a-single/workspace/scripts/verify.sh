#!/usr/bin/env bash
#
# verify.sh — exit 0 iff the database is in the CORRECTED state
#             (RUNBOOK.md), exit 1 if it is still broken.
#
# Checks, one per defect/finding:
#   D1  public.document_embeddings exists            (Defect D1)
#   F3  extension "vector" is installed              (Finding F3)
#   D1  document_embeddings.embedding is type vector (kept requirement)
#   D2  every document has a non-NULL search_key     (Defect D2)
#
# Connection (same credentials the pipeline uses), first match wins:
#   1. DATABASE_URL        psql "postgres://user:pass@host:5432/db"
#   2. exported PG* env    PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
#
# ASSUMPTION: the database must already contain documents (the fixtures'
# 0000_init.sql seeds three; the production report also observes documents).
# A database with zero documents is reported as a check failure for the
# backfill check, because "all documents are keyed" is not verifiable there.

set -u

# Prefer DATABASE_URL if present, else rely on exported PG* variables.
if [ -n "${DATABASE_URL:-}" ]; then
  PSQL=(psql "$DATABASE_URL")
else
  PSQL=(psql)
fi

# -t: tuples only, -A: unaligned, -q: quiet, -v ON_ERROR_STOP=1
sql() { "${PSQL[@]}" -t -A -q -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

# A connection failure must be reported as a failed verification, not
# swallowed as an empty result.
probe="$(sql 'SELECT 1')"
if [ "$probe" != "1" ]; then
  echo "FAIL: cannot reach database ($probe)"
  echo "VERIFY: BROKEN DATABASE — unreachable"
  exit 1
fi

failures=0
passes=0

report_ok()   { echo "OK:   $1"; passes=$((passes + 1)); }
report_fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
report_skip() { echo "SKIP: $1"; }

echo "VERIFY: checking public.document_embeddings ..."
table_exists="$(sql "SELECT to_regclass('public.document_embeddings') IS NOT NULL")"
if [ "$table_exists" = "t" ]; then
  report_ok "public.document_embeddings exists"
else
  report_fail "relation \"public.document_embeddings\" does not exist (Defect D1)"
fi

echo "VERIFY: checking vector extension ..."
ext_installed="$(sql "SELECT count(*) FROM pg_extension WHERE extname = 'vector'")"
if [ "$ext_installed" = "1" ]; then
  report_ok "extension \"vector\" is installed"
else
  report_fail "extension \"vector\" is not installed (Finding F3)"
fi

echo "VERIFY: checking column type of document_embeddings.embedding ..."
if [ "$table_exists" = "t" ]; then
  col_type="$(sql "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.document_embeddings'::regclass AND attname = 'embedding'")"
  case "$col_type" in
    vector*) report_ok "document_embeddings.embedding is of type $col_type" ;;
    "")      report_skip "column document_embeddings.embedding not present yet (follows from D1)" ;;
    *)       report_fail "document_embeddings.embedding is of type '$col_type', expected vector (requirement kept, not waived)" ;;
  esac
else
  report_skip "column document_embeddings.embedding not present yet (follows from D1)"
fi

echo "VERIFY: checking search_key backfill ..."
doc_total="$(sql "SELECT count(*) FROM documents")"
doc_unkeyed="$(sql "SELECT count(*) FROM documents WHERE search_key IS NULL")"
case "$doc_total" in
  0)
    report_fail "documents table is empty — cannot verify the backfill (Defect D2 check is meaningless)"
    ;;
  *)
    if [ "$doc_unkeyed" = "0" ]; then
      report_ok "all $doc_total documents have a search_key"
    else
      report_fail "$doc_unkeyed of $doc_total documents have search_key IS NULL (Defect D2)"
    fi
    ;;
esac

if [ "$failures" -eq 0 ]; then
  echo "VERIFY: CORRECTED DATABASE — all checks passed"
  exit 0
else
  echo "VERIFY: BROKEN DATABASE — $failures check(s) failed, $passes passed"
  exit 1
fi
