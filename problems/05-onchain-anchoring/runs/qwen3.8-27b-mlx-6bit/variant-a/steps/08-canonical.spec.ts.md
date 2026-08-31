# 08-canonical.spec.ts

## reasoning

```
The user wants me to write exactly one file: `test/canonical.spec.ts`. I have all the reference material including the plan, the canonical.ts implementation, and a detailed list of test cases I already decided on.

Let me look at the test cases list carefully and write each one. The file is `test/canonical.spec.ts` and per the layout convention tests go in `test/<feature>.spec.ts`. The manifest says `test/canonical.spec.ts | reads: src/anchor/canonical.ts`.

So I need to import from `src/anchor/canonical.ts`. Let me figure out the correct import path. The test file is at `test/canonical.spec.ts` and the source is at `src/anchor/canonical.ts`. So the relative path would be `../src/anchor/canonical.js` (ESM, so .js extension). Let me think about the import convention. The project is ESM with `"type": "module"`. In TypeScript with ESM, imports typically use `.js` extensions. Let me use `../src/anchor/canonical.js`.

Actually, let me reconsider. The convention in many NestJS + TS projects with ESM is to use `.js` extensions in imports. But some use no extension. Given the strict ESM setup, I'll use `.js` extension to be safe and correct.

Now let me go through each test case in the list and write it:

1. `hashContent is invariant to object key order` — two fresh objects with identical data but different insertion orders ({a:1,b:2} vs {b:2,a:1}) produce the same digest.

2. `different content produces different hashes` — {a:1} vs {a:2}, and a changed value buried in a nested field, hash differently.

3. `object keys are sorted lexicographically at every nesting level` — canonicalize({b:{d:1,c:2},a:3}) is exactly '{"a":3,"b":{"c":2,"d":1}}'.

4. `array element order is preserved` — [2,1] and [1,2] canonicalize (and hash) differently.

5. `object keys are sorted inside array elements too` — canonicalize([{b:1,a:2}]) is '[{"a":2,"b":1}]'.

6. `the canonical form is compact, with no whitespace` — the output contains no spaces or newlines (e.g. '{"a":1,"b":2}').

7. `hashContent is exactly the SHA-256 of the canonicalize output` — hashContent(v) equals the SHA-256 hex of canonicalize(v).

8. `the digest is 64 lowercase hex characters` — pins the SHA-256-hex contract.

9. `non-ASCII content is hashed as UTF-8 bytes` — hashContent("héllo") equals the SHA-256 of the canonical string encoded as UTF-8.

10. `string values are never altered` — canonicalize("a b") ≠ canonicalize("a  b") and "True" ≠ "true".

11. `top-level primitives and null serialize as JSON literals` — canonicalize(42)==="42", canonicalize("x")==='"x"', canonicalize(true)==="true", canonicalize(null)==="null".

12. `empty object and empty array render as {} and []` — canonicalize({})==="'{}'", canonicalize([])==="'[]'".

13. `number formatting follows JSON semantics (1e21 → "1e+21", -0 → "0")` — numbers are delegated to JSON.stringify.

14. `non-finite numbers throw instead of serializing as null` — canonicalize(NaN), Infinity, and -Infinity reject with CanonicalizationError.

15. `undefined members are rejected, not silently dropped` — canonicalize({a:1,b:undefined}) and top-level undefined throw.

16. `function and symbol members are rejected, not silently dropped` — canonicalize({f:()=>1}) and {s:Symbol()} throw.

17. `BigInt throws CanonicalizationError, not a raw TypeError` — the error-type contract: instanceof CanonicalizationError.

18. `circular references throw CanonicalizationError` — direct self-reference and indirect cycle reject cleanly.

19. `shared non-circular references are serialized twice, not flagged as cycles` — DAGs work: with x={v:1}, canonicalize({a:x,b:x}) === '{"a":{"v":1},"b":{"v":1}}'.

20. `hashing is pure: object identity and later mutation don't matter` — two distinct instances with equal data hash the same, and mutating the input after hashing doesn't retroactively change the stored canonical string or digest.

