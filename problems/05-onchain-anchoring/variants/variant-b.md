# Variant B — Certificate issuance anchoring

An education platform issues course-completion certificates (structured JSON +
rendered image). Each issued certificate must be anchored on-chain so employers
can verify authenticity. Certificates can be re-issued (name correction), which
creates a new version; both versions' history must remain verifiable. Chain
client: `prepare(tx) -> {txId, signedTx}`, `broadcast(signedTx)` (unknown
outcome on timeout), `getReceipt(txId)`.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. `issueCertificate(certId, version, payload)` — canonical hash over the
   structured payload (define and test the canonicalization; key order and
   whitespace must not matter), write-ahead persist of the anchor + tx identity,
   then broadcast.
2. Confirmation worker + recovery sweep: anything stuck after broadcast is
   resolved by chain lookup using the persisted tx identity — re-broadcast only
   if the chain proves the tx never landed.
3. `verify(certId, version, payload)` — recompute, compare, return proof or
   mismatch; superseded versions verifiable and marked as superseded.
4. Unique anchor per (certId, version) at schema level; a test simulating crash
   between broadcast and any late write must show no double anchor.

No real keys or RPC; fake client in tests.
