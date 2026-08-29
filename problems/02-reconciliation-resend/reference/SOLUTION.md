# Reference solution — annotated core

## Crux 1: deterministic external id

```ts
// Stable across retries: same order + same effective date => same txid.
// A duplicate send collides at the provider instead of paying twice.
const txid = (order: Order, effectiveDate: string) =>
  createHash('sha256')
    .update(`${order.id}:${effectiveDate}`)
    .digest('hex')
    .slice(0, 32);
```

## Crux 2: states — resend is a reconcile-only transition

```
PENDING → SENDING → SENT_UNCONFIRMED → SETTLED
                        │ (reconcile: found in statement)
                        │
                        └─(reconcile: absent past lag)→ ABSENT_CONFIRMED
                                                          │ attempts < 5: → SENDING (same txid)
                                                          └ attempts = 5: → MANUAL_REVIEW (terminal)
```

Send failures and timeouts land in `SENT_UNCONFIRMED` (we do not know), never
back in `PENDING`. Only `reconcile()` can produce `ABSENT_CONFIRMED`, and only
`ABSENT_CONFIRMED` is resend-eligible.

## Crux 3: reconcile — evidence of absence, not absence of evidence

```ts
async reconcile(window: DateWindow) {
  const entries = await this.bank.getStatement(window.date);
  const byTxid = new Map(entries.map(e => [e.txid, e]));

  const open = await this.orders.findUnconfirmed(window);
  for (const order of open) {
    const hit = byTxid.get(order.txid);
    if (hit) { await this.markSettled(order, hit); continue; }   // idempotent guard inside

    // Absence only counts past the statement publishing lag.
    if (now() < addMinutes(order.sentAt, PUBLISHING_LAG_MIN)) continue;

    await this.markAbsentConfirmed(order); // guarded transition; rerun = no-op
  }
}
```

Idempotency of reconcile comes from guarded transitions
(`updateMany({ where: { id, status: EXPECTED } })`) — replaying a window updates
0 rows the second time.

## Crux 4: response buckets

```ts
switch (classify(res)) {
  case 'ACCEPTED':   return this.markSentUnconfirmed(order);
  case 'DUPLICATE':  return this.markSentUnconfirmed(order); // earlier send won — success signal
  case 'TRANSIENT':  return this.markSentUnconfirmed(order); // reconcile decides, not the catch block
  case 'PERMANENT':  return this.markRejected(order);        // definitive "no transfer happened"
}
```

## Common wrong answers

- Resending from the `catch` of the send call — a timeout is not a "no".
- Fresh UUID per attempt — turns every retry into a potential double payment.
- Auto-revert on exhaustion — frees funds that may already have left.
- Reconcile that flips states unguardedly — replaying a statement window
  double-fires transitions.
