# Variant B — Acquirer settlement-file reconciler

An e-commerce refunds customers through a card acquirer. Refund submissions can
time out; the acquirer publishes a daily settlement file (CSV of processed
refunds, keyed by our `merchantRefundId`) available with up to 1 business day of
delay.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. `submitRefunds()` — submits pending refunds via
   `acquirer.refund({merchantRefundId, amount})`. `merchantRefundId` must be
   deterministic per refund order (stable across retries).
2. `reconcileFile(file)` — ingests a settlement file and advances refund states.
   Re-ingesting the same file (or overlapping files) must be a no-op.
3. A refund whose submission failed may only be re-submitted after a settlement
   file covering its expected date proves it absent. Max 5 attempts, then a
   terminal review state. Never auto-cancel a refund whose outcome is unknown.
4. Classify acquirer responses (accepted, duplicate id, transient, permanent) with
   distinct handling; "duplicate id" means the earlier submission succeeded.

Deliver schema, service, reconcile job, and tests for: timeout-but-present-in-file
(no resubmit), proven-absent (resubmit, same id), exhaustion. Integers for money.
