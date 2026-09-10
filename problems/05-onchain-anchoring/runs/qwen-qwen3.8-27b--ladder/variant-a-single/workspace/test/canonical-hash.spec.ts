import { describe, expect, it } from 'vitest';
import {
  canonicalHashOf,
  canonicalizeJson,
  CanonicalizationError,
} from '../src/anchors/anchors.service.js';
import { SAMPLE_CONTENT } from './harness.js';

describe('canonicalization', () => {
  it('is independent of key order and object construction order', () => {
    const a = { zeta: 1, alpha: { m: [1, 2.5, 'x'], b: null }, mid: true };
    const b = { alpha: { b: null, m: [1, 2.5, 'x'] }, mid: true, zeta: 1 };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
    expect(canonicalHashOf(a)).toBe(canonicalHashOf(b));
  });

  it('sorts keys in UTF-16 code-unit order, which is locale-independent', () => {
    expect(canonicalizeJson({ b: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"b":1}');
  });

  it('emits no whitespace and escapes strings exactly as JSON requires', () => {
    expect(canonicalizeJson({ s: 'a"b\\c\né', empty: [] })).toBe(
      '{"empty":[],"s":"a\\"b\\\\c\\né"}',
    );
  });

  it('serializes numbers in shortest round-trip form and normalizes -0 to 0', () => {
    expect(canonicalizeJson({ n: 0.1 })).toBe('{"n":0.1}');
    expect(canonicalizeJson({ n: 1e21 })).toBe('{"n":1e+21}');
    expect(canonicalizeJson({ n: -0 })).toBe('{"n":0}');
  });

  it('preserves array order (positions are significant)', () => {
    expect(canonicalHashOf([1, 2, 3])).not.toBe(canonicalHashOf([3, 2, 1]));
  });

  it('rejects non-finite numbers, undefined, symbols, and functions', () => {
    expect(() => canonicalizeJson({ n: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ n: Number.POSITIVE_INFINITY })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ n: Number.NEGATIVE_INFINITY })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ n: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson(Symbol('x'))).toThrow(CanonicalizationError);
    expect(() => canonicalizeJson({ f: () => 1 })).toThrow(CanonicalizationError);
  });

  it('produces a stable lowercase 64-char SHA-256 hex digest over the UTF-8 canonical bytes', () => {
    const first = canonicalHashOf(SAMPLE_CONTENT);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalHashOf(SAMPLE_CONTENT)).toBe(first);
    // A single byte difference (an accented character) must change the digest.
    const ascii = { ...SAMPLE_CONTENT, metadata: { ...SAMPLE_CONTENT.metadata, author: 'dr. avila' } };
    expect(canonicalHashOf(ascii)).not.toBe(first);
  });
});
