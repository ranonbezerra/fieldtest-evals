import { describe, expect, it } from 'vitest';
import { deriveTxid } from '../src/payout/txid.util.js';

describe('deriveTxid', () => {
  it('is deterministic: same order, same effective date, same txid', () => {
    const morning = new Date('2025-03-10T00:00:00.000Z');
    const noon = new Date('2025-03-10T12:00:00.000Z'); // same UTC day
    const txid = deriveTxid('order-1', morning);
    expect(txid).toBe(deriveTxid('order-1', noon));
    expect(txid).toMatch(/^po_[0-9a-f]{40}$/);
  });

  it('changes when the effective date changes', () => {
    const d1 = new Date('2025-03-10T00:00:00.000Z');
    const d2 = new Date('2025-03-11T00:00:00.000Z');
    expect(deriveTxid('order-1', d1)).not.toBe(deriveTxid('order-1', d2));
  });

  it('changes when the order changes', () => {
    const d = new Date('2025-03-10T00:00:00.000Z');
    expect(deriveTxid('order-1', d)).not.toBe(deriveTxid('order-2', d));
  });
});
