# Verdict — 06 Multi-tenant isolation (gpt-oss-120b, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✗, M6 ✓]

graded:       {context_propagation: 3, config_theming: 2, escape_hatch: 0,
               tests: 0, quality: 1, process: n/a}

typecheck:    failed after 50 repairs — 47 errors
tests:        1 of 1 passes — `should compile`

failure_mode: dropped_a_requirement
              # M5 asks the model to prove tenant A cannot read tenant B's data. The
              # entire suite is one test named `should compile`.

revisions:    {self_repairs: 50, dropped_a_requirement: yes}
cost:         {wall_minutes: ~16, requests: 51, usd: 0.0225}
host:         {n/a — the model is not on this machine}

would_merge:  no — an isolation feature with no isolation test
headline:     Twenty-seven files, a genuinely structural tenant filter, and a test
              suite consisting of the assertion that the code compiles.
```

## The enforcement is real

M2 is the must-have most designs fake, and this one does not. `prisma.service.ts`
extends `PrismaClient` and installs a middleware:

    this.$use(async (params, next) => {
      const tenantId = this.tenantContext.getTenantId();
      …
      // For write actions, ensure the tenantId is present in the data payload.

Three repositories then carry `// No explicit tenantId needed – middleware scopes the
query`, and none of them writes a `where: { tenantId }` by hand. That is structural
enforcement, which is what M2 asks for, and M3 follows from the same hook.

M1 resolves from the host header with a JWT claim as the second source, server-side.
M4 is `@@unique([tenantId, email])` and `@@unique([tenantId, code])`. M6 routes
not-found through a single path.

Worth noting against the previous four problems: `prisma.service.ts` opens with
`// ASSUMPTION: The tenant context lives in src/tenant/tenant.context.ts and exports a
TenantContext class with a getTenantId(): string | undefined method` — and this time
the assumption is **correct**. `tenant.context.ts` exports exactly that. The model
hedged against its own file and happened to remember it right.

## The test is the problem, and the problem is the test

    it('should compile')

That is the suite. M5 — "tests create data in tenant A, authenticate as tenant B, and
prove: list excludes, fetch by id 404s, update/delete 404 rather than mutate" — has no
attempt. `tests: 0`.

The isolation might work. Nothing here demonstrates that it does, and on this problem
that distinction is the deliverable.

## And the schema does not generate

    Error validating field `customer` in model `Order`: The relation field `customer`…
    Error validating field `plan` in model `Order`: The relation field `plan`…
    Validation Error Count: 2

`Order` points at `Customer` and `Plan`; neither declares the opposite field. This is
**the same defect Qwen3.8-27B produced on problems 03 and 07** — a relation written
from one side only, by a model that writes each model complete when it writes it and
never amends an earlier one. Two different models, same failure, which makes it a
property of how these schemas get written rather than of either model.

Of the 47 errors, 34 are the `.js` extension under the harness-supplied NodeNext and 8
are `has no exported member` cascading from the client that was never generated.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B | gpt-oss-120b |
|---|---|---|
| must-haves | 5 of 6 | 5 of 6 |
| the one that fails | M5 | M5 |
| enforcement | `$extends` + AsyncLocalStorage, fail-closed | `$use` + AsyncLocalStorage |
| why M5 failed | wrote a real leak test that would not compile | wrote `should compile` |
| `prisma generate` | 0 | **1** — two one-sided relations |
| escape hatch | absent | absent |
| repairs | 2 | **50** |

The same score and the same missing must-have, reached from opposite ends. The 27B
built the leak test the problem asks for and misconfigured its runner; the 120B
configured everything and wrote no test.

Fifty repair rounds is also the campaign's high-water mark, and they did not converge:
47 errors remain.
