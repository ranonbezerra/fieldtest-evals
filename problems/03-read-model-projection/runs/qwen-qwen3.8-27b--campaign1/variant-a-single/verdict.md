# Verdict — 03 Read model projection (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✗, M2 ✗, M3 ✗, M4 ✓, M5 ✗, M6 ✓]

graded:       {schema_design: 2, rebuild_story: 0, tradeoffs: 1, tests: 0,
               quality: 1, process: n/a}

typecheck:    failed after 11 repairs — 36 errors
tests:        did not run. `Cannot find module '.prisma/client/default'`

failure_mode: wrong_answer
              # Its own Prisma schema is invalid: `event Event? @relation(...)` on
              # PaymentOrder with no opposite field on Event. `prisma generate` exits
              # 1, no client is produced, and everything typed against it collapses —
              # including the errors that would have named the real defects.

revisions:    {self_repairs: 11, dropped_a_requirement: yes}
cost:         {wall_minutes: 26 generation, output_tokens: —, requests: 12,
               usd: 0.383}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     An invalid relation in its own schema stops the client from generating,
              and hides that half its services call methods nobody wrote.

notes: |
  M1 is the problem, and there is no attempt at it. The word `$transaction` does not
  appear anywhere in `src`. The brief asks for projections maintained by synchronous
  in-transaction hooks on every write; nothing here is transactional at all. The local
  run at least wrote the hooks and then failed to put them in the transaction.
  M2 and M3 are called and never written. `operations-reconciliation.service.ts` and
  `operations.controller.ts` both invoke `rederiveWindow` and `repairDriftWindow`; the
  repository defines `findPage`, `findCompanyTotals` and `findPaymentOrdersByCompany`.
  M5 follows from M1: with no transaction there is nothing making two concurrent
  updates to one aggregate safe.
  M4 holds — the dashboard reads the projection through `findPage` with no join back
  to source. M6 is the best part of the run: `[companyId, status, createdAt desc,
  paymentOrderId desc]` is a covering index that matches the dashboard's filter and
  sort exactly.
```

## One invalid relation, and the compiler goes quiet

    Validating field `event` in model `PaymentOrder`: the relation field `event` is
    missing an opposite relation field on Event

Prisma requires both sides of a relation. `prisma generate` exits 1, `@prisma/client`
exports nothing, and then:

    Module '"@prisma/client"' has no exported member 'PrismaClient'
    Property '$connect' does not exist on type 'PrismaService'

Twenty-odd of the thirty-six errors are that cascade. Behind it sit the ones that
matter — `Property 'rederiveWindow' does not exist`, `'repairDriftWindow'`,
`'listOperations'` — services calling a repository that does not define them.

This is §3.6b with a new root. There the unresolved import stopped the compiler
looking behind it; here an ungenerated client does. **An error that prevents type
information from being computed is not one error, and this run's thirty-six is not a
count of thirty-six problems.**

## Against the local run of the same problem

| | local, phased | hosted, single |
|---|---|---|
| must-haves | 2 of 6 | **2 of 6** |
| M1 in-transaction hooks | ✗ — written, placed wrong | ✗ — never written |
| methods called and undefined | `reDeriveWindow`, `simulateWrite` | `rederiveWindow`, `repairDriftWindow`, `listOperations` |
| what hid them | 25 unresolved imports | an ungenerated Prisma client |
| cost | 7.7 h of a laptop | 26 min, $0.38 |

The same score, the same defect, and the same masking — through two different causes,
in two different shapes, on two different machines. This is the problem the model does
not do, and neither the decomposition nor the ceiling was the reason.
