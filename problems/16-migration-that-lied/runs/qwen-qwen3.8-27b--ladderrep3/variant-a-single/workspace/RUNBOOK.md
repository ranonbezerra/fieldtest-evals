# RUNBOOK — "deploy is green and the table is not there" (Issue #133)

**TL;DR.** A green pipeline left `document_embeddings` absent and `search_key`
empty because **two independent migration defects** hid behind a
journal-driven runner, and a third issue was an **environment finding**: the
pinned Postgres image cannot install the `vector` extension the embeddings
migration requires. All corrections are additive: one missing journal entry
added, one new forward-only migration appended, one image pin changed. No
applied migration was edited, and no column was downgraded.

**Symptoms.**

- Production: `relation "document_embeddings" does not exist`.
- Report: a backfilled `search_key` for **no** document (all NULL).
- Pipeline: every migration step logged success.

**Why green ≠ applied.** `drizzle-kit migrate` applies only the migrations
listed in `drizzle/meta/_journal.json`, in `idx` order, recording each in the
`__drizzle_migrations` table. A `.sql` file without a journal entry is
invisible to the runner: skipped silently, exit 0, the log says success. The
runner reports what *it* decided to do — not the state the migration files
describe.

Commands below assume `DATABASE_URL` is exported:

~~~bash
set -a; . ./.env; set +a
~~~

---

## D-1 — `document_embeddings` was never created

**Mechanism.** `drizzle/0003_embeddings.sql` exists on disk, but
`drizzle/meta/_journal.json` stopped at `idx: 2`
(`0002_backfill_search_key`). With no journal entry, the runner never saw the
file. In every environment the pipeline built, 0000–0002 ran, were recorded
in `__drizzle_migrations`, and the step logged success — while
`0003_embeddings.sql` was never executed. Hence no `document_embeddings`
table (and no `vector` extension).

**Fix (additive).** Appended the missing entry to
`drizzle/meta/_journal.json` (together with the entry for the D-2 fix,
`idx: 4`):

~~~json
{ "idx": 3, "version": "7", "when": 1726700000000, "tag": "0003_embeddings", "breakpoints": true },
{ "idx": 4, "version": "7", "when": 1726800000000, "tag": "0004_backfill_search_key", "breakpoints": true }
~~~

`0003_embeddings.sql` itself is **unchanged**: it was never applied anywhere,
so nothing can diverge, and editing it in place is what this incident
forbids. The journal entry is what makes the runner pick the file up — the
same mechanism that hid the defect.

**The single command that distinguishes the fixed state from the broken one.**

~~~bash
psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.document_embeddings') IS NOT NULL"
# broken: f
# fixed:  t
~~~

---

## D-2 — `search_key` was never backfilled

**Mechanism.** `0001_rename_slug.sql` renamed `slug` → `public_ref` and,
**in the same migration, stripped the `'slug:'` prefix from every row**.
`0002_backfill_search_key.sql` then backfilled `search_key` only for rows
matching `public_ref LIKE 'slug:%'` — a predicate describing the pre-0001
state. After 0001, zero rows match: the `DO` block loops zero times,
commits, and the runner logs success. `search_key` is NULL for every
document. This defect is independent of D-1 — even on a database where the
embeddings table exists, the report stays empty.

**Fix (additive, forward-only).** New migration
`drizzle/0004_backfill_search_key.sql`:

~~~sql
UPDATE "documents"
SET "search_key" = lower("public_ref")
WHERE "search_key" IS NULL;
~~~

By the time 0004 runs, every `public_ref` is prefix-free (0001 normalized
the legacy rows; rows written after 0001 never carried the prefix), so
`lower(public_ref)` is exactly the value 0002 was trying to compute. 0002 is
left in place, unmodified.

**The single command that distinguishes the fixed state from the broken one.**

~~~bash
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM documents WHERE search_key IS NULL"
# broken: 5   (all seeded documents)
# fixed:  0
~~~

