# 10-DESIGN.md

## reasoning

```
The user is asking me to write exactly one file, `DESIGN.md`. It's a 10-20 line explanation of the fund-safety approach based on PLAN.md.

Let me check the plan's content:
- Outbox pattern: payout + message in a single DB transaction
- Account row locked with SELECT ... FOR UPDATE before balance check and insert
- Idempotency: unique (accountId, idempotencyKey)
- Worker claims messages with a status flip + FOR UPDATE SKIP LOCKED
- Double-entry ledger: settled balance is derived from the sum of entries. Cached columns are updated in the same transaction
- Provider calls are made outside transactions
- Retry exhaustion: deterministic failure → FAILED (release reservation), ambiguous/timeout → NEEDS_REVIEW (hold reservation, no ledger entry)
- Amounts are bigint minor units

DESIGN.md must be 10-20 lines. Let me try writing it:

```markdown
# Design — Fund Safety

## Atomic reservation
`createPayoutWithMessage` runs in a single Postgres transaction: it locks the
account row (`SELECT ... FOR UPDATE`), checks `settledBalance - reservedAmount`,
increments the reservation, and inserts the payout plus its outbox message. The row
lock serializes concurrent requests, so two racing payouts can never overdraw the
account. The outbox row lives in the same transaction, so a payout can never exist
without its message.

## Idempotency
The unique index on `(account_id, idempotency_key)` makes client retries a no-op:
a duplicate request is rejected with `duplicate_payout` and never reserves funds twice.

## Ledger
Double-entry: every settled-balance change is a `ledger_entries` row (CREDIT/DEBIT).
The `accounts.settled_balance` / `reserved_amount` columns are cached aggregates,
updated in the same transaction as the ledger write, and can always be re-derived
from the entries.

## At-least-once processing
The worker claims a message with a `PENDING → PROCESSING` flip under
`FOR UPDATE SKIP LOCKED`, so two workers never process one message. The provider
call happens outside any DB transaction, so a crash mid-transfer results in redelivery,
not loss. Duplicate delivery is a no-op: terminal payout states are only reachable
from `CREATED`/`PROCESSING`, so the ledger entry is posted exactly once.

## Safe exhaustion
Retries are bounded (`PAYOUT_MAX_ATTEMPTS`). On exhaustion, a deterministic failure
fails the payout and releases the reservation. An ambiguous outcome (timeout) leaves
the payout `NEEDS_REVIEW` with funds still reserved and no ledger entry — because a
timeout may mean the transfer landed on-chain, and failing it would risk double-spend.
```

Let me count lines:
1. `# Design — Fund Safety`
2. (blank)
3. `## Atomic reservation`
4. ``createPayoutWithMessage` runs in a single Postgres transaction: it locks the`
5. `account row (`SELECT ... FOR UPDATE`), checks `settledBalance - reservedAmount`,`
6. `increments the reservation, and inserts the payout plus its outbox message. The row`
7. `lock serializes concurrent requests, so two racing payouts can never overdraw the`
8. `account. The outbox row lives in the same transaction, so a payout can never exist`
9. `without its message.`
10. (blank)
11. `## Idempotency`
12. `The unique index on `(account_id, idempotency_key)` makes client retries a no-op:`
13. `a duplicate request is rejected with `duplicate_payout` and never reserves funds twice.`
14. (blank)
15. `## Ledger`
16. `Double-entry: every settled-balance change is a `ledger_entries` row (CREDIT/DEBIT).`
17. `The `accounts.settled_balance` / `reserved_amount` columns are cached aggregates,`
18. `updated in the same transaction as the ledger write, and can always be re-derived`
19. `from the entries.`
20. (blank)
21. `## At-least-once processing`
...

This is already over 20 lines. The requirement says "10–20 line explanation." Hmm, does that mean 10-20 lines total? Let me count more carefully. Total line count including blank lines and headings — to be safe I should keep the total at 20 or fewer. Let me try to compress.

Let me rewrite more compactly:

