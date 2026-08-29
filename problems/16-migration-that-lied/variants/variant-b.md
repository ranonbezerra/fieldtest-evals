# Variant B — Write the criteria that would have caught it

`fixtures/service/` holds a TypeScript service with Drizzle migrations, a
`docker-compose.yml`, and `scripts/verify.sh` — a verification script written by
the engineer who shipped the migrations.

The migrations are broken in several ways. **`verify.sh` passes against the
broken database anyway.**

## The task

1. Run the pipeline and the existing `verify.sh`. Show it passing while the
   database is wrong.
2. For each check in it, say precisely what it does verify and what it only
   appears to verify. This is the deliverable, not a preamble to it.
3. Rewrite it so that every check **fails on the current, broken database** and
   passes only on a correct one. Each check must distinguish a specific state —
   name which.
4. Then fix the migrations, additively, and show the rewritten script going from
   red to green.
5. `RUNBOOK.md` covering both halves.

## What is being measured

Not whether you can fix migrations. Whether you can write a check that fails when
the work is wrong — which is a different and rarer skill, and the one the original
script did not have.
