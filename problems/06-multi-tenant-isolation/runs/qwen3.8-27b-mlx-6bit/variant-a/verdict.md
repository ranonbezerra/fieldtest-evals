# Verdict — 06 Multi-tenant isolation

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {context_propagation: 3, config_theming: 3, escape_hatch: 0,
               tests: 3, quality: 2, process: 3}

manifest:     22 declared, 22 built, not truncated
typecheck:    failed after 26 repairs — 24 errors
tests:        could not run — @nestjs/testing is not in the harness scaffold

failure_mode: reference_gap
              # 19 of 24 errors are the `.js` extension: 13 × TS2307 and 6 × TS2835,
              # the latter being TypeScript naming the fix in the message. Two more
              # are module augmentations the model wrote to stub packages the
              # scaffold does not provide. Three are its own: the Prisma `$extends`
              # callback typing, and a create-input mismatch.

revisions:    {self_repairs: 26, dropped_a_requirement: no}
cost:         {wall_minutes: 287, output_tokens: 163945, tokens_per_second: 9.5,
               requests: 51, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 51, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  after_changes
headline:     Enforces isolation structurally, in the one place that cannot be
              forgotten, and cannot prove it because the scaffold has no test runner
              for the framework it declares.

notes: |
  The rerun after the truncated one, and the first with the manifest cap lifted: 22
  files declared, 22 built.
  M2 is the must-have this problem turns on, and it is right. Enforcement is a
  Prisma client extension — `base.$extends(...)` — that adds `where.tenantId` to
  reads and stamps `data.tenantId` on create, createMany and upsert from the request
  context. Structural, not disciplinary: a repository that forgets to filter still
  cannot see another tenant's rows.
  M3 follows from the same place. The stamp comes from `ctx.tenantId`, so a
  client-supplied tenantId in a create body is overwritten rather than trusted.
  Context propagation is `AsyncLocalStorage` from `node:async_hooks`, which is the
  correct primitive rather than a request-scoped provider, and there is a test named
  "concurrent requests from different tenants do not cross contexts" — the failure
  mode that makes this hard.
  M4, M5 and M6 are covered by ten tests that name the traps exactly: tenant B cannot
  list, fetch, update or delete tenant A's rows; the same email registers in both
  tenants and conflicts within one; a cross-tenant id returns 404 rather than 403.
  None of them ran.
  What is missing is criterion 3. There is no escape hatch — no audited, deliberate
  path for a legitimate cross-tenant operation. Every admin or batch job would have
  to go around the extension, and nothing in the design says how.
  The three defects that are the model's own are all Prisma typing: `Property
  'action' does not exist` on the `$extends` callback argument, an argument-type
  mismatch beside it, and a create-input that does not match the generated type.
  Getting `$extends` typed correctly is the genuinely hard part of this approach, and
  it is where the model ran out.
```

## The scaffold does not supply the stack it declares

The suite could not run at all:

    Error: Failed to load url @nestjs/testing

The cheatsheet tells the model the stack is "NestJS for the API … Vitest for tests".
The scaffold's package.json supplies `@nestjs/common`, `@nestjs/core`,
`@prisma/client`, `reflect-metadata`, `rxjs`, and for development `@types/node`,
`prisma`, `typescript`, `vitest`. The standard way to test a NestJS module is
`Test.createTestingModule` from `@nestjs/testing`, which is not there.

So the model wrote idiomatic tests for the framework it was told to use, and the
environment could not execute them. Two of the typecheck errors are the same package.

This is not isolated. Across the campaign the scaffold has been missing:

| run | package | what it was for |
|---|---|---|
| 03 read model projection | `@nestjs/schedule` | the `@Cron` drift-repair sweep the problem asks for |
| 06 multi-tenant isolation | `@nestjs/jwt` | resolving the tenant from a token, which M1 offers as an option |
| 06 multi-tenant isolation | `@nestjs/testing` | running any NestJS test |

The model's response was resourceful and made things worse: it wrote `declare module
'@nestjs/jwt'` and `declare module 'express'` stubs to satisfy the compiler, which
produced two `TS2664` errors of their own.

**Not fixed in this pass**, for the same reason as `moduleResolution`: adding packages
changes whether earlier runs compile, so it is intervention rather than observation.
It goes to `SECOND-PASS.md`, and it is more urgent than it looks — a missing test
runner defeats the test-execution step added in §3.7, which is the only instrument
that has caught a live defect the typecheck could not see.
