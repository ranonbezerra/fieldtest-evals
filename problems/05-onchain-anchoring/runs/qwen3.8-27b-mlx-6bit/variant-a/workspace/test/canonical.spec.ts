import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { CanonicalizationError, canonicalize, hashContent } from '../src/anchor/canonical.js';

describe('canonical', () => {
  it('hashContent is invariant to object key order', () => {
    const first = hashContent({ a: 1, b: 2 });
    const second = hashContent({ b: 2, a: 1 });
    expect(first).toBe(second);
  });

  it('different content produces different hashes', () => {
    expect(hashContent({ a: 1 })).not.toBe(hashContent({ a: 2 }));
    expect(hashContent({ a: { nested: 1 } })).not.toBe(hashContent({ a: { nested: 2 } }));
  });

  it('object keys are sorted lexicographically at every nesting level', () => {
    expect(canonicalize({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('array element order is preserved', () => {
    expect(canonicalize([2, 1])).not.toBe(canonicalize([1, 2]));
    expect(hashContent([2, 1])).not.toBe(hashContent([1, 2]));
  });

  it('object keys are sorted inside array elements too', () => {
    expect(canonicalize([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('the canonical form is compact, with no whitespace', () => {
    const out = canonicalize({ a: 1, b: 2 });
    expect(out).toBe('{"a":1,"b":2}');
    expect(out).not.toMatch(/\s/);
  });

  it('hashContent is exactly the SHA-256 of the canonicalize output', () => {
    const value = { b: [3, 1], a: 'x' };
    const canonical = canonicalize(value);
    const expected = createHash('sha256').update(canonical, 'utf8').digest('hex');
    expect(hashContent(value)).toBe(expected);
  });

  it('the digest is 64 lowercase hex characters', () => {
    expect(hashContent({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('non-ASCII content is hashed as UTF-8 bytes', () => {
    const expected = createHash('sha256').update('"héllo"', 'utf8').digest('hex');
    expect(hashContent('héllo')).toBe(expected);
  });

  it('string values are never altered', () => {
    expect(canonicalize('a b')).not.toBe(canonicalize('a  b'));
    expect(canonicalize('True')).not.toBe(canonicalize('true'));
  });

  it('top-level primitives and null serialize as JSON literals', () => {
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('x')).toBe('"x"');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(null)).toBe('null');
  });

  it('empty object and empty array render as {} and []', () => {
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([])).toBe('[]');
  });

  it('number formatting follows JSON semantics (1e21 → "1e+21", -0 → "0")', () => {
    expect(canonicalize(1e21)).toBe('1e+21');
    expect(canonicalize(-0)).toBe('0');
  });

  it('non-finite numbers throw instead of serializing as null', () => {
    expect(() => canonicalize(NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Infinity)).toThrow(CanonicalizationError);
    expect(() => canonicalize(-Infinity)).toThrow(CanonicalizationError);
  });

  it('undefined members are rejected, not silently dropped', () => {
    expect(() => canonicalize({ a: 1, b: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize(undefined)).toThrow(CanonicalizationError);
  });

  it('function and symbol members are rejected, not silently dropped', () => {
    expect(() => canonicalize({ f: () => 1 })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ s: Symbol('s') })).toThrow(CanonicalizationError);
  });

  it('BigInt throws CanonicalizationError, not a raw TypeError', () => {
    let caught: unknown;
    try {
      canonicalize({ n: 10n });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalizationError);
  });

  it('circular references throw CanonicalizationError', () => {
    const self: Record<string, unknown> = {};
    self.self = self;
    expect(() => canonicalize(self)).toThrow(CanonicalizationError);

    const a: Record<string, unknown> = {};
    const c: Record<string, unknown> = {};
    a.b = c;
    c.a = a;
    expect(() => canonicalize(a)).toThrow(CanonicalizationError);
  });

  it('shared non-circular references are serialized twice, not flagged as cycles', () => {
    const x = { v: 1 };
    expect(canonicalize({ a: x, b: x })).toBe('{"a":{"v":1},"b":{"v":1}}');
  });

  it('hashing is pure: object identity and later mutation don\'t matter', () => {
    const first = { a: 1, b: 2 };
    const second = { a: 1, b: 2 };
    expect(hashContent(first)).toBe(hashContent(second));

    const source = { a: 1 };
    const digestBefore = hashContent(source);
    const canonicalBefore = canonicalize(source);
    source.a = 999;
    expect(hashContent(source)).not.toBe(digestBefore);
    expect(canonicalBefore).toBe('{"a":1}');
    expect(digestBefore).toBe(createHash('sha256').update('{"a":1}', 'utf8').digest('hex'));
  });

  it('hashContent rejects with CanonicalizationError (not a bare Error)', () => {
    let caught: unknown;
    try {
      hashContent({ n: 10n });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalizationError);
  });
});
