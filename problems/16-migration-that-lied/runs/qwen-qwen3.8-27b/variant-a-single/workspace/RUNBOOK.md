# RUNBOOK — `document_embeddings` missing / `search_key` backfilled for none

**State of the world.** The deploy pipeline is green and every migration step
logs success, yet production throws `relation "document_embeddings" does not
exist`, and the report that should show a backfilled `search_key` for every
document shows it for none. There are **two independent defects** in applied
migrations plus **one environment finding** that the additive fix depends on.

## Why a green run can leave the database broken

`drizzle-kit migrate` executes each `.sql` file it has not yet recorded in
`__drizzle_migrations` and logs success when the file **executes without
throwing**. Two properties of Postgres let broken migrations still "succeed":

1. A file that contains no executable statements (only comments) executes
   cleanly. Applying it records its checksum and logs success — while
   changing nothing.
2. `UPDATE ... WHERE <predicate that matches nothing)` is a perfectly
   successful statement that touches zero rows. Neither the migration
   runner nor `psql` treats "0 rows affected" as an error.

Both defects below exploit exactly these properties, which is why the
pipeline never went red.

---

## Defect D1 — `0001_document_embeddings.sql` is a comment-only no-op

**Symptom.** `relation "document_embeddings" does not exist` in production.

**Mechanism.** The whole DDL of `0001_document_embeddings.sql` (the
`CREATE EXTENSION` line and the `CREATE TABLE document_embeddings ...`
statement) is commented out — a commented dry-run body shipped as the final
migration. The runner executes the file, finds no statements, records the
file's checksum in `__drizzle_migrations` and logs success. No table is
created in any environment, including production.

**Fix (additive).** New migration
`fixtures/service/drizzle/0003_create_document_embeddings.sql`, registered as
the journal entry `idx: 3` in `fixtures/service/drizzle/meta/_journal.json`.
It runs `CREATE EXTENSION IF NOT EXISTS vector;` and creates
`public.document_embeddings` idempotently, so it also repairs any
environment where the table was hand-created as an interim hotfix, and every
environment converges on the same checksum frontier. `0001` is left byte-for-byte
untouched because it is already applied and checksummed elsewhere.

**Single command that distinguishes fixed from broken** (run with the same
credentials as the pipeline):
