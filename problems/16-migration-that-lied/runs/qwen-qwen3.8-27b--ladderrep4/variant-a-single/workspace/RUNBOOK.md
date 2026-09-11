# RUNBOOK — Issue #133: deploy is green, `document_embeddings` is not there

**Symptoms.** `relation "document_embeddings" does not exist` in production; the
report that should show a backfilled `search_key` for every document shows it for
none; the deploy pipeline is green and every migration step logged success.

**Root cause in one line.** `drizzle-kit migrate` applies only what its manifest,
`drizzle/meta/_journal.json`, lists. A green run proves the listed steps
succeeded — not that the database matches the files on disk.

**Findings: three, independent.** Fixing one does not surface the others.

  1. `0003_embeddings.sql` has no journal entry → never applied → no table (runner-manifest defect).
  2. `0002_backfill_search_key` filters on `slug:%`, a prefix `0001_rename_slug` had already stripped → the backfill touched 0 rows (migration-logic defect).
  3. `docker-compose.yml` pins `postgres:16-alpine`, which cannot provide the `vector` extension (environment finding).

All commands below assume:

    DATABASE_URL=postgres://app:app@localhost:55432/app

(the compose credentials).

## Reproduce the way the pipeline does

    cp .env.example .env && set -a && . ./.env && set +a
    docker compose up -d db
    ./scripts/migrate.sh

Observed end state on the **original** compose file and journal, fresh database:

- Runner logs `0000_documents`, `0001_rename_slug`, `0002_backfill_search_key` applied; exit 0. `__drizzle_migrations` holds exactly those three tags.
- `documents`: 5 rows; `public_ref` no longer carries the `slug:` prefix; `search_key` is **NULL on all five**.
- No `document_embeddings` relation. No `vector` extension.

## Defect 1 — `0003_embeddings` is missing from `drizzle/meta/_journal.json`

**Mechanism.** `drizzle-kit migrate` walks the journal and applies only the listed
tags. The journal stopped at `idx 2`; `0003_embeddings.sql` — which creates the
`vector` extension and the `document_embeddings` table — sits on disk unlisted.
The runner applies 3 of 3, logs success, exits 0. The green run is real: it did
exactly what its manifest told it to do.

**Fix (additive).** Append the missing entry. No applied migration is edited;
`0003_embeddings.sql` is byte-identical:

    { "idx": 3, "version": "7", "when": 1726700000000, "tag": "0003_embeddings", "breakpoints": true }

On an already-broken production database, re-running the migration step with the
fixed repo applies only the newly journaled entries (0003, and 0004 from defect
2); the already-recorded 0000–0002 are not replayed.

**Distinguishing command** — `t` = fixed, `f` = broken:

    psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.document_embeddings') IS NOT NULL;"

## Defect 2 — `0002` backfills a prefix that `0001` already stripped

**Mechanism.** `0001_rename_slug` renames `slug` → `public_ref` **and** strips the
legacy prefix in the same migration (`UPDATE ... SET public_ref = replace(public_ref, 'slug:', '')`).
The next migration, `0002_backfill_search_key`, backfills only rows where
`public_ref LIKE 'slug:%'`. After 0001, **no** row matches, so the `DO` block
loops over zero rows and `search_key` stays NULL for every document. Both
migrations succeed individually, so the pipeline stays green and the report shows
`search_key` for none. 0002 was written against the pre-0001 data shape.

**Fix (additive).** New forward-only migration
`drizzle/0004_complete_search_key_backfill.sql` plus its journal entry (`idx 4`):

    UPDATE "documents"
    SET "search_key" = lower("public_ref")
    WHERE "search_key" IS NULL
      AND "public_ref" IS NOT NULL;

`0001` and `0002` are applied and are not edited.

**Distinguishing command** — `0` = fixed, `5` = broken (the five seeded documents):

    psql "$DATABASE_URL" -tAc "SELECT count(*) FROM documents WHERE search_key IS NULL;"

## Defect 3 — (finding) the pinned image cannot provide `pgvector`

**Mechanism.** `postgres:16-alpine` does not ship the `vector` extension and has
no package source to install it. While defect 1 hid `0003`, this stayed silent;
once the journal entry is restored, 0003 runs and fails at
`CREATE EXTENSION IF NOT EXISTS vector` — the deploy stops being green.
Independent of the other two: the manifest can be correct while the environment
still cannot express the schema, and vice versa.

**Fix.** Pin an image that ships pgvector: `pgvector/pgvector:pg16` in
`docker-compose.yml`. The requirement is preserved, not removed:
`document_embeddings.embedding` stays `vector(768)`. Deliberately **not** done:
downgrading the column to `text`/`jsonb` to dodge the missing extension — that
is a schema change smuggled in as a fix, and `scripts/verify.sh` fails it (check 2).

**Distinguishing command** — `t` = fixed, `f` = broken (and unreachable on the
old image, which is the finding):

    psql "$DATABASE_URL" -tAc "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector');"

## Why the defects are independent

- Fix 1 only → 0003 runs and **fails** at `CREATE EXTENSION` (needs 3); deploy goes red.
- Fix 3 only → green, but the table is still missing (needs 1) and `search_key` is still NULL (needs 2).
- Fix 2 only → green, `search_key` good, table still missing (needs 1).
- All three → green **and** correct.

## Corrected state from a fresh database

    cp .env.example .env && set -a && . ./.env && set +a
    docker compose up -d db     # now pgvector/pgvector:pg16
    ./scripts/migrate.sh        # applies 0000 → 0004, all journaled
    ./scripts/verify.sh         # exit 0

The same commands repair an existing broken database: the runner's bookkeeping
(`__drizzle_migrations`) means only the unapplied, newly journaled 0003 and 0004
execute.

## `scripts/verify.sh` — real output from both states

Checks: (1) `document_embeddings` exists; (2) `embedding` is still `vector(768)`
(guards against a type-downgrade workaround); (3) `vector` extension installed;
(4) every document has `search_key = lower(public_ref)`. Exit 0 = corrected,
1 = broken or unreachable. Each capture below is from a **freshly rebuilt**
database — the script was run against the broken state before the fixes existed,
not only against the state it was written for.

**Broken** — fresh `postgres:16-alpine`, original journal (0000–0002), pipeline as shipped:

    FAIL document_embeddings relation exists: expected t, got f
    FAIL document_embeddings.embedding is vector(768): expected vector(768), got <missing>
    FAIL vector extension installed: expected t, got f
    FAIL all documents have search_key = lower(public_ref): expected 0, got 5
    RESULT: BROKEN

    (exit code: 1)

**Fixed** — fresh `pgvector/pgvector:pg16`, corrected journal (0000–0004):

    PASS document_embeddings relation exists
    PASS document_embeddings.embedding is vector(768)
    PASS vector extension installed
    PASS all documents have search_key = lower(public_ref)
    RESULT: OK

    (exit code: 0)

## What changed (all additive)

| File | Change |
| --- | --- |
| `docker-compose.yml` | `db.image` → `pgvector/pgvector:pg16` |
| `drizzle/meta/_journal.json` | appended `idx 3` and `idx 4` entries; existing entries untouched |
| `drizzle/0004_complete_search_key_backfill.sql` | new forward-only migration |
| `scripts/migrate.sh`, `.env.example` | pipeline entry points (reconstructed; see ASSUMPTION notes in-file) |
| `scripts/verify.sh`, `RUNBOOK.md` | new |

No SQL migration that was applied anywhere was modified.