21. `hashContent rejects with CanonicalizationError (not a bare Error)` — the hash layer propagates the typed error.

Now let me write these tests. I'll use Vitest with `describe` and `it`.

Let me think about the import path. The source file is at `src/anchor/canonical.ts`. The test is at `test/canonical.spec.ts`. So relative from `test/` to `src/anchor/canonical.js` is `../src/anchor/canonical.js`.

Let me write the test file.

For test 7 (hashContent is exactly SHA-256 of canonicalize output), I'll need to compute SHA-256 myself using node:crypto to verify.

For test 9 (non-ASCII UTF-8), I'll compute the SHA-256 of the canonical string "héllo" — wait, but the canonical form of a string is `"héllo"` (with quotes). Actually `canonicalize("héllo")` returns the JSON string representation, which is `"héllo"` (with surrounding quotes). So the canonical form is `"héllo"` including the double quotes. Let me verify: `JSON.stringify("héllo")` returns `"\"héllo\""`, i.e., the string with quotes. So canonicalize("héllo") === '"héllo"'. Then hashContent hashes that. So I should compute SHA-256 of the UTF-8 bytes of `"héllo"` (with quotes).

Let me be careful here. For test 9, I'll assert that `hashContent("héllo")` equals `createHash('sha256').update('"héllo"', 'utf8').digest('hex')`. But wait — does JSON.stringify escape non-ASCII? No, by default JSON.stringify does NOT escape non-ASCII characters. So `JSON.stringify("héllo")` produces `"héllo"` with the literal é character, not `\u00e9`. So the canonical form contains the raw UTF-8 é. Good, so hashing as UTF-8 bytes of `'"héllo"'` is correct.

Actually, let me double check the test case description: "proves hashContent("héllo") equals the SHA-256 of the canonical string encoded as UTF-8." So I need to compute the SHA-256 of the canonical string (which is `"héllo"` with quotes) encoded as UTF-8. That's what I'll do.

Let me now also think about test 13: `number formatting follows JSON semantics (1e21 → "1e+21", -0 → "0")`. Let me verify: `JSON.stringify(1e21)` — in JavaScript, `String(1e21)` is `"1e+21"`. So JSON.stringify(1e21) === "1e+21". And `JSON.stringify(-0)` — hmm, `String(-0)` is `"0"`. So JSON.stringify(-0) === "0". Let me confirm: `JSON.stringify(-0)` actually returns `"0"`. Yes. So canonicalize(1e21) === "1e+21" and canonicalize(-0) === "0".

Wait, let me double check `JSON.stringify(-0)`. In JS, `JSON.stringify(-0)` returns `"0"`. Let me verify... Actually I recall that `JSON.stringify(-0)` returns `"0"`. Yes, because -0 is serialized as 0 in JSON. Let me confirm: `Object.is(-0, 0)` is false but `String(-0)` is `"0"` and `JSON.stringify(-0)` is `"0"`. Yes.

Now let me write all the tests.

Let me structure with describe blocks for clarity:
- `describe('hashContent', ...)` for hash-related tests
- `describe('canonicalize', ...)` for canonicalization tests
- Maybe group error cases.

Actually, let me just organize logically. Let me write it out.

Let me think about the import for createHash in the test file: `import { createHash } from 'node:crypto';`.

Now let me write each test carefully.

Test 1: hashContent invariant to key order
```ts
it('hashContent is invariant to object key order', () => {
  const first = hashContent({ a: 1, b: 2 });
  const second = hashContent({ b: 2, a: 1 });
  expect(first).toBe(second);
});
```

Test 2: different content produces different hashes
```ts
it('different content produces different hashes', () => {
  expect(hashContent({ a: 1 })).not.toBe(hashContent({ a: 2 }));
  expect(hashContent({ a: { nested: 1 } })).not.toBe(hashContent({ a: { nested: 2 } }));
});
```

