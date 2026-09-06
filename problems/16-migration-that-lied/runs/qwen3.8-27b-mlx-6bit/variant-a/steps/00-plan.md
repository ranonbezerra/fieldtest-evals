# plan

## reasoning

```
Let me analyze the task carefully.

The task is about a broken migration system using Drizzle migrations with a Docker Postgres setup. The issues are:
1. A `document_embeddings` table doesn't exist after migrations run green
2. A `search_key` column that should be backfilled for documents shows it for none

I need to write a PLAN.md for someone who will implement the fix. They'll have:
- The variant-a.md reference (which I'm reading now)
- The `fixtures/service/` directory with TypeScript service, Drizzle migrations, and docker-compose.yml
- This PLAN.md

Let me think about what the plan needs to specify:

**Assumptions:**
- The defects are in the migration files themselves (likely a migration that creates the table but uses wrong name, or a migration that's skipped due to ordering/hash issues)
- The `search_key` backfill is in a migration that runs but doesn't actually execute the UPDATE (maybe it's commented out, or targets wrong table)
- "Additive" means new migration files that fix the broken ones
- The verification script uses `psql` or a Node script to check table existence and data

Let me think about what Drizzle migrations look like:
- They're typically in `drizzle/` or `migrations/` folder
- Each is a `.sql` file with a timestamp
- Applied via `drizzle-kit migrate` or a custom runner

The two independent defects:
1. `document_embeddings` table - likely the migration that creates it either uses a wrong table name, is in the wrong directory, has a syntax issue that's silently swallowed, or the migration runner skips it
2. `search_key` backfill - likely the UPDATE statement in a migration is wrong (wrong column name, wrong table, or the migration runs but the WHERE clause matches nothing)

Since I can't see the actual fixtures, I need to write a plan that tells the implementer:
- How to set up the environment (docker-compose)
- How to apply migrations (the same way the pipeline does)
- How to diagnose each defect
- How to write additive fixes (new migration files)
- How to write the RUNBOOK.md
- How to write scripts/verify.sh

Let me structure this properly. The manifest should list:
- `RUNBOOK.md`
- `scripts/verify.sh`
- New migration files (but I don't know the exact names yet - they depend on what the implementer finds)

Wait, I need to be more specific. Let me think about what the plan should contain.

The plan is a specification for whoever implements it. They have:
1. This PLAN.md
2. The variant-a.md (reference, already read)
3. Access to `fixtures/service/` directory

They need to:
1. Bring up docker-compose, apply migrations, diagnose
2. Write additive migration fixes
3. Write RUNBOOK.md
4. Write scripts/verify.sh

For the data model section - I need to describe what tables should exist. Based on the problem:
- `documents` table (exists, has a `search_key` column that should be backfilled)
- `document_embeddings` table (should exist after migration but doesn't)

For types and signatures - this is mostly a bash script and SQL migrations, plus maybe a Node verification. Let me think about what's actually "exported" here.

Actually, re-reading the task: the deliverables are:
1. Additive migration files (SQL)
2. `RUNBOOK.md`
3. `scripts/verify.sh`

The "types and signatures" would be for the verify.sh script's contract (exit codes, output format).

Let me write this plan now, keeping it terse and within the hard output limit.
```

## reply

## 1. Assumptions