```markdown
# Design — Fund Safety

- **Atomic reservation.** `createPayoutWithMessage` is one Postgres transaction: lock the
  account row (`SELECT ... FOR UPDATE`), check `settledBalance - reservedAmount`, increment
  the reservation, and insert the payout plus its outbox message. The row lock serializes
  concurrent requests, so racing payouts can never overdraw; the outbox row in the same
  transaction guarantees a payout never exists without its message.
- **Idempotency.** A unique index on `(account_id, idempotency_key)` makes client retries
  a no-op: duplicates are rejected and never reserve funds twice.
- **Double-entry ledger.** Every settled-balance change is a `ledger_entries` row
  (CREDIT/DEBIT); the `settled_balance`/`reserved_amount` columns are cached aggregates
  updated in the same transaction and always re-derivable from the entries.
- **At-least-once, exactly-once effect.** The worker claims a message with a
  `PENDING → PROCESSING` flip under `FOR UPDATE SKIP LOCKED`; the provider call runs
  outside any DB transaction, so a crash causes redelivery, not loss. Payout states are
  only terminal from `CREATED`/`PROCESSING`, so duplicate delivery posts the ledger
  entry exactly once.
- **Safe exhaustion.** Retries are bounded; on exhaustion a deterministic failure fails the
  payout and releases the reservation, while an ambiguous timeout leaves it `NEEDS_REVIEW`
  with funds reserved and no ledger entry — a timeout may mean the transfer landed on-chain,
  and failing it would risk double-spend.
```

Line count:
1. `# Design — Fund Safety`
2. (blank)
3. `- **Atomic reservation.** ...`
4. `  account row ...`
5. `  the reservation, and insert ...`
6. `  concurrent requests, so racing ...`
7. `  transaction guarantees ...`
8. `- **Idempotency.** ...`
9. `  a no-op: duplicates ...`
10. `- **Double-entry ledger.** ...`
11. `  (CREDIT/DEBIT); the ...`
12. `  updated in the same transaction ...`
13. `- **At-least-once, exactly-once effect.** ...`
14. `  `PENDING → PROCESSING` flip under ...`
15. `  outside any DB transaction, so a crash ...`
16. `  entry exactly once.`
17. `- **Safe exhaustion.** ...`
18. `  payout and releases the reservation, while an ambiguous timeout leaves it `NEEDS_REVIEW``
19. `  with funds reserved and no ledger entry — a timeout may mean the transfer landed on-chain,`
20. `  and failing it would risk double-spend.`

Exactly 20 lines including the blank line. Hmm, cutting it close. Maybe I should trim to be safely within range — say 18-19 lines. Let me try tightening each bullet to 3 lines:

```markdown
# Design — Fund Safety

- **Atomic reservation.** `createPayoutWithMessage` is one Postgres transaction: lock the
  account row (`SELECT ... FOR UPDATE`), check `settledBalance - reservedAmount`, increment
  the reservation, and insert the payout with its outbox message. The row lock serializes
  concurrent requests so racing payouts can never overdraw, and the outbox row in the same
  transaction guarantees a payout never exists without its message.
- **Idempotency.** A unique index on `(account_id, idempotency_key)` makes client retries a
  no-op: duplicates are rejected and never reserve funds twice.
- **Double-entry ledger.** Every settled-balance change is a `ledger_entries` row
  (CREDIT/DEBIT); `settled_balance`/`reserved_amount` are cached aggregates updated in the
  same transaction and always re-derivable from the entries.
- **At-least-once, once-effective.** The worker claims a message via a `PENDING → PROCESSING`
  flip under `FOR UPDATE SKIP LOCKED`; the provider call runs outside any DB transaction, so
  a crash causes redelivery, not loss. Terminal states are only reachable from `CREATED`/
  `PROCESSING`, so duplicate delivery posts the ledger entry exactly once.
- **Safe exhaustion.** On bounded retry exhaustion, a deterministic failure fails the payout
  and releases the reservation; an ambiguous timeout leaves it `NEEDS_REVIEW` with funds
  reserved and no ledger entry — a timeout may mean the transfer landed on-chain, and
  failing it would risk double-spend.
```

Line count:
1. `# Design — Fund Safety`
2. (blank)
3. `- **Atomic reservation.** ...`
4. `  account row ...`
5. `  the reservation, and insert ...`
6. `  concurrent requests so racing ...`
7. `  transaction guarantees ...`
8. `- **Idempotency.** ...`
9. `  no-op: duplicates ...`
10. `- **Double-entry ledger.** ...`
11. `  (CREDIT/DEBIT); ...`
12. `  same transaction and always ...`
13. `- **At-least-once, once-effective.** ...`
14. `  flip under ...`
15. `  a crash causes redelivery, not loss. Terminal states are only reachable from `CREATED`/`
16. `  `PROCESSING`, so duplicate delivery posts the ledger entry exactly once.`
17. `- **Safe exhaustion.** ...`
18. `  and releases the reservation; an ambiguous timeout leaves it `NEEDS_REVIEW` with funds`
19. `  reserved and no ledger entry — a timeout may mean the transfer landed on-chain, and`
20. `  failing it would risk double-spend.`

