import { createHash } from 'node:crypto';
import { dateKey } from './dates.util.js';

/**
 * Derives the bank txid deterministically from stable order attributes and the
 * effective date: the same order on the same date always yields the same txid.
 * That is what makes a statement entry matchable to the order and a re-send
 * recognisable by the bank as the same instruction rather than a new payment.
 *
 * Never change this derivation without migrating existing orders: a new
 * derivation would make history unmatchable and re-sends unrecognised.
 */
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  const digest = createHash('sha256').update(`${orderId}:${dateKey(effectiveDate)}`).digest('hex');
  return `po_${digest.slice(0, 40)}`;
}
