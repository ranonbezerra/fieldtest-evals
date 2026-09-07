# Verdict — 06 Multi-tenant isolation (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✗, M6 ✓]

graded:       {context_propagation: 3, config_theming: 2, escape_hatch: 0,
               tests: 0, quality: 2, process: n/a}

typecheck:    failed after 2 repairs — 38 errors, all 38 in one test file.
              src/ compiles clean.
tests:        did not run — the suite does not compile

failure_mode: wrong_answer
              # Not in the application. The model wrote a tsconfig with
              # `"types": ["node"]`, a vitest config without `globals: true`, and a
              # test file that calls `describe`/`beforeAll` without importing them.
              # Three files from one reply, each correct alone, mutually unusable.

revisions:    {self_repairs: 2, dropped_a_requirement: no}
cost:         {wall_minutes: —, output_tokens: —, requests: 3, usd: —}
host:         {n/a — the model is not on this machine}

would_merge:  no — an isolation feature with no passing isolation test
headline:     The application is right and the only thing that fails is the test file
              that was supposed to prove it — which, on this problem, is the point.

notes: |
  M1 `tenant.middleware.ts` resolves from `req.headers.host`, server-side, and rejects
  a missing host with 400. M2 is structural and good: `$extends` with a query hook
  reading `AsyncLocalStorage`, and it throws `Missing tenant context` rather than
  falling through when the store is empty — fail-closed. The repositories call
  `tenantClient` and never write a `where: { tenantId }` by hand. M3 stamps writes by
  spreading the caller's `data` and then setting `tenantId`, so a client-supplied
  tenant is overwritten, not trusted. M4 `@@unique([tenantId, email])`,
  `[tenantId, code]`, `[tenantId, reference]`. M6 all three not-found paths raise the
  same `customerNotFound(id)`, so probing another tenant's id is indistinguishable.
  M5 is the one that fails, and it fails completely: the leak test never runs.
  No escape hatch for legitimate cross-tenant operations — same omission as local.
```

## After two repairs, `src/` is clean and 38 errors sit in one test file

    21 × TS2304   Cannot find name 'beforeAll' / 'afterAll' / 'beforeEach'
     9 × TS2593   Cannot find name 'describe'. Do you need to install type definitions…
     8 × TS2349   This expression is not callable

Three artifacts from the same reply, each defensible on its own:

- `tsconfig.json` — `"types": ["node"]`
- `vitest.config.ts` — no `globals: true`
- `test/customer.spec.ts` — uses `describe`, `it`, `beforeAll` with no import

Any two of those three would work together. All three together cannot. And the
TS2349s are the same shape: the model set `"esModuleInterop": true` in its tsconfig,
then wrote `import * as request from 'supertest'` — the idiom that is only correct
*without* interop. It configured the flag and then wrote against its opposite.

This is not a missing dependency. The model's own `package.json` declares
`@nestjs/testing`, `supertest` and `vitest` — the exact gap that stopped the local
run from testing at all. It supplied everything it needed and then mis-wired it.

## Why this one is a FAIL where 04 and 05 were not

Problems 04 and 05 also shipped broken tests. There, the tests were decoration on
work that was demonstrably correct, and the failures pointed at assertions. **Here
the test is the deliverable.** M5 asks the model to prove tenant A cannot see tenant
B's data. The application looks like it would pass that test. Nobody knows, because
the test does not compile.

An isolation boundary you have not executed a leak test against is a claim, not a
control.

## Against the local run of the same problem

| | local, phased | hosted, single |
|---|---|---|
| must-haves | 6 of 6 | 5 of 6 — M5 fails |
| repairs | 26 | 2 |
| errors left | 24, of which 19 were `.js` extensions | 38, of which 0 are `.js` |
| where | spread across `src/` | all in one test file |
| tests | blocked by a harness gap | blocked by the model's own config |
| verdict | FAIL | FAIL |

Two failures with nothing in common. The local run could not resolve its own imports
across 22 files written in 22 requests. The hosted run resolved every import and then
disagreed with itself about how its test runner is configured.

The decomposition defect is gone. **What is left is the model's inability to keep
three files consistent about one convention — and that survives the single request.**