Test 3: object keys sorted at every nesting level
```ts
it('object keys are sorted lexicographically at every nesting level', () => {
  expect(canonicalize({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
});
```

Test 4: array element order preserved
```ts
it('array element order is preserved', () => {
  expect(canonicalize([2, 1])).not.toBe(canonicalize([1, 2]));
  expect(hashContent([2, 1])).not.toBe(hashContent([1, 2]));
});
```

Test 5: object keys sorted inside array elements
```ts
it('object keys are sorted inside array elements too', () => {
  expect(canonicalize([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
});
```

Test 6: canonical form compact, no whitespace
```ts
it('the canonical form is compact, with no whitespace', () => {
  const out = canonicalize({ a: 1, b: 2 });
  expect(out).toBe('{"a":1,"b":2}');
  expect(out).not.toMatch(/\s/);
});
```

Test 7: hashContent is exactly SHA-256 of canonicalize output
```ts
it('hashContent is exactly the SHA-256 of the canonicalize output', () => {
  const value = { b: [3, 1], a: 'x' };
  const canonical = canonicalize(value);
  const expected = createHash('sha256').update(canonical, 'utf8').digest('hex');
  expect(hashContent(value)).toBe(expected);
});
```

Test 8: digest is 64 lowercase hex
```ts
it('the digest is 64 lowercase hex characters', () => {
  const digest = hashContent({ a: 1 });
  expect(digest).toMatch(/^[0-9a-f]{64}$/);
});
```

Test 9: non-ASCII hashed as UTF-8
```ts
it('non-ASCII content is hashed as UTF-8 bytes', () => {
  const value = 'héllo';
  const expected = createHash('sha256').update(`"${value}"`, 'utf8').digest('hex');
  expect(hashContent(value)).toBe(expected);
});
```

Wait, I need to make sure the canonical form of "héllo" is `"héllo"` (with quotes, no escaping). JSON.stringify("héllo") === '"héllo"'. So `expected` should be SHA-256 of `'"héllo"'`. Let me write it as `createHash('sha256').update('"héllo"', 'utf8').digest('hex')`. That's clearer.

Test 10: string values never altered
```ts
it('string values are never altered', () => {
  expect(canonicalize('a b')).not.toBe(canonicalize('a  b'));
  expect(canonicalize('True')).not.toBe(canonicalize('true'));
});
```

Test 11: top-level primitives and null serialize as JSON literals
```ts
it('top-level primitives and null serialize as JSON literals', () => {
  expect(canonicalize(42)).toBe('42');
  expect(canonicalize('x')).toBe('"x"');
  expect(canonicalize(true)).toBe('true');
  expect(canonicalize(null)).toBe('null');
});
```

Test 12: empty object and empty array
```ts
it('empty object and empty array render as {} and []', () => {
  expect(canonicalize({})).toBe('{}');
  expect(canonicalize([])).toBe('[]');
});
```

Test 13: number formatting follows JSON semantics
```ts
it('number formatting follows JSON semantics (1e21 → "1e+21", -0 → "0")', () => {
  expect(canonicalize(1e21)).toBe('1e+21');
  expect(canonicalize(-0)).toBe('0');
});
```

Test 14: non-finite numbers throw
```ts
it('non-finite numbers throw instead of serializing as null', () => {
  expect(() => canonicalize(NaN)).toThrow(CanonicalizationError);
  expect(() => canonicalize(Infinity)).toThrow(CanonicalizationError);
  expect(() => canonicalize(-Infinity)).toThrow(CanonicalizationError);
});
```

Test 15: undefined members rejected
```ts
it('undefined members are rejected, not silently dropped', () => {
  expect(() => canonicalize({ a: 1, b: undefined })).toThrow(CanonicalizationError);
  expect(() => canonicalize(undefined)).toThrow(CanonicalizationError);
});
```