---

## F-1 — Finding: the pinned image cannot install the `vector` extension

**Mechanism.** `0003_embeddings.sql` runs `CREATE EXTENSION IF NOT EXISTS
vector`. The compose file pinned `postgres:16-alpine`, which does not ship
pgvector and does not have it in its package repositories — the extension
**cannot be installed on that image**. Before D-1 was fixed this was
invisible (0003 never ran). After the journal fix, the same image turns the
pipeline red at 0003:

~~~
could not open extension control file
"/usr/share/postgresql/16/extension/vector.control": No such file or directory
~~~

**Fix.** Provide the capability instead of working around it: pin
`pgvector/pgvector:pg16` — Postgres 16 with pgvector built in. The migration
is unchanged: the `embedding` column stays `vector(768)`. Downgrading the
column (e.g. to `bytea`) to dodge the extension is a schema change smuggled
in as a fix, and it is ruled out for this incident.

**The single command that distinguishes the fixed state from the broken one.**

~~~bash
psql "$DATABASE_URL" -tAc "SELECT installed_version FROM pg_available_extensions WHERE name = 'vector'"
# broken: <no rows>
# fixed:  0.7.x   (the pgvector version the image ships)
~~~

---

## Applying the correction

**Fresh database** (CI / local):

~~~bash
cp .env.example .env && set -a && . ./.env && set +a
docker compose down -v && docker compose up -d db
./scripts/migrate.sh     # applies 0000..0004 in order
./scripts/verify.sh      # exits 0
~~~

**Already-broken database** (staging / prod): first roll the `pgvector`
image (F-1), then re-run the pipeline's migration step as-is:

~~~bash
./scripts/migrate.sh     # 0000-0002 already recorded -> skipped; 0003 + 0004 run
./scripts/verify.sh      # exits 0
~~~

Note the direction change: with the journal fixed, a database image that
lacks pgvector now **fails loudly** at 0003 instead of passing silently.

---

## `scripts/verify.sh` — real output, both states

The script exits 0 on the corrected database and 1 on the broken one.
Checks: the embeddings table exists; the `vector` extension is installed; at
least one document exists (so the backfill check cannot pass vacuously on an
empty table); `search_key` is non-NULL for every document; and the
`embedding` column is still `vector(768)` (a guard against a future
downgrade "fix").

**Before the fix** — original `postgres:16-alpine` image, original journal,
migrations applied exactly the way the pipeline applies them:

~~~console
$ ./scripts/verify.sh
FAIL  document_embeddings table exists    expected=t actual=f
FAIL  vector extension installed          expected=1 actual=0
PASS  documents present (non-vacuous)     value=5
FAIL  search_key backfilled (null count)  expected=0 actual=5
FAIL  embedding column type               expected=vector(768) actual=<empty>
verify: BROKEN (4 of 5 checks failed)
$ echo $?
1
~~~

**After the fix** — `pgvector/pgvector:pg16` image, journal with all five
entries, `./scripts/migrate.sh` re-run against the broken database:

~~~console
$ ./scripts/verify.sh
PASS  document_embeddings table exists    value=t
PASS  vector extension installed          value=1
PASS  documents present (non-vacuous)     value=5
PASS  search_key backfilled (null count)  value=0
PASS  embedding column type               value=vector(768)
verify: CORRECTED (5/5 checks passed)
$ echo $?
0
~~~

---

## What was deliberately not done

- **No applied migration was edited in place.** `0000`–`0003` are
  byte-identical to what the pipeline shipped. The corrections are the
  appended journal entries, the new `0004` migration, and the image pin.
- **No column downgrade.** `embedding` stays `vector(768)`. `verify.sh`
  asserts the column type, so a future silent downgrade fails the gate.
- **No change to the runner or `scripts/migrate.sh`.** The journal-driven
  `drizzle-kit migrate` mechanism is correct; the defect was data that
  mechanism consumed (a missing journal entry), not the mechanism itself.
