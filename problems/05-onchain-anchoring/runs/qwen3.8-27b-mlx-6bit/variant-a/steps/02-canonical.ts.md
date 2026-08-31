# 02-canonical.ts

## reasoning

```
Need to write `src/anchor/canonical.ts` according to the plan.

Plan specifies:
- `canonicalize(value: unknown): string` — returns canonical JSON (keys sorted, no whitespace). Throws `CanonicalizationError` for non-serializable input.
- `hashContent(value: unknown): string` — returns SHA-256 hex of `canonicalize(value)`.
- `class CanonicalizationError extends Error` — thrown from `canonicalize`/`hashContent` when input isn't JSON-serializable.

Assumptions section: "Canonical form of JSON — at every object level, keys sorted lexicographically, arrays preserve order, no whitespace, UTF-8; hash is SHA-256 hex of the canonical string."

Stack: TypeScript strict, ESM ("type": "module"). Use `crypto` from Node. Since it's ESM: `import { createHash } from 'node:crypto'`.

Implementation details:

`canonicalize(value: unknown): string`:
- Must handle: objects (sort keys recursively), arrays (preserve order), primitives (string, number, boolean, null).
- Non-serializable input: circular references, functions, symbols, BigInt? JSON.stringify throws on circular refs and BigInt. Functions/undefined inside objects are silently dropped by JSON.stringify — is that "non-serializable"? Per the plan, throw `CanonicalizationError` for non-serializable input. Tests in the plan: "hashContent throws CanonicalizationError on non-serializable input (e.g. circular reference)."

So the safest approach: do a manual recursive canonicalization that throws `CanonicalizationError` on encountering values JSON can't represent (functions, symbols, BigInt, circular refs). Or use JSON.stringify with a guard.

Let me think about what's most defensible:

Option A: Use `JSON.stringify` with a replacer that sorts keys. But JSON.stringify on an object with sorted keys: actually, `JSON.stringify` already serializes object keys in insertion order (for string keys). So we can recursively build a new object with sorted keys and then `JSON.stringify`. But `JSON.stringify` silently drops `undefined`, functions, and symbols in objects/arrays. That's a silent loss of data — bad for a canonical hash (two different inputs would hash the same). For a canonicalization function used for integrity, silent dropping is dangerous. Better to throw on values that can't be represented.

Also `JSON.stringify` throws `TypeError` on circular refs and BigInt. We could catch it and rethrow as `CanonicalizationError`, but a cleaner approach is to walk the structure ourselves:

```ts
function walk(value: unknown, seen: Set<unknown>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalizationError(...); // JSON.stringify produces "null" for NaN/Infinity — that's a silent change
    return value;
  }
  if (typeof value === 'bigint') throw new CanonicalizationError(...);
  if (typeof value === 'function' || typeof value === 'symbol') throw new CanonicalizationError(...);
  if (seen.has(value)) throw new CanonicalizationError('circular');
  seen.add(value);
  if (Array.isArray(value)) {
    const out = value.map(v => walk(v, seen));
    seen.delete(value); // should we delete? For DAG (shared but non-circular references), JSON.stringify serializes shared refs multiple times. If we keep them in `seen`, a DAG would be falsely flagged as circular. So delete after processing to allow shared references (DAGs) — matching JSON.stringify behavior.
    return out;
  }
  // object
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = walk((value as Record<string, unknown>)[key], seen);
  }
  seen.delete(value);
  return out;
}
```

Wait — should NaN/Infinity throw? JSON.stringify converts them to `null`. That's a silent data change, and for canonical hashing it's bad (NaN content would hash the same as null). The plan says throw `CanonicalizationError` for non-serializable input. NaN isn't JSON-serializable (JSON has no representation), so throwing is defensible. But is that overreaching? The plan's tests only mention circular refs. Hmm.

The instructions say: "Implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan doesn't name." Throwing on NaN/BigInt/functions is within the scope of "throw CanonicalizationError for non-serializable input" — those are non-serializable in JSON. I think a strict canonicalizer that throws on anything JSON can't faithfully represent is the most defensible reading. Alternatively, we could just let `JSON.stringify` handle it and wrap errors.

Actually, simpler and more defensible: do the recursive normalization (sort keys, validate values) then `JSON.stringify` the result. Since we've already validated that all values are JSON-representable, `JSON.stringify` can't throw — but for safety wrap it in try/catch and rethrow as `CanonicalizationError`.

Hmm, but should we throw on functions/undefined? Consider `{a: 1, b: undefined}`. JSON.stringify returns `{"a":1}`. If a document has an undefined field vs. missing field, they'd hash the same. That's arguably acceptable canonicalization (undefined ≈ absent). But for an integrity hash, silent dropping is risky. The plan's definition: "throw CanonicalizationError for non-serializable input." `undefined` as a value isn't JSON-serializable. I'll throw on undefined, functions, symbols, BigInt, non-finite numbers, and circular refs.

Wait, what about top-level `undefined`? `canonicalize(undefined)` — JSON.stringify(undefined) returns undefined (not a string). We should throw. Top-level `NaN` → JSON.stringify returns "null"... actually, top-level: `JSON.stringify(NaN)` → `"null"`. So our validation catches it first.

What about numbers with -0? JSON.stringify(-0) → "0". Fine, canonical.

OK let me think about whether throwing on undefined values is too aggressive for the tests. The plan's tests:
- Determinism: same content with different key ordering → same hash; different content → different hash.
- Throws on circular reference.

So throwing on undefined/functions won't break the specified tests. And it's more correct for an integrity anchor. I'll go with strict validation.

Hmm, but wait: "Do not add exports, features, or files that the plan doesn't name." Strict validation is part of implementing "throw CanonicalizationError for non-serializable input" — not an extra feature. It's a judgment call about what "non-serializable" means. I'll go with strict (throw on anything JSON can't faithfully represent). That's the most defensible reading for a canonicalization function used in integrity anchoring.

Now `hashContent`:
```ts
export function hashContent(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
```

`CanonicalizationError`:
```ts
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}
```

ESM + strict TS. Should I use `import { createHash } from 'node:crypto'`? Yes, Node 20+, ESM.

Now let me write the full file:

```ts
import { createHash } from 'node:crypto';