Test 16: function and symbol members rejected
```ts
it('function and symbol members are rejected, not silently dropped', () => {
  expect(() => canonicalize({ f: () => 1 })).toThrow(CanonicalizationError);
  expect(() => canonicalize({ s: Symbol('s') })).toThrow(CanonicalizationError);
});
```

Test 17: BigInt throws CanonicalizationError not raw TypeError
```ts
it('BigInt throws CanonicalizationError, not a raw TypeError', () => {
  try {
    canonicalize({ n: 10n });
    throw new Error('expected canonicalize to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(CanonicalizationError);
  }
});
```

Hmm, but I want to make sure it's specifically CanonicalizationError and not a TypeError. Using `expect(() => canonicalize({n: 10n})).toThrow(CanonicalizationError)` would pass if it throws a CanonicalizationError. But to prove it's NOT a raw TypeError, I should assert instanceof. Actually `toThrow(CanonicalizationError)` checks that the error is an instance of CanonicalizationError (or a message match). Since CanonicalizationError extends Error, and TypeError is not an instance of CanonicalizationError, `toThrow(CanonicalizationError)` would fail if a TypeError were thrown. So that's sufficient. But to be extra explicit about the "not a raw TypeError" part, I'll use the try/catch with instanceof. Actually let me use `toThrow(CanonicalizationError)` which is cleaner and does prove it's the typed error. But the test case explicitly says "not a raw TypeError". Let me use the instanceof check to be explicit.

Actually, `expect(fn).toThrow(CanonicalizationError)` — when you pass a class, Vitest checks `error instanceof Constructor` OR the message matches. So it would catch a CanonicalizationError. If a TypeError were thrown instead, `error instanceof CanonicalizationError` is false and the message wouldn't match a class (message matching only works with strings), so it'd fail. Good. So `toThrow(CanonicalizationError)` is sufficient to prove it's the typed error and not a TypeError. But I'll add an explicit instanceof assertion for clarity to match "not a raw TypeError".

Let me write it with try/catch to be explicit:
```ts
it('BigInt throws CanonicalizationError, not a raw TypeError', () => {
  let caught: unknown;
  try {
    canonicalize({ n: 10n });
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(CanonicalizationError);
});
```

Test 18: circular references throw
```ts
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
```

Test 19: shared non-circular references serialized twice
```ts
it('shared non-circular references are serialized twice, not flagged as cycles', () => {
  const x = { v: 1 };
  expect(canonicalize({ a: x, b: x })).toBe('{"a":{"v":1},"b":{"v":1}}');
});
```

Test 20: hashing is pure
```ts
it('hashing is pure: object identity and later mutation don't matter', () => {
  const first = { a: 1, b: 2 };
  const second = { a: 1, b: 2 };
  expect(hashContent(first)).toBe(hashContent(second));

  const source = { a: 1 };
  const digest = hashContent(source);
  const canonical = canonicalize(source);
  source.a = 999;
  expect(hashContent(source)).not.toBe(digest);
  // The stored canonical string / digest are not retroactively changed.
  expect(canonical).toBe('{"a":1}');
  expect(digest).toBe(createHash('sha256').update('{"a":1}', 'utf8').digest('hex'));
});
```

