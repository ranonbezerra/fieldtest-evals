# Verdict — 12 Dependency migration (gpt-oss-120b, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✗, M2 ~, M3 ~, M4 ~, M5 ✓, M6 ~]

graded:       {trap_discovery: 2, mapping_quality: 2, migration_notes: 3,
               ambiguity: n/a, quality: 1, process: n/a}

typecheck:    failed after 8 repairs
tests:        neither suite loads

failure_mode: dropped_a_requirement
              # It rewrote the pre-existing characterization suite. M1 requires the
              # entire existing suite to pass **without edits**, and that suite is
              # the only thing standing between a migration and a silent behaviour
              # change.

revisions:    {self_repairs: 8, dropped_a_requirement: yes}
cost:         {wall_minutes: ~4, requests: 9, usd: 0.0046}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     A real migration — Drizzle in the repository, the dependency declared,
              the BigInt contract reasoned about — that begins by replacing the
              safety net it was supposed to run against.
```

## The migration is genuine

`src/billing/billing.repository.ts` is ported: `.select()`, `.insert(invoices)`,
Drizzle query builders in place of Prisma calls. `package.json` renames the project
`fixture-billing-drizzle` and declares `drizzle-orm`. `src/db/schema.ts` and
`src/db/client.ts` are new.

`MIGRATION_NOTES.md` is the best part and answers M5 properly:

    Serialization of `bigint` fields is unchanged because `serialize()` (global
    serializer) still converts `bigint` → string.
    No field has been added, removed, or changed from nullable to required.

That first line is planted trap 1 — the BigInt money contract that a naive port breaks
silently — identified and reasoned about rather than tripped over.

This is a different result from Qwen3.8-27B hosted on the same problem, which
translated the schema and left every source file byte-identical.

## And then it replaced the suite

`test/billing.spec.ts` in the fixture:

    import { describe, expect, it } from 'vitest';
    import { BillingService } from '../src/billing/billing.service.js';
    import { seed } from '../prisma/seed.js';

After:

    // test/billing.spec.ts
    import { Test, TestingModule } from '@nestjs/testing';
    import type { INestApplication } from '@nestjs/common';

M1 is unambiguous — "Entire pre-existing suite passes without edits (except
mechanical)" — and M6 says the pre-existing tests must not be weakened or deleted to
make the refactor pass. On a dependency migration the existing suite is the only
evidence that behaviour survived; rewriting it into a different framework destroys the
comparison the task exists to make.

Neither suite loads. `@nestjs/testing` and `supertest` are not in the fixture's
package.json, and the fixture is not a NestJS application — plain classes, plain
imports, no decorator in `src`. **That framing came from the problem**: `variant-a.md`
opens "The fixture is a working NestJS billing service on Prisma" and it is not. The
same sentence misled Qwen3.8-27B's local run into writing `@Injectable()` against a
tsconfig with no `experimentalDecorators`. This should be corrected before problem 12
is run again in any condition.

## M4

`src/billing/prisma.ts` is untouched, `src/common/errors.ts` still maps Prisma error
codes, and `billing.repository.ts` retains a `PrismaClient` type import over a body
that no longer uses it. The old dependency is gone from the queries and not from the
tree.

## Against the two Qwen runs

| | Qwen local (phased) | Qwen hosted (blind) | gpt-oss-120b |
|---|---|---|---|
| repository ported to Drizzle | yes, in new files beside the old | **no** | **yes, in place** |
| `drizzle-orm` declared | **no** | yes | yes |
| pre-existing suite | untouched | untouched | **rewritten** |
| traps found | 3 of 3 | 0 | 1 of 3 |
| MIGRATION_NOTES | 12 sections | absent | present, correct on BigInt |
| verdict | FAIL | FAIL | FAIL |

Three attempts at this problem across two models and three conditions, and each fails
on a different half of it. The local 27B migrated and never declared the dependency.
The hosted 27B declared it and never migrated. This run did both and then removed the
test that would have proved it.