/**
 * Raised when a value cannot be represented in canonical JSON form.
 */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Canonical JSON form: object keys sorted lexicographically at every level,
 * arrays preserved in order, no whitespace, UTF-8.
 */
export function canonicalize(value: unknown): string {
  const normalized = normalize(value, new Set<object>());
  try {
    return JSON.stringify(normalized);
  } catch (err) {
    throw new CanonicalizationError(
      `Value is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * SHA-256 hex digest of the canonical form of the given value.
 */
export function hashContent(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null) return null;

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;

  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalizationError('Non-finite numbers are not JSON-serializable');
    }
    return value;
  }

  if (type === 'bigint') {
    throw new CanonicalizationError('BigInt values are not JSON-serializable');
  }

  if (type === 'function' || type === 'symbol') {
    throw new CanonicalizationError(`${type} values are not JSON-serializable`);
  }

  if (type !== 'object') {
    throw new CanonicalizationError(`Value of type ${type} is not JSON-serializable`);
  }

  const record = value as object;
  if (seen.has(record)) {
    throw new CanonicalizationError('Circular structure is not JSON-serializable');
  }
  seen.add(record);

  let result: unknown;
  if (Array.isArray(record)) {
    // Arrays preserve order.
    result = record.map((item) => normalize(item, seen));
  } else {
    // Objects: keys sorted lexicographically at every level.
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = normalize((record as Record<string, unknown>)[key], seen);
    }
    result = out;
  }

  seen.delete(record); // allow shared (DAG) references, reject only true cycles
  return result;
}
```

Wait — `type !== 'object'` after handling all other types: the remaining type would be `undefined`. Actually, `typeof undefined === 'undefined'` and we haven't handled it. So the final check catches undefined with "Value of type undefined is not JSON-serializable". Good.

Hmm, one issue: `seen.delete(record)` after processing — we delete after processing children. In a DAG (same object referenced twice, not circular), the first traversal completes and removes it from `seen`, so the second traversal reprocesses it fine. In a cycle, the child traversal hits the parent which is still in `seen` (because we only delete after all children are done) → throws. Correct.

Edge case: what about objects with prototype properties? `Object.keys` only returns own enumerable string keys — matches JSON.stringify behavior. Good.

Edge case: `Object.keys(record).sort()` — lexicographic sort by default (UTF-16 code units). The plan says "sorted lexicographically". Default sort is fine.

Now, the try/catch around `JSON.stringify`: after normalization, can JSON.stringify still throw? All values are validated: null, string, boolean, finite number, arrays of normalized, objects with string keys → normalized values. JSON.stringify can't throw on those (no cycles since we built a fresh tree). But defensively wrapping is fine and cheap. Actually, hmm — is it "adding a feature"? No, it's just defensive. But could be seen as unnecessary. Keep it minimal but safe. Actually let me reconsider: since normalization guarantees serializability, the try/catch is dead code. But it guards against unforeseen edge cases (e.g., exotic objects with custom toString? No — we only use own keys and validated values). I think keeping the try/catch is defensible as a safety net to ensure the contract "throws CanonicalizationError for non-serializable input" always holds. I'll keep it.

Wait, one more consideration: the plan says `canonicalize` "throws CanonicalizationError for non-serializable input." And `hashContent` "returns SHA-256 hex of canonicalize(value)" — and the class doc says thrown from `canonicalize`/`hashContent`. Since hashContent delegates to canonicalize, it throws transitively. Good.

TypeScript strict mode: `record.map` — record is typed as `object`... I need to be careful. Let me restructure the types:

```ts
function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError('Non-finite numbers are not JSON-serializable');
      }
      return value;
    case 'bigint':
      throw new CanonicalizationError('BigInt values are not JSON-serializable');
    case 'function':
      throw new CanonicalizationError('Functions are not JSON-serializable');
    case 'symbol':
      throw new CanonicalizationError('Symbols are not JSON-serializable');
    case 'undefined':
      throw new CanonicalizationError('Undefined values are not JSON-serializable');
    case 'object':
      break;
  }

  const record = value as object;
  if (seen.has(record)) {
    throw new CanonicalizationError('Circular structure is not JSON-serializable');
  }
  seen.add(record);

  let result: unknown;
  if (Array.isArray(record)) {
    result = record.map((item) => normalize(item, seen));
  } else {
    const source = record as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalize(source[key], seen);
    }
    result = out;
  }

  seen.delete(record);
  return result;
}
```

After the switch, `value` is narrowed to `object`? In TS, after a switch on `typeof value` where all non-object cases return/throw, the remaining case is 'object'. TS narrowing: `value` was `unknown`; after the switch where all cases except 'object' exit, does TS narrow `value` to `object`? Actually, control-flow narrowing on `typeof` checks: after the switch, in the implicit fallthrough... hmm, TS does narrow through switch statements on typeof. If all cases except 'object' return/throw, then after the switch `value` is `object`. I think TS handles this. But to be safe, keep `const record = value as object;` — no wait, if TS has already narrowed to `object`, the cast is redundant but harmless. Actually, with `strict` and no implicit any issues... the cast is fine either way.

Hmm, one subtlety: `case 'object'` with no body and `break` — that's fine.

Also `Number.isFinite(value)` where value is narrowed to number — fine.

Now, file header comment: the plan says code and comments in English. Keep comments minimal and purposeful.

Should `canonicalize` handle top-level arrays? Yes, `normalize` handles arrays at any level including top. `JSON.stringify([1,2])` → "[1,2]". Good.

Should I include JSDoc referencing the canonical form definition? A brief comment is good. The plan's assumptions define it; a short doc comment in the file is appropriate (not "repeating" the plan — just documenting behavior).

One more thought on `hashContent` signature: `(value: unknown): string`. Yes.

Exports: exactly three named exports: `canonicalize`, `hashContent`, `CanonicalizationError`. No default export. The plan doesn't name any others.

Final check on strict TS:
- `seen: Set<object>` — passing objects (arrays and plain objects) is fine.
- `record.map((item) => normalize(item, seen))` — record is `object` narrowed by Array.isArray → `any[]`? Actually, `Array.isArray(record)` narrows `record` to `any[]`. `.map` returns `any[]`. Assigning to `result: unknown` is fine.

Let me also double-check the error message style: "developer-oriented English." Fine.

One question: should `CanonicalizationError` be constructible with details? The plan just says it extends Error. Keep it simple: constructor takes a message. Should I make the message parameter optional? No — always pass a message. Keep `constructor(message: string)`.

Also, should I set `this.name = 'CanonicalizationError'`? Yes, good practice and helps tests identify it (tests probably check `instanceof` or the name).

Final file:

```ts
import { createHash } from 'node:crypto';

/**
 * Raised when a value cannot be represented in canonical JSON form
 * (e.g. circular references, BigInts, non-finite numbers).
 */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Canonical JSON form of a structured value: object keys sorted
 * lexicographically at every level, arrays preserved in order, no
 * whitespace, UTF-8. Throws {@link CanonicalizationError} for values that
 * JSON cannot represent.
 */
export function canonicalize(value: unknown): string {
  const normalized = normalize(value, new Set<object>());
  try {
    return JSON.stringify(normalized);
  } catch (err) {
    throw new CanonicalizationError(
      `Value is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * SHA-256 hex digest of the canonical form of a structured value.
 */
export function hashContent(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Recursively rebuilds the value in canonical order, rejecting anything JSON
 * cannot represent. Shared (non-circular) references are allowed; true cycles
 * are not.
 */
function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError('Non-finite numbers are not JSON-serializable');
      }
      return value;
    case 'bigint':
      throw new CanonicalizationError('BigInt values are not JSON-serializable');
    case 'function':
      throw new CanonicalizationError('Functions are not JSON-serializable');
    case 'symbol':
      throw new CanonicalizationError('Symbols are not JSON-serializable');
    case 'undefined':
      throw new CanonicalizationError('Undefined values are not JSON-serializable');
    case 'object':
      break;
  }

  const record = value as object;
  if (seen.has(record)) {
    throw new CanonicalizationError('Circular structure is not JSON-serializable');
  }
  seen.add(record);

  let result: unknown;
  if (Array.isArray(record)) {
    // Arrays preserve order.
    result = record.map((item) => normalize(item, seen));
  } else {
    // Objects: keys sorted lexicographically at every level.
    const source = record as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalize(source[key], seen);
    }
    result = out;
  }

  // Drop only after children are done so shared references (DAGs) are
  // serialized again while true cycles still throw.
  seen.delete(record);
  return result;
}
```

Wait, after the switch where `case 'object': break;` and all other cases return/throw — does TS narrow `value` to `object` after the switch? Yes, TS narrows on typeof discriminants in switches; after the switch, the only remaining possibility is 'object'. Then `const record = value as object;` — actually, if it's already narrowed, the cast is unnecessary but legal. Hmm, is it? `value` is `object`, casting to `object` is fine.

Actually wait, there's a subtlety: in the switch, for `case 'string'` and `case 'boolean'` we return `value` — the type is string | boolean, assignable to unknown. Fine.

One more: `record.map((item) => normalize(item, seen))` — after `Array.isArray(record)`, record is narrowed to `any[]`. Fine.

Also, is `seen` typed as `Set<object>` and we pass `record` (object)? Fine.

Now, the try/catch around JSON.stringify: after normalization, all values are guaranteed serializable. The catch is defensive. Keep it — ensures the documented contract.

Hmm, actually one more consideration: should `canonicalize` throw on top-level `undefined`? Yes, "Undefined values are not JSON-serializable". JSON.stringify(undefined) returns `undefined` (not a string), so without our check the return type contract would break. Good to throw.

I think this file is complete and matches the plan exactly: three named exports, no extras. No ASSUMPTION comments needed — everything is resolvable from the plan (canonical form definition, SHA-256 hex, error class). The strictness about which values count as "non-serializable" is a judgment call but defensible; the plan's examples (circular refs) are covered. Should I add an ASSUMPTION comment for throwing on undefined/functions/NaN? The instructions say to mark only if a symbol is "truly missing from both the plan and references." The symbols aren't missing — the behavior boundary is a judgment call, not a missing symbol. I don't think an ASSUMPTION comment is needed. Hmm, but "non-serializable" could be read leniently (JSON.stringify semantics: silently drop functions/undefined, NaN→null). My strict reading changes behavior for those inputs. Is that "the most defensible reading"? For an integrity anchor, yes — silent data loss in a canonical hash is worse. And the plan's tests only pin down circular refs and determinism, so both readings pass. I'll go with strict without an ASSUMPTION comment since the plan's contract ("throw for non-serializable input") is implemented and the strictness is within that contract's scope.

Actually, let me reconsider once more whether to keep the try/catch. If a reviewer sees dead code... it's not strictly dead: `normalize` guarantees serializability, so the catch never fires. But it's a cheap invariant guard. Alternatively I could drop it and just `return JSON.stringify(normalized);`. Simpler = better, and "implement exactly what the plan specifies." The plan says canonicalize throws CanonicalizationError for non-serializable input — my normalize does all the throwing. The try/catch is belt-and-suspenders. I'll keep it; it makes the exported contract airtight regardless of how normalize evolves, and it's only 4 lines. Hmm...

Let me weigh: the discipline section says "do exactly what the task asks." The task (plan) says canonicalize throws CanonicalizationError for non-serializable input. Both versions satisfy that. The try/catch version is more robust. Keep it.

Final answer: one fenced block with the file contents, nothing else.
```

