# Variant C — On-chain transfer reconciler

A service pays contributors in a stablecoin. Broadcasts sometimes time out; the
chain can be queried via `chain.findTransfer(reference) -> Transfer | null`
(indexer with up to ~10 min of lag). The token contract rejects a transfer whose
`reference` was already used (acts as an on-chain idempotency key).

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. `executeTransfers()` — sends pending transfers via
   `wallet.transfer({reference, to, amount})`. `reference` must be deterministic
   per payout order (stable across retries).
2. `reconcile()` — polls the indexer for outstanding transfers and advances state
   (broadcast → confirmed). Must tolerate being run concurrently/repeatedly.
3. A transfer whose broadcast failed may only be re-broadcast after reconciliation
   proves no transfer with that reference exists past the indexer lag. Max 5
   attempts, then terminal manual review; never auto-release funds on uncertainty.
4. Classify wallet/provider errors (accepted, reference-already-used, transient
   RPC error, permanent rejection); reference-already-used is success-equivalent.

Deliver schema, service, reconcile job, and tests for: timeout-but-on-chain (no
rebroadcast), proven-absent (rebroadcast, same reference), exhaustion. Amounts as
BigInt in token base units.
