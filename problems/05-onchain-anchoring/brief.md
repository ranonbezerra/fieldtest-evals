# 05 — On-chain document anchoring (web3 as infrastructure)

## The real situation

A healthtech product generates regulated documents and anchors their hashes on an
L2 (zkSync Era in the original) so any party can later prove a document existed,
unmodified, at a point in time. During review, a real vulnerability was found in
the pipeline: **the txHash was not persisted at broadcast time**. The service
broadcast the anchor transaction and only saved the txHash after the call
returned. A crash, timeout, or restart in that window left the database thinking
the document was never anchored — and the retry anchored it again. Double
anchoring is not just wasted gas: two on-chain records for one document version
undermines the very audit trail the feature exists to provide.

The correct shape is a **write-ahead anchoring pipeline**: persist the intent
(and everything needed to identify the transaction) *before* broadcasting, make
the anchor idempotent per document version, and treat broadcast and confirmation
as separate states — "the RPC call returned" is not "it's on chain", and
"pending" is not "failed".

This tests whether a model applies distributed-systems discipline to web3: the
chain is just another external system with at-least-once semantics and ambiguous
failures, plus one extra constraint — the canonical hash must be computed over a
stable serialization, or every re-render "changes" the document.

## Stack

TypeScript, NestJS, Prisma, PostgreSQL. The chain client is an interface
(`broadcast`, `getTransaction`, `getReceipt`) with a fake for tests; no real RPC
or keys involved.