20 lines including the blank line. If the count excludes blank lines, 19. Within 10-20 range either way. Good.

Wait — I should double-check the wording "once-effective" — the plan says duplicate delivery is a no-op and "the idempotency of payout state transitions (only CREATED/PROCESSING → terminal) guarantees no double ledger entry." The plan's test says "provider `transfer` is called exactly once" for duplicate message delivery. Hmm, actually the plan's test says: "call `processMessage` twice with the same message id; provider `transfer` is called exactly once." So the claim mechanism guarantees transfer is called only once. My line "duplicate delivery posts the ledger entry exactly once" is accurate per the plan.

Also, in the plan's processMessage flow: "if status is DONE or DEAD, return (idempotent no-op on duplicate delivery)" and "if status is not PROCESSING, claim it... if claim returns null, return." So duplicate delivery → no-op. Good.

One more check: the plan says "SENT: set when provider returns txHash" and "COMPLETED: set immediately after SENT in the same transaction that posts the ledger entry." I don't need to mention SENT/COMPLETED details in DESIGN.md. The file is about fund-safety approach.

I should also mention bigint minor units? That's part of fund safety (no floats). The plan says "Amounts are `bigint` minor units... Reason: statement forbids floating-point money." I could add a short line. But it's already at 20 lines. I could fold it into the ledger bullet: "Amounts are `bigint` minor units — no floats." Let me see if I can fit.

Alternative: drop the title line? No, a title is reasonable. The requirement is "10–20 line explanation." I'll keep the title and fit within 20 lines total.

Let me try to include the bigint point by tightening. Revised:

```markdown
# Design — Fund Safety

- **Atomic reservation.** `createPayoutWithMessage` is one Postgres transaction: lock the
  account row (`SELECT ... FOR UPDATE`), check `settledBalance - reservedAmount`, increment
  the reservation, and insert the payout with its outbox message. The row lock serializes
  concurrent requests so racing payouts can never overdraw, and the outbox row in the same
  transaction guarantees a payout never exists without its message.
- **Idempotency.** A unique index on `(account_id, idempotency_key)` makes client retries a
  no-op: duplicates are rejected and never reserve funds twice.
- **Double-entry ledger.** Every settled-balance change is a `ledger_entries` row
  (CREDIT/DEBIT) in `bigint` minor units — no floats. `settled_balance`/`reserved_amount`
  are cached aggregates updated in the same transaction, re-derivable from the entries.
- **At-least-once, once-effective.** The worker claims a message via a `PENDING → PROCESSING`
  flip under `FOR UPDATE SKIP LOCKED`; the provider call runs outside any DB transaction, so
  a crash causes redelivery, not loss. Terminal states are only reachable from `CREATED`/
  `PROCESSING`, so duplicate delivery posts the ledger entry exactly once.
- **Safe exhaustion.** On bounded retry exhaustion, a deterministic failure fails the payout
  and releases the reservation; an ambiguous timeout leaves it `NEEDS_REVIEW` with funds
  reserved and no ledger entry — a timeout may mean the transfer landed on-chain, and
  failing it would risk double-spend.
```

Line count:
1. `# Design — Fund Safety`
2. (blank)
3-7: bullet 1 (5 lines)
8-9: bullet 2 (2 lines)
10-12: bullet 3 (3 lines)
13-16: bullet 4 (4 lines)
17-20: bullet 5 (4 lines)

Total = 20 lines. Exactly 20. Good, within 10-20 range.

Hmm, but is it risky to be exactly at the boundary? "10–20 line explanation" — 20 is included. Fine. But to be safe I could trim one line to make it 19. Let me tighten bullet 5:

```
- **Safe exhaustion.** On bounded retry exhaustion, a deterministic failure fails the payout
  and releases the reservation; an ambiguous timeout leaves it `NEEDS_REVIEW` with funds
  reserved and no ledger entry — a timeout may mean the transfer landed on-chain, and
  failing it would risk double-spend.
```

That's 4 lines. I could compress to 3:

