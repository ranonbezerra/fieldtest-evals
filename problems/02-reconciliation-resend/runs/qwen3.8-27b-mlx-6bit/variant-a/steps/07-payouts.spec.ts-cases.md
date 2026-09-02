# 07-payouts.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/payouts.spec.ts` based on the plan and implementation shown. They want one line per case in a specific format, covering behavior from both the task statement and the plan. Let me analyze what needs to be tested:

From the task statement:
- timeout-but-settled (no resend)
- proven-absent (resend, same txid)
- attempt exhaustion

From the plan's test section (section 5):
1. Timeout-but-settled
2. Proven-absent, attempts remaining
3. Attempt exhaustion
4. Accepted response
5. Duplicate response
6. Transient error
7. Permanent rejection
8. Not-yet-past-lag
9. Reconcile idempotency
10. Amount mismatch
11. TXID determinism
12. Bank network error on send

Let me also think about what's awkward or could be wrong on its own:

- The `transition` method uses `WHERE status = $from` — if a concurrent reconcile already moved the row, the update affects 0 rows. This is the concurrency/overlap safety.
- The absence phase re-fetches `findInFlight` to exclude orders just settled. If it didn't re-fetch, an order settled in the match phase could also be "parked" or sent back to PENDING.
- The `isPastPublishingLag` boundary: exactly at the threshold (now === lagThreshold) should be past lag (>=). Just before should not.
- The txid reuse: on resend, the order already has a txid set. The code uses `order.txid ?? this.deriveTxid(...)`. If the txid is somehow null on an IN_FLIGHT order going back to PENDING, it would re-derive. But the plan says txid is immutable once set.
- The `attempts` counter: transient errors don't increment it. Accepted/duplicate/timeout do.
- The max attempts is 5. So attempts >= 5 means parked. That means on the 6th attempt (after 5 committed sends), it parks. Wait, let me re-read: "Cap attempts at 5; after that, park for manual review." So if attempts is already 5 and the order comes back to PENDING... wait no. Let me re-read the plan.

From the plan:
- `attempts` increments each time a send is committed (accepted, duplicate, or timeout). Max 5.
- In reconcile absence phase: if `order.attempts >= 5` → PARKED, else → PENDING.

So the flow is:
- First send: attempts 0→1 (IN_FLIGHT)
- Reconcile absent, past lag: attempts=1 < 5 → PENDING (attempts stays 1)
- Second send: attempts 1→2 (IN_FLIGHT)
- Reconcile absent, past lag: attempts=2 < 5 → PENDING (attempts stays 2)
- ... repeat until attempts=5
- Reconcile absent, past lag: attempts=5 >= 5 → PARKED

So the order gets 5 sends total, and on the 6th reconcile absence it parks.

Wait, but what about: after parking, can executePayments pick it up? No — executePayments only finds PENDING orders. PARKED is terminal.

Let me also think about:
- What if `bank.send` returns a result for an order that's no longer PENDING (concurrent reconcile moved it)? The transition would fail (0 rows updated) and the count wouldn't increment.
- What if the statement contains a txid that doesn't match any IN_FLIGHT order? It's just ignored (not in the map lookup).
- What if getStatement throws? The plan says `bank_unavailable` error.

Let me also think about the boundary for publishing lag:
- effectiveDate = 2025-01-15T00:00:00Z
- lagThreshold = 2025-01-16T00:30:00Z (24h + 30min)
- now = 2025-01-16T00:29:59Z → NOT past lag
- now = 2025-01-16T00:30:00Z → IS past lag (>=)
- now = 2025-01-16T00:30:01Z → IS past lag

Now let me structure the test cases. I need to be specific about what would break for each to fail.

Let me also consider: the plan says "No outer transaction; each order is an independent unit of work." This means if bank.send throws for one order, the others still process.

Also: "Reconcile for date D and D+1 may run concurrently; they touch disjoint effectiveDate sets, so no conflict." This is a concurrency case but maybe hard to test in unit tests without actual concurrent execution.

