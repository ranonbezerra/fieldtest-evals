import { describe, expect, it } from 'vitest';
import { mapProviderStatus } from '../src/orders/orders.status.js';

describe('orders status mapping', () => {
  it('maps the settled codes to paid', () => {
    expect(mapProviderStatus('CAPTURED')).toBe('paid');
    expect(mapProviderStatus('SETTLED')).toBe('paid');
  });

  it('maps both refund codes to refunded', () => {
    expect(mapProviderStatus('REFUNDED')).toBe('refunded');
    expect(mapProviderStatus('PARTIAL_REFUND')).toBe('refunded');
  });

  it('throws on a code it does not know', () => {
    expect(() => mapProviderStatus('WHATEVER')).toThrow();
  });
});
