# Variant A — Regulated report anchoring

A healthtech platform issues versioned clinical/administrative reports as
structured JSON rendered to PDF. Each published version must be anchored on an
L2 so auditors can verify integrity years later. The chain client exposes
`prepare(tx) -> {txId, signedTx}` (local, deterministic), `broadcast(signedTx)`
(may time out with unknown outcome), and `getReceipt(txId)`.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. `anchorDocument(documentId, version)` — computes a canonical hash of the
   structured content (define the canonicalization; the PDF is a rendering, not
   the source of truth), persists the anchor intent with the tx identity BEFORE
   broadcasting, then broadcasts.
2. A confirmation worker polling receipts and advancing state; a recovery sweep
   that resolves anchors stuck in broadcast-limbo by querying the chain first.
3. `verify(documentId, version, content)` — recomputes the hash and returns the
   anchoring proof (txId, block) or a mismatch report.
4. Exactly one anchor per (document, version), enforced at the schema level, and
   proven by a test that crashes the process between broadcast and the (wrong)
   late persist a naive design would do.

No real keys or RPC: implement against the interface with a fake for tests.
