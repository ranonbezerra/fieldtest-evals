# 16 — The migration that reported success and did nothing

## The real situation

Every failure in this problem was collected from one project's migration history,
and they share a single shape: **the tool printed success and the database was
unchanged.**

- A migration written by hand and placed in the migrations directory, but never
  added to the tool's journal. `migrate` prints *applied successfully* and creates
  nothing — the journal, not the directory, is what the tool reads.
- `CREATE EXTENSION vector` against a Postgres image that does not ship pgvector.
  It fails, the deploy script does not check, and the failure surfaces weeks later
  as a query that cannot find an operator class.
- A `DO $$ ... $$` backfill whose loop matched no rows, because the `WHERE`
  clause referenced a column the previous migration renamed. Zero iterations is
  not an error.
- A verification step that checked `SELECT version()` instead of the extension,
  and passed on a database with no extension at all.

None of these throw. None fail CI. Each was found later, by someone debugging
something that appeared unrelated.

The second half of the problem is the part people skip: **writing a check that
fails when the work is wrong.** It is easy to write a criterion that passes on a
correct database. The whole skill is writing one that fails on the broken one —
`SELECT extname FROM pg_extension`, not `SELECT version()`; a row count after the
backfill, not the absence of an exception.

## Stack

TypeScript, Drizzle (or Prisma — the variant says which), PostgreSQL via Docker.
The failures are in SQL, journals, and shell, so the deliverable is a diagnosis, a
corrected migration set, and a verification script.