## reply

```typescript
import { createHash } from 'node:crypto';

/**
 * Raised when a value cannot be represented in canonical JSON form
 * (e.g. circular references, BigInts, non-finite numbers).
 */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Canonical JSON form of a structured value: object keys sorted
 * lexicographically at every level, arrays preserved in order, no
 * whitespace, UTF-8. Throws {@link CanonicalizationError} for values that
 * JSON cannot represent.
 */
export function canonicalize(value: unknown): string {
  const normalized = normalize(value, new Set<object>());
  try {
    return JSON.stringify(normalized);
  } catch (err) {
    throw new CanonicalizationError(
      `Value is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * SHA-256 hex digest of the canonical form of a structured value.
 */
export function hashContent(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Recursively rebuilds the value in canonical order, rejecting anything JSON
 * cannot represent. Shared (non-circular) references are allowed; true cycles
 * are not.
 */
function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError('Non-finite numbers are not JSON-serializable');
      }
      return value;
    case 'bigint':
      throw new CanonicalizationError('BigInt values are not JSON-serializable');
    case 'function':
      throw new CanonicalizationError('Functions are not JSON-serializable');
    case 'symbol':
      throw new CanonicalizationError('Symbols are not JSON-serializable');
    case 'undefined':
      throw new CanonicalizationError('Undefined values are not JSON-serializable');
    case 'object':
      break;
  }

  const record = value as object;
  if (seen.has(record)) {
    throw new CanonicalizationError('Circular structure is not JSON-serializable');
  }
  seen.add(record);

  let result: unknown;
  if (Array.isArray(record)) {
    // Arrays preserve order.
    result = record.map((item) => normalize(item, seen));
  } else {
    // Objects: keys sorted lexicographically at every level.
    const source = record as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalize(source[key], seen);
    }
    result = out;
  }

  // Drop only after children are done so shared references (DAGs) serialize
  // again while true cycles still throw.
  seen.delete(record);
  return result;
}
```
