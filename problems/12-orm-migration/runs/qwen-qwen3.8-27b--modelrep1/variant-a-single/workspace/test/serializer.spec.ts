import { describe, expect, it } from 'vitest';
import { serialize } from '../src/common/serializer.js';

// The serializer is the public wire contract: money as decimal STRINGS,
// dates as ISO-8601, nulls present. Everything about the ORM migration that
// touches those shapes has to keep this function doing the same job.
describe('serialize (public response contract)', () => {
  it('serializes bigint money fields as decimal strings', () => {
    expect(serialize(9007199254740993n)).toBe('9007199254740993');
    expect(serialize(125000n)).toBe('125000');
  });

  it('keeps precision past Number.MAX_SAFE_INTEGER', () => {
    const body = JSON.stringify(serialize({ totalMinor: 9007199254740993n }));
    expect(body).toBe('{"totalMinor":"9007199254740993"}');
  });

  it('serializes Date as ISO-8601', () => {
    expect(serialize(new Date('2024-04-01T09:00:00Z'))).toBe('2024-04-01T09:00:00.000Z');
  });

  it('keeps null as null (field present) and recurses into arrays and objects', () => {
    const out = serialize({
      issuedAt: null,
      lineItems: [{ description: 'Training day', quantity: 1, unitPriceMinor: 120000n }],
    });
    expect(out).toEqual({
      issuedAt: null,
      lineItems: [{ description: 'Training day', quantity: 1, unitPriceMinor: '120000' }],
    });
  });
});
