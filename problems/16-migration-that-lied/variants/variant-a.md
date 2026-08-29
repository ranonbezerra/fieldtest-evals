# Variant A — The table that is not there

`fixtures/service/` holds a TypeScript service with Drizzle migrations and a
`docker-compose.yml`. The deploy pipeline is green. Every migration step logs
success.

Production is throwing `relation "document_embeddings" does not exist`, and a
report that should show a backfilled `search_key` for every document shows it for
none.

## The task

1. Bring up the environment, apply the migrations as the pipeline does, and find
   out why a green run leaves the database in this state. There is more than one
   defect and they are independent.
2. Correct them. Corrections are **additive**: a migration that has already been
   applied somewhere is not edited in place.
3. Write `RUNBOOK.md`: for each defect, the mechanism, the fix, and the single
   command that distinguishes the fixed state from the broken one.
4. Deliver `scripts/verify.sh` — it exits non-zero on the broken database and
   zero on the corrected one. Show its real output, from both.

## Constraints

The database is a Docker Postgres. If an extension cannot be installed on the
image the compose file specifies, that is a finding, not an obstacle to work
around by removing the requirement.
