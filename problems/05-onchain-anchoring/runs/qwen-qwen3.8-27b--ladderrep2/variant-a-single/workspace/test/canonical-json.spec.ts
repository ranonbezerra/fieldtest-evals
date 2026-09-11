import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalize } from '../src/anchoring/canonical-json.js';
import { CanonicalizationError } from '../src/anchoring/errors.js';

describe('canonical JSON (the anchoring hash input)', () => {
  it('orders object keys and drops all whitespace, at every level', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalize({ z: 1, a: 2 })).toBe(canonicalize({ a: 2, z: 1 }));
  });

  it('preserves array order (order is meaningful)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it('normalizes numbers by value: 1e5 == 100000, 1.10 == 1.1, -0 == 0', () => {
    expect(canonicalize({ n: 1e5 })).toBe(canonicalize({ n: 100000 }));
    expect(canonicalize({ n: 1.10 })).toBe('{"n":1.1}');
    expect(canonicalize({ n: -0 })).toBe('{"n":0}');
    expect(canonicalize({ n: 1.5e-7 })).toBe('{"n":1.5e-7}');
  });

  it('escapes strings per the spec and leaves printable characters literal', () => {
    expect(canonicalize({ s: 'a"b\\c\nd' })).toBe('{"s":"a\\"b\\\\c\\nd"}');
    expect(canonicalize({ s: '\u0001' })).toBe('{"s":"\\u0001"}');
    expect(canonicalize({ s: 'café' })).toBe('{"s":"café"}');
  });

  it('handles null, booleans and empty containers', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize({ a: true, b: false, c: null })).toBe('{"a":true,"b":false,"c":null}');
    expect(canonicalize({ e: [] })).toBe('{"e":[]}');
    expect(canonicalize({ e: {} })).toBe('{"e":{}}');
  });

  it('produces a stable sha256:<hex> digest independent of key order', () => {
    const h1 = canonicalHash({ version: 1, vitals: { hr: 72 } });
    const h2 = canonicalHash({ vitals: { hr: 72 }, version: 1 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('different content produces a different digest', () => {
    expect(canonicalHash({ hr: 72 })).not.toBe(canonicalHash({ hr: 73 }));
  });

  it('rejects values that are not JSON', () => {
    expect(() => canonicalize({ x: NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ x: Infinity })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ x: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ x: () => 1 })).toThrow(CanonicalizationError);
  });
});