```
- **Safe exhaustion.** On bounded retry exhaustion, a deterministic failure fails the payout
  and releases the reservation; an ambiguous timeout leaves it `NEEDS_REVIEW`, funds still
  reserved with no ledger entry — a timeout may mean the transfer landed on-chain, and
  failing it would risk double-spend.
```

Still 4 lines. Let me try to make bullet 5 3 lines:

```
- **Safe exhaustion.** On bounded retry exhaustion, a deterministic failure fails the payout
  and releases the reservation; an ambiguous timeout leaves it `NEEDS_REVIEW` with funds
  reserved and no ledger entry — a timeout may mean the transfer landed on-chain, so failing
  it would risk double-spend.
```

Still 4 lines. To make it 3:

```
- **Safe exhaustion.** On bounded retry exhaustion, a deterministic failure fails the payout
  and releases the reservation; an ambiguous timeout leaves it `NEEDS_REVIEW` with funds
  reserved and no ledger entry — a timeout may mean the transfer landed on-chain.
```

3 lines, but drops "so failing it would risk double-spend" which is the key "explain why" the variant asks for ("if retries are exhausted without a definitive outcome, do something safe and explain why"). The plan's assumption says: "Reason: a timeout may mean the transfer actually landed on-chain; failing it would double-spend, so we hold for manual reconciliation." I should keep the double-spend rationale.

Alternative: trim bullet 1 from 5 lines to 4:

```
- **Atomic reservation.** `createPayoutWithMessage` is one Postgres transaction: lock the
  account row (`SELECT ... FOR UPDATE`), check `settledBalance - reservedAmount`, increment
  the reservation, and insert the payout with its outbox message. The row lock serializes
  concurrent requests so racing payouts can never overdraw; the outbox row in the same
  transaction guarantees a payout never exists without its message.
```

Still 5 lines. Compress:

```
- **Atomic reservation.** `createPayoutWithMessage` is one Postgres transaction: lock the
  account row (`SELECT ... FOR UPDATE`), check `settledBalance - reservedAmount`, increment
  the reservation, and insert the payout with its outbox message. The row lock serializes
  concurrent requests so racing payouts can never overdraw, and the same transaction
  guarantees a payout never exists without its outbox message.
```

Still 5. Hmm. Let me try:

```
- **Atomic reservation.** `createPayoutWithMessage` is one Postgres transaction: lock the
  account row (`SELECT ... FOR UPDATE`), check available funds, increment the reservation,
  and insert the payout with its outbox message. The row lock serializes concurrent requests
  so racing payouts can never overdraw, and the same transaction guarantees a payout never
  exists without its outbox message.
```

Still 5 lines. To get to 4:

```
- **Atomic reservation.** `createPayoutWithMessage` is one Postgres transaction: lock the
  account row (`SELECT ... FOR UPDATE`), check available funds, increment the reservation,
  and insert the payout with its outbox message. The row lock serializes concurrent requests
  so racing payouts can never overdraw; the same transaction guarantees no payout exists
  without its outbox message.
```

Still 5 lines because the first line is long. OK — I'll accept 20 total lines. It's within range. Actually, let me reconsider: do I really need a title? "10–20 line explanation of the fund-safety approach" — a title is standard for a DESIGN.md and counts as one line. With the title, 20 lines total is fine.

Actually, let me recount very carefully with the final text:

Line 1: `# Design — Fund Safety`
Line 2: `` (blank)
Line 3: `- **Atomic reservation.** `createPayoutWithMessage` is one Postgres transaction: lock the`
Line 4: `  account row (`SELECT ... FOR UPDATE`), check `settledBalance - reservedAmount`, increment`
Line 5: `  the reservation, and insert the payout with its outbox message. The row lock serializes`
Line 6: `  concurrent requests so racing payouts can never overdraw, and the outbox row in the same`
Line 7: `  transaction guarantees a payout never exists without its message.`
Line 8: `- **Idempotency.** A unique index on `(account_id, idempotency_key)` makes client retries a`
Line 9: `  no-op: duplicates are rejected and never reserve funds twice.`
Line 10: `- **Double-entry ledger.** Every settled-balance change is a `ledger_entries` row`
Line 11: `  (CREDIT/DEBIT) in `bigint` minor units — no floats. `settled_balance`/`reserved_amount``
Line 12: `  are cached aggregates updated in the same transaction, re-derivable from the entries.`
Line 13: `- **At-least-once, once-effective.** The worker claims a message via a `PENDING → PROCESSING``
Line 14: `  flip under `FOR UPDATE SKIP LOCKED`; the provider call runs outside any DB transaction, so`
Line 15: `  a crash causes redelivery, not loss. Terminal states are only reachable from `CREATED`/`
Line 16: `  `PROCESSING`, so duplicate delivery posts the ledger entry exactly once.`
Line 17: `- **Safe exhaustion.** On bounded retry exhaustion, a deterministic failure fails the payout`
Line 18: `  and releases the reservation; an ambiguous timeout leaves it `NEEDS_REVIEW` with funds`
Line 19: `  reserved and no ledger entry — a timeout may mean the transfer landed on-chain, and`
Line 20: `  failing it would risk double-spend.`

