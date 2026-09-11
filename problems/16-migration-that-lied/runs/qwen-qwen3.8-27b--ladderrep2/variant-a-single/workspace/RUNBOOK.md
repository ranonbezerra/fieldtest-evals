# RUNBOOK — search-service: green pipeline, missing table, empty backfill

## What was observed

Brought the environment up from `docker-compose.yml` and applied the
migrations exactly as the pipeline does (`./scripts/migrate.sh`, i.e.
`drizzle-kit migrate`). Every step logged success. End state:

- `psql` reports `relation "document_embeddings" does not exist`.
- `SELECT count(*) FROM documents WHERE search_key IS NULL` returns 5 of 5.
- `drizzle/meta/_journal.json` lists exactly three migrations (0000, 0001,
  0002), while a fourth SQL file, `drizzle/0003_embeddings.sql`, sits on disk
  unregistered.

There are **two independent defects** — fixing one does not surface the other
— and **one environmental finding** that defect 1 keeps hidden. Both defects
exploit the same gap: a migration runner logging success reports that it did
what it decided to do, not that the database matches the migration files.

## Defect 1 — `document_embeddings` is never created

**Symptom.** Production throws `relation "document_embeddings" does not
exist`. The pipeline is green.

**Mechanism.** `drizzle-kit migrate` does not scan `drizzle/*.sql`; it reads
`drizzle/meta/_journal.json` and applies only the entries listed there.
`0003_embeddings.sql` was committed without its journal entry, so the runner
stopped after 0002 with nothing left to do and exited 0. The migration file
is green because the runner never saw it.

**Fix (additive).** Register the already-written migration — no SQL file is
edited, and 0003 was never applied anywhere, so it runs as-is on the next
migrate; environments that already ran 0000–0002 pick up exactly this one new
step. Append to `entries` in `drizzle/meta/_journal.json`:

    { "idx": 3, "version": "7", "when": 1726700000000, "tag": "0003_embeddings", "breakpoints": true }

**The single command that distinguishes fixed from broken.**

    psql "$DATABASE_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'document_embeddings'"

Broken prints `0`. Fixed prints `1`.

## Defect 2 — `search_key` is backfilled for zero documents

**Symptom.** The report that should show a backfilled `search_key` for every
document shows it for none. The pipeline is green.

**Mechanism.** Two consecutive migrations disagree about the data:

- `0001_rename_slug.sql` renames `slug` to `public_ref` and, in the same
  file, strips the `slug:` prefix from every existing row (`UPDATE "documents"
  SET "public_ref" = replace("public_ref", 'slug:', '')`).
- `0002_backfill_search_key.sql` then loops over rows matching
  `WHERE "search_key" IS NULL AND "public_ref" LIKE 'slug:%'` — a predicate
  written against pre-0001 data. After 0001, no row matches, the PL/pgSQL
  `FOR` loop runs zero iterations, the block commits, and the runner logs
  success. "Succeeded" here means "executed without error"; the migration had
  nothing to do.

The defect is invisible in the logs and only visible in the data.

**Fix (additive).** 0002 is already applied in production and is never
edited in place. A new forward migration, `drizzle/0004_backfill_search_key.sql`,
backfills against post-rename data with the same expression 0002 intended
(`replace` is a no-op once the prefix is gone; the stale `LIKE` guard is
dropped):

    UPDATE "documents"
    SET "search_key" = lower(replace("public_ref", 'slug:', ''))
    WHERE "search_key" IS NULL;

It is registered in the journal — a new migration only runs if the runner
knows about it, the same mechanism as defect 1:

    { "idx": 4, "version": "7", "when": 1726800000000, "tag": "0004_backfill_search_key", "breakpoints": true }

The `IS NULL` guard keeps the backfill idempotent and never overwrites a key
the application has set.

**The single command that distinguishes fixed from broken.**

    psql "$DATABASE_URL" -tAc "SELECT count(*) FROM documents WHERE search_key IS NULL"

Broken prints `5` (all seeded documents). Fixed prints `0`.

## Finding 3 — the compose image cannot provide the `vector` extension

Once defect 1 is fixed, the next migrate runs `0003_embeddings.sql`, whose
first statement is `CREATE EXTENSION IF NOT EXISTS vector;`. The compose file
pinned `postgres:16-alpine`, which does not ship pgvector; on that image the
statement fails with:

    ERROR:  could not open extension control file "/usr/share/postgresql/extension/vector.control": No such file or directory
    HINT:  The extension must first be installed on the system where PostgreSQL is running.

Per the incident rules this is reported as a **finding**, not worked around:
the migration is not weakened (`document_embeddings.embedding` stays
`vector(768)`; no downgrade to `bytea`/`text`). The environment is fixed
instead — the service now runs on an image that ships pgvector on Postgres 16:

    image: pgvector/pgvector:pg16

(`docker compose down -v && docker compose up -d db` to recreate the volume.)

**The single command that distinguishes fixed from broken.**

    psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_extension WHERE extname = 'vector'"

Broken image prints `0`. Fixed image prints `1`.

## scripts/verify.sh

Four checks, one line each, then a verdict. Exit 0 only when all pass; exit 1
on the broken database; exit 2 if `psql` is missing.

    set -a && . ./.env && set +a
    ./scripts/verify.sh

### Real output — broken database

Fresh `postgres:16-alpine` container, original journal, pipeline run green:

    [verify] document_embeddings table exists: MISMATCH, got 'f' want 't'
    [verify] vector extension installed: MISMATCH, got 'f' want 't'
    [verify] embedding column is vector(768): MISMATCH, got 'missing' want 'vector(768)'
    [verify] search_key backfilled (null/total): MISMATCH, got '5/5' want '0/5'
    [verify] RESULT: BROKEN

exit code: 1

### Real output — fixed database

`pgvector/pgvector:pg16` container, corrected journal, 0003 and 0004 applied:

    [verify] document_embeddings table exists: OK (t)
    [verify] vector extension installed: OK (t)
    [verify] embedding column is vector(768): OK (vector(768))
    [verify] search_key backfilled (null/total): OK (0/5)
    [verify] RESULT: OK

exit code: 0

## Rebuild from zero (proves the corrected set)

    docker compose down -v
    docker compose up -d db
    set -a && . ./.env && set +a
    ./scripts/migrate.sh
    ./scripts/verify.sh

A fresh database built this way ends with 5 documents (all with `search_key`
set), the `vector` extension installed, and `document_embeddings` ready for
`vector(768)` rows — the state the migration files describe.
