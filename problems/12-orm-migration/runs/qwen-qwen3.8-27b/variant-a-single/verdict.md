# Verdict — 12 Dependency migration (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓ vacuously, M2 n/a, M3 n/a, M4 ✗, M5 ✗, M6 ✗]

graded:       {trap_discovery: 0, mapping_quality: 1, migration_notes: 0,
               ambiguity: n/a, quality: 1, process: n/a}

typecheck:    failed after 2 repairs — errors in `drizzle/schema.ts`
tests:        5 of 5 pass — the fixture's own `billing.spec.ts`, unchanged,
              running against the unchanged Prisma code

failure_mode: dropped_a_requirement
              # Every source file of the application is byte-identical to the
              # fixture. `billing.repository.ts` still reads
              # `this.prisma.account.findUnique(...)` and `this.prisma.$transaction`.
              # The deliverable is a Drizzle schema and a package.json edit.

revisions:    {self_repairs: 2, dropped_a_requirement: yes}
cost:         {wall_minutes: —, output_tokens: —, requests: 3, usd: —}
host:         {n/a — the model is not on this machine}

harness_note: |
  `prisma generate -> 1` here is not the model's: it removed `prisma` from
  package.json, which is the objective, and the gate then ran `npx prisma generate`
  against a workspace that no longer has it, so npx tried to fetch
  `prisma@8.0.0-rc.13` and was refused. The gate should skip that step when prisma is
  not a declared dependency. Recorded in SECOND-PASS.

would_merge:  no
headline:     It translated the schema, swapped the dependency in package.json, and
              did not touch one line of the code that talks to the database.
```

## What was delivered

    drizzle/schema.ts                        new
    drizzle/migrations/0000_initial.sql      new
    drizzle/migrations/meta/…                new
    drizzle.config.ts                        new
    package.json      prisma → drizzle-orm, pg, drizzle-kit
    src/main.ts, src/app.module.ts           new, and NestJS, which this fixture is not
    tsconfig.json, vitest.config.ts, .gitignore

## What was not

    src/billing/billing.repository.ts        byte-identical to the fixture
    src/billing/billing.service.ts           byte-identical
    src/billing/prisma.ts                    byte-identical
    src/common/errors.ts                     byte-identical
    src/common/serializer.ts                 byte-identical
    test/billing.spec.ts                     byte-identical
    prisma/schema.prisma                     still there

The repository the whole task is about:

    import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from './prisma.js';
    constructor(private readonly prisma: PrismaClient) {}
    return this.prisma.account.findUnique({ where: { id } });
    return this.prisma.$transaction(async (tx) => { … });

M4 asks that the old dependency be fully removed — no leftover imports, config or
schema files. `prisma/schema.prisma` is on disk and every data-access call is a Prisma
call. The application cannot start: `package.json` no longer provides the client the
code imports.

M1 — "entire pre-existing suite passes unmodified" — is green, and it is green for the
same reason as the local run and with less excuse: the suite passes because the code
beneath it is the code the suite was written for.

M5 and M6 have nothing to grade. There is no MIGRATION_NOTES.md and no new test.
`trap_discovery: 0` — none of the three planted traps is mentioned anywhere.

## Against the local run of the same problem

| | local, phased | hosted, single |
|---|---|---|
| files delivered | 13 | 13 |
| Drizzle repositories written | **yes** — `accounts`, `invoices` | **no** |
| declared `drizzle-orm` in package.json | **no** | **yes** |
| MIGRATION_NOTES.md | 12 sections | absent |
| planted traps found | **3 of 3** | 0 |
| characterization tests written | 6 | 0 |
| Prisma removed from `src/` | no | no |
| wall clock | 5 h 35 min | minutes |
| verdict | FAIL | FAIL |

Two failures on the same must-have from opposite directions. Locally the model wrote
Drizzle repositories, found every trap, documented twelve semantic differences across
five and a half hours — and forgot to declare the dependency. Hosted it declared the
dependency correctly, and then stopped after the schema.

**The phased shape forced work that the single shape let it skip.** Every phase in the
decomposition is a request that must produce a file, so the local run had to write
repositories and tests whether or not it judged them necessary. Asked once, with no
structure compelling it forward, the model answered with the part of the migration that
is mechanical — a schema translation — and treated the port as done.

That is the counterweight to problems 04, 05 and 09. The decomposition costs accuracy
across files and buys completeness within the task.
