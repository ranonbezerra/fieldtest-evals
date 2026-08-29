# Variant C — Audit-log checkpoint anchoring

A B2B platform keeps an append-only audit log of sensitive operations. Every N
events (or T minutes) it must anchor a checkpoint — the Merkle root (or chained
hash) of the log segment — on an L2, so tampering with history is detectable.
Chain client: `prepare(tx) -> {txId, signedTx}`, `broadcast(signedTx)` (unknown
outcome on timeout), `getReceipt(txId)`.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. `checkpoint()` — deterministically selects the next unanchored segment,
   computes its root over a canonical event serialization, persists the
   checkpoint + tx identity BEFORE broadcasting, then broadcasts. Two concurrent
   checkpoint runs must not anchor overlapping segments (schema-level guarantee).
2. Confirmation worker + recovery sweep resolving broadcast-limbo checkpoints by
   chain lookup before any re-broadcast.
3. `verifySegment(from, to)` — recomputes the root from stored events and checks
   it against the anchored checkpoint; a tampered event must be detected and
   localized to its segment.
4. Tests: crash between broadcast and late persist (no double anchor), concurrent
   checkpoint race, tamper detection, canonicalization stability.

No real keys or RPC; fake client in tests.
