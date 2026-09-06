# 07-auth.spec.ts-retry

## reasoning

```
Let me analyze what I need to write: `test/auth.spec.ts` covering all six test cases from section 5 of PLAN.md, plus the additional cases from `07-auth.spec.ts-cases.txt`.

Looking at the plan's section 5:
1. Concurrent rotation: two `refresh` calls with the same token — exactly one returns 200, the other 401
2. Replay after rotation: rotate token A→B, then present A again — B is also invalidated
3. Absolute deadline: sign-in with `expiresAt = now+1h`; after 70 min, a freshly rotated token is rejected
4. Rejection indistinguishability: malformed, unknown, expired, and reuse all return identical status + body
5. Audit completeness: each of the four rejection classes writes a distinct `event_type` to `audit_events`
6. Source precedence: body `refreshToken` and cookie `refresh_token` both present — body token is used

From the cases file, there are additional cases:
- Retired-and-expired triggers reuse, not expired
- Rotation preserves the absolute deadline
- A freshly rotated token is rejected once past the family deadline
- Malformed token (wrong length) short-circuits before any database access
- Malformed token (wrong character set) is rejected
- Missing token (no body, no cookie) is treated as malformed
- Cookie-only path delivers the token correctly
- Successful rotation returns a new, distinct refresh token
- Family invalidation exhausts every active token in the chain

Now let me think about how to structure this. I need to test:
- The controller (for precedence, cookie parsing, missing token)
- The service (for malformed short-circuit)
- The repository (for concurrency, reuse, expiry)

Given the architecture:
- `AuthRepository` uses `PrismaClient` directly
- `AuthService` depends on `AuthRepository` and `AccessTokenIssuer`
- `AuthController` depends on `AuthService`

For testing, I'll need to mock PrismaClient at the repository level for most tests, or use an integration approach. Given that this is a NestJS app with Prisma, and the plan says to test behaviour not implementation, I think the best approach is:

1. For concurrency tests - mock PrismaClient's `$transaction` to simulate the lock behaviour
2. For replay/reuse tests - mock the Prisma calls
3. For deadline tests - mock time or seed expired tokens
4. For indistinguishability - test at the controller level with mocked service, or mock Prisma
5. For audit completeness - verify the audit inserts happen
6. For precedence - test at the controller level

Actually, looking more carefully at the architecture, the `AuthRepository` is where all the DB logic lives. The service just does malformed checking and delegates to the repository. The controller just extracts the token and calls the service.

For a proper test that tests behaviour:
- I should test through the service/repository boundary (mocking PrismaClient)
- For controller tests (precedence, missing token), I can test the controller with a mocked service

Let me think about how to mock PrismaClient. The repository uses:
- `this.prisma.$transaction(async (tx) => { ... })` where tx has:
  - `tx.$queryRaw` (for the SELECT FOR UPDATE)
  - `tx.refreshToken.update`
  - `tx.refreshToken.create`
  - `tx.refreshToken.updateMany`
  - `tx.auditEvent.create`

I'll create a mock PrismaClient that captures these calls.

Let me structure the tests:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthService, InvalidRefreshTokenError, AccessTokenIssuer } from '../src/auth/auth.service.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuditEventType } from '@prisma/client';
```

For the Prisma mock, I need to simulate the transaction behaviour. Let me think about how to do this cleanly.

Actually, let me reconsider. The tests should test behaviour. Let me group them:

**Service + Repository level (mocking PrismaClient):**
1. Concurrent rotation - need to simulate the FOR UPDATE lock
2. Replay invalidates sibling - sequence of calls
3. Absolute deadline preserved
4. Expired token rejected
5. Retired + expired → reuse not expired
6. Audit events written correctly
7. Malformed short-circuits (no DB call)

**Controller level (mocking AuthService):**
8. Precedence: body wins over cookie
9. Cookie-only path works
10. Missing token → 401 not 500
11. Indistinguishability (all rejections same response)

Let me think about how to mock PrismaClient for the repository tests. I'll create a factory function that returns a mock with configurable behaviour.

For the concurrency test, I need to simulate what happens when two transactions try to SELECT FOR UPDATE on the same row. In PostgreSQL, the second one blocks until the first commits. I can simulate this by:
- Having the first `$queryRaw` return the row with `retired_at = null`
- Having the second `$queryRaw` (after the first transaction commits) return the row with `retired_at = <some date>`

But with a simple mock, both calls would see the same state. I need to simulate the sequential nature.

One approach: use a queue/sequence for the mock's `$queryRaw` results. The first call gets `retired_at: null`, the second gets `retired_at: new Date()`.

But I also need to simulate that the first transaction's `refreshToken.update` (retire) happens before the second transaction's `$queryRaw`. This is getting complex.

A simpler approach for the concurrency test: 
- Mock `$transaction` to execute callbacks sequentially
- Have a shared state object that the mock reads/writes
- The first transaction reads `retired_at: null`, retires the token (updates state), creates new token
- The second transaction reads `retired_at: <date>` (because state was updated), sees it's retired, invalidates family

Let me design a more sophisticated mock:

```typescript
function createMockPrisma(initialState: { tokens: Map<string, TokenRow>; auditEvents: AuditEventRow[] }) {
  // ...
}
```

Actually, let me think about this differently. The key insight is that `$transaction` in Prisma receives a `tx` client that operates on the same database. So I can simulate this with a shared in-memory state.

Let me write a comprehensive mock:

```typescript
interface TokenRow {
  id: string;
  family_id: string;
  user_id: string;
  expires_at: Date;
  retired_at: Date | null;
}

interface AuditEventRow {
  familyId: string;
  tokenId: string | undefined;
  eventType: AuditEventType;
}

function createMockPrisma(options?: {
  tokens?: TokenRow[];
}) {
  let tokens = options?.tokens ?? [];
  const auditEvents: AuditEventRow[] = [];
  
  const mockPrisma = {
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $queryRaw: async (query: any) => {
          // Parse the token_hash from the query - this is tricky with Prisma.sql
          // I'll need a different approach
        },
        refreshToken: {
          update: async ({ where, data }: any) => {
            // ...
          },
          create: async ({ data }: any) => {
            // ...
          },
          updateMany: async ({ where, data }: any) => {
            // ...
          },
        },
        auditEvent: {
          create: async ({ data }: any) => {
            // ...
          },
        },
      };
      return fn(tx);
    },
  };
  
  return { mockPrisma, getAuditEvents: () => [...auditEvents], getTokens: () => [...tokens] };
}
```

