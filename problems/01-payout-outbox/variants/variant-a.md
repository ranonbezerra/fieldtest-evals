# Variant A — Crypto payout service

You are building the payout service for a platform that pays sellers in a
stablecoin. Payouts are requested via API and executed asynchronously through a
blockchain provider SDK (assume `provider.transfer({to, amount}) -> {txHash}`,
which may throw, time out, or succeed slowly).

## Requirements

Implement in **TypeScript + NestJS + Prisma + PostgreSQL**:

1. `POST /payouts` — body: `{ accountId, amount, destinationAddress, idempotencyKey }`.
   Creates a payout if the account has sufficient available funds. Requests may be
   retried by clients; retrying the same `idempotencyKey` must not create a second
   payout or reserve funds twice.
2. Asynchronous processing — the transfer must NOT happen inside the request.
   Use a message table in Postgres as the queue plus a polling worker
   (`processMessages()` runs every N seconds). Delivery is at-least-once: your
   worker may see the same message more than once.
3. The account balance may be spent by concurrent payout requests. Two racing
   requests must never overdraw the account.
4. Track each payout's lifecycle explicitly (created → processing → sent →
   completed / failed / needs-review, or your own equivalent).
5. Keep a double-entry-style ledger. The account's settled balance changes only
   when the provider confirms the transfer.
6. The provider can fail transiently. Retry a bounded number of times; if you
   exhaust retries without a definitive outcome, do something safe and explain why.

## Deliverables

- Prisma schema + migration
- NestJS module: controller, service, worker
- Tests for: concurrent creation against one account, duplicate message delivery,
  retry exhaustion
- A short `DESIGN.md` (10–20 lines) explaining your funds-safety approach

Amounts are in minor units. Do not use floating point for money.
