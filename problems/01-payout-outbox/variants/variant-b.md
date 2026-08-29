# Variant B — Marketplace seller withdrawal

A marketplace holds seller earnings in an internal wallet. Sellers request
withdrawals to their bank account; the money leaves through the bank's instant
payment API (assume `bank.sendPayment({payoutId, amount, pixKey}) -> {endToEndId}`,
which may throw, time out, or return an async "accepted" that is only confirmed
later by `bank.getPaymentStatus(endToEndId)`).

## Requirements

Implement in **TypeScript + NestJS + Prisma + PostgreSQL**:

1. `POST /withdrawals` — body: `{ sellerId, amount, pixKey, requestId }`. Mobile
   clients retry aggressively on flaky networks; the same `requestId` must never
   produce two withdrawals or lock funds twice.
2. The bank call must happen asynchronously, decoupled from the HTTP request, via
   a Postgres-backed job/message table consumed by a worker. Assume the worker can
   crash after picking up a job and the job will be redelivered.
3. Sellers can fire multiple withdrawal requests at once (web + app). They must
   never withdraw more than their available balance, under any interleaving.
4. Model the withdrawal lifecycle explicitly, including the confirmation step:
   "accepted by the bank" is not "settled".
5. Maintain a ledger. The seller's settled balance changes only on confirmed
   settlement; before that, funds are locked but not gone.
6. On repeated transient bank errors, stop after a bounded number of attempts and
   route the withdrawal to a state a human can act on. Justify why you do not
   simply refund the wallet at that point.

## Deliverables

- Prisma schema + migration
- NestJS module: controller, service, worker
- Tests for: concurrent withdrawals from one wallet, redelivered job, retry
  exhaustion
- A short `DESIGN.md` (10–20 lines) explaining your funds-safety approach

Amounts are in minor units (centavos). Do not use floating point for money.
