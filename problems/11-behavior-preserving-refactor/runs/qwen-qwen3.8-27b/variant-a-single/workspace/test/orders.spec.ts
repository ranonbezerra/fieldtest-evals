/**
 * Pre-existing orders tests. Coverage is partial on purpose (only some
 * statuses were pinned before the extraction) -- left unmodified by the
 * refactor, they must keep passing.
 */
import { describe, expect, it } from 'vitest';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrdersRepository } from '../src/orders/orders.repository.js';

// The status-mapping methods never touch the repository, so a stub is enough.
const service = new OrdersService({} as OrdersRepository);

describe('OrdersService#displayStatusFor (pre-existing, partial)', () => {
  it('maps AUTHORIZED to "authorized"', () => {
    expect(service.displayStatusFor('AUTHORIZED')).toBe('authorized');
  });

  it('maps CAPTURED to "captured"', () => {
    expect(service.displayStatusFor('CAPTURED')).toBe('captured');
  });

  it('maps PENDING to "pending"', () => {
    expect(service.displayStatusFor('PENDING')).toBe('pending');
  });

  it('throws on an unrecognized provider status (preserved orders behavior)', () => {
    expect(() => service.displayStatusFor('WHATEVER')).toThrow();
  });
});
