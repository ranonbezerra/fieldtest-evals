# 01 — Payout with outbox + hold

## The real situation

This mirrors production work on the payout pipeline of a marketplace platform:
workers accumulate earnings and the platform pays them out through an external
provider (an instant-payment bank API in the original; a blockchain transfer in a
later variation of the same design). The money movement is asynchronous by nature:
the API request that creates a payout is not the moment the money leaves.

It is a deceptively simple feature that hides most of the hard parts of money
movement:

- **Funds safety under concurrency.** Two racing payout requests must not be able
  to spend the same balance. The correct pattern is a *hold*
  (reserve → claim → capture/release), not a direct debit at creation time.
- **Reliable handoff to async processing.** The event that triggers processing must
  be written in the *same database transaction* that creates the payout
  (transactional outbox). Enqueueing after commit can be lost; enqueueing before
  commit can process a payout that never existed.
- **At-least-once delivery.** The consumer will eventually receive duplicates.
  Without dedup by message id, the external transfer fires twice.
- **Settlement semantics.** The balance only truly changes when the provider
  confirms. Capture the hold on success, release it on failure, and write the
  settlement ledger entry only on confirmation.
- **Never revert in uncertainty.** When retries are exhausted without a definitive
  answer from the provider, the payout parks in a terminal manual-review state.
  Reverting would free funds that may already have left, reopening the
  double-payment window.

Partial solutions look plausible and pass shallow tests — which is exactly why
this is problem #01. A model that solves it has to hold several constraints in its
head simultaneously: transactional boundaries, concurrency without read-then-write
races, exactly-once *effects* on top of at-least-once *delivery*, and a state
machine with no unsafe transitions.

## Stack

TypeScript, NestJS, Prisma, PostgreSQL. Queue may be simulated with a DB-backed
message table + polling worker (no external broker required).
