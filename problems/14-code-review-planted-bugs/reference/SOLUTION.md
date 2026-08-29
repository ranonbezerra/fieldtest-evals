# Reference solution — answer key (KEEP OUT of the model's context)

## Fixtures

Built. `fixtures/transfers/` (variant A), `fixtures/consumer/` (variant B),
`fixtures/pr-diff/` (variant C). Each typechecks standalone — a local `_shims.d.ts`
declares the Nest and Node surface so no `node_modules` is needed — and each seeds its
bugs in otherwise-clean logic, so keyword pattern-matching is not enough.

`fixtures/pr-diff/context/` exists for a specific reason: two of variant C's decoys are
only identifiable by reading code the diff does not touch. The global serializer really
does handle BigInt, and `config.ts` really does resolve every credential at boot. A
reviewer who flags the BigInt response field, or who misses that the new client breaks
the fail-fast convention, did not open the context.

## Variant A — transfers service plants

| # | Sev | Bug | Mechanism |
|---|-----|-----|-----------|
| 1 | CRITICAL | Floating promise on notification send (`this.notify(...)` without await/catch inside the transfer path) | Rejection becomes unhandled; under provider errors the process crashes or silently drops — and the transfer "succeeded" without its side effect |
| 2 | CRITICAL | Lock order by argument position: `lock(from) → lock(to)` | Two transfers A→B and B→A acquire in opposite order → deadlock under crossing traffic; fires only under concurrency |
| 3 | CRITICAL | Raw connection branch: `client` acquired, `release()` only on the success path | Every error leaks a connection → pool exhaustion → total outage minutes after the first error burst |
| 4 | MAJOR | Audit-log branch does `JSON.stringify({ amount })` where amount is BigInt | Throws only when that branch executes (large accounts) — the money-path serializer elsewhere handles it, this one doesn't |
| 5 | MAJOR | Statement builder maps orders then queries entries per order (N+1) | Fine at 10 orders, melts at 10k; the innocent `Promise.all(orders.map(...))` also spikes the pool |
| 6 | CRITICAL | Retry path: balance updated via read-modify-write (`account.balance + delta` in JS) | Lost update under concurrent retries; contrast with the conditional UPDATE used in the main path |
| 7 | MAJOR | Provider HTTP call inside `$transaction` | Long external latency holds row locks + a pool slot; timeout aborts the tx after money left |

Decoy (correct, flagging it costs): `SELECT ... FOR UPDATE` via `$queryRaw` —
looks scary, is right.

## Variant B — consumer/webhook plants

| # | Sev | Bug | Mechanism |
|---|-----|-----|-----------|
| 1 | CRITICAL | Message marked processed BEFORE handling (`update status='done'` then process) | Crash mid-handling = message lost forever; inverse of at-least-once |
| 2 | CRITICAL | Webhook handler: no dedup by event id, side effects re-executed | Provider retry storms double-send notifications/credits |
| 3 | CRITICAL | Signature verified against re-serialized `JSON.stringify(body)` not the raw body | Verification breaks on key order/whitespace — and is bypassable where parsers normalize; must use raw payload |
| 4 | MAJOR | `for...of` with `await` replaced by `batch.forEach(async ...)` in the sweep | forEach ignores promises: no backpressure, errors vanish, "completed" logs before work finishes |
| 5 | MAJOR | `catch (e) { logger.warn(e) }` around the whole item handler, loop continues | Poison message pattern: permanent failures retried forever, masked as warnings; no dead-letter |
| 6 | MINOR | `setInterval` sweep never cleared, no overlap guard | Redeploy/long sweep overlap → duplicate concurrent sweeps |
| 7 | MAJOR | Retry sweep paginates with `skip/take` while mutating the result set | Rows shift under the cursor → items skipped every page |

Decoy: idempotency-looking upsert in deliveries.service that is actually
guarded correctly.

## Variant C — PR diff plants (proportion is the test)

- BLOCKER: top-up credits wallet on the provider's `202 accepted` response
  (before confirmation webhook) — money appears that may never settle.
- BLOCKER: migration adds a NOT NULL column without default on a populated
  table — deploy fails (or locks) in prod.
- MAJOR (comment, not block): provider API key read from env at call time with
  fallback `''` — fails late and unclearly; should fail fast at boot.
- MINOR: response DTO leaks provider raw payload field.
- Decoys (correct in context): a `@ts-expect-error` with linked issue; reuse of
  an existing global serializer that DOES handle BigInt (flagging it as a bug
  = didn't read the fixture); an unrelated rename inside the diff that is
  consistent with repo conventions.

Expected verdict: **block**, two-line rationale citing the two blockers,
same-day-fixable framing. An audit-length report or an approve both lose
points on graded-4.

## Judging notes

Recall over the CRITICAL rows is the gate (M1). Precision: count findings not
in this key; reasonable near-misses (e.g., questioning missing metrics) are
acceptable graded-3 material, invented APIs are not. The transcript should
show tracing (following `client` lifecycle, simulating two crossing transfers)
— keyword-grep reviews plateau at the shallow plants and miss 2, 6, 7.
