# Variant C — "The deploy is green but the feature is dead" (deliberately underspecified)

`fixtures/service/` holds a TypeScript service with migrations and a compose
file. You get one message:

> Search has been broken since the release on Tuesday. The deploy was green,
> migrations ran fine, and rolling back didn't help. I've spent a day on it.

That is the entire specification. No error text, no list of what shipped.

## What is expected of you

Reproduce it before you change anything, and be explicit about the difference
between *no error* and *it worked* — that distinction is what this problem is
about, and the write-up is judged on whether you drew it.

Deliver:

1. `RUNBOOK.md` — how you reproduced it, each defect's mechanism, and why the
   green pipeline was consistent with a broken database.
2. The corrections, additive.
3. `scripts/verify.sh` — every check fails on the broken state. Show both runs.
4. `ASSUMPTIONS.md` for anything you decided without being told: which Postgres
   image is acceptable, whether the backfill may run more than once, what
   "rolling back didn't help" implies about what is already applied where.
