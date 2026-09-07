# Verdict — 01 Payout with outbox + hold (gpt-oss-120b, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓, M7 ✓, M8 ✓]

graded:       {state_machine: 3, tx_boundaries: 3, errors: 2, tests: 0,
               quality: 1, process: n/a}

typecheck:    failed after 20 repairs — 28 errors as run.
              21 under a fair toolchain; see the attribution below.
tests:        did not run — the suite does not compile

failure_mode: reference_gap
              # Twelve method names invented across three files, called on a
              # repository that defines eight different ones. And the outbox model
              # is `OutboxMessage` in the schema the model wrote, while the
              # repository in the same reply carries `// ASSUMPTION: The outbox
              # table is called `Message``.

revisions:    {self_repairs: 20, dropped_a_requirement: no}
cost:         {wall_minutes: ~8, requests: 21, usd: 0.0096}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     Eight of eight must-haves — including the transaction boundary the
              27B missed — on a codebase whose three main files each address a
              different repository.
```

## The design is better than the 27B's

**M3 is the one Qwen3.8-27B failed**, and here it holds. Every step is inside one
`this.prisma.$transaction`, each taking `tx`:

    1️⃣ Idempotency check …          await this.repository.findByIdempotencyKey(…, tx)
    2️⃣ Load the account with a row-level lock (FOR UPDATE) …
    3️⃣ Verify sufficient available balance.
    4️⃣ Create a ledger entry that *reserves* the amount.
    5️⃣ Persist the payout record (status = 'CREATED').
    6️⃣ Enqueue an outbox message for the async worker.

The reservation and the outbox row commit together or not at all, which is the
entire point of the pattern.

M1 is a real hold: `settledBalance` and `reservedBalance` as separate `BigInt`
columns, so the gross balance is never reduced at creation. M8 follows — `BigInt`
on every money column, no float anywhere. M2 is `getAccountForUpdate` inside the
transaction. M4 the worker takes a batch of unprocessed messages, skips ones another
worker holds, and marks processed only after success. M6 the settlement ledger entry
is written only after the provider transfer returns. M7 bounds retries with
`MAX_ATTEMPTS` and parks in `NEEDS_REVIEW`, which is in the schema's status enum.

There is nothing wrong with this design.

## And the code does not describe itself

`payout.repository.ts` defines:

    createPayout   findPayoutById   createMessage   fetchNextMessage
    markMessageProcessing   updatePayoutStatus   adjustAccountBalance   createLedgerEntry

`message.processor.ts` and `payout.service.ts` call:

    fetchPendingMessages   lockMessage   markMessageProcessed   recordMessageFailure
    executePayoutFromMessage   markMessageNeedsReview   updateMessageAttempts
    findMessageById   deleteMessage   getAccountForUpdate   findByIdempotencyKey

**Twelve names, none of them defined.** The near-misses say what happened:
`markMessageProcessed` against `markMessageProcessing`; `fetchPendingMessages`
against `fetchNextMessage`. The model wrote a repository, then wrote its callers from
memory of what such a repository ought to have.

And then the sharpest instance either campaign has produced. The model's own
`prisma/schema.prisma`:

    model OutboxMessage {

The model's own `payout.repository.ts`, in the same reply:

    // ASSUMPTION: The outbox table is called `Message` in the Prisma schema.
    // If the generated client does not export it, we fall back to `any`.
    type Message = Prisma.MessageGetPayload<{ include: {} }>;

`single-shot.md` asks for an `ASSUMPTION` comment when "a symbol you need is
genuinely absent from the task". The symbol was not absent. It was thirty lines away,
in a file the same reply had already written. **The model hedged against a fact it
had authored.**

## Attribution of the 28 errors

| errors | cause | whose |
|---|---|---|
| 23 | relative imports with no `.js`, under the NodeNext the harness supplies | see below |
| 5 | `@nestjs/schedule`, `@nestjs/testing`, `supertest` — absent from the scaffold's package.json | harness |
| 21 (of which) | methods and Prisma models that do not exist | model |

The extension count needs care. This model delivered **no `package.json` and no
`tsconfig.json`**, so the harness supplied both, and the harness's is
`"module": "NodeNext"` with `"type": "module"` — the strictest choice, requiring
`.js` on every relative import.

Qwen3.8-27B on this same problem wrote **its own** tsconfig with
`"moduleResolution": "Bundler"`, and its 28 extensionless imports were correct under
it. Its extension-error count on problem 01 was zero.

So this is not a like-for-like difference in care. One model took control of its
build configuration and the other left it to the harness. Under Bundler resolution
and with the three packages present, gpt-oss-120b's 28 errors become **21 — every one
of them an interface the model disagrees with itself about.**

## Against Qwen3.8-27B

| | Qwen3.8-27B | gpt-oss-120b |
|---|---|---|
| must-haves | 7 of 8 — **M3 failed** | **8 of 8** |
| outbox in the write transaction | no | yes |
| delivered its own build config | yes, `Bundler` | no |
| errors under a fair toolchain | — | 21, all interface drift |
| tests | 3 of 8 pass against a live Postgres | did not compile |
| cost | — | $0.0096, 21 requests |
| verdict | FAIL | FAIL |

Two failures, and the better design is the one that fails harder. The 27B produced
something that ran and got the transaction boundary wrong. The 120B got the boundary
right and produced something that cannot be compiled, because it did not read what it
had just written.