Let me think about what's deliberately NOT testing:
- Integration with actual Postgres (we're mocking the repository)
- Actual bank HTTP calls (we're mocking BankClient)
- The controller layer (it's thin validation + delegation)
- Schema/migration correctness (that's a Prisma concern)
- The actual SHA-256 computation being cryptographically secure (we just test determinism and format)

Let me write the list now.
```

## reply

- `accepted response transitions PENDING → IN_FLIGHT, stores txid, increments attempts` — proves the happy-path send commits state; fails if `transition` is not called with `IN_FLIGHT`, or if `attempts` is not `order.attempts + 1`, or if `txid` is not persisted in the patch.

- `duplicate response is handled identically to accepted (IN_FLIGHT, attempts + 1)` — proves the idempotency guarantee: a bank returning "duplicate" does not lose the order; fails if the `duplicate` branch falls through, skips the transition, or increments attempts by a different amount than `accepted`.

- `transient error leaves order PENDING with unchanged attempts` — proves a transient blip does not consume send budget or move state; fails if the code transitions to any other status, or if `attempts` is incremented, making the order eligible for parking sooner than it should.

- `permanent rejection transitions PENDING → REJECTED (terminal)` — proves a definitive bank refusal parks the order out of both send and reconcile pipelines; fails if the status is anything other than `REJECTED`, or if a subsequent `findPending` / `findInFlight` call would still return the row.

- `bank.send network throw is treated as committed timeout (IN_FLIGHT, attempts + 1)` — proves the catch-path counts as a real send because the request may have landed; fails if the throw is swallowed without transitioning, or if `attempts` is not incremented, allowing an unbounded number of blind retries.

- `timeout-but-settled: reconcile finds txid in statement → SETTLED, no resend` — the core task-statement case; proves a timed-out send that actually arrived is not re-sent; fails if the match phase does not transition to `SETTLED`, or if the absence phase subsequently re-enters the row (e.g., because it does not re-fetch `findInFlight` after settling), causing a spurious PENDING or PARKED transition.

- `proven-absent with attempts < 5: IN_FLIGHT → PENDING, same txid retained` — proves a genuinely lost send is retried with the identical txid (idempotent at the bank); fails if the txid is re-derived (different hash), if `attempts` is incremented here instead of at send time, or if the transition target is anything other than `PENDING`.

- `proven-absent with attempts ≥ 5: IN_FLIGHT → PARKED (terminal, never auto-reverted)` — proves the cap is enforced and the order is removed from all automated paths; fails if the threshold check uses `>` instead of `>=` (allowing a 6th send), or if `PARKED` is not excluded by both `findPending` and `findInFlight`.

- `not-yet-past-publishing-lag: order stays IN_FLIGHT, no transition` — proves the 30-min grace window is respected so we do not declare absence before the bank has published; fails if `isPastPublishingLag` uses `>` instead of `>=` at the boundary, or if the absence phase runs without checking the lag condition.

- `boundary: now exactly at effectiveDate + 24h + 30min is past lag; one millisecond before is not` — proves the off-by-one at the threshold; fails if the comparison is strict `>` (excluding the exact instant) or if the 30-minute component is omitted (making it 24h flat).

- `amount mismatch in statement: order is NOT settled, remains IN_FLIGHT` — proves a corrupted or mis-routed settlement does not silently mark the order done; fails if the code settles despite a mismatch, or if it parks/rejects the order (it should simply skip and leave it for the next cycle or manual intervention).

- `reconcile idempotency: second run on same date yields zero settlements, zero parks, zero proven-absent` — proves overlapping 15-minute windows do not double-act; fails if the match or absence phase does not guard on `status = IN_FLIGHT` in the `WHERE` clause, so a second run re-processes already-SETTLED or already-PENDING rows.

- `concurrent reconcile: two runs on same date — the transition `WHERE status = $from` guard means only one wins, the other gets 0 rows and skips` — proves the CAS-style guard prevents double-settle under race; fails if `transition` does a bare `UPDATE … SET status = $to WHERE id = ?` without the `AND status = $from` predicate.

- `txid determinism: same (orderId, effectiveDate) always yields the same 32-char hex string` — proves resend uses an identical identifier so the bank deduplicates; fails if the derivation is non-deterministic (e.g., includes a timestamp or random salt), or if the output length is not 32 hex characters.

- `txid reuse on resend: an order that went IN_FLIGHT → PENDING (proven-absent) keeps its original txid on the next executePayments` — proves the `order.txid ?? deriveTxid(...)` short-circuit works; fails if the code always calls `deriveTxid`, producing a new txid that the bank sees as a fresh payment (double-pay).

- `executePayments processes multiple PENDING orders independently: one bank.send throw does not abort the loop` — proves fault isolation per order; fails if the `try/catch` wraps the entire for-loop instead of each iteration, so a single network error skips remaining orders.

- `reconcile with empty statement (no settlements for the date) still runs the absence phase correctly` — proves the match phase is a no-op without crashing on an empty map, and that all IN_FLIGHT orders past lag are evaluated for absence; fails if the code early-returns when `settlements.length === 0`, skipping the absence phase.

- `bank.getStatement throws: reconcile surfaces bank_unavailable, no state mutations` — proves the error path does not silently park or settle; fails if the exception is caught and treated as an empty statement (which would trigger mass "proven-absent" transitions), or if it is not re-thrown in the standard error envelope.

- `attempts counter after 5 committed sends + 5 proven-absent cycles is exactly 5, and the 6th absence parks` — proves the counter is only incremented at send time (accepted/duplicate/timeout) and never at reconcile time; fails if `reconcile` also increments `attempts`, causing premature parking at attempt 3 or 4.

Deliberately not testing: the controller layer (thin date-validation + delegation, no business logic to break), actual Postgres query correctness or migration integrity (covered by Prisma's own test suite and a separate integration harness), the cryptographic strength of SHA-256 (only determinism and format are relevant here), and real bank HTTP transport (the `BankClient` interface is the seam; its mock is the unit under observation).
