import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalize } from '../src/common/canonicalize.js';

describe('canonicalize', () => {
  it('object key order is irrelevant at every depth', () => {
    const a = { a: 1, b: { d: [1, { z: 3, y: 4 }], c: true } };
    const b = { b: { c: true, d: [1, { y: 4, z: 3 }] }, a: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('array order is significant', () => {
    expect(canonicalHash({ s: [1, 2, 3] })).not.toBe(canonicalHash({ s: [3, 2, 1] }));
  });

  it('different values hash differently', () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 1, b: null }));
  });

  it('produces stable lowercase-hex sha256 over compact UTF-8 JSON', () => {
    expect(canonicalize({ a: 1 })).toBe('{"a":1}');
    expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalHash({ a: 1 })).toBe(canonicalHash({ a: 1 }));
  });
});
