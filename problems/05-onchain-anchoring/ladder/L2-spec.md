# Issue #143 — An anchor broadcast timed out and we lost the transaction identity

**Repo:** `report-anchoring` · **Labels:** `bug` `compliance` `blocker`
**Reported by:** compliance · **Diagnosed by:** platform

---

## What is happening

We anchor each published report version on an L2 so auditors can verify integrity
years later. Last month a `broadcast()` call timed out. The transaction had been
accepted by the chain; we had no record of it, because we persist the anchor **after**
the broadcast returns.

The report version now has an anchor on chain that our database does not know about.
An auditor querying us gets "not anchored"; an auditor querying the chain finds it.
Reconstructing which txId belonged to which version took two days of block scanning.

The chain client is:

    prepare(tx)         -> {txId, signedTx}   local, deterministic
    broadcast(signedTx)                        may time out, outcome unknown
    getReceipt(txId)

`prepare` is local and deterministic. **The transaction identity exists before the
broadcast does**, and we were throwing that away.

## What we need

### 1. Write ahead of the broadcast

`anchorDocument(documentId, version)`:

1. compute the canonical hash of the structured content
2. `prepare()` to obtain `{txId, signedTx}`
3. **persist the anchor intent, including the tx identity, and commit**
4. only then broadcast

If the process dies at any point after step 3, the recovery path has the txId and can
ask the chain what happened. That is the whole fix.

### 2. Canonical hashing, defined

The structured JSON is the source of truth; the PDF is a rendering of it. Define the
canonicalization — key ordering, number formatting, whitespace, encoding — write it
down, and hash the canonical bytes. An auditor in four years reproduces this from your
description, so it has to be stated, not merely implemented.

### 3. Broadcast-sent is not confirmed, and neither is unknown

Distinct states. At minimum: prepared, broadcast-sent, confirmed, failed. And a state
for **broadcast attempted, outcome unknown** — the timeout case. Collapsing it into
either "sent" or "failed" is what the incident was.

Confirmation comes from a receipt, never from `broadcast()` returning.

### 4. A recovery sweep that asks the chain first

For anchors stuck in limbo: **query `getReceipt(txId)` before doing anything else.**
If it landed, confirm it. Only if the chain has no trace may the same signed
transaction be re-broadcast — the same one, not a new one, so a re-send cannot become
a second anchor.

### 5. One anchor per (document, version), at the schema level

A unique constraint, not application logic. Prove it with a test that crashes the
process between the broadcast and the point where a naive design would persist, then
restarts and recovers — and shows exactly one anchor and one transaction identity.

### 6. `verify(documentId, version, content)`

Recompute the hash from the supplied content and return either the anchoring proof —
txId, block — or a mismatch report saying what differs.

## Acceptance

- Intent with tx identity is committed before `broadcast()` is called
- Broadcast times out but landed → recovery confirms from the receipt, no re-broadcast
- Broadcast times out and did not land → same signed tx re-broadcast, one anchor
- Crash between broadcast and confirmation → restart recovers, one anchor total
- Anchoring the same (document, version) twice → rejected by the database
- `verify` returns a proof for matching content and a mismatch report otherwise

## Deliverables

Prisma schema with the uniqueness constraint · `anchorDocument`, `verify` · the
confirmation worker and the recovery sweep · tests for the acceptance cases · the
canonicalization written down.

## Notes

Stack is fixed: TypeScript, NestJS, Prisma, PostgreSQL. No real keys and no RPC —
implement against the chain-client interface with a fake for tests.
