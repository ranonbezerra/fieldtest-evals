# Variant C — "The ORM is being deprecated internally" (underspecified)

The fixture is the same working billing service as variant A (Prisma; partial
suite; seeds). The guidance you get is an internal announcement:

> Platform team: we are deprecating our current ORM setup over the next
> quarters. New services must not use it; existing services should migrate
> when they get meaningful work done on them. This service is scheduled for
> feature work next cycle, so migrate its data layer now. Keep the API stable
> — billing consumers do not want to know this happened.

No target is named. Choosing it is part of the task.

## What is expected of you

1. Pick the replacement data-layer approach (an ORM, a query builder, or raw
   SQL with a thin layer) and record the decision + rejected alternatives +
   rationale in `ASSUMPTIONS.md`, grounded in this service's actual needs
   (transactions, BigInt money, simple relations — not résumé-driven choice).
2. Execute the migration completely under the same rules as variant A: old
   dependency fully gone, contract byte-stable, transactional behavior proven,
   uncovered-but-depended-on behaviors found, pinned, preserved,
   MIGRATION_NOTES.md for every semantic difference.

You are judged on the fit of the choice and the honesty of its trade-offs as
much as on the execution.
