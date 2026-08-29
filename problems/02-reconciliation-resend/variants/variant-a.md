# Variant A — Instant-payment payout reconciler

A platform pays suppliers through a bank's instant-payment API. Sends sometimes
time out; the bank exposes `getStatement(date) -> Settlement[]` (each with the
txid we sent) with up to ~30 min of publishing lag.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. `executePayments()` — sends pending orders via `bank.send({txid, amount, key})`.
   The txid must be derived deterministically from the order + effective date.
2. `reconcile(window)` — matches statement entries to orders and advances their
   state. Must be safe to run every 15 minutes, including over overlapping windows.
3. Resend logic: an order whose send failed/timed out may only be re-sent after
   reconciliation proves it is absent from the statement past the publishing lag.
   Cap attempts at 5; after that, park for manual review and never auto-revert.
4. Classify `bank.send` responses (accepted, duplicate, transient error, permanent
   rejection) and handle each differently.

Deliver schema, service, reconcile job, and tests for: timeout-but-settled (no
resend), proven-absent (resend, same txid), attempt exhaustion. Money in minor
units, integers only.
