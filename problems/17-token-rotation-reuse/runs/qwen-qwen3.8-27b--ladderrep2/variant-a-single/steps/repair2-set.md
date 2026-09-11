# repair2-set

## reasoning

```
Let me analyze the error:

```
test/auth.spec.ts(249,27): error TS2339: Property 'body' does not exist on type 'never'.
```

Looking at line 249 in the test file, I need to find what's there. Let me count through the file...

The file has a complex line around line 249. Let me look at the test that has the concurrent presentation:

```typescript
const rejected = [first, second].find((r): r is PromiseFulfilledResult<typeof first extends PromiseFulfilledResult<infer T> ? T : never> => r.status === 'fulfilled' && r.value.status === 401)!;
```

This is the problematic line. The type predicate `r is PromiseFulfilledResult<typeof first extends PromiseFulfilledResult<infer T> ? T : never>` is trying to be clever but it's not working.

The issue is that `typeof first extends PromiseFulfilledResult<infer T> ? T : never` — TypeScript is resolving this to `never` in this context.

Let me think about what `first` and `second` are. They come from `Promise.allSettled([...])` where the array elements are `Promise<Response>` (supertest responses). So `first` and `second` are `PromiseSettledResult<Response>`.

The type of `[first, second]` is `[PromiseSettledResult<Response>, PromiseSettledResult<Response>]`.

When we call `.find()` on this array, the parameter `r` is `PromiseSettledResult<Response>`.

The type predicate says `r is PromiseFulfilledResult<typeof first extends PromiseFulfilledResult<infer T> ? T : never>`.

`typeof first` is `PromiseSettledResult<Response>`. Does `PromiseSettledResult<Response> extends PromiseFulfilledResult<infer T>`? 

`PromiseSettledResult<Response>` is `PromiseFulfilledResult<Response> | PromiseRejectedResult`. A union type does not extend a single member of the union. So `PromiseSettledResult<Response> extends PromiseFulfilledResult<infer T>` is `false`, meaning the conditional resolves to `never`.

So the predicate becomes `r is PromiseFulfilledResult<never>`, which is nonsensical.

The fix: We need to properly type the find. The simplest fix is to just use a type assertion or a simpler type predicate.

The cleanest fix:

```typescript
const rejected = [first, second].find((r): r is PromiseFulfilledResult<import('supertest').Response> => r.status === 'fulfilled' && (r as PromiseFulfilledResult<import('supertest').Response>).value.status === 401)!;
```

Wait, but we can't use `import('supertest')` inline like that in a type predicate easily. Let me think differently.

Actually, the simplest approach: just cast or use a simpler pattern.

Looking at what we need: `rejected.value.body` should work. The type of `first` and `second` are `PromiseSettledResult<Response>` where `Response` is from supertest.

The simplest fix that TypeScript will accept:

```typescript
const rejected = [first, second].find((r) => r.status === 'fulfilled' && r.value.status === 401)! as PromiseFulfilledResult<import('supertest').Response>;
```

Wait, but `import('supertest').Response` — let me check. Supertest's response type is `Response` from `superagent`. In the supertest package, the response type is `superagent.Response`.

Actually, looking at the imports in the file:
```typescript
import request from 'supertest';
```

The return type of `request(app.getHttpServer()).post(...)` is `Promise<superagent.Response>`.

Let me look at what type the response actually is. In supertest, `request(...).post(...).send(...)` returns a `Request` which extends `Promise<Response>`. The `Response` here is `superagent.Response`.

So `first` and `second` are `PromiseSettledResult<superagent.Response>`.

The simplest fix:

```typescript
const rejected = [first, second].find((r) => r.status === 'fulfilled' && r.value.status === 401)! as { status: 'fulfilled'; value: superagent.Response };
```

But we'd need to import `superagent.Response` or just use a different approach.

Actually, the cleanest minimal fix: just remove the type predicate and use a different approach to narrow:

```typescript
const rejected = [first, second].find((r) => r.status === 'fulfilled' && r.value.status === 401)!;
```

Without the type predicate, `find` returns `PromiseSettledResult<Response> | undefined`. With `!`, it's `PromiseSettledResult<Response>`. But then `rejected.value` would error because `PromiseSettledResult` is a union and `value` only exists on the fulfilled variant.

Hmm. So we need some form of narrowing. Let me think...

Option 1: Use a type assertion after find:
```typescript
const rejected = [first, second].find((r) => r.status === 'fulfilled' && r.value.status === 401)! as PromiseFulfilledResult<Parameters<typeof setCookies>[0] extends { headers: infer H } ? H : never>;
```
No, that's getting too convoluted.

Option 2: Import the Response type:
```typescript
import type { Response } from 'superagent';
```
Then:
```typescript
const rejected = [first, second].find((r): r is PromiseFulfilledResult<Response> => r.status === 'fulfilled' && r.value.status === 401)!;
```

But wait, does the file already import from superagent? No. And the instructions say "Change exactly what the compiler requires" and "Do not add features".

Option 3: The simplest fix that works without adding imports:

Looking at the actual error: `Property 'body' does not exist on type 'never'`. This means `rejected.value` is typed as `never`.

The issue is the type predicate. Let me just simplify it. The type predicate `r is PromiseFulfilledResult<typeof first extends PromiseFulfilledResult<infer T> ? T : never>` resolves to `PromiseFulfilledResult<never>`.

The simplest fix: just remove the type predicate and use a non-predicate approach.

```typescript
const rejected = ([first, second].find((r) => r.status === 'fulfilled' && r.value.status === 401) ?? { status: 'fulfilled' as const, value: undefined! }).value;
```

No, that changes too much.

Actually, let me look at this more carefully. The `find` with a type predicate is the standard way. The problem is just the type in the predicate.

What is the actual type of the elements in `[first, second]`? They are `PromiseSettledResult<superagent.Response>`.

So the correct predicate should be:
```typescript
(r): r is PromiseFulfilledResult<superagent.Response> => ...
```

But we need to reference the type. Since `request` is imported from `supertest`, and supertest re-exports superagent's Response...

Actually, let me check: in supertest, the response type is available as `supertest.Response` or we can get it from the return type of `request`.

The simplest approach that requires minimal changes: just use a type assertion instead of a type predicate.

```typescript
const rejected = [first, second].find((r) => r.status === 'fulfilled' && r.value.status === 401)! as PromiseFulfilledResult<typeof first.value>;
```

Wait, `typeof first.value` — `first` is `PromiseSettledResult<Response>`, so `first.value` doesn't exist on the rejected variant... TypeScript would complain.

Hmm. Let me think about this differently.

What about:
```typescript
const rejected = [first, second].find((r): r is PromiseFulfilledResult<never> => false)!;
```
No, that's silly.

OK, the real issue: we need to reference the `Response` type from superagent. Let me check what's available.

In the test file, `request` is from `supertest`. The response type is `superagent.Response`. We can get it via:

```typescript
type Response = Awaited<ReturnType<typeof request>>;
```

Wait no, `request` is a function that returns a `SuperTest` which is callable and returns `Promise<Response>`. So `Awaited<ReturnType<ReturnType<typeof request>>>` might work but that's ugly.

Actually, the simplest approach: just use a variable to capture the type.

Or even simpler: the `find` without a type predicate, followed by a manual check:

```typescript
const results = [first, second];
const rejected = results.find((r) => r.status === 'fulfilled' && r.value.status === 401)!;
// rejected is PromiseSettledResult<Response> | undefined, with ! it's PromiseSettledResult<Response>
```

But then `rejected.value` still doesn't type-check because `PromiseSettledResult` is a union.

OK let me just go with the cleanest minimal fix. I'll extract the response type:

Looking at the file again, I see that the tests use `res.body`, `res.status` etc. on supertest responses. The type is `superagent.Response`.

The minimal fix: change the type predicate to use a proper type reference. Since we can't easily get the type without an import, the cleanest approach is:

```typescript
const rejected = [first, second].find((r): r is { status: 'fulfilled'; value: { status: number; body: unknown } } => r.status === 'fulfilled' && r.value.status === 401)!;
```

Hmm, but then `rejected.value.body` would be `unknown`, and the test does `expect(rejected.value.body).toEqual(REJECTION_BODY)` which should work with `unknown`.

Wait, let me re-read the test:

```typescript
const rejected = [first, second].find((r): r is PromiseFulfilledResult<typeof first extends PromiseFulfilledResult<infer T> ? T : never> => r.status === 'fulfilled' && r.value.status === 401)!;
expect(rejected.value.body).toEqual(REJECTION_BODY);
```

So `rejected.value.body` needs to be accessible. If I use `{ status: 'fulfilled'; value: { status: number; body: unknown } }`, then `rejected.value.body` is `unknown`, and `.toEqual(unknown)` should work fine with vitest.

Actually wait, let me reconsider. The problem statement says the error is:
```
test/auth.spec.ts(249,27): error TS2339: Property 'body' does not exist on type 'never'.
```

Line 249, column 27. Let me count more carefully through the file to find line 249.

Actually, I don't need to count exactly. The error is clear: `Property 'body' does not exist on type 'never'`. This is because the type predicate resolves the type to `never`, making `rejected.value` be `never`, and then `.body` on `never` gives this error.

The fix: replace the broken type predicate with one that works.

The cleanest minimal change: use a structural type in the predicate that matches what we actually access.

Let me write the fix:

```typescript
const rejected = [first, second].find((r): r is PromiseFulfilledResult<{ status: number; body: unknown }> => r.status === 'fulfilled' && r.value.status === 401)!;
```

This should work because:
1. `r` is `PromiseSettledResult<superagent.Response>`
2. We're checking if it's a `PromiseFulfilledResult<{ status: number; body: unknown }>`
3. A `PromiseFulfilledResult<superagent.Response>` IS assignable to `PromiseFulfilledResult<{ status: number; body: unknown }>` because `superagent.Response` has `status: number` and `body: any` (or similar)

Wait, actually for a type predicate, TypeScript checks if the predicate type is a valid narrowing of the element type. `PromiseFulfilledResult<{ status: number; body: unknown }>` needs to be a subtype of `PromiseSettledResult<superagent.Response>`. 

`PromiseFulfilledResult<{ status: number; body: unknown }>` is `{ status: 'fulfilled'; value: { status: number; body: unknown } }`.

Is this a subtype of `PromiseSettledResult<superagent.Response>` = `PromiseFulfilledResult<superagent.Response> | PromiseRejectedResult`?

For it to be a subtype of the union, it needs to be a subtype of at least one member. Is `{ status: 'fulfilled'; value: { status: number; body: unknown } }` a subtype of `{ status: 'fulfilled'; value: superagent.Response }`?

Only if `{ status: number; body: unknown }` is a supertype of `superagent.Response` (contravariant in the value position... no wait, it's covariant).

Actually, for `PromiseFulfilledResult<A>` to be a subtype of `PromiseFulfilledResult<B>`, we need `A` to be a subtype of `B`. So we need `{ status: number; body: unknown }` to be a subtype of `superagent.Response`. That's NOT true — `superagent.Response` has many more properties.

So this won't work as a type predicate either. TypeScript will reject it.

Hmm. Let me think about what TypeScript actually allows for type predicates. The rule is: the type in the predicate must be a "narrowing" of the parameter type. Specifically, it must be comparable to the parameter type.

Actually, I recall that TypeScript is more lenient with type predicates in some cases. Let me think about what actually compiles.

Actually, you know what, the simplest fix that will definitely work: just don't use a type predicate. Use a different pattern:

```typescript
const results = [first, second];
const rejectedIdx = results.findIndex((r) => r.status === 'fulfilled' && r.value.status === 401);
const rejected = results[rejectedIdx] as PromiseFulfilledResult<superagent.Response>;
```

But we'd need to import `superagent.Response`...

Or even simpler, just use a non-type-predicate find and then assert:

```typescript
const rejected = [first, second].find((r) => r.status === 'fulfilled' && r.value.status === 401)! as { status: 'fulfilled'; value: { status: number; body: Record<string, unknown> } };
```

This is a type assertion (not a predicate), so TypeScript allows any assertion as long as the types are "comparable" (one is assignable to the other, or they overlap). Actually, for `as`, TypeScript requires that the source type is assignable to the target type OR the target type is assignable to the source type (they must be "comparable").

Source: `PromiseSettledResult<superagent.Response>` (after `!` removes undefined)
Target: `{ status: 'fulfilled'; value: { status: number; body: Record<string, unknown> } }`

Is `PromiseSettledResult<superagent.Response>` comparable to `{ status: 'fulfilled'; value: { status: number; body: Record<string, unknown> } }`?

`PromiseSettledResult<superagent.Response>` = `PromiseFulfilledResult<superagent.Response> | PromiseRejectedResult`
= `{ status: 'fulfilled'; value: superagent.Response } | { status: 'rejected'; reason: any }`

Target: `{ status: 'fulfilled'; value: { status: number; body: Record<string, unknown> } }`

Is the target assignable to the source? Is `{ status: 'fulfilled'; value: { status: number; body: Record<string, unknown> } }` assignable to `{ status: 'fulfilled'; value: superagent.Response } | { status: 'rejected'; reason: any }`?

It would need to be assignable to at least one member. To be assignable to `{ status: 'fulfilled'; value: superagent.Response }`, we'd need `{ status: number; body: Record<string, unknown> }` to be assignable to `superagent.Response`. That's not true.

So the assertion might be rejected too. TypeScript's `as` requires comparability.

Hmm, what about double assertion? `as unknown as ...`? That always works but is ugly.

Actually, let me reconsider. What does `superagent.Response` look like? It's an interface with many properties. `body` is typically typed as `any` in superagent. So `{ status: number; body: unknown }` might actually be... no, the issue is the reverse direction.

OK, I think the cleanest solution that will definitely compile is:

1. Import the Response type from superagent (or use a type alias)
2. Use it in the type predicate

Let me check: can we do `import type { Response } from 'superagent'`? Yes, superagent exports `Response`.

But wait, the instructions say "Do not add features, do not rename anything the errors do not mention, do not reorganise." Adding an import is a change, but it's the minimal change needed to fix the type error.

Actually, let me reconsider the problem. The original code was:
```typescript
const rejected = [first, second].find((r): r is PromiseFulfilledResult<typeof first extends PromiseFulfilledResult<infer T> ? T : never> => r.status === 'fulfilled' && r.value.status === 401)!;
```

The intent was to extract the `Response` type from `first`. The problem is that `typeof first` is `PromiseSettledResult<Response>`, not `PromiseFulfilledResult<Response>`, so the conditional type fails.

The minimal fix: change the conditional to work with `PromiseSettledResult`:

```typescript
typeof first extends PromiseFulfilledResult<infer T> ? T : never
```

This doesn't work because `PromiseSettledResult<T>` doesn't extend `PromiseFulfilledResult<T>`.

What if we use:
```typescript
[first, second][number] extends PromiseFulfilledResult<infer T> ? T : never
```

Same problem.

What about:
```typescript
Extract<typeof first, PromiseFulfilledResult<never>> extends PromiseFulfilledResult<infer T> ? T : never
```

`Extract<PromiseSettledResult<Response>, PromiseFulfilledResult<never>>` — this extracts members of the union that are assignable to `PromiseFulfilledResult<never>`. `PromiseFulfilledResult<Response>` is not assignable to `PromiseFulfilledResult<never>` (since `Response` is not assignable to `never`). So this would be `never`, and then `never extends PromiseFulfilledResult<infer T> ? T : never` is `never`.

Hmm.

What about just extracting from the tuple type? The array `[first, second]` has type `[PromiseSettledResult<Response>, PromiseSettledResult<Response>]`. The `.find()` method on a tuple... actually in TypeScript, `.find()` on an array returns `T | undefined` where `T` is the element type.

OK I think the absolute simplest fix is to just use a type assertion with `as` after the find, without a type predicate:

```typescript
const rejected = ([first, second].find((r) => r.status === 'fulfilled' && r.value.status === 401) ?? { status: 'fulfilled' as const, value: undefined! }).value;
```

No wait, that changes the logic. The `!` at the end was asserting non-null.

Let me try yet another approach. What about:

```typescript
const rejected = [first, second].find((r) => r.status === 'fulfilled' && r.value.status === 401) as PromiseFulfilledResult<typeof first extends PromiseFulfilledResult<infer T> ? T : never> | undefined;
```

No, same issue with the conditional.

OK, I think the truly minimal fix is to just change the type predicate to use a structural type that's a proper narrowing. Let me check what TypeScript actually allows.

After more thought, I believe TypeScript does allow type predicates where the predicate type is a subtype of the parameter type. The parameter type is `PromiseSettledResult<Response>` (the element type of the array being searched). 

`PromiseFulfilledResult<Response>` IS a subtype of `PromiseSettledResult<Response>` (it's one member of the union). So `r is PromiseFulfilledResult<Response>` would be a valid predicate.

The problem is just getting `Response` into scope. Let me see...

Actually, I just realized: we can get the type from the array itself.

```typescript
type Settled = typeof first; // PromiseSettledResult<Response>
type Response = Extract<Settled, { status: 'fulfilled' }>['value'];
```

But adding a type alias is a bigger change.

The absolute minimal fix: just use `PromiseFulfilledResult` with the correct type. Since we can't easily name the Response type without an import, let me just add the import.

Wait, actually, I just realized there might be an even simpler approach. What if we just do:

```typescript
const rejected = [first, second].find((r) => r.status === 'fulfilled' && r.value.status === 401)!;
```

Without a type predicate, `find` returns `PromiseSettledResult<Response> | undefined`. With `!`, it's `PromiseSettledResult<Response>`. Then `rejected.value` — does this work?

`PromiseSettledResult<Response>` is `PromiseFulfilledResult<Response> | PromiseRejectedResult`. Accessing `.value` on this union would fail because `PromiseRejectedResult` doesn't have `.value`.

So we still need narrowing. But the `.find()` already narrows at runtime. The issue is just the type.

What if we use a different pattern:

```typescript
const [a, b] = [first, second];
const rejected = (a.status === 'fulfilled' && a.value.status === 401 ? a : b.status === 'fulfilled' && b.value.status === 401 ? b : null)!;
```

This is ugly and changes the code significantly.

I think the cleanest minimal fix is to add a type import. Let me check if `superagent` is a dependency that's available. Since `supertest` is imported and supertest depends on superagent, it should be available.

Actually, wait. Let me look at this from a different angle. What if we just use:

```typescript
const rejected = [first, second].find((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value.status === 401)!;
```

`PromiseFulfilledResult<any>` is `{ status: 'fulfilled'; value: any }`. Is this a valid narrowing of `PromiseSettledResult<Response>`? 

`PromiseSettledResult<Response>` = `{ status: 'fulfilled'; value: Response } | { status: 'rejected'; reason: any }`

Is `{ status: 'fulfilled'; value: any }` a subtype of this union? It's a subtype of `{ status: 'fulfilled'; value: Response }` because `any` is assignable to `Response`. Yes! So this should work as a type predicate.

And then `rejected.value` would be `any`, so `rejected.value.body` would be `any`, and `expect(rejected.value.body).toEqual(REJECTION_BODY)` would work fine.

But using `any` might not be ideal. However, it's the minimal change that fixes the error without adding imports.

Actually, even better: since the only thing we access is `.body` and `.status`, and the test just does `expect(rejected.value.body).toEqual(REJECTION_BODY)`, using `any` for the value type is perfectly fine and is the minimal fix.

So the fix is to change:
```typescript
(r): r is PromiseFulfilledResult<typeof first extends PromiseFulfilledResult<infer T> ? T : never> => r.status === 'fulfilled' && r.value.status === 401
```

to:
```typescript
(r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value.status === 401
```

Wait, but will TypeScript complain about using `any` in strict mode? No, `any` is always allowed in strict mode. It's just that you can't implicitly create `any`. Explicit `any` is fine.

Actually, let me double-check: is `PromiseFulfilledResult<any>` a valid narrowing of `PromiseSettledResult<superagent.Response>`?

For a type predicate `r is T` to be valid, `T` must be a subtype of the type of `r` (or more precisely, they must be comparable). 

`PromiseFulfilledResult<any>` = `{ status: 'fulfilled'; value: any }`
Type of `r` = `PromiseSettledResult<superagent.Response>` = `{ status: 'fulfilled'; value: superagent.Response } | { status: 'rejected'; reason: any }`

Is `{ status: 'fulfilled'; value: any }` assignable to `{ status: 'fulfilled'; value: superagent.Response } | { status: 'rejected'; reason: any }`?

It's assignable to `{ status: 'fulfilled'; value: superagent.Response }` because `any` is assignable to `superagent.Response`. Yes!

So the predicate is valid. 

Let me write the complete file with just this one-line change.

Actually wait, I need to be more careful. Let me re-read the constraint: "Change exactly what the compiler requires." and "Do not add features, do not rename anything the errors do not mention, do not reorganise."

The change is: replacing the broken type expression `typeof first extends PromiseFulfilledResult<infer T> ? T : never` with `any`. This is the minimal change to fix the type error.

Let me now write out the complete file with this fix applied.
```

## reply

Looking at the error, there's exactly **one distinct mistake**: the type predicate on line 249 uses `typeof first extends PromiseFulfilledResult<infer T> ? T : never`, but `typeof first` is `PromiseSettledResult<Response>` (a union), which does not extend `PromiseFulfilledResult<infer T>`, so the conditional collapses to `never`. The fix is to replace the broken conditional with `any`, which is a valid narrowing and allows `.body` access.

### test/auth.spec.ts
```ts
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { ACCESS_TOKEN_ISSUER, AuthService, CLOCK } from '../src/auth/auth.service.js';
import { ErrorEnvelopeFilter } from '../src/common/error-envelope.js';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const junkToken = (): string => randomBytes(32).toString('base64url');

const REJECTION_BODY = {
  error: { code: 'invalid_refresh_token', message: 'The refresh token could not be used.', details: {} },
};

// A clock the tests can advance, so deadline behaviour is deterministic.
function makeClock() {
  let current = new Date();
  return {
    now: (): Date => current,
    advance: (ms: number): void => {
      current = new Date(current.getTime() + ms);
    },
  };
}

interface FakeToken {
  id: string;
  tokenHash: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  retiredAt: Date | null;
  revokedAt: Date | null;
  replacedById: string | null;
  createdAt: Date;
}

interface FakeFamily {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface FakeEvent {
  id: string;
  kind: string;
  reason: string | null;
  userId: string | null;
  familyId: string | null;
  tokenId: string | null;
  source: string | null;
  details: Record<string, unknown>;
  occurredAt: Date;
}

/**
 * Emulates the AuthRepository contract. rotate() mirrors the real
 * repository's single conditional UPDATE: the check ("still live?") and the
 * set happen in one synchronous step, so two racing callers cannot both
 * observe "still live" — the same serialisation the database row lock
 * provides. The final describe block exercises the real repository against
 * Postgres for the same scenario.
 */
class FakeRefreshRepository {
  readonly tokens = new Map<string, FakeToken>();
  readonly families = new Map<string, FakeFamily>();
  readonly events: FakeEvent[] = [];

  constructor(private readonly now: () => Date) {}

  findByHash(tokenHash: string): Promise<FakeToken | null> {
    for (const token of this.tokens.values()) {
      if (token.tokenHash === tokenHash) return Promise.resolve({ ...token });
    }
    return Promise.resolve(null);
  }

  findById(id: string): Promise<FakeToken | null> {
    const token = this.tokens.get(id);
    return Promise.resolve(token ? { ...token } : null);
  }

  async rotate(input: {
    presentedId: string;
    issued: Omit<FakeToken, 'retiredAt' | 'revokedAt' | 'replacedById'>;
  }): Promise<{ status: 'rotated'; issuedId: string } | { status: 'lost' }> {
    const at = this.now();
    const token = this.tokens.get(input.presentedId);
    if (
      token === undefined ||
      token.retiredAt !== null ||
      token.revokedAt !== null ||
      token.expiresAt.getTime() <= at.getTime()
    ) {
      return { status: 'lost' };
    }
    token.retiredAt = at;
    token.replacedById = input.issued.id;
    const issued: FakeToken = { ...input.issued, retiredAt: null, revokedAt: null, replacedById: null };
    this.tokens.set(issued.id, issued);
    for (const other of this.tokens.values()) {
      if (other.familyId === issued.familyId && other.id !== issued.id && other.retiredAt === null && other.revokedAt === null) {
        other.retiredAt = at;
      }
    }
    return { status: 'rotated', issuedId: issued.id };
  }

  async revokeFamily(familyId: string, at: Date): Promise<{ newlyRevokedTokens: number; familyAlreadyRevoked: boolean }> {
    let newlyRevokedTokens = 0;
    for (const token of this.tokens.values()) {
      if (token.familyId === familyId && token.revokedAt === null) {
        token.revokedAt = at;
        newlyRevokedTokens += 1;
      }
    }
    const family = this.families.get(familyId);
    const familyAlreadyRevoked = family !== undefined && family.revokedAt !== null;
    if (family !== undefined && family.revokedAt === null) family.revokedAt = at;
    return { newlyRevokedTokens, familyAlreadyRevoked };
  }

  async createSession(input: {
    family: Omit<FakeFamily, 'revokedAt'>;
    token: Omit<FakeToken, 'retiredAt' | 'revokedAt' | 'replacedById'>;
  }): Promise<void> {
    this.families.set(input.family.id, { ...input.family, revokedAt: null });
    this.tokens.set(input.token.id, { ...input.token, retiredAt: null, revokedAt: null, replacedById: null });
  }

  async recordEvent(event: FakeEvent): Promise<void> {
    this.events.push(event);
  }

  tokenByHash(plaintext: string): FakeToken | undefined {
    for (const token of this.tokens.values()) {
      if (token.tokenHash === sha256(plaintext)) return token;
    }
    return undefined;
  }
}

async function buildApp(fake: FakeRefreshRepository, now: () => Date): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      AuthService,
      { provide: AuthRepository, useValue: fake },
      { provide: ACCESS_TOKEN_ISSUER, useValue: { issueAccessToken: (userId: string): string => `access:${userId}` } },
      { provide: CLOCK, useValue: now },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.init();
  return app;
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const header = res.headers['set-cookie'];
  if (header === undefined) return [];
  return Array.isArray(header) ? (header as string[]) : [String(header)];
}

describe('POST /auth/refresh', () => {
  let app: INestApplication;
  let fake: FakeRefreshRepository;
  let clock: ReturnType<typeof makeClock>;
  let service: AuthService;

  beforeEach(async () => {
    clock = makeClock();
    fake = new FakeRefreshRepository(clock.now);
    app = await buildApp(fake, clock.now);
    service = app.get(AuthService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rotates a presented token: retires it and issues a new pair with the same absolute deadline', async () => {
    const session = await service.startSession('user-1', 3_600_000);
    const res = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'refreshToken']);
    expect(res.body.accessToken).toBe('access:user-1');
    expect(res.body.refreshToken).not.toBe(session.refreshToken);

    expect(fake.tokenByHash(session.refreshToken)?.retiredAt).not.toBeNull();
    const fresh = fake.tokenByHash(res.body.refreshToken);
    expect(fresh).toBeDefined();
    expect(fresh?.expiresAt.getTime()).toBe(session.sessionExpiresAt.getTime());
    expect(fake.events.some((e) => e.kind === 'refresh_success')).toBe(true);
  });

  it('accepts the token from the refresh_token cookie and refreshes the cookie in the response', async () => {
    const session = await service.startSession('user-2', 3_600_000);
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${session.refreshToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith('refresh_token=') && c.includes('HttpOnly'))).toBe(true);
  });

  it('lets the body win over the cookie when both are present, and clears a stale cookie', async () => {
    const a = await service.startSession('user-a', 3_600_000);
    const b = await service.startSession('user-b', 3_600_000);
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${b.refreshToken}`)
      .send({ refreshToken: a.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('access:user-a'); // the body's session rotated
    expect(fake.tokenByHash(a.refreshToken)?.retiredAt).not.toBeNull();
    expect(fake.tokenByHash(b.refreshToken)?.retiredAt).toBeNull(); // other family untouched

    const cookies = setCookies(res);
    expect(cookies.some((c) => c.includes('refresh_token=;') || c.includes('Max-Age=0'))).toBe(true);
    expect(cookies.some((c) => c.includes(`refresh_token=${b.refreshToken}`))).toBe(false);
  });

  it('lets exactly one of two concurrent refreshes of one token rotate; the loser is a reuse that kills the family', async () => {
    const session = await service.startSession('user-race', 3_600_000);
    // Genuinely concurrent: both requests are in flight before either settles.
    const [first, second] = await Promise.allSettled([
      request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: session.refreshToken }),
      request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: session.refreshToken }),
    ]);

    const statuses = [first, second].map((r) => (r.status === 'fulfilled' ? r.value.status : 0)).sort();
    expect(statuses).toEqual([200, 401]);

    const rejected = [first, second].find((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value.status === 401)!;
    expect(rejected.value.body).toEqual(REJECTION_BODY);

    const original = fake.tokenByHash(session.refreshToken)!;
    const familyRows = [...fake.tokens.values()].filter((t) => t.familyId === original.familyId);
    expect(familyRows.length).toBe(2); // the original and the winner's successor
    expect(original.retiredAt).not.toBeNull();
    const successor = familyRows.find((t) => t.id !== original.id)!;
    expect(successor.revokedAt).not.toBeNull(); // the winner's new token was invalidated
    expect(fake.families.get(original.familyId)?.revokedAt).not.toBeNull();

    const reuse = fake.events.find((e) => e.kind === 'refresh_rejected' && e.reason === 'reuse');
    expect(reuse).toBeDefined();
    expect(reuse!.details.context).toBe('race');
    expect(fake.events.filter((e) => e.kind === 'refresh_success').length).toBe(1);
  });

  it('replaying a retired token invalidates every descendant of the family', async () => {
    const s0 = await service.startSession('user-replay', 3_600_000);
    const s1 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });
    const s2 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s1.body.refreshToken });
    expect([s1.status, s2.status]).toEqual([200, 200]);

    const replay = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION_BODY);

    const familyId = fake.tokenByHash(s0.refreshToken)!.familyId;
    expect(fake.tokenByHash(s2.body.refreshToken)!.revokedAt).not.toBeNull(); // the live descendant died
    expect(fake.families.get(familyId)?.revokedAt).not.toBeNull();

    // Presenting the (now revoked) descendant is another reuse event.
    const again = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s2.body.refreshToken });
    expect(again.status).toBe(401);
    const reuseEvents = fake.events.filter((e) => e.kind === 'refresh_rejected' && e.reason === 'reuse');
    expect(reuseEvents.length).toBe(2);
    expect(reuseEvents[1].details.tokenState).toBe('revoked');
  });

  it('never extends the absolute deadline fixed at sign-in', async () => {
    const session = await service.startSession('user-deadline', 1000);
    const r1 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(r1.status).toBe(200);
    expect(fake.tokenByHash(r1.body.refreshToken)!.expiresAt.getTime()).toBe(session.sessionExpiresAt.getTime());

    clock.advance(999);
    const r2 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(200); // 1ms before the deadline: still valid

    clock.advance(1); // exactly at the deadline: the session is over
    const r3 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: r2.body.refreshToken });
    expect(r3.status).toBe(401);
    expect(fake.events.some((e) => e.kind === 'refresh_rejected' && e.reason === 'expired')).toBe(true);
  });

  it('returns a byte-identical 401 envelope for malformed, unknown, expired and retired tokens; only the audit log differs', async () => {
    const s0 = await service.startSession('user-401', 1000);
    const s1 = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });
    expect(s1.status).toBe(200);
    clock.advance(1000); // the absolute deadline has now passed

    const malformed = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: 'too-short' });
    const missing = await request(app.getHttpServer()).post('/auth/refresh').send({});
    const unknown = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: junkToken() });
    const expired = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s1.body.refreshToken });
    const retired = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });

    for (const res of [malformed, missing, unknown, expired, retired]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(REJECTION_BODY);
      expect(JSON.stringify(res.body)).toBe(JSON.stringify(REJECTION_BODY));
    }

    // The audit record distinguishes all of them.
    const reasons = fake.events.filter((e) => e.kind === 'refresh_rejected').map((e) => e.reason);
    expect(reasons).toEqual(['malformed', 'malformed', 'unknown', 'expired', 'reuse']);
  });

  it('records a token that is both retired and expired as reuse, not as expiry', async () => {
    const s0 = await service.startSession('user-both', 1000);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });
    clock.advance(1000);

    const res = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: s0.refreshToken });
    expect(res.status).toBe(401);

    const rejected = fake.events.filter((e) => e.kind === 'refresh_rejected');
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBe('reuse');
    expect(rejected[0].details.context).toBe('replay');
    expect(fake.families.get(fake.tokenByHash(s0.refreshToken)!.familyId)?.revokedAt).not.toBeNull();
  });
});

