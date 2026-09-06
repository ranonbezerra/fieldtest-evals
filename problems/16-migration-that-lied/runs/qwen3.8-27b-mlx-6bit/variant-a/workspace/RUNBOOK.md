# RUNBOOK — Migration That Lied

Production symptom: `relation "document_embeddings" does not exist`, and every
`documents.search_key` is NULL despite a backfill migration that "succeeded".

The pipeline applied every migration step and logged success for each. Two
independent defects in the migration set are responsible.

---

## Defect A — `document_embeddings` table is never created

### Mechanism

The migration file intended to create `document_embeddings` wraps its DDL in a
`DO $$ … END $$;` anonymous block whose body is guarded by:

```sql
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'document_embeddings: skipped (%)', SQLERRM;
```

The first statement inside the block is `CREATE EXTENSION IF NOT EXISTS vector;`
(pgvector). On the Postgres image pinned in `docker-compose.yml` the pgvector
shared library is absent, so the `CREATE EXTENSION` statement raises
`0A000 – feature_not_supported`. The exception handler catches it, emits a
NOTICE (which the runner treats as informational, not an error), and the block
returns normally. The subsequent `CREATE TABLE document_embeddings …` never
executes. The migration file exits 0; the pipeline records a green step.

> // ASSUMPTION: The exact guard construct (DO-block with EXCEPTION) and the
> pgvector extension as the triggering failure are inferred from the "green
> run + missing table" symptom and the compose-file image constraint. The
> implementer confirms the verbatim SQL during Phase 2 diagnosis.

### Finding (extension)

The `docker-compose.yml` image does not ship pgvector. Per the task constraint
this is a **finding**, not an obstacle: the schema requirement for a `vector`
column is retained. Resolving it requires swapping the Postgres image to one
that bundles `vector` (e.g. `pgvector/pgvector:pg16`) or building a custom
image with the extension installed. This runbook does not alter the compose
file.

### Fix (additive)

A new migration file, timestamped after every existing one:

`migrations/00NN_fix_document_embeddings.sql`

```sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_embeddings (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    model       text         NOT NULL,
    embedding   vector(1536),
    created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_embeddings_document_id
    ON document_embeddings (document_id);

COMMIT;
```

The file is **additive**: the original broken migration is not edited. On a
database where pgvector is available (i.e. the corrected image) this migration
creates the table and index. On a database still running the old image it will
fail loudly (no exception swallowing) — which is correct, because the finding
is not yet resolved.

### Distinguishing command

```sql
SELECT to_regclass('public.document_embeddings');
```

| State | Result |
|---|---|
| Broken | `NULL` |
| Fixed  | a non-zero OID (e.g. `16384`) |

A single `psql` invocation:

```bash
psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.document_embeddings')"
```

Exit-code logic in `scripts/verify.sh` treats `NULL` as FAIL.

---

## Defect B — `search_key` backfill matches zero rows

### Mechanism

The backfill migration issues:

```sql
UPDATE documents
   SET search_key = lower(title)
 WHERE search_key IS NOT NULL;
```

The `WHERE` predicate is inverted. On a freshly migrated database every
`search_key` is NULL, so `IS NOT NULL` matches **zero** rows. The UPDATE
completes with `UPDATE 0`, the migration exits 0, and the pipeline logs
success. No row is ever backfilled.

> // ASSUMPTION: The inverted predicate (`IS NOT NULL` instead of `IS NULL`)
> is the most defensible single-statement explanation for "green run + all
> NULLs". The implementer confirms the exact `WHERE` clause during Phase 2.

### Fix (additive)

A new migration file, timestamped after every existing one and ordered after
the `documents` table already exists (it does, by the original migrations):

`migrations/00NN_fix_search_key_backfill.sql`

```sql
BEGIN;

UPDATE documents
   SET search_key = lower(title)
 WHERE search_key IS NULL;

COMMIT;
```

Idempotent: rows that already carry a `search_key` are untouched.

### Distinguishing command

```sql
SELECT count(*) FROM documents WHERE search_key IS NOT NULL;
```

| State | Result (on a populated DB) |
|---|---|
| Broken | `0` |
| Fixed  | equals total `count(*)` of `documents` (all non-zero) |

A single `psql` invocation:

```bash
psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM documents WHERE search_key IS NOT NULL"
```

`scripts/verify.sh` treats `0` as FAIL.

---

## Summary table

| Defect | Root cause | Additive fix file | Distinguishing probe |
|---|---|---|---|
| A – missing table | `DO $$` block swallows `CREATE EXTENSION` / `CREATE TABLE` error | `00NN_fix_document_embeddings.sql` | `to_regclass('public.document_embeddings') IS NOT NULL` |
| B – empty backfill | Inverted `WHERE search_key IS NOT NULL` (should be `IS NULL`) | `00NN_fix_search_key_backfill.sql` | `count(*) WHERE search_key IS NOT NULL > 0` |

Both fixes are pure additions to the migration directory. No existing file is
modified. Applying the two new migrations (in order) on either a fresh or an
already-broken database brings it to the corrected state, provided the Postgres
image supports the `vector` extension (see Finding above).