Total 20 lines.

Hmm, one concern: line 13 has "`PENDING → PROCESSING`" at end of line and line 14 starts with "flip under". The markdown will render fine.

Another concern: the em-dash "—" in markdown is fine.

Let me double-check accuracy against the plan:
- "lock the account row (SELECT ... FOR UPDATE), check settledBalance - reservedAmount, increment the reservation" — plan: "SELECT ... FOR UPDATE on account row. Check settledBalance - reservedAmount >= amount... increment reservedAmount by amount." ✓
- "insert the payout with its outbox message" in same transaction ✓
- unique index on (account_id, idempotency_key) ✓
- ledger entries CREDIT/DEBIT, cached aggregates updated in same transaction, re-derivable ✓ (plan: "accounts.settledBalance == sum of CREDIT entries minus sum of DEBIT entries... The repository maintains settledBalance/reservedAmount as cached columns updated in the same transaction as ledger writes.")
- bigint minor units ✓
- worker claims with PENDING → PROCESSING flip under FOR UPDATE SKIP LOCKED ✓
- provider call outside DB transaction ✓ (plan: "What must not be inside a transaction: the provider transfer() call")
- crash → redelivery not loss ✓ (at-least-once)
- "terminal states are only reachable from CREATED/PROCESSING, so duplicate delivery posts the ledger entry exactly once" ✓ (plan: "The idempotency of payout state transitions (only CREATED/PROCESSING → terminal) guarantees no double ledger entry.")
- bounded retry exhaustion: deterministic failure → FAILED + release reservation; ambiguous timeout → NEEDS_REVIEW, funds reserved, no ledger entry ✓
- reason: timeout may mean transfer landed on-chain; failing would double-spend ✓

All good. The instructions say to reply with the complete content inside one fenced block and nothing else.

One more consideration: should I use a fenced block with the `markdown` language tag? The instructions say "inside one fenced block." I'll use ```markdown.

Also, no ASSUMPTION comment needed — everything I wrote is grounded in the plan.

Final check on the 10-20 line constraint: exactly 20 lines including title and blank line. If the grader counts non-blank lines: 18. Either way within range. Good.
```

## reply

```markdown
# Design — Fund Safety

- **Atomic reservation.** `createPayoutWithMessage` is one Postgres transaction: lock the
  account row (`SELECT ... FOR UPDATE`), check `settledBalance - reservedAmount`, increment
  the reservation, and insert the payout with its outbox message. The row lock serializes
  concurrent requests so racing payouts can never overdraw, and the outbox row in the same
  transaction guarantees a payout never exists without its message.
- **Idempotency.** A unique index on `(account_id, idempotency_key)` makes client retries a
  no-op: duplicates are rejected and never reserve funds twice.
- **Double-entry ledger.** Every settled-balance change is a `ledger_entries` row
  (CREDIT/DEBIT) in `bigint` minor units — no floats. `settled_balance`/`reserved_amount`
  are cached aggregates updated in the same transaction, re-derivable from the entries.
- **At-least-once, once-effective.** The worker claims a message via a `PENDING → PROCESSING`
  flip under `FOR UPDATE SKIP LOCKED`; the provider call runs outside any DB transaction, so
  a crash causes redelivery, not loss. Terminal states are only reachable from `CREATED`/
  `PROCESSING`, so duplicate delivery posts the ledger entry exactly once.
- **Safe exhaustion.** On bounded retry exhaustion, a definitive failure fails the payout
  and releases the reservation; an ambiguous timeout leaves it `NEEDS_REVIEW` with funds
  reserved and no ledger entry — a timeout may mean the transfer landed on-chain, and
  failing it would risk double-spend.
```
