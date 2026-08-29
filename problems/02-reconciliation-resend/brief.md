# 02 — Reconciliation + safe resend

## The real situation

Production hardening of an instant-payment payout pipeline. The pipeline already
worked: a cron built the day's payment guide, another executed transfers through
the bank API, a third reconciled bank statements every 15 minutes. The hardening
question was: **when is it safe to send a payment again?**

A payment can be "missing" for many reasons: our POST timed out (but the bank got
it), the bank accepted and settled but our reconcile hasn't seen it yet, or the
transfer genuinely never happened. Resending on anything short of proof creates a
double payment. The rules that made resend safe:

- Resend is only reachable **from the reconciliation branch that proved absence**
  at the bank — never from a timeout, never from an error handler.
- The external transaction id is **deterministic** (hash of order + effective
  date), so an accidental duplicate send collides at the bank instead of paying
  twice.
- Attempts are bounded (max 5). On exhaustion the order parks in a terminal
  manual-review state. It is **never reverted**: reverting mints a fresh txid and
  reopens the double-payment window.
- Provider responses are classified into buckets (accepted / pre-authorized /
  duplicate / transient / permanent) with different handling per bucket —
  "duplicate" is a *success signal*, not an error.

This tests whether a model reasons about distributed uncertainty: absence of
evidence vs evidence of absence, and idempotency as a property of identifiers,
not just of endpoints.

## Stack

TypeScript, NestJS, Prisma, PostgreSQL. Bank API and statement fetch are provided
as fakes/interfaces; reconcile runs as a cron-style job.