- The pipeline applies migrations via `drizzle-kit migrate` (or the project's equivalent runner) against the `postgres` service defined in `docker-compose.yml`; we replicate that exact invocation.
- "Additive" means new timestamped `.sql` migration files appended to the existing migration directory; existing files are never modified.
- The two defects are (a) a migration that should create `document_embeddings` silently produces nothing or creates a differently-named object, and (b) a backfill migration that should populate `documents.search_key` runs to completion without touching rows. The implementer confirms the exact mechanism during diagnosis.
- `scripts/verify.sh` is a self-contained bash script that connects to the Postgres container via `psql` (no Node runtime dependency).
- The extension requirement from the compose file (e.g. `pgvector` or `uuid-ossp`) is a finding to document in RUNBOOK.md if it cannot be installed on the specified image, but is not removed from `docker-compose.yml`.
- New migration files are named with the next sequential timestamp after the last existing one, using Drizzle's `00NN_description.sql` convention already present in the directory.

## 2. Data model

| Table | Column | Type | Notes |
|---|---|---|---|
| `documents` | `id` | `uuid` PK | Pre-existing |
| `documents` | `title` | `text` NOT NULL | Pre-existing |
| `documents` | `body` | `text` | Pre-existing |
| `documents` | `search_key` | `text` | Exists but NULL for all rows in broken state |
| `documents` | `created_at` | `timestamptz` DEFAULT now() | Pre-existing |
| `document_embeddings` | `id` | `uuid` PK | **Missing in broken state** |
| `document_embeddings` | `document_id` | `uuid` FK → `documents(id)` ON DELETE CASCADE | **Missing in broken state** |
| `document_embeddings` | `model` | `text` NOT NULL | **Missing in broken state** |
| `document_embeddings` | `vector` | `vector(1536)` (pgvector) or `float8[]` fallback | **Missing in broken state** |
| `document_embeddings` | `created_at` | `timestamptz` DEFAULT now() | **Missing in broken state** |

The exact column set for `document_embeddings` is confirmed from the *intended* migration SQL during diagnosis; the table above reflects what the broken-state error implies must exist.

## 3. Types and signatures

### `scripts/verify.sh`

```
Usage: scripts/verify.sh [PGHOST] [PGPORT] [PGUSER] [PGDATABASE]
Defaults:  localhost  5432  postgres  fieldtest

Exit codes:
  0  both checks pass (table exists AND backfill is present)
  1  one or both checks fail
  2  cannot connect to database

Output (stdout, one line per check):
  "PASS document_embeddings table exists"   or
  "FAIL document_embeddings table missing"
  "PASS search_key backfilled (<n> rows)"   or
  "FAIL search_key empty (0 rows with non-NULL search_key)"
```

No functions are exported; the script is a linear sequence of two `psql` probes.

### Additive migration files

Each is plain SQL, no parameterisation. The implementer writes exactly two new files:

- `migrations/00NN_fix_document_embeddings.sql` — `CREATE TABLE IF NOT EXISTS document_embeddings (…)`.
- `migrations/00NN_fix_search_key_backfill.sql` — `UPDATE documents SET search_key = … WHERE search_key IS NULL;`

The precise `<NN>` and column definitions are taken from the diagnosis. If a `CREATE INDEX` or unique constraint is part of the intended schema, it ships in the same file as the `CREATE TABLE`.

### Error model

| Condition | Source | Surfaced as |
|---|---|---|
| `psql` cannot connect | verify.sh | exit 2, stderr message |
| Table absent | verify.sh check 1 | exit 1, `FAIL …` line |
| Zero backfilled rows | verify.sh check 2 | exit 1, `FAIL …` line |
| Migration runner error (during fix) | drizzle-kit / psql | non-zero exit from the apply command; recorded in RUNBOOK.md |

### Ordering rules

1. `fix_document_embeddings` must be applied **before** any migration that inserts into it (if one exists later in the sequence).
2. `fix_search_key_backfill` must be applied **after** `documents` table exists (it does, by assumption) and is independent of `fix_document_embeddings`.
3. Both new migrations must carry timestamps **greater** than every existing migration in the directory so the runner orders them last.

## 4. Control flow

**Phase 1 — Reproduce.**

1. `docker compose up -d` from `fixtures/service/`.
2. Apply migrations using the pipeline's exact command (read from CI config or Makefile in the fixture; fallback `npx drizzle-kit migrate`).
3. Connect with `psql`, run `\dt` and `SELECT count(*) FROM documents WHERE search_key IS NOT NULL;`.
4. Record both failures. This is the "broken" baseline for verify.sh.

**Phase 2 — Diagnose (two independent investigations).**

- *Defect A:* Read every migration file in order. Identify which one was intended to create `document_embeddings`. Determine why it produces nothing: wrong object name, wrapped in a no-op transaction that rolls back, placed in a subdirectory the runner ignores, contains only a comment/DDL guard that evaluates to no-op, or references an extension not installed. The mechanism is recorded verbatim for RUNBOOK.md.
- *Defect B:* Read the backfill migration. Determine why the UPDATE matches zero rows: wrong column name, wrong table, `WHERE` clause that is always false, the statement is inside a `DO $$ … END;` block that swallows the error, or it targets a table not yet populated at that migration position.

**Phase 3 — Fix (additive migrations).**

1. Write `migrations/00NN_fix_document_embeddings.sql`. If the root cause is a missing extension, the file begins with `CREATE EXTENSION IF NOT EXISTS …;`. Wrap in `BEGIN; … COMMIT;`.
2. Write `migrations/00NN_fix_search_key_backfill.sql`. Single `UPDATE … WHERE search_key IS NULL;`. Wrap in `BEGIN; … COMMIT;`.
3. Re-run the full migration sequence against a **fresh** container (`docker compose down -v && docker compose up -d`, re-apply). Confirm both checks pass.
4. Also verify against the **broken** container (old state) that applying only the two new migrations brings it to green.

**Phase 4 — Deliverables.**

- `RUNBOOK.md` at repo root.
- `scripts/verify.sh`, executable (`chmod +x`).

No code outside these deliverables is modified. The `docker-compose.yml`, existing migrations, and service source are untouched.

## 5. Tests

- `verify.sh` exits 0 and prints two PASS lines against the corrected database.
- `verify.sh` exits 1 and prints at least one FAIL line against the broken database (pre-fix state).
- `verify.sh` exits 2 and prints a stderr message when the Postgres container is not running.
- The `document_embeddings` table accepts a row with a valid FK to an existing document (sanity: schema is correct, not merely present).
- Every row in `documents` has a non-NULL `search_key` after the backfill migration (count = total row count).

## 6. Manifest

<!-- manifest
RUNBOOK.md | reads: - | one section per defect: mechanism, additive fix, distinguishing psql command
scripts/verify.sh | reads: - | connects to Postgres, checks table existence and backfill count, exits 0/1/2
migrations/00NN_fix_document_embeddings.sql | reads: - | CREATE TABLE IF NOT EXISTS + required index/extension
migrations/00NN_fix_search_key_backfill.sql | reads: - | UPDATE documents SET search_key … WHERE search_key IS NULL
-->
