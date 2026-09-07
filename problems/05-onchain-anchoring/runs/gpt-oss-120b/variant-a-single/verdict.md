# Verdict — 05 On-chain anchoring (gpt-oss-120b, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ~, M5 ✓, M6 ✓]

graded:       {state_machine: 2, recovery: 1, verification: 2, tests: 1,
               quality: 0, process: n/a}

typecheck:    failed after 13 repairs — 19 errors
tests:        0 of 5 pass. Every one dies on
              `TypeError: this.repository.findIntent is not a function`

failure_mode: reference_gap
              # The service declares its own `AnchorRepository` contract with
              # `findIntent` and `updateIntent`, and the repository the same reply
              # wrote defines `findPending`, `updateStatus` and `getProof`. The
              # compiler is satisfied by the local declaration; the runtime is not.

revisions:    {self_repairs: 13, dropped_a_requirement: no}
cost:         {wall_minutes: ~7, requests: 14, usd: 0.0049}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     It wrote the repository, then wrote the service believing the
              repository did not exist and that it was forbidden from creating one.
```

## The design is sound and the wiring is not

M2 `@@unique([documentId, version])`. M3 four states — `pending`, `broadcasted`,
`confirmed`, `failed`. M5 `createHash('sha256')` over a canonical form. M6 no key
material; the chain client is an injected interface with a fake implementation. M1 is
laid out in the service's own header and honoured in order:

    1. Compute a canonical hash of the structured content.
    2. Persist an intent **before** broadcasting.
    3. Broadcast the transaction.
    4. Provide verification of an anchored version.

M4 is partial: `getReceipt` is consulted on recovery, but the sweep is a single lookup
rather than a routine over stuck rows, and `broadcast_unknown` — the state Qwen3.8-27B
modelled and most designs omit — is absent.

## The comment that explains the campaign

`src/anchor/anchor.service.ts`, lines 8–12:

    * Because those files are missing (and we are not allowed to create them),
    * we declare minimal local typings that satisfy the service implementation
    * and the compiler.

`src/anchor/anchor.repository.ts` is 2,288 bytes and sits beside it, written by the
same reply.

The model wrote the repository, then wrote the service under the belief that the
repository was missing and out of bounds, and declared a second, parallel contract to
get past `tsc`. That contract has `findIntent` and `updateIntent`. The real repository
has `createIntent`, `findPending`, `updateStatus`, `getProof`. One name in four
matches.

Every test dies the same way:

    × anchors a document and stores intent before broadcast
        → this.repository.findIntent is not a function
    × prevents anchoring the same document version twice          → same
    × verifies a correctly anchored document                      → same
    × reports mismatch when content differs from anchored hash     → same
    × recovery sweep resolves anchors stuck after broadcast failure → same

The five scenarios are the right five. They cannot reach the code.

**This is the sharpest statement of the defect either model has produced.** Problem 01
hedged with `// ASSUMPTION: The outbox table is called Message` against a schema it
had written. Problem 03 addressed `prisma.company_totals` against a model it had
declared. Here the model states outright that a file it authored does not exist and
that it is not permitted to author it — and then works around its own absence.

`quality: 0` is for that: satisfying the compiler with a duplicate declaration instead
of reading the file next to it is the specific thing a reviewer would reject.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B | gpt-oss-120b |
|---|---|---|
| must-haves | 6 of 6 | 5 of 6, M4 partial |
| `broadcast_unknown` as a distinct state | yes | no |
| typecheck | **clean, attempt 0, zero repairs** | failed after 13 repairs |
| tests | 11 of 15 pass against a live Postgres; all 4 failures were test defects | **0 of 5**, all one runtime error |
| recovery | chain-first sweep over stuck rows | a single receipt lookup |
| verdict | PASS_WITH_NOTES | FAIL |

Five problems, five failures for the 120B, against the 27B's two passes and three
failures on the same set. The 120B is fast — $0.0049 and seven minutes here — and its
architecture is consistently reasonable. What it does not do is read what it has
already written.
