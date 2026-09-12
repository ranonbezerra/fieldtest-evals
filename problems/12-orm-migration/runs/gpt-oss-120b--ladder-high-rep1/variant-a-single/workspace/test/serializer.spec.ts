import { describe, expect, it } from 'vitest';
import { serialize } from '../src/common/serializer.js';

describe('Serializer', () => {
  it('converts BigInt values to strings', () => {
    const input = { amount: 1234567890123456789n };
    const output = serialize(input);
    expect(output).toEqual({ amount: '1234567890123456789' });
  });
});