Hmm, let me think about this test. "two distinct instances with equal data hash the same" — first and second are distinct objects with equal data, hashContent(first) === hashContent(second). Good. "mutating the input after hashing doesn't retroactively change the stored canonical string or digest" — I hash `source`, get digest and canonical. Then mutate source. The stored `digest` (a string) and `canonical` (a string) are immutable strings, so they can't change. But the point is that re-hashing after mutation gives a different result, proving the digest was computed from a snapshot, not a live reference. Let me assert:
- `hashContent(source)` after mutation !== original digest (proves it's a snapshot, not live).
- The stored `canonical` and `digest` strings remain what they were (trivially true since they're strings, but it documents the contract).

Actually the "doesn't retroactively change" is a bit tautological for strings. The meaningful assertion is that re-hashing after mutation differs. Let me keep both but make the key assertion the re-hash difference.

Let me refine:
```ts
it('hashing is pure: object identity and later mutation don't matter', () => {
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
```

This is good. It proves: distinct instances with equal data hash the same; mutation changes the re-hash (snapshot semantics); and the previously captured canonical/digest are exactly what we'd compute from the original data.

Test 21: hashContent rejects with CanonicalizationError not bare Error
```ts
it('hashContent rejects with CanonicalizationError (not a bare Error)', () => {
  let caught: unknown;
  try {
    hashContent({ n: 10n });
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(CanonicalizationError);
});
```

This proves hashContent propagates the typed error. Good.

Now, let me reconsider the import path and whether I should use `.js` extension. The project is ESM with `"type": "module"`. In a typical NestJS + TS + ESM setup, the tsconfig has `"module": "NodeNext"` or `"ESNext"` and imports use `.js` extensions. Given the convention file names are `kebab-case.role.ts`, and the manifest references `src/anchor/canonical.ts`, I'll import from `../src/anchor/canonical.js`.

Hmm, but I'm not 100% sure about the `.js` extension convention. Let me think. The plan and references don't show any import statements, so I can't confirm the exact style. The most defensible reading for ESM TypeScript is to use `.js` extensions. But many projects use no extension with `moduleResolution: "bundler"`. 

Given the ambiguity, I'll go with `.js` extension since it's the standard for Node ESM. Actually, wait — let me reconsider. The convention says "ESM, `"type": "module"`". This strongly implies NodeNext-style resolution where `.js` extensions are required/expected. I'll use `.js`.

Actually, let me reconsider whether to add an ASSUMPTION comment. The instructions say: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence... write the file using the most defensible reading and mark it with one `// ASSUMPTION: <what was unresolved>` comment at the point it matters."

The import path is a minor detail, not a "symbol" per se. But it's genuinely unresolved. However, I think the `.js` extension is the most defensible reading for ESM and doesn't really need an assumption comment — it's standard. But to be safe, maybe I should not clutter with an assumption for something this standard. The instruction is about symbols that are "genuinely absent." The import path isn't a symbol. I'll just use the standard ESM `.js` extension without an assumption comment, as it's the most defensible reading and standard practice.

Hmm, but actually let me reconsider. If I'm wrong about the extension, the test won't compile/run. But since this is a reference-based task and I can't run anything, the most defensible reading for Node ESM is `.js`. I'll go with that.

Let me reconsider — should I import both `canonicalize`, `hashContent`, and `CanonicalizationError`? Yes.

Now let me also double check: does the test need to import from a specific alias? No, relative path is fine.

Let me also reconsider test 6: "the canonical form is compact, with no whitespace". I assert `out` toBe `'{"a":1,"b":2}'` and not match whitespace. Good.

Let me reconsider test 4: I should make sure `[2,1]` canonicalizes to `"[2,1]"` and `[1,2]` to `"[1,2]"`. These are different. And hashes differ. Good.

Let me reconsider the structure. I'll wrap in a top-level `describe('canonical', ...)`.

Let me also think about whether I should import `createHash` from `node:crypto`. Yes, for tests 7 and 9 (and 20).

Now let me write the full file.

Let me reconsider test 13's expected values once more to be safe:
- `JSON.stringify(1e21)`: In JavaScript, numbers >= 1e21 are formatted in exponential notation. `String(1e21)` = `"1e+21"`. So JSON.stringify(1e21) = `"1e+21"`. Correct.
- `JSON.stringify(-0)`: `String(-0)` = `"0"`. So JSON.stringify(-0) = `"0"`. Correct.

Good.

Now, one concern: in test 13, the canonicalize function for a number does `return value;` and then JSON.stringify handles it. So canonicalize(1e21) = JSON.stringify(1e21) = "1e+21". And canonicalize(-0) = JSON.stringify(-0) = "0". 

Wait, but there's a subtlety. In the normalize function, for `-0`, `typeof -0` is `'number'`, and `Number.isFinite(-0)` is true, so it returns `-0`. Then JSON.stringify(-0) = "0". Good.

Let me write it all out now.

Actually, let me reconsider test 9 more carefully. The canonical form of the string `"héllo"` is `JSON.stringify("héllo")`. Does JSON.stringify escape the é? No. By default, `JSON.stringify` does not escape non-ASCII characters. So `JSON.stringify("héllo")` = `"héllo"` (with the literal é, surrounded by double quotes). So the canonical string is the 7-character string: `"`, `h`, `é`, `l`, `l`, `o`, `"`. When encoded as UTF-8, é is 2 bytes (0xC3 0xA9). So the SHA-256 is over those UTF-8 bytes. My test computes `createHash('sha256').update('"héllo"', 'utf8').digest('hex')`. The `'"héllo"'` in the test source is a JS string containing `"héllo"` (with quotes). When passed to `.update(..., 'utf8')`, it's encoded as UTF-8. This matches. Good.

But wait — I need to make sure the test source file itself, when written, contains the literal é character and not an escape. Since I'm writing the file content, I'll include the literal é. That's fine.

Let me finalize.

Let me write the complete file now.

One more consideration: should I group tests into nested describes? The list is flat, so I'll keep it mostly flat but maybe use a couple of describes for readability. Actually, to match the decisions list precisely and keep it clean, I'll use a single top-level `describe('canonical', ...)` with all the `it` blocks. That's clean and matches the flat list of decisions.

Actually, let me use a top-level describe and keep all its. That's the simplest and matches the list exactly.

Let me write it.

```ts
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
```

Let me double-check the count of tests against the list:
1. hashContent invariant to key order ✓
2. different content produces different hashes ✓
3. object keys sorted at every nesting level ✓
4. array element order preserved ✓
5. object keys sorted inside array elements ✓
6. canonical form compact, no whitespace ✓
7. hashContent is exactly SHA-256 of canonicalize ✓
8. digest is 64 lowercase hex ✓
9. non-ASCII hashed as UTF-8 ✓
10. string values never altered ✓
11. top-level primitives and null serialize as JSON literals ✓
12. empty object and empty array render as {} and [] ✓
13. number formatting follows JSON semantics ✓
14. non-finite numbers throw ✓
15. undefined members rejected ✓
16. function and symbol members rejected ✓
17. BigInt throws CanonicalizationError not raw TypeError ✓
18. circular references throw ✓
19. shared non-circular references serialized twice ✓
20. hashing is pure ✓
21. hashContent rejects with CanonicalizationError not bare Error ✓

All 21 tests are present. 

Now let me reconsider the import path one more time. The reference files show the source at `src/anchor/canonical.ts`. The test is at `test/canonical.spec.ts`. Relative path: from `test/`, go up to root (`..`), then into `src/anchor/canonical.js`. So `../src/anchor/canonical.js`. Correct.

I'm fairly confident in the `.js` extension for ESM. Let me keep it.

Let me reconsider: is there any risk the project uses a path alias like `@/`? The layout in the conventions doesn't mention aliases. The manifest references use full paths like `src/anchor/canonical.ts`. So relative import is fine.

I think the file is complete and correct. Let me finalize.

Actually, let me reconsider test 17 and 21 — they're nearly identical (both use `{ n: 10n }`). Test 17 is about `canonicalize` throwing CanonicalizationError not raw TypeError, and test 21 is about `hashContent` propagating the typed error. They use different functions (canonicalize vs hashContent), so they're distinct and both valid. Good. I could vary the input slightly but it's fine to use the same BigInt input since they test different entry points.

Let me finalize the file. I'll present it in a single fenced block with nothing else.
```

## reply

```ts
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
```