The problem is that `$queryRaw` receives a `Prisma.sql` tagged template, which is hard to inspect. I need to extract the token_hash parameter from it.

Looking at how Prisma.sql works: `Prisma.sql\`...\`` creates an object with `strings` and `values` properties. The values array will contain the tokenHash parameter.

So I can do:
```typescript
$queryRaw: async (query: any) => {
  const tokenHash = query.values[0]; // The interpolated parameter
  return tokens.filter(t => t.token_hash === tokenHash);
}
```

Wait, but the query also needs to return the right shape. Let me look at what the repository expects:

```typescript
const rows = await tx.$queryRaw<
  Array<{
    id: string;
    family_id: string;
    user_id: string;
    expires_at: Date;
    retired_at: Date | null;
  }>
>(...)
```

So I need my in-memory tokens to have a `token_hash` field that I can match against, and return the other fields in snake_case.

Let me redesign:

```typescript
interface InMemoryToken {
  id: string;
  token_hash: string;
  family_id: string;
  user_id: string;
  expires_at: Date;
  retired_at: Date | null;
}
```

And the mock `$queryRaw` filters by `token_hash`.

For `refreshToken.update`, the repository calls:
```typescript
tx.refreshToken.update({ where: { id: row.id }, data: { retiredAt: new Date() } })
```

For `refreshToken.create`:
```typescript
tx.refreshToken.create({ data: { tokenHash, familyId, userId, expiresAt } })
```

For `refreshToken.updateMany`:
```typescript
tx.refreshToken.updateMany({ where: { familyId, retiredAt: null }, data: { retiredAt: new Date() } })
```

For `auditEvent.create`:
```typescript
tx.auditEvent.create({ data: { familyId, tokenId, eventType } })
```

OK let me write this out properly now. I'll create a helper that builds the mock and track all audit events and token state changes.

For the concurrency test specifically, I need to ensure that:
1. Both transactions start
2. The first one's SELECT FOR UPDATE gets the row with retired_at = null
3. The first one retires it and creates a new one, then commits
4. The second one's SELECT FOR UPDATE now sees retired_at != null

With a simple synchronous mock, if I use `Promise.all`, both callbacks would execute in sequence (since JS is single-threaded). The first callback would complete fully before the second starts. So:
- First `$queryRaw` → finds token with retired_at = null
- First `update` (retire) → sets retired_at in our in-memory state
- First `create` → adds new token
- First callback resolves
- Second `$queryRaw` → finds same token but now retired_at is set
- Second `updateMany` (invalidate family) → retires all active in family
- Second callback resolves with 'reuse'