describe.runIf(!!process.env.DATABASE_URL)('rotation against real Postgres (requires DATABASE_URL)', () => {
  const MIGRATION_SQL_PATH = 'prisma/migrations/20250612000000_init_refresh_rotation/migration.sql';
  let prisma: PrismaClient;
  let service: AuthService;

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await prisma.$executeRawUnsafe(
      `DROP TABLE IF EXISTS "refresh_tokens", "refresh_token_families", "security_events" CASCADE`,
    );
    const migration = readFileSync(MIGRATION_SQL_PATH, 'utf8');
    for (const statement of migration.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
      await prisma.$executeRawUnsafe(`${statement};`);
    }
    const clock = makeClock();
    const repository = new AuthRepository(prisma);
    service = new AuthService(repository, { issueAccessToken: (userId: string): string => `access:${userId}` }, clock.now);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('serialises two truly concurrent rotations of one token; the loser is reuse and the family is invalidated', async () => {
    const session = await service.startSession('user-db', 3_600_000);
    const [first, second] = await Promise.allSettled([
      service.refresh(session.refreshToken, 'body'),
      service.refresh(session.refreshToken, 'body'),
    ]);
    expect([first, second].filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect([first, second].filter((r) => r.status === 'rejected').length).toBe(1);

    const original = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(session.refreshToken) } });
    expect(original).not.toBeNull();

    const rows = await prisma.refreshToken.findMany({ where: { familyId: original!.familyId } });
    expect(rows.length).toBe(2);
    expect(rows.filter((t) => t.retiredAt !== null).length).toBe(1);
    expect(rows.filter((t) => t.revokedAt !== null).length).toBe(2); // the winner's new token died too

    const family = await prisma.refreshTokenFamily.findUnique({ where: { id: original!.familyId } });
    expect(family?.revokedAt).not.toBeNull();

    const reuse = await prisma.securityEvent.findFirst({ where: { kind: 'refresh_rejected', reason: 'reuse' } });
    expect(reuse).not.toBeNull();
    expect(reuse?.details).toMatchObject({ context: 'race', tokenState: 'retired' });
  });
});
```
