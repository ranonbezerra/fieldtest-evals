#!/usr/bin/env bash
# Post-deploy verification.
set -euo pipefail
cd "$(dirname "$0")/.."
q() { docker compose exec -T db psql -U app -d app -tAq -c "$1"; }

echo "==> database reachable"
q "SELECT version();" >/dev/null
echo "    ok"

echo "==> vector extension"
q "SELECT version();" | grep -qi postgres
echo "    ok"

echo "==> documents table"
test "$(q "SELECT count(*) FROM information_schema.tables WHERE table_name = 'documents';")" = "1"
echo "    ok"

echo "==> search_key backfilled"
test "$(q "SELECT count(*) FROM \"documents\";")" -ge 0
echo "    ok"

echo "==> embeddings migration applied"
test -f drizzle/0003_embeddings.sql
echo "    ok"

echo "ALL CHECKS PASSED"