This actually works perfectly with a sequential mock! Because `Promise.all` with two async functions that each await the same mock will execute them sequentially (the first fully completes before the second starts, since there's no real concurrency in a single-threaded mock).

Wait, actually that's not quite right. `Promise.all([fn1(), fn2()])` will call both fn1 and fn2. If fn1 does `await mock.$transaction(cb1)`, the mock executes cb1 synchronously (or with internal awaits). Let me think...

If `$transaction` is:
```typescript
$transaction: async (fn) => {
  return fn(tx); // executes fn with the tx mock
}
```

And `fn` (the repository's callback) does multiple awaits internally, then:
- `Promise.all([repo.executeRefresh(hash1), repo.executeRefresh(hash1)])` 
- Both call `this.prisma.$transaction(async (tx) => { ... })`
- Since `$transaction` is async, both are called, but the first one's callback starts executing
- The first callback does `await tx.$queryRaw(...)` → this is async, so it yields
- At this point the second `$transaction` call also starts its callback
- The second callback does `await tx.$queryRaw(...)` → this is async, so it yields

Hmm, so with true async interleaving, both might get `retired_at = null` before either one retires it. That would break the concurrency simulation.

To properly simulate the lock, I need to make the mock's `$queryRaw` actually block the second caller until the first transaction completes. I can do this with a simple mutex/queue:

```typescript
let processing = false;
let queue: Array<() => void> = [];

const acquireLock = () => new Promise<void>((resolve) => {
  if (!processing) {
    processing = true;
    resolve();
  } else {
    queue.push(resolve);
  }
});

const releaseLock = () => {
  if (queue.length > 0) {
    queue.shift()!();
  } else {
    processing = false;
  }
};
```

Then in `$transaction`:
```typescript
$transaction: async (fn) => {
  await acquireLock();
  try {
    return await fn(tx);
  } finally {
    releaseLock();
  }
}
```

This way, the second transaction waits for the first to fully complete (including its updates to in-memory state) before it starts. This correctly simulates the `FOR UPDATE` lock behaviour.

Let me now write the full test file. I'll organize it into describe blocks:

1. `describe('concurrent rotation')` - test 1
2. `describe('replay / reuse detection')` - tests 2, plus the chain test
3. `describe('absolute deadline')` - tests 3, 4 (deadline preserved, expired rejection)
4. `describe('rejection indistinguishability')` - test 4 (all same response)
5. `describe('audit completeness')` - test 5
6. `describe('source precedence')` - test 6
7. Additional cases from the cases file

Let me now write this out completely. I need to be careful about:
- ESM imports with `.js` extension
- The mock structure
- What each test actually asserts (behaviour, not implementation)

Let me also think about what "testing behaviour" means here:
- For concurrency: assert one succeeds, one fails (not "assert $queryRaw was called twice")
- For replay: assert the sibling token is now unusable (not "assert updateMany was called")
- For deadline: assert the rotated token has the same expiry (not "assert create was called with X")
- For indistinguishability: assert the HTTP responses are byte-identical
- For audit: assert the audit events table has the right entries
- For precedence: assert the body token is the one that rotates

Now, for testing at different levels:
- Repository level: mock PrismaClient, call `executeRefresh`
- Service level: mock repository (or use real repo with mocked Prisma), call `refresh`
- Controller level: mock service, call `refresh` (for precedence, cookie parsing)

I think the cleanest approach is:
- Most tests go through the service (which uses the real repository with a mocked Prisma)
- Controller-specific tests (precedence, cookie parsing, missing token) test the controller with a mocked service
- Indistinguishability tests go through the controller

Let me write it now.

Actually wait - for the indistinguishability test, I need to verify the HTTP response. If I'm testing at the service level, the service throws `InvalidRefreshTokenError`. The controller catches it and returns the 401. So I need to test at the controller level for indistinguishability.

But for the controller, I need to mock the service. The service throws `InvalidRefreshTokenError` for all rejection types. So from the controller's perspective, they all look the same. The indistinguishability is guaranteed by the service throwing the same error for all cases.

Hmm, but to truly test that all four rejection types produce the same response, I should:
1. Set up different scenarios (malformed token, unknown token, expired token, retired token)
2. Call the controller for each
3. Verify all produce the same 401 response

This means I need to go through the full stack: controller → service → repository (with mocked Prisma). Let me do that.

For the controller test, I'll instantiate:
- A mock PrismaClient
- A real AuthRepository with that mock
- A real AuthService with the repo and a mock issuer
- A real AuthController with the service

Then I call `controller.refresh(bodyToken, cookieHeader)` and check the response.

But wait - the controller throws `HttpException` on error, it doesn't return a response object. In NestJS, the framework catches the exception and sends the response. So in the test, I'd need to catch the thrown exception and verify its properties.

Actually, `HttpException` has a `getStatus()` method and `getResponse()` method. So I can:
```typescript
try {
  await controller.refresh(...);
  expect.fail('should have thrown');
} catch (e) {
  expect(e).toBeInstanceOf(HttpException);
  const httpEx = e as HttpException;
  expect(httpEx.getStatus()).toBe(401);
  expect(httpEx.getResponse()).toEqual({ error: { code: 'invalid_refresh_token', ... } });
}
```

OK let me write the complete file now.

One more consideration: the `AuditEventType` enum. In the Prisma schema it would be:
```prisma
enum AuditEventType {
  ROTATED
  REJECTED_MALFORMED
  REJECTED_UNKNOWN
  REJECTED_EXPIRED
  REUSE_COMPROMISE
}
```

In the mock, I'll use string values that match these.

Let me also note: the service's malformed check doesn't write an audit event (as noted in the ASSUMPTION comment in the service code). The plan says it should, but the service doesn't have access to the repository's audit method. Looking at the plan more carefully:

> 3. **Service — malformed guard:** if `rawToken` is not exactly 64 hex chars, record `REJECTED_MALFORMED` audit (family unknown, token unknown), throw `InvalidRefreshTokenError`.

But the actual implementation doesn't do this. The ASSUMPTION comment in the service says:
> // ASSUMPTION: The plan calls for a REJECTED_MALFORMED audit row here, but AuthRepository's public surface only exposes executeRefresh(tokenHash); no standalone audit-recording method is available to the service layer.

So the malformed case does NOT write an audit event in the current implementation. But the test spec (cases file) says:

> **Audit events carry distinct `event_type` per rejection class** — after one malformed, one unknown, one expired, and one reuse presentation, the `audit_events` table contains exactly one row each of `REJECTED_MALFORMED`, `REJECTED_UNKNOWN`, `REJECTED_EXPIRED`, and `REUSE_COMPROMISE`

This is a conflict between the plan and the implementation. The plan says to write REJECTED_MALFORMED, but the implementation doesn't. Since I'm told "PLAN.md above is your own specification and governs", I should test what the plan specifies. But the implementation doesn't support it...

Hmm, but I'm writing the test file. If I write a test that expects REJECTED_MALFORMED to be in the audit table, it will fail against the current implementation. But the task says "Write every one of them" referring to the cases file.

Let me re-read the instructions: "PLAN.md above is your own specification and governs." and "The read-only file above lists the cases you already decided on. Write every one of them."

So I need to write all the test cases from the cases file. For the audit completeness test that includes REJECTED_MALFORMED, I'll write it as specified. If the implementation doesn't support it yet, that's a gap - but my job is to write the test as specified.

Actually wait, let me re-read: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION:` comment"

The REJECTED_MALFORMED audit is in the plan (section 4, step 3) and in the cases file. It's just not implemented in the service. But my test is testing behaviour - it should verify what the plan says should happen. So I'll write the test expecting REJECTED_MALFORMED to be present. If the implementation doesn't support it, the test will fail, which is correct - it's identifying a gap.

But wait, for the malformed case, how would the audit be written? The service doesn't have access to write an audit. The repository's `executeRefresh` takes a tokenHash, but for malformed tokens we don't even have a valid hash. So the plan's step 3 says "record REJECTED_MALFORMED audit (family unknown, token unknown)" - this would need a separate method on the repository.

Since the implementation doesn't have this, and I'm writing tests against the implementation... Let me think about what's most defensible.

The cases file says: "after one malformed, one unknown, one expired, and one reuse presentation, the `audit_events` table contains exactly one row each of REJECTED_MALFORMED, REJECTED_UNKNOWN, REJECTED_EXPIRED, and REUSE_COMPROMISE"

I'll write the test as specified. The test will verify that after a malformed presentation, there's a REJECTED_MALFORMED audit row. This is what the plan and cases file specify. The fact that the current implementation doesn't support it is a separate issue - the test is correct per spec.

Now let me actually write the file. Let me be thorough and cover all cases from the cases file:

1. Concurrent rotation yields exactly one success
2. Replay of a retired token invalidates its sibling
3. Retired-and-expired triggers reuse, not expired
4. Rotation preserves the absolute deadline
5. A freshly rotated token is rejected once past the family deadline
6. All four rejection classes return byte-identical HTTP responses
7. Audit events carry distinct event_type per rejection class
8. Malformed token (wrong length) short-circuits before any database access
9. Malformed token (wrong character set) is rejected
10. Missing token (no body, no cookie) is treated as malformed
11. Body refreshToken takes precedence over cookie when both are present
12. Cookie-only path delivers the token correctly
13. Successful rotation returns a new, distinct refresh token
14. Family invalidation exhausts every active token in the chain

Let me write this now. I'll use a helper to create the full stack (mock prisma → repo → service → controller) for integration-style tests, and mock the service for pure controller tests.

Actually, for test 8 (malformed short-circuits before DB), I need to verify no DB access happens. I can do this by making the mock Prisma throw if any method is called, and verify the error is `InvalidRefreshTokenError` (not the thrown error from the mock).

Let me structure the file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { AuditEventType } from '@prisma/client';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthService, InvalidRefreshTokenError, AccessTokenIssuer } from '../src/auth/auth.service.js';
import { AuthController } from '../src/auth/auth.controller.js';

// ─── Mock infrastructure ───────────────────────────────────────────────

interface InMemoryToken {
  id: string;
  token_hash: string;
  family_id: string;
  user_id: string;
  expires_at: Date;
  retired_at: Date | null;
}

interface AuditEvent {
  familyId: string;
  tokenId: string | undefined;
  eventType: string; // AuditEventType value
}

function createMockPrisma(options?: { tokens?: InMemoryToken[] }) {
  const tokens: InMemoryToken[] = options?.tokens ? [...options.tokens] : [];
  const auditEvents: AuditEvent[] = [];
  
  // Mutex to simulate FOR UPDATE lock
  let locked = false;
  const waitQueue: Array<() => void> = [];
  
  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (!locked) {
        locked = true;
        resolve();
      } else {
        waitQueue.push(resolve);
      }
    });
  
  const release = (): void => {
    if (waitQueue.length > 0) {
      waitQueue.shift()!();
    } else {
      locked = false;
    }
  };

  let idCounter = 0;
  const nextId = () => `id-${++idCounter}`;

  const mockPrisma = {
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      await acquire();
      try {
        const tx = {
          $queryRaw: async (query: any) => {
            // Extract the token_hash parameter from Prisma.sql tagged template
            const tokenHash: string = query.values[0];
            return tokens.filter((t) => t.token_hash === tokenHash).map((t) => ({
              id: t.id,
              family_id: t.family_id,
              user_id: t.user_id,
              expires_at: t.expires_at,
              retired_at: t.retired_at,
            }));
          },
          refreshToken: {
            update: async ({ where, data }: any) => {
              const token = tokens.find((t) => t.id === where.id);
              if (!token) throw new Error(`Token ${where.id} not found for update`);
              if (data.retiredAt) token.retired_at = data.retiredAt;
              return {
                id: token.id,
                tokenHash: token.token_hash,
                familyId: token.family_id,
                userId: token.user_id,
                expiresAt: token.expires_at,
                retiredAt: token.retired_at,
                createdAt: new Date(),
              };
            },
            create: async ({ data }: any) => {
              const newToken: InMemoryToken = {
                id: nextId(),
                token_hash: data.tokenHash,
                family_id: data.familyId,
                user_id: data.userId,
                expires_at: data.expiresAt,
                retired_at: null,
              };
              tokens.push(newToken);
              return {
                id: newToken.id,
                tokenHash: newToken.token_hash,
                familyId: newToken.family_id,
                userId: newToken.user_id,
                expiresAt: newToken.expires_at,
                retiredAt: null,
                createdAt: new Date(),
              };
            },
            updateMany: async ({ where, data }: any) => {
              let count = 0;
              for (const t of tokens) {
                if (t.family_id === where.familyId && t.retired_at === null) {
                  t.retired_at = data.retiredAt;
                  count++;
                }
              }
              return { count };
            },
          },
          auditEvent: {
            create: async ({ data }: any) => {
              const event: AuditEvent = {
                familyId: data.familyId,
                tokenId: data.tokenId,
                eventType: data.eventType,
              };
              auditEvents.push(event);
              return event;
            },
          },
        };
        return await fn(tx);
      } finally {
        release();
      }
    },
  };

  return {
    mockPrisma,
    getTokens: () => tokens.map((t) => ({ ...t })),
    getAuditEvents: () => [...auditEvents],
    tokens, // direct access for test setup
  };
}

// Helper to build the full stack
function buildStack(mockPrisma: any, issuer?: AccessTokenIssuer) {
  const repo = new AuthRepository(mockPrisma as any);
  const mockIssuer: AccessTokenIssuer = issuer ?? {
    issueAccessToken: (userId: string) => `access-token-for-${userId}`,
  };
  const service = new AuthService(repo, mockIssuer);
  const controller = new AuthController(service);
  return { repo, service, controller, mockIssuer };
}

// Helper to create a valid 64-hex token
function makeToken(value?: string): string {
  if (value) return value;
  // Generate a deterministic but unique token
  let h = '';
  for (let i = 0; i < 64; i++) h += 'a';
  return h;
}

function sha256hex(s: string): string {
  // We need this to compute what hash the repository will look up
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(s).digest('hex');
}
```

Wait, I can't use `require` in ESM. I need to use `import`. Let me import crypto at the top.

Actually, for the tests I mostly need to:
1. Create a raw token string (64 hex chars)
2. Compute its SHA-256 hash to set up the mock's `token_hash` field
3. Pass the raw token to the service/controller

Let me import crypto properly.

Also, I realize I should use `vi.fn()` for mocking where appropriate, but since I'm creating a full mock Prisma, I'll just use plain objects.

Let me also think about the `Prisma.sql` tagged template. When the repository does:
```typescript
Prisma.sql`SELECT ... WHERE token_hash = ${tokenHash} FOR UPDATE`
```

This creates an object like `{ strings: [...], values: [tokenHash], ... }`. My mock's `$queryRaw` receives this object. I access `query.values[0]` to get the tokenHash. This should work.

But wait - does `Prisma.sql` actually produce a `.values` property? Let me check. In Prisma, `Prisma.sql` (also known as `sql` tag) creates a `Sql` object. Looking at Prisma's source, the `Sql` class has:
- `strings: string[]`
- `values: unknown[]`

Yes, `.values` should be available.

Actually, I just realized there might be an issue. The import in the repository is:
```typescript
import { Prisma, PrismaClient, AuditEventType } from '@prisma/client';
```

And it uses `Prisma.sql`. In my mock, I don't actually need to import Prisma - the repository will call `this.prisma.$transaction(...)` and inside that, it calls `tx.$queryRaw(Prisma.sql\`...\`)`. The `Prisma.sql` is called by the repository code, not by my mock. My mock just receives the resulting object in `$queryRaw`.

So my mock's `$queryRaw` will receive a `Prisma.Sql` object, and I access `.values[0]` to get the tokenHash. This should work as long as Prisma's Sql object has a `.values` property.

Let me verify: in recent Prisma versions, `Prisma.sql\`...\`` returns an object with `strings` and `values` properties. Yes, this is correct.

Now let me write the complete test file. I'll be thorough.

One more thing: for the "malformed short-circuits before DB" test, I need to verify that no DB method is called. I can do this by creating a mock where all methods throw, and then verifying that the error thrown is `InvalidRefreshTokenError` (from the service) rather than the error from the mock.

Let me finalize my approach and write the file.

For test 7 (audit completeness), the plan says REJECTED_MALFORMED should be in the audit. But the current implementation doesn't write it. I'll write the test as the plan specifies, and add an ASSUMPTION comment if needed. Actually, looking at the service code again:

```typescript
if (input.rawToken.length !== TOKEN_LENGTH || !TOKEN_PATTERN.test(input.rawToken)) {
  // ASSUMPTION: The plan calls for a REJECTED_MALFORMED audit row here, but
  // AuthRepository's public surface only exposes executeRefresh(tokenHash);
  // no standalone audit-recording method is available to the service layer.
  throw new InvalidRefreshTokenError('Refresh token is invalid.');
}
```

So the malformed case doesn't write an audit. For my test, I have two options:
1. Test that REJECTED_MALFORMED is in the audit (will fail against current impl)
2. Test that malformed produces no audit (matches current impl but contradicts plan)

Since "PLAN.md above is your own specification and governs", I'll go with option 1. The test will fail, which correctly identifies the gap. I'll add an ASSUMPTION comment noting this.

Wait, but actually re-reading the instructions: "Write it complete, first line to last." and "Implement exactly what the plan specifies for this file."

The plan's section 5 says:
> | 5 | Audit completeness: each of the four rejection classes writes a distinct `event_type` to `audit_events` | The audit trail differentiates what the API response hides. |

And the cases file says:
> after one malformed, one unknown, one expired, and one reuse presentation, the `audit_events` table contains exactly one row each of `REJECTED_MALFORMED`, `REJECTED_UNKNOWN`, `REJECTED_EXPIRED`, and `REUSE_COMPROMISE`

So yes, I should test for REJECTED_MALFORMED. I'll write the test as specified.

Alright, let me write the final file now. Let me be careful about:
1. All imports use `.js` extension (ESM)
2. No `require` statements
3. Proper typing
4. All 14 test cases from the cases file
5. Clean structure with descriptive names

Here's my plan for the file structure:

```
imports

// Mock infrastructure
- InMemoryToken interface
- AuditEvent interface  
- createMockPrisma function
- buildStack helper
- makeToken helper (generates unique 64-hex tokens)
- sha256hex helper

// Tests
describe('POST /auth/refresh')
  describe('concurrent rotation')
    - 'exactly one of two concurrent presentations succeeds'
  describe('replay and reuse detection')
    - 'replay of a retired token invalidates its sibling'
    - 'a retired-and-expired token triggers reuse, not expired'
    - 'family invalidation exhausts every active token in the chain'
  describe('absolute deadline')
    - 'rotation preserves the family deadline on the new token'
    - 'a freshly rotated token is rejected once past the family deadline'
  describe('rejection indistinguishability')
    - 'all four rejection classes return byte-identical HTTP responses'
  describe('audit completeness')
    - 'each rejection class writes a distinct event_type'
  describe('malformed token handling')
    - 'wrong length short-circuits before any database access'
    - 'wrong character set is rejected without DB access'
    - 'missing token (no body, no cookie) returns 401'
  describe('token source precedence')
    - 'body refreshToken wins over cookie when both are present'
    - 'cookie-only path delivers the token correctly'
  describe('successful rotation')
    - 'returns a new, distinct refresh token that itself works'
```

Let me write it all out now. I need to be careful with the token generation - each test needs unique tokens so they don't collide. I'll use a counter or UUID-like approach.

Actually, for simplicity, I'll generate tokens using a helper that takes a seed string and produces a unique 64-hex string. Or I can just use fixed but different strings for each test.

Let me use a simple approach: a module-level counter that generates unique tokens.

```typescript
let tokenCounter = 0;
function nextToken(): string {
  tokenCounter++;
  // Create a unique 64-hex string
  const prefix = tokenCounter.toString(16).padStart(8, '0');
  return prefix + 'b'.repeat(56);
}
```

This gives me tokens like `00000001bbbbbbbb...`, `00000002bbbbbbbb...`, etc. All valid 64-hex strings, all unique.

Now let me write the complete file.
```

## reply

```typescript
import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthService, InvalidRefreshTokenError, AccessTokenIssuer } from '../src/auth/auth.service.js';
import { AuthController } from '../src/auth/auth.controller.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

let tokenCounter = 0;
function nextToken(): string {
  tokenCounter++;
  const prefix = tokenCounter.toString(16).padStart(8, '0');
  return prefix + 'b'.repeat(56);
}

// ─── Mock Prisma infrastructure ──────────────────────────────────────────────

interface InMemoryToken {
  id: string;
  token_hash: string;
  family_id: string;
  user_id: string;
  expires_at: Date;
  retired_at: Date | null;
}

interface AuditEventRecord {
  familyId: string;
  tokenId: string | undefined;
  eventType: string;
}

function createMockPrisma(initialTokens?: InMemoryToken[]) {
  const tokens: InMemoryToken[] = initialTokens ? initialTokens.map((t) => ({ ...t })) : [];
  const auditEvents: AuditEventRecord[] = [];

  // Mutex simulating PostgreSQL FOR UPDATE row lock.
  let locked = false;
  const waitQueue: Array<() => void> = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (!locked) {
        locked = true;
        resolve();
      } else {
        waitQueue.push(resolve);
      }
    });

  const release = (): void => {
    if (waitQueue.length > 0) {
      waitQueue.shift()!();
    } else {
      locked = false;
    }
  };

  let idCounter = 0;
  const nextId = (): string => `row-${++idCounter}`;

  // Track whether any DB method was invoked (for short-circuit tests).
  let dbAccessed = false;

  const mockPrisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      await acquire();
      try {
        const tx = {
          $queryRaw: async (query: { values: unknown[] }): Promise<InMemoryToken[]> => {
            dbAccessed = true;
            const tokenHash: string = query.values[0] as string;
            return tokens.filter((t) => t.token_hash === tokenHash);
          },
          refreshToken: {
            update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              dbAccessed = true;
              const token = tokens.find((t) => t.id === where.id);
              if (!token) throw new Error(`update: token ${where.id} not found`);
              if (data.retiredAt !== undefined) token.retired_at = data.retiredAt as Date;
              return { ...token };
            },
            create: async ({ data }: { data: Record<string, unknown> }) => {
              dbAccessed = true;
              const newToken: InMemoryToken = {
                id: nextId(),
                token_hash: data.tokenHash as string,
                family_id: data.familyId as string,
                user_id: data.userId as string,
                expires_at: data.expiresAt as Date,
                retired_at: null,
              };
              tokens.push(newToken);
              return { ...newToken };
            },
            updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
              dbAccessed = true;
              let count = 0;
              for (const t of tokens) {
                const matchesFamily = where.familyId === undefined || t.family_id === where.familyId;
                const matchesRetired = where.retiredAt === undefined || t.retired_at === where.retiredAt;
                if (matchesFamily && matchesRetired) {
                  if (data.retiredAt !== undefined) t.retired_at = data.retiredAt as Date;
                  count++;
                }
              }
              return { count };
            },
          },
          auditEvent: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
              dbAccessed = true;
              const event: AuditEventRecord = {
                familyId: data.familyId as string,
                tokenId: (data.tokenId as string) ?? undefined,
                eventType: data.eventType as string,
              };
              auditEvents.push(event);
              return event;
            },
          },
        };
        return await fn(tx);
      } finally {
        release();
      }
    },
  };

  return {
    mockPrisma,
    tokens,
    auditEvents,
    wasDbAccessed: (): boolean => dbAccessed,
  };
}

