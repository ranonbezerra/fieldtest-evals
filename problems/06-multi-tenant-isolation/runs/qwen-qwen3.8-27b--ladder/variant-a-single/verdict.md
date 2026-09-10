# Verdict — 06 Multi-tenant isolation (qwen3.8-27b, hosted, **ladder**)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: ladder, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               upstream_provider: Mancer 2 (retry); Cloudflare errored at 1 token}

plan_gate:    n/a — the level-2 specification replaced the plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ~, M6 ✓]

graded:       {context_propagation: 3, config_theming: 2, escape_hatch: 0,
               tests: 2, quality: 1, process: n/a}

typecheck:    failed after 14 repairs — **47 errors, every one of them in a test
              file**. `src/` compiles clean.
tests:        did not run

failure_mode: wrong_answer
              # The model delivered its own `tsconfig.json`, `vitest.config.ts` and
              # test files, and the three disagree about how the runner is
              # configured: the tests call `it` and `expect` as globals, the vitest
              # config does not set `globals: true`, and the tsconfig declares no
              # `vitest/globals` in `types`.

revisions:    {self_repairs: 14, dropped_a_requirement: no}
cost:         {output_tokens: 1 + 85844, requests: 16, usd: 0.4782}
host:         {n/a — the model is not on this machine}

would_merge:  no — an isolation feature whose leak test cannot run
headline:     It wrote every leak test the issue asked for, and then could not run
              them, for the same reason gpt-oss could not on this same problem.
```

## The isolation is structural and the tests are the right tests

M2 is what most implementations fake: `tenant-context.ts` holds an
`AsyncLocalStorage`, and `tenant-prisma.service.ts` builds the client with
`this.prisma.$extends({…})`. Scoping is at the data layer, not remembered at each
query site — which is §2 of the issue and the fix for the finding that opened it.

M3 routes not-found through `throw new ApiError(404, 'resource_not_found')`, so
another tenant's id is indistinguishable from a missing one.

And **M5's tests exist, by name, as the issue specified them**:

    tenant B cannot list tenant A customers
    tenant B cannot fetch tenant A customer by id (404)
    tenant B cannot update tenant A customer
    tenant B cannot delete tenant A customer
    same email can register in both tenants
    concurrent requests from different tenants do not cross contexts

That last one is the test the issue called out as the kind that "fails quietly under
load, and is the reason this is a test suite rather than a code review". It was
written. Neither earlier condition on this problem wrote it — the `model` axis's suite
did not compile, and gpt-oss's entire suite was `it('should compile')`.

## And they cannot run

    test/customer.spec.ts(142,3): error TS2582: Cannot find name 'it'.
    test/customer.spec.ts(144,5): error TS2304: Cannot find name 'expect'.

Forty-seven errors, **all of them in `test/`**. `src/` is clean.

`gate_scaffold_added: []` — the model supplied its own `package.json`,
`tsconfig.json` and `vitest.config.ts`. Its tsconfig declares no `vitest/globals` in
`types`; its vitest config does not set `globals: true`; its test files use `it` and
`expect` without importing them. Any two of those three agree. All three together
cannot work.

**This is the identical defect gpt-oss produced on this same problem** — same three
files, same three-way disagreement, different model. That makes it a property of how
this configuration gets written rather than of either model, and it is the second such
shared failure in this repository after the one-sided Prisma relation.

## Five valid ladder runs

| | 01 | 03 | 04 | 05 | 06 |
|---|---|---|---|---|---|
| must-haves met | 8/8 | 4/6 | 6/6 | 5.5/6 | 5.5/6 |
| errors | 25 | 10 | 27 | 11 | 47 |
| where they are | src | src | src + test | src | **test only** |
| tests ran | no | no | no | no | no |

Five for five on the headline: the design the specification supplied gets built, and
nothing executes. Problem 06 is the first where `src/` is entirely clean — the
application would run; only the evidence that it isolates correctly does not.
