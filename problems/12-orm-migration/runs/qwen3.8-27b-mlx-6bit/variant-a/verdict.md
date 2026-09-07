# Verdict — 12 Dependency migration (local, phased)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: phased, reasoning_effort: medium,
               provider: omlx, model: Qwen3.8-27B-MLX-6bit, quantization: 6-bit,
               max_tokens: 16384, context_window: 32768}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✓, M2 ~, M3 ~, M4 ✗, M5 ✓, M6 ✓]

graded:       {trap_discovery: 3, mapping_quality: 2, migration_notes: 3,
               ambiguity: n/a, quality: 1, process: 2}

manifest:     13 declared, 13 built, not truncated
typecheck:    failed after 22 repairs — 56 errors as run.
              17 with a complete toolchain; see the attribution below.
tests:        5 of 5 pass — all of them the fixture's own `billing.spec.ts`,
              which still runs on Prisma

failure_mode: wrong_answer
              # The migration was not performed. `src/billing/billing.repository.ts`
              # still imports `PrismaClient`; the new Drizzle repositories in
              # `src/accounts` and `src/invoices` are referenced by nothing in `src/`
              # — only by the model's own new tests.

revisions:    {self_repairs: 22, dropped_a_requirement: yes}
cost:         {wall_minutes: 335.4, requests: 43, output_ceiling_hits: 2}
host:         {pressure: 1 of 15 samples — spotlightknowled at 86% CPU;
               throughput halved 10.5 → 4 tok/s with memory clean}

would_merge:  no
headline:     It wrote a Drizzle implementation beside the Prisma one instead of in
              place of it, and every covered test stayed green because every covered
              test is still talking to Prisma.
```

## The migration did not happen

    src/billing/billing.repository.ts:1
      import type { AccountRow, InvoiceRow, LineItemRow, PrismaClient } from './prisma.js'

`prisma/schema.prisma`, `src/billing/prisma.ts`, `billing.service.ts` and
`billing.repository.ts` are all untouched and all still Prisma. The new
`src/accounts/accounts.repository.ts` and `src/invoices/invoices.repository.ts` are
real Drizzle code, and `grep` finds them imported by exactly one kind of file: the
tests the model wrote for them.

M1 — "entire pre-existing suite passes without edits" — is green, and that is the
problem. `billing.spec.ts` is byte-identical to the fixture and its five tests pass
**because the code under them never changed**. M4 asks that the old dependency be
fully removed. It is fully present.

This is `dropped_a_requirement` in its most expensive form: 43 requests and five and a
half hours to produce a second implementation of a service that already worked.

## Trap discovery was excellent, and one resolution was wrong

Three traps are planted. The model found all three without being told any of them:

| trap | found | resolved |
|---|---|---|
| BigInt money serialized as JSON strings | yes — §5.1, plus `bigint-format.spec.ts` | yes |
| `null` vs thrown on missing account | yes — §6 error mapping, plus `null-vs-missing.spec.ts` | yes |
| line items rendered in insertion order | **yes** | **no** |

On the third it wrote:

    No implicit ordering. Neither Prisma `findMany` nor Drizzle `select().from()`
    guarantees row order. If a caller relied on insertion order, that was never
    contractually guaranteed and is not changed here.

Every clause of that is true and the conclusion is wrong. The frontend renders those
items positionally. The reference fix is an explicit `ORDER BY position` and a test
pinning it. **The model found the hazard and then argued itself out of fixing it on
the grounds that the old behaviour was never promised** — which is exactly the
reasoning that ships a silent reordering to production.

Noticing is the hard half and it did that. `trap_discovery: 3` stands.

## Attribution of the 56 errors

This run was launched to replace the one discarded for the `_shims.d.ts` defect. It
found two more harness defects, both of which are now fixed:

| errors | cause | whose |
|---|---|---|
| 48 | `Cannot find name 'expect'` / `describe` — the seed deleted `_shims.d.ts`, and the fixture declares no vitest for `pnpm install` to bring in its place | **harness** |
| 6 | `@nestjs/testing`, `@nestjs/common`, `supertest` not declared by the fixture | **harness** |
| 7 | `drizzle-orm`, `drizzle-orm/pg-core`, `pg` — the model never declared the dependency it migrated to | model |
| 5 | `../src/app.module.js` — a file nobody wrote | model |
| 3 | implicit `any`, downstream of the missing Drizzle types | model |
| 2 | `Decorators are not valid here` | see below |

With vitest, its types and the Nest packages supplied, the count is **17**, and the
deliverable still does not build: it migrated to a library it never added to
`package.json`, having been told in the phase-0 instruction to "list only files you
will write" with config files explicitly its own call.

The two decorator errors are the problem set's fault, not the model's. `variant-a.md`
opens `The fixture is a working NestJS billing service on Prisma` and `brief.md` says
`TypeScript, NestJS, PostgreSQL`. The fixture is neither: plain classes, plain
imports, no decorator anywhere in `src`, no `experimentalDecorators` in its tsconfig.
The model was told NestJS, wrote `@Injectable()` and `@Inject(DB)`, and reached for an
`app.module` the description implied should exist. **A model that believed its brief
is not the one that was wrong here.**

## Harness changes this run produced

1. `ft-go` removes `_shims.d.ts` only when the shimmed module is an actual dependency.
   Deleting it unconditionally left this run with no source of vitest types at all.
2. The fixtures script `vitest run` and declare neither vitest nor the Nest test
   packages. Recorded in SECOND-PASS; not fixed here, because changing a fixture
   changes every run that used it.
3. `problems/12-orm-migration/variants/variant-a.md` calls the fixture NestJS and it
   is not. The same sentence appears in `brief.md`. This should be corrected before
   problem 12 is run again in any condition.
