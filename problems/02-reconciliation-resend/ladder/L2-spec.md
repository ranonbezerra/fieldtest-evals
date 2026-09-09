# Issue #288 — A timed-out send was re-sent and the supplier was paid twice

**Repo:** `supplier-payouts` · **Labels:** `bug` `money` `blocker`
**Reported by:** treasury · **Diagnosed by:** platform

---

## What happened

An order to a supplier timed out against the bank's instant-payment API. Our code
treated the timeout as a failure and re-sent. The bank had accepted the first send;
both landed. €18,400 paid twice, recovered manually over nine days.

The bank's own statement showed it the whole time. `getStatement(date) -> Settlement[]`
returns the txid we submitted, and both sends were there. We never looked before
re-sending, because the resend is currently driven by the send's own error path.

There is a second thing wrong that has not cost us yet. The txid is generated fresh
on each attempt, so even if we had checked the statement we could not have matched
the first send to the order.

## What we need

**The only thing that may cause a re-send is reconciliation proving absence.** Not a
timeout, not an exception, not a retry counter. The send path may record that it does
not know the outcome; it may not act on that.

### 1. The txid is derived, not generated

Derive it deterministically from stable order attributes and the effective date, so
the same order on the same date always produces the same txid. That is what makes a
statement entry matchable to an order at all, and what makes a re-send of the same
order recognisable to the bank as the same instruction rather than a new one.

### 2. `executePayments()` classifies what came back

`bank.send({txid, amount, key})` has four outcomes and they are not two:

- **accepted** — in flight, awaiting the statement
- **duplicate** — the bank already has this txid; this is a success, not an error
- **transient error** — network, timeout, 5xx. **Outcome unknown.**
- **permanent rejection** — malformed, blocked account, closed beneficiary

Each gets its own handling. The transient case is the one the incident turned on:
it is the state where we do not know, and the only correct move is to record that and
wait for evidence.

### 3. `reconcile(window)` is the only path to a re-send

Match statement entries to orders by txid and advance state. For orders still
awaiting evidence **and past the publishing lag** — the bank runs up to ~30 minutes
behind — absence from the statement is proof the send did not land, and only then is
a re-send permitted, with the same derived txid.

### 4. Reconciliation runs every 15 minutes over overlapping windows

Running it twice over the same window, or over windows that overlap, must not change
anything the first run already settled. An order already matched is skipped before
any decision is taken about it.

### 5. Attempts are capped and exhaustion parks

Five attempts. After that the order goes to a terminal state a human reviews. **Never
auto-revert**, never release, never mark failed-and-forget — the same reasoning as
the transient case: we do not know, and the safe direction is to stop and escalate.

### 6. Money is integer

Minor units, integers end to end.

## Acceptance

- Send times out but the order is in the statement → **no re-send**, order settles
- Send times out and the order is proven absent past the lag → re-send, **same txid**
- Attempts exhausted → parked for review, nothing reverted
- `reconcile` run twice over the same window → identical state after both
- Each of the four send outcomes takes a distinct path

## Deliverables

Prisma schema · service with `executePayments()` and `reconcile(window)` · the
scheduled reconcile job · tests for timeout-but-settled, proven-absent, and attempt
exhaustion.

## Notes

Stack is fixed: TypeScript, NestJS, Prisma, PostgreSQL. Assume nothing about the bank
API beyond `bank.send({txid, amount, key})` and `getStatement(date) -> Settlement[]`.
