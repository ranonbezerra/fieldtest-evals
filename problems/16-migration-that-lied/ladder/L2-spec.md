# Issue #133 — The deploy is green and the table is not there

**Repo:** `documents-service` · **Labels:** `bug` `data` `blocker`
**Reported by:** on-call · **Diagnosed by:** platform

---

## What is happening

Production throws `relation "document_embeddings" does not exist`. Separately, a report
that should show a backfilled `search_key` for every document shows it for none.

**The deploy pipeline is green.** Every migration step logged success. That is the part
to sit with: a migration runner reporting success is reporting that it did what it
decided to do, which is not the same as the database being in the state the migration
files describe.

There is **more than one defect and they are independent** — fixing one will not
surface the other, so finding one is not finishing.

## What we need

### 1. Reproduce it the way the pipeline does

Bring the environment up from the compose file, apply the migrations exactly as the
pipeline applies them, and observe the end state. The gap between "the migration files
say X" and "the database is Y" is where the defects live, and reading the files alone
will not show it.

### 2. Corrections are additive

A migration that has already been applied somewhere is **never edited in place**. It
ran in production; rewriting it means the file and the database disagree, and the next
environment built from scratch diverges from the one you fixed.

New migrations, forward only. And a new migration only runs if the runner knows about
it — check that whatever you add is actually picked up, by the same mechanism you
found the original defect in.

### 3. If the environment cannot provide something, that is a finding

The compose file pins a specific image. If a migration needs a capability that image
does not have, **say so as a finding** rather than working around it by changing what
the migration does. Downgrading a column type to avoid an extension is a schema change
smuggled in as a fix, and it will surprise whoever depends on that column.

### 4. `RUNBOOK.md`

Per defect: the mechanism, the fix, and **the single command that distinguishes the
fixed state from the broken one**. Somebody paged at 3am reads this.

### 5. `scripts/verify.sh`

Exits non-zero on the broken database and zero on the corrected one. Show its **real
output from both states** — run it before your fix and after, and paste what it
printed.

A verification script that has only ever been run against the state it was written for
is a script that has never been tested.

## Acceptance

- Every defect found — and the count is more than one
- Corrections are additive; no applied migration edited in place
- Applying the corrected set to a fresh database, in order, produces the intended state
- `RUNBOOK.md` names the mechanism per defect and the command that proves it
- `scripts/verify.sh` runs, and its output from both the broken and fixed states is shown

## Notes

TypeScript, Drizzle, PostgreSQL in Docker. The service is in `fixtures/service/`.
