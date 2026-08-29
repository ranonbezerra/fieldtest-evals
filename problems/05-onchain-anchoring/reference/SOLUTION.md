# Reference solution — annotated core

## Crux 1: write-ahead anchoring (the bug and the fix)

```ts
async anchor(documentId: string, version: number, content: unknown) {
  const hash = canonicalHash(content);            // M5, below

  // prepare() is local & deterministic: we know the tx identity BEFORE
  // anything leaves the process.
  const { txId, signedTx } = await this.chain.prepare({ data: hash });

  // M1 — WRITE-AHEAD: commit intent + tx identity first.
  // M2 — unique (documentId, version): a raced/retried anchor throws here.
  await this.prisma.anchor.create({ data: {
    documentId, version, hash, txId, status: 'PREPARED',
  }});

  try {
    await this.chain.broadcast(signedTx);
    await this.transition(txId, 'PREPARED', 'BROADCAST');
  } catch {
    // Unknown outcome. Do NOT mark failed, do NOT retry here.
    await this.transition(txId, 'PREPARED', 'BROADCAST'); // limbo; sweep resolves
  }
}
```

The original bug: `broadcast()` first, `create()` after. Crash in between = DB
says "never anchored" = retry double-anchors. Persisting the tx identity first
makes the crash recoverable instead of ambiguous.

## Crux 2: recovery sweep — look before you leap

```ts
// M4 — for every anchor in BROADCAST past a grace period:
const receipt = await this.chain.getReceipt(anchor.txId);
if (receipt?.confirmed)      await this.transition(anchor.txId, 'BROADCAST', 'CONFIRMED');
else if (receipt?.reverted)  await this.transition(anchor.txId, 'BROADCAST', 'FAILED');
else if (provenAbsent(receipt, anchor)) {
  // Only now is re-broadcast safe — and it reuses the SAME prepared tx
  // identity, so even a race collides on-chain or in the DB, never doubles.
}
```

## Crux 3: canonical hashing

```ts
// Hash the structured source of truth, canonically serialized:
// sorted keys, fixed separators, UTF-8 NFC, no insignificant whitespace.
// NEVER hash the rendered PDF — re-rendering changes bytes, not content.
const canonicalHash = (content: unknown) =>
  createHash('sha256').update(canonicalJson(content)).digest('hex');
```

Test: two serializations of the same object (different key order) must produce
the same hash; a one-field change must produce a different one.

## Crux 4: guarded transitions

```ts
async transition(txId: string, from: AnchorStatus, to: AnchorStatus) {
  const r = await this.prisma.anchor.updateMany({
    where: { txId, status: from }, data: { status: to },
  });
  return r.count === 1;   // replayed sweep/worker = 0 rows = no-op
}
```

## Common wrong answers

- Persist txHash after broadcast returns — the original vulnerability.
- Retry broadcast from the catch block — ambiguity is not failure.
- Hash the PDF bytes — every re-render "tampers" with the document.
- No unique (doc, version) — idempotency by convention instead of by constraint.
