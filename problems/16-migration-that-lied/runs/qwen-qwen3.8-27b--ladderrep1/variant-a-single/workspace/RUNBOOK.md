# RUNBOOK — "the deploy is green and the table is not there"

Reproduce exactly the way the pipeline does:

    docker compose up -d db
    ./scripts/migrate.sh
    ./scripts/verify.sh

Every state check in this runbook reads the database the compose file starts
(`app` / `app` on `localhost:55432`). If you have sourced `.env`, the
`$DATABASE_URL` in it works as-is; otherwise substitute
`postgresql://app:app@localhost:55432/app`.

Three defects. The two observable symptoms — `document_embeddings` missing and
`search_key` NULL for every document — have **independent** mechanisms; fixing
one does not surface the other. The third is an environment capability finding
that the corrected migration set depends on.

---

## Defect 1 — the migration journal never listed `0003_embeddings`

**Mechanism.** `drizzle-kit migrate` decides what to apply from
`drizzle/meta/_journal.json`; loose `.sql` files sitting in `drizzle/` are not
scanned. `0003_embeddings.sql` — which creates the `vector` extension and the
`document_embeddings` table — was committed to disk but never registered in
the journal. The runner applied entries 0000–0002, recorded each as applied in
`__drizzle_migrations`, and exited 0. The pipeline is green, but the table was
never created; any query against it fails with
`relation "document_embeddings" does not exist`.

**Fix (additive).** Registered the existing, unmodified `0003_embeddings.sql`
by appending one entry to `drizzle/meta/_journal.json`:
`{ "idx": 3, "version": "7", "when": 1726700000000, "tag": "0003_embeddings", "breakpoints": true }`.
No applied migration was edited. On a database where 0000–0002 are already
applied, `drizzle-kit migrate` now runs exactly `0003_embeddings` and
`0004_fix_search_key_backfill` (the defect-2 fix), and nothing else.

**Single command that distinguishes fixed from broken.**

    psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.document_embeddings') IS NOT NULL"

Broken → `f` · Fixed → `t`

---

## Defect 2 — the backfill predicate matched nothing

**Mechanism.** `0001_rename_slug` strips the `slug:` prefix from **every** row
(`UPDATE ... SET public_ref = replace(public_ref, 'slug:', '')`) before
`0002_backfill_search_key` runs, yet 0002 only backfills rows where
`public_ref LIKE 'slug:%'`. After 0001, no row matches that predicate; the
PL/pgSQL loop iterates zero times and still reports success. `search_key` is
therefore NULL for every document — the report shows it for none.

**Fix (additive).** New forward-only migration
`drizzle/0004_fix_search_key_backfill.sql`, registered in the journal as
`idx: 4`. It backfills from the already-normalized column:
`UPDATE documents SET search_key = lower(public_ref) WHERE search_key IS NULL;`
— exactly the value 0002 intended to write. Idempotent; it touches only
documents that still lack a value. 0002 itself is untouched.

**Single command that distinguishes fixed from broken.**

    psql "$DATABASE_URL" -tAc "SELECT count(*) FROM documents WHERE search_key IS NULL"

Broken → `5` (every seeded row) · Fixed → `0`

---

## Defect 3 (finding) — the pinned image cannot install `pgvector`

**Mechanism.** The compose file pinned `postgres:16-alpine`. That image does
not ship the `vector` extension, so once defect 1 is corrected,
`0003_embeddings.sql` fails at `CREATE EXTENSION vector` — the extension's
control file does not exist in the image. This is a capability gap in the
environment, not a defect in the migration file. Per policy the requirement is
**not** removed and the `vector(768)` column is **not** downgraded; the
environment is changed to provide the capability.

**Fix (additive, environment only).** `docker-compose.yml` now pins
`pgvector/pgvector:pg16-alpine` — the same Postgres 16 base, with pgvector
included. No migration file was changed.

**Single command that distinguishes fixed from broken.**

    psql "$DATABASE_URL" -tAc "SELECT extname FROM pg_extension WHERE extname = 'vector'"

Broken → (no rows) · Fixed → `vector`

---

## scripts/verify.sh

Run `chmod +x scripts/verify.sh` once. It exits 0 only when all three checks
pass, 1 otherwise. The output of `./scripts/verify.sh` in each state follows;
in both cases the database is a fresh one, brought up and migrated exactly the
way the pipeline does (`docker compose up -d db`, `./scripts/migrate.sh`,
`./scripts/verify.sh`).

**Broken state** — original compose, original journal, original migrations.
`migrate` exits 0 (green pipeline), and:

    FAIL document_embeddings missing
    FAIL search_key missing on 5/5 documents
    FAIL vector extension not installed
    RESULT BROKEN (exit 1)

**Fixed state** — corrected compose, journal with `idx: 3` and `idx: 4`, and
the new `0004_fix_search_key_backfill.sql`:

    OK document_embeddings present
    OK search_key set on 5/5 documents
    OK vector extension installed
    RESULT OK (exit 0)

---

## Out of scope (follow-up)

`src/schema.ts` does not declare `document_embeddings`. It is not read by
`drizzle-kit migrate`, so it played no part in this incident; declaring the
table there is a follow-up, not part of this fix.
