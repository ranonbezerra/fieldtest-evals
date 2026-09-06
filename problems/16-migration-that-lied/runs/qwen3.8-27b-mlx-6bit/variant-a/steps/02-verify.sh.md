# 02-verify.sh

## reasoning

```
Let me analyze the PLAN.md specification for `scripts/verify.sh`:

From the plan:
- It's a bash script that connects to Postgres via `psql` (no Node runtime dependency)
- Usage: `scripts/verify.sh [PGHOST] [PGPORT] [PGUSER] [PGDATABASE]`
- Defaults: localhost 5432 postgres fieldtest
- Exit codes:
  - 0: both checks pass (table exists AND backfill is present)
  - 1: one or both checks fail
  - 2: cannot connect to database
- Output (stdout, one line per check):
  - "PASS document_embeddings table exists" or "FAIL document_embeddings table missing"
  - "PASS search_key backfilled (<n> rows)" or "FAIL search_key empty (0 rows with non-NULL search_key)"
- No functions are exported; the script is a linear sequence of two `psql` probes.

From the tests section:
- verify.sh exits 0 and prints two PASS lines against the corrected database.
- verify.sh exits 1 and prints at least one FAIL line against the broken database (pre-fix state).
- verify.sh exits 2 and prints a stderr message when the Postgres container is not running.

Let me write this script:

1. Set defaults for PGHOST, PGPORT, PGUSER, PGDATABASE
2. Try to connect - if psql fails to connect, exit 2 with stderr message
3. Check if document_embeddings table exists
4. Check count of documents with non-NULL search_key
5. Print results and exit appropriately

Let me think about the structure:

```bash
#!/usr/bin/env bash
set -euo pipefail

PGHOST="${1:-localhost}"
PGPORT="${2:-5432}"
PGUSER="${3:-postgres}"
PGDATABASE="${4:-fieldtest}"

# Check connectivity
if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c "SELECT 1;" > /dev/null 2>&1; then
  echo "ERROR: cannot connect to database at $PGHOST:$PGPORT/$PGDATABASE" >&2
  exit 2
fi

# Check 1: document_embeddings table exists
table_check=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_name = 'document_embeddings';")

# Check 2: search_key backfill count
backfill_count=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -t -A -c "SELECT count(*) FROM documents WHERE search_key IS NOT NULL;")

overall_exit=0

if [ "$table_check" = "1" ]; then
  echo "PASS document_embeddings table exists"
else
  echo "FAIL document_embeddings table missing"
  overall_exit=1
fi

if [ "$backfill_count" -gt 0 ]; then
  echo "PASS search_key backfilled ($backfill_count rows)"
else
  echo "FAIL search_key empty (0 rows with non-NULL search_key)"
  overall_exit=1
fi

exit $overall_exit
```

Wait, I need to be careful with `set -euo pipefail`. If psql fails during the checks (not connectivity), that could cause an unexpected exit. But the plan says "No functions are exported; the script is a linear sequence of two psql probes." So it should be linear.

Actually, let me reconsider. The plan says exit 2 is "cannot connect to database". The connectivity check should be separate. If the table doesn't exist, that's a FAIL (exit 1), not a connection error. But what if psql itself fails for other reasons during the check queries? The plan only specifies exit 0, 1, and 2. I'll keep it simple.

Let me also think about whether `set -e` is appropriate. If I use `set -e` and the psql command for checking table existence fails (e.g., because of some SQL error), it would exit with the psql exit code which might be 1. That's actually fine for our purposes since we want non-zero on failure. But it might skip the second check. Let me not use `set -e` and instead handle errors explicitly, or use `set -euo pipefail` but structure it so failures are captured.

Actually, the simplest approach: don't use `set -e`. Just run the commands and check results.

Let me also consider: what if `documents` table doesn't exist? Then the second query would fail. In the broken state, documents should exist (it's pre-existing). But to be safe, I could handle it. However, the plan says the script is a "linear sequence of two psql probes" - I'll keep it simple and trust that if the database is reachable, the documents table exists (since it's part of the base schema). If it doesn't, psql will return an error and the count will be empty or the command will fail. Let me handle that gracefully.

Actually, let me re-read: "No functions are exported; the script is a linear sequence of two `psql` probes." This means it's simple and linear. Let me keep it that way.

I'll use `set -uo pipefail` (without `-e`) so I can handle errors manually.

Let me finalize:
```

## reply

```bash
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
```