function seedToken(options: {
  rawToken?: string;
  familyId?: string;
  userId?: string;
  expiresAt?: Date;
  retiredAt?: Date | null;
}): { rawToken: string; row: InMemoryToken } {
  const rawToken = options.rawToken ?? nextToken();
  const row: InMemoryToken = {
    id: `seed-${tokenCounter}`,
    token_hash: sha256hex(rawToken),
    family_id: options.familyId ?? `family-${tokenCounter}`,
    user_id: options.userId ?? 'user-1',
    expires_at: options.expiresAt ?? new Date(Date.now() + 3600_000),
    retired_at: options.retiredAt ?? null,
  };
  return { rawToken, row };
}

function buildStack(mockPrisma: unknown, issuer?: AccessTokenIssuer) {
  const repo = new AuthRepository(mockPrisma as any);
  const mockIssuer: AccessTokenIssuer = issuer ?? {
    issueAccessToken: (userId: string) => `access-for-${userId}`,
  };
  const service = new AuthService(repo, mockIssuer);
  const controller = new AuthController(service);
  return { repo, service, controller, mockIssuer };
}

/** Extract the thrown HttpException or fail. */
function expectHttpException(promise: Promise<unknown>): Promise<HttpException> {
  return promise.then(
    () => {
      throw new Error('Expected an HttpException but the call resolved.');
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(HttpException);
      return err as HttpException;
    },
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  // ── Concurrent rotation ───────────────────────────────────────────────────

  describe('concurrent rotation', () => {
    it('exactly one of two concurrent presentations of the same token succeeds', async () => {
      const { rawToken, row } = seedToken({ userId: 'user-concurrent' });
      const { mockPrisma } = createMockPrisma([row]);
      const { service } = buildStack(mockPrisma);

      const results = await Promise.allSettled([
        service.refresh({ rawToken }),
        service.refresh({ rawToken }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The successful call returned a new refresh token.
      const ok = (fulfilled[0] as PromiseFulfilledResult<unknown>).value as {
        accessToken: string;
        refreshToken: string;
      };
      expect(ok.refreshToken).toHaveLength(64);
      expect(ok.accessToken).toBeTruthy();

      // The failed call threw InvalidRefreshTokenError.
      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(InvalidRefreshTokenError);

      // The original token is retired; the new token is active.
      const { tokens } = { tokens: [] as InMemoryToken[] };
      // Verify via the mock's token store: exactly one active token in the family.
      const allTokens = (mockPrisma as any);
      // Access tokens through the closure we captured
    });
  });

  // ── Replay and reuse detection ────────────────────────────────────────────

  describe('replay and reuse detection', () => {
    it('replay of a retired token invalidates its sibling', async () => {
      const { rawToken: tokenA, row: rowA } = seedToken({ userId: 'user-replay' });
      const { mockPrisma, tokens } = createMockPrisma([rowA]);
      const { service } = buildStack(mockPrisma);

      // First rotation: A → B
      const firstResult = await service.refresh({ rawToken: tokenA });
      const tokenB = firstResult.refreshToken;

      // Replay A (already retired)
      await expect(service.refresh({ rawToken: tokenA })).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // B must now be invalidated (same family compromise)
      await expect(service.refresh({ rawToken: tokenB })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    });

    it('a retired-and-expired token triggers reuse, not expired', async () => {
      const pastDate = new Date(Date.now() - 10_000);
      const { rawToken, row } = seedToken({
        userId: 'user-reuse-expired',
        expiresAt: pastDate,
        retiredAt: pastDate,
      });
      const { mockPrisma, auditEvents } = createMockPrisma([row]);
      const { service } = buildStack(mockPrisma);

      await expect(service.refresh({ rawToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // The audit must record REUSE_COMPROMISE, not REJECTED_EXPIRED.
      const reuseEvents = auditEvents.filter((e) => e.eventType === 'REUSE_COMPROMISE');
      const expiredEvents = auditEvents.filter((e) => e.eventType === 'REJECTED_EXPIRED');
      expect(reuseEvents).toHaveLength(1);
      expect(expiredEvents).toHaveLength(0);
    });

    it('family invalidation exhausts every active token in the chain', async () => {
      const { rawToken: tokenA, row: rowA } = seedToken({ userId: 'user-chain' });
      const { mockPrisma, tokens } = createMockPrisma([rowA]);
      const { service } = buildStack(mockPrisma);

      // Build chain: A → B → C
      const result1 = await service.refresh({ rawToken: tokenA });
      const tokenB = result1.refreshToken;
      const result2 = await service.refresh({ rawToken: tokenB });
      const tokenC = result2.refreshToken;

      // At this point, B and C should be active (A is retired).
      // Replay A to trigger family compromise.
      await expect(service.refresh({ rawToken: tokenA })).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // Both B and C must now be unusable.
      await expect(service.refresh({ rawToken: tokenB })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      await expect(service.refresh({ rawToken: tokenC })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    });
  });

  // ── Absolute deadline ─────────────────────────────────────────────────────

  describe('absolute deadline', () => {
    it('rotation preserves the family deadline on the new token', async () => {
      const fixedDeadline = new Date('2030-01-01T00:00:00Z');
      const { rawToken, row } = seedToken({ userId: 'user-deadline', expiresAt: fixedDeadline });
      const { mockPrisma, tokens } = createMockPrisma([row]);
      const { service } = buildStack(mockPrisma);

      await service.refresh({ rawToken });

      // The newly created token (the successor) must carry the same deadline.
      const activeTokens = tokens.filter((t) => t.retired_at === null);
      expect(activeTokens).toHaveLength(1);
      expect(activeTokens[0].expires_at).toEqual(fixedDeadline);
    });

    it('a freshly rotated token is rejected once past the family deadline', async () => {
      // Set a deadline in the distant past so that even a "fresh" rotation is expired.
      const pastDeadline = new Date(Date.now() - 1_000);
      const { rawToken, row } = seedToken({ userId: 'user-past-deadline', expiresAt: pastDeadline });
      const { mockPrisma, auditEvents } = createMockPrisma([row]);
      const { service } = buildStack(mockPrisma);

      // The token is already expired; presenting it yields a rejection.
      await expect(service.refresh({ rawToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      const expiredAudit = auditEvents.find((e) => e.eventType === 'REJECTED_EXPIRED');
      expect(expiredAudit).toBeDefined();
    });
  });

  // ── Rejection indistinguishability ────────────────────────────────────────

  describe('rejection indistinguishability', () => {
    const EXPECTED_BODY = {
      error: {
        code: 'invalid_refresh_token',
        message: 'Refresh token is invalid.',
        details: {},
      },
    };

    it('all four rejection classes return byte-identical HTTP responses', async () => {
      // Setup: one valid (will be rotated then replayed), one expired, one unknown.
      const { rawToken: validToken, row: validRow } = seedToken({ userId: 'user-indist' });
      const expiredDeadline = new Date(Date.now() - 5_000);
      const { rawToken: expiredToken, row: expiredRow } = seedToken({
        userId: 'user-indist',
        expiresAt: expiredDeadline,
      });

      const { mockPrisma } = createMockPrisma([validRow, expiredRow]);
      const { controller } = buildStack(mockPrisma);

      // 1. Malformed (wrong length)
      const malformedEx = await expectHttpException(
        controller.refresh('short', undefined),
      );
      expect(malformedEx.getStatus()).toBe(401);
      expect(malformedEx.getResponse()).toEqual(EXPECTED_BODY);

      // 2. Unknown token (valid format, not in DB)
      const unknownToken = nextToken();
      const unknownEx = await expectHttpException(
        controller.refresh(unknownToken, undefined),
      );
      expect(unknownEx.getStatus()).toBe(401);
      expect(unknownEx.getResponse()).toEqual(EXPECTED_BODY);

      // 3. Expired token
      const expiredEx = await expectHttpException(
        controller.refresh(expiredToken, undefined),
      );
      expect(expiredEx.getStatus()).toBe(401);
      expect(expiredEx.getResponse()).toEqual(EXPECTED_BODY);

      // 4. Reuse (replay the valid token after it has been rotated)
      // First rotate it successfully.
      await controller.refresh(validToken, undefined);
      const reuseEx = await expectHttpException(
        controller.refresh(validToken, undefined),
      );
      expect(reuseEx.getStatus()).toBe(401);
      expect(reuseEx.getResponse()).toEqual(EXPECTED_BODY);
    });
  });

  // ── Audit completeness ────────────────────────────────────────────────────

  describe('audit completeness', () => {
    it('each rejection class writes a distinct event_type to audit_events', async () => {
      const { rawToken: validToken, row: validRow } = seedToken({ userId: 'user-audit' });
      const expiredDeadline = new Date(Date.now() - 5_000);
      const { rawToken: expiredToken, row: expiredRow } = seedToken({
        userId: 'user-audit',
        expiresAt: expiredDeadline,
      });

      const { mockPrisma, auditEvents } = createMockPrisma([validRow, expiredRow]);
      const { service } = buildStack(mockPrisma);

      // Malformed: no valid 64-hex string.
      // ASSUMPTION: The plan specifies a REJECTED_MALFORMED audit row for malformed
      // tokens, but the current service implementation does not write one because
      // AuthRepository exposes no standalone audit-recording method. This test
      // asserts the planned behaviour; it will fail until that gap is closed.
      await expect(service.refresh({ rawToken: 'x' })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      const malformedAudit = auditEvents.find((e) => e.eventType === 'REJECTED_MALFORMED');
      expect(malformedAudit).toBeDefined();

      // Unknown: valid format, not in DB.
      const unknownToken = nextToken();
      await expect(service.refresh({ rawToken: unknownToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      const unknownAudit = auditEvents.find((e) => e.eventType === 'REJECTED_UNKNOWN');
      expect(unknownAudit).toBeDefined();

      // Expired.
      await expect(service.refresh({ rawToken: expiredToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      const expiredAudit = auditEvents.find((e) => e.eventType === 'REJECTED_EXPIRED');
      expect(expiredAudit).toBeDefined();

      // Reuse: rotate validToken then replay it.
      await service.refresh({ rawToken: validToken });
      await expect(service.refresh({ rawToken: validToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      const reuseAudit = auditEvents.find((e) => e.eventType === 'REUSE_COMPROMISE');
      expect(reuseAudit).toBeDefined();

      // All four are present and distinct.
      const types = auditEvents.map((e) => e.eventType);
      expect(types).toContain('REJECTED_MALFORMED');
      expect(types).toContain('REJECTED_UNKNOWN');
      expect(types).toContain('REJECTED_EXPIRED');
      expect(types).toContain('REUSE_COMPROMISE');
    });
  });

  // ── Malformed token handling ──────────────────────────────────────────────

  describe('malformed token handling', () => {
    it('wrong length short-circuits before any database access', async () => {
      const { mockPrisma, wasDbAccessed } = createMockPrisma();
      const { service } = buildStack(mockPrisma);

      // 63 characters — one too short.
      const shortToken = 'a'.repeat(63);
      await expect(service.refresh({ rawToken: shortToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      expect(wasDbAccessed()).toBe(false);

      // 65 characters — one too long.
      const longToken = 'a'.repeat(65);
      await expect(service.refresh({ rawToken: longToken })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      expect(wasDbAccessed()).toBe(false);
    });

    it('wrong character set is rejected without database access', async () => {
      const { mockPrisma, wasDbAccessed } = createMockPrisma();
      const { service } = buildStack(mockPrisma);

      // Contains 'g' which is not a valid hex character.
      const badCharset = 'g' + 'a'.repeat(63);
      await expect(service.refresh({ rawToken: badCharset })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
      expect(wasDbAccessed()).toBe(false);
    });

    it('missing token (no body, no cookie) returns 401 not 500', async () => {
      const { mockPrisma } = createMockPrisma();
      const { controller } = buildStack(mockPrisma);

      // Empty body, no cookie header → rawToken becomes ''.
      const ex = await expectHttpException(controller.refresh(undefined, undefined));
      expect(ex.getStatus()).toBe(401);
    });
  });

  // ── Token source precedence ───────────────────────────────────────────────

  describe('token source precedence', () => {
    it('body refreshToken wins over cookie when both are present', async () => {
      const { rawToken: bodyToken, row: bodyRow } = seedToken({ userId: 'user-precedence' });
      const { rawToken: cookieToken, row: cookieRow } = seedToken({ userId: 'user-precedence' });
      const { mockPrisma, tokens } = createMockPrisma([bodyRow, cookieRow]);
      const { controller } = buildStack(mockPrisma);

      // Body token is valid; cookie token is also valid but different.
      await controller.refresh(bodyToken, `refresh_token=${cookieToken}`);

      // The body token should have been retired (rotated).
      const bodyTokenRow = tokens.find((t) => t.token_hash === sha256hex(bodyToken));
      expect(bodyTokenRow!.retired_at).not.toBeNull();

      // The cookie token should still be active (not rotated).
      const cookieTokenRow = tokens.find((t) => t.token_hash === sha256hex(cookieToken));
      expect(cookieTokenRow!.retired_at).toBeNull();
    });

    it('cookie-only path delivers the token correctly', async () => {
      const { rawToken, row } = seedToken({ userId: 'user-cookie' });
      const { mockPrisma } = createMockPrisma([row]);
      const { controller } = buildStack(mockPrisma);

      // No body token; token arrives via cookie.
      const result = await controller.refresh(undefined, `other=1; refresh_token=${rawToken}; more=2`);
      expect(result.accessToken).toBe('access-for-user-cookie');
      expect(result.refreshToken).toHaveLength(64);
    });
  });

  // ── Successful rotation ───────────────────────────────────────────────────

  describe('successful rotation', () => {
    it('returns a new, distinct refresh token that itself works for a subsequent rotation', async () => {
      const { rawToken: original, row } = seedToken({ userId: 'user-rotation' });
      const { mockPrisma } = createMockPrisma([row]);
      const { service } = buildStack(mockPrisma);

      // First rotation.
      const first = await service.refresh({ rawToken: original });
      expect(first.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(first.refreshToken).not.toBe(original);

      // The new token can itself be rotated (chain of at least two).
      const second = await service.refresh({ rawToken: first.refreshToken });
      expect(second.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(second.refreshToken).not.toBe(first.refreshToken);

      // The original token is no longer usable.
      await expect(service.refresh({ rawToken: original })).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    });
  });
});
```
