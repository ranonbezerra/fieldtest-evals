# repair2-auth.spec.ts

## reasoning

```
Let me analyze the compiler errors for `test/auth.spec.ts`:

1. `test/auth.spec.ts(63,44): error TS2554: Expected 1 arguments, but got 2.` — The `AuthService` constructor expects 1 argument but the test is passing 2. Looking at the stub `auth.service.ts`, the constructor takes `repo: AuthRepository` and `issueAccessToken: (userId: string) => string` — that's 2 parameters. But the file shown is a stub (it's truncated/incomplete). The compiler says "Expected 1 arguments, but got 2" which means the actual `AuthService` constructor as compiled only expects 1 argument. Wait, but the stub shows 2 params...

Actually, looking more carefully at the reference material, the `auth.service.ts` shown is clearly incomplete (it's a stub with just the constructor). The compiler is reporting errors for the *current* state of the workspace. The error says "Expected 1 arguments, but got 2" at line 63, column 44. This means the actual `AuthService` in the compiled workspace has a constructor that takes 1 argument.

Wait, but the reference shows the service has 2 constructor params. Let me re-read...

The reference material shows:
```
src/auth/auth.service.ts(3,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
```

So `auth.repository` module doesn't resolve. This means `AuthRepository` is effectively `any` or the import fails. But the constructor signature should still be visible...

Actually, if the import fails, TypeScript would treat `AuthRepository` as `any` (with the error suppressed or as a type error). The constructor would still have 2 parameters though.

Wait, let me reconsider. The error at line 63 says "Expected 1 arguments, but got 2." This is a definitive statement about the constructor signature. So the actual `AuthService` that the compiler sees has a constructor taking 1 argument.

But the stub shows 2 parameters. The stub is just a reference - it might be incomplete or the actual file in the workspace is different.

Hmm, but the task says "Rely on them; never reproduce them and never rewrite them." So I should use what's shown. The service stub shows:

```typescript
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly issueAccessToken: (userId: string) => string,
  ) {}
}
```

That's 2 constructor parameters. But the compiler says "Expected 1 arguments, but got 2." This is contradictory.

Wait - maybe the actual file in the workspace is different from what's shown in the reference. The reference is a "read-only reference" showing what was read. But the actual file might have been modified or the reference is showing a partial view.

Actually, re-reading the instructions: "The blocks above are reference material. Rely on them; never reproduce them and never rewrite them."

So I should rely on what's shown. The service constructor takes 2 params: `repo` and `issueAccessToken`. But the compiler says it expects 1 argument. 

The most likely explanation: The `AuthRepository` import fails (TS2307), which means `AuthRepository` is unresolved. In strict mode, this would be an error but the type would be `any`. The constructor would still have 2 parameters though...

Unless the actual file in the workspace is different from what's shown in the reference. The reference might be showing an older version or a planned version.

Let me look at this differently. The task says to fix `test/auth.spec.ts` only. The errors in `test/auth.spec.ts` are:

1. Line 63, col 44: `TS2554: Expected 1 arguments, but got 2` — constructor call with wrong number of args
2. Lines 85, 86, 112, 132, 133, 150, 171, 184: `TS2339: Property 'rotate' does not exist on type 'AuthService'` — the service doesn't have a `rotate` method
3. Lines 171, 184: `TS7006: Parameter 'e' implicitly has an 'any' type` — untyped parameter

So the issues with the test file are:
1. The test is calling `new AuthService(x, y)` with 2 args but the constructor expects 1
2. The test is calling `service.rotate(...)` but no such method exists
3. Some catch parameter `e` is implicitly `any`

Now, the PLAN.md specifies a `rotate` method. The plan says the service should have a `rotate` method. But the current `auth.service.ts` stub doesn't have it (it's incomplete).

The instructions say: "Change nothing the messages do not name." So I can only change `test/auth.spec.ts`.

"PLAN.md above still governs. Do not drop a requirement to silence an error."

So the plan says the service should have a `rotate` method. But the current service doesn't have it. I can't change the service (the messages don't name it as something I should fix - well, actually the messages DO name `src/auth/auth.service.ts` with the TS2307 error, but that's about the repository import, not about missing methods).

Wait, let me re-read: "Change nothing the messages do not name." The messages name:
- `src/auth/auth.controller.ts` (TS2307)
- `src/auth/auth.service.ts` (TS2307)
- `test/auth.spec.ts` (multiple errors)

But the task says: "Rewrite `test/auth.spec.ts` complete, fixing what these messages require of this file."

So I'm only rewriting `test/auth.spec.ts`. The other files have errors too but I'm not asked to fix them.

Now, the key question: what should the test look like given that:
- `AuthService` constructor takes 1 argument (per compiler)
- `AuthService` does not have a `rotate` method (per compiler)
- But the PLAN says it should

The instruction says: "If satisfying the compiler seems to require abandoning something the plan specified, keep the plan and add one `// ASSUMPTION:` line saying what you could not reconcile."

So I need to write tests that call a `rotate` method and pass 2 constructor args, but the compiler won't be happy. OR I need to adapt the test to work with what's actually there.

Wait, but the task is to "fix what these messages require of this file." The messages require:
1. Constructor call should use 1 argument (not 2)
2. `rotate` should exist on the type (or we need to work around it)
3. `e` should be typed

For point 2: Since the `AuthService` type doesn't have `rotate`, and I can't change the service file, I need to either:
- Cast the service to `any` or a local interface that includes `rotate`
- Or use a type assertion

But the plan says the service should have `rotate`. The plan governs. So I should write the test as if `rotate` exists, and add an `// ASSUMPTION:` line explaining the discrepancy.

Actually wait. Let me re-think. The task says "fixing what these messages require of this file." The messages require that the test compiles. To make it compile:
1. Fix the constructor call to use 1 arg
2. Fix the `rotate` property access
3. Fix the implicit `any`

For #2, since I can't add the method to the service, I could:
- Define a local interface that extends what I expect
- Cast the service instance

But actually, looking at this more carefully - the `AuthService` in the stub has an empty body (just the constructor). The `rotate` method doesn't exist yet. The test is written anticipating the method will exist.

Given the constraints:
- I must only change `test/auth.spec.ts`
- I must not drop plan requirements
- I must add `// ASSUMPTION:` lines for things I can't reconcile

The best approach:
- For the constructor: The compiler says 1 arg expected. The plan shows 2 params (repo + issueAccessToken). Since I can't see the full actual file (only a stub), and the compiler is authoritative about what's actually there, I'll use 1 arg. But wait - what IS that 1 arg? 

Hmm, actually I think the issue might be that because `AuthRepository` import fails, the TypeScript compiler might be seeing the constructor differently. Or the actual file in the workspace is different from the stub shown.

Let me take a different approach. The compiler is the source of truth for what the code looks like. It says:
- Constructor expects 1 argument
- No `rotate` method exists

So to fix the test:
1. Pass 1 argument to constructor
2. Use a type assertion or interface for `rotate`
3. Type the `e` parameter

But I need to think about what the 1 argument is. Given the PLAN shows `repo` and `issueAccessToken` as dependencies, and the compiler says 1 arg... Maybe in the actual file, one of them is not a constructor param (e.g., `issueAccessToken` might be a standalone function or the repo is injected differently).

I'll write the test with an `// ASSUMPTION:` about the constructor signature.

Actually, let me reconsider the whole approach. The test file needs to:
1. Test concurrent presentation of one token
2. Test replay that invalidates sibling token
3. Test rotation against absolute deadline
4. Test rejection responses compared to each other

For these tests to work, they need to:
- Create an `AuthService` instance
- Call `rotate` on it
- Assert results

Given the compiler errors, here's my plan for the test file:

```typescript
// Define an interface for what we expect AuthService to have
interface AuthServiceContract {
  rotate(token: string): Promise<{ accessToken: string; refreshToken: string }>;
}

// For the constructor, pass 1 arg as the compiler requires
// ASSUMPTION: The AuthService constructor in the current workspace accepts 1 argument (the repository). The issueAccessToken function is provided via a different mechanism (e.g., module-level injection or a separate provider).

// For rotate, use a type assertion since the method doesn't yet exist on the type
const service = new AuthService(repo) as unknown as AuthServiceContract;
```

Wait, but if `AuthService` constructor takes 1 arg, what is it? Looking at the stub again:

```typescript
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly issueAccessToken: (userId: string) => string,
  ) {}
}
```

This clearly has 2 params. But the compiler says 1. The only explanation is that the actual file in the workspace is different from this stub. Since I'm told to "Rely on them" (the reference material), but the compiler disagrees...

I think the right approach is:
- Add `// ASSUMPTION:` explaining the discrepancy
- Write the test to compile against what the compiler reports (1 arg constructor, no `rotate` method)
- Use type assertions to work around the missing method

Let me write the test:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service';

// ASSUMPTION: The AuthService constructor in the current workspace accepts 1 argument
// (the repository). The issueAccessToken function is expected to be available via
// a different injection mechanism not visible in the current stub.

// ASSUMPTION: The `rotate` method is specified by PLAN.md but not yet present on the
// compiled AuthService type. Tests use a structural interface to express the contract.

interface RotateResult {
  accessToken: string;
  refreshToken: string;
}

interface RejectionError extends Error {
  status: number;
  response: {
    error: {
      code: string;
      message: string;
      details: Record<string, unknown>;
    };
  };
}

interface AuthServiceContract {
  rotate(token: string): Promise<RotateResult>;
}

// Mock repository
function createMockRepo() {
  return {
    findTokenById: vi.fn(),
    retireToken: vi.fn(),
    createToken: vi.fn(),
    findSessionById: vi.fn(),
    revokeFamily: vi.fn(),
    createAuditRecord: vi.fn(),
    // ... whatever methods the service needs
  };
}

describe('AuthService — refresh-token rotation', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let service: AuthServiceContract;

  const userId = 'user-1';
  const familyId = 'family-1';
  const sessionId = 'session-1';
  const issueAccessToken = vi.fn().mockReturnValue('access-token-xyz');

  beforeEach(() => {
    repo = createMockRepo();
    // ASSUMPTION: Constructor takes 1 arg per compiler
    const raw = new AuthService(repo as any);
    service = raw as unknown as AuthServiceContract;
  });

  // Test 1: Concurrent presentation
  it('exactly one of two concurrent presentations of the same token succeeds', async () => {
    const tokenValue = 'token-A';
    const now = new Date();
    const futureExpiry = new Date(now.getTime() + 3600_000);

    // First call: token is active, CAS succeeds
    repo.findTokenById.mockResolvedValue({
      id: tokenValue,
      familyId,
      sessionId,
      createdAt: now,
      retiredAt: null,
      revokedAt: null,
    });
    repo.findSessionById.mockResolvedValue({
      id: sessionId,
      userId,
      createdAt: now,
      expiresAt: futureExpiry,
    });
    // CAS: first call succeeds (affectedRows = 1)
    repo.retireToken.mockResolvedValueOnce(1);
    repo.createToken.mockResolvedValue({ id: 'token-B' });
    repo.createAuditRecord.mockResolvedValue({});

    // For the second concurrent call, by the time it does CAS, the token is retired
    // So the service should detect reuse
    // We simulate this by having the CAS return 0 on the second call
    repo.retireToken.mockResolvedValueOnce(0);

    const results = await Promise.allSettled([
      service.rotate(tokenValue),
      service.rotate(tokenValue),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });
```

Hmm, but this is getting complicated. The mock behavior needs to be realistic. Let me think about how the service would actually work based on the PLAN:

The service's `rotate` method would:
1. Call `repo.findTokenById(token)` → get token row
2. Check if revoked/retired → if so, revoke family, audit, throw
3. Check session expiry → if expired, audit, throw
4. In a transaction: CAS retire the token, create new token, audit
5. If CAS fails (affectedRows=0), treat as reuse
6. Issue access token, return

For the mock, I need to simulate the CAS behavior. The `retireToken` method (or whatever it's called) returns the number of affected rows.

But I don't know the exact method names on the repository. The repository is a stub (empty class). So I have to make assumptions about the method names.

Let me write the test in a way that:
1. Compiles (fixes the TS errors)
2. Expresses the correct behavioral tests per the PLAN
3. Uses `// ASSUMPTION:` lines where I'm guessing at the shape

Let me also think about the `TS7006: Parameter 'e' implicitly has an 'any' type` errors. These are at lines 171 and 184. This means there are `.catch(e => ...)` or `catch (e)` blocks where `e` needs a type annotation. In strict mode with `useUnknownInCatchVariables` (which is part of `strict` in TS 4.4+), catch variables are `unknown`. So I need to type them.

Let me write a complete, well-structured test file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service';

// ASSUMPTION: The AuthService constructor in the current workspace accepts 1 argument
// (the repository). The issueAccessToken function is provided via a separate mechanism
// not visible in the current workspace state.

// ASSUMPTION: The `rotate` method is specified by PLAN.md section 3 but is not yet
// present on the compiled AuthService type. Tests express the contract via a local
// interface and a type assertion.

// ASSUMPTION: Repository method names are inferred from the PLAN.md algorithm steps.
// The actual repository stub is empty, so names are chosen to match the plan's intent.

interface RotateResult {
  accessToken: string;
  refreshToken: string;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

interface TokenRow {
  id: string;
  familyId: string;
  sessionId: string;
  createdAt: Date;
  retiredAt: Date | null;
  revokedAt: Date | null;
}

interface SessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

interface RepoContract {
  findTokenById(id: string): Promise<TokenRow | null>;
  findSessionById(id: string): Promise<SessionRow | null>;
  retireTokenIfActive(id: string): Promise<number>; // CAS: returns affected rows
  createToken(data: { familyId: string; sessionId: string }): Promise<{ id: string }>;
  revokeFamily(familyId: string): Promise<void>;
  createAuditRecord(data: { familyId: string; tokenId: string; event: string; details: Record<string, unknown> }): Promise<void>;
}

interface AuthServiceContract {
  rotate(token: string): Promise<RotateResult>;
}

function createMockRepo(): RepoContract & Record<string, vi.Mock> {
  return {
    findTokenById: vi.fn().mockResolvedValue(null),
    findSessionById: vi.fn().mockResolvedValue(null),
    retireTokenIfActive: vi.fn().mockResolvedValue(0),
    createToken: vi.fn().mockResolvedValue({ id: 'new-token' }),
    revokeFamily: vi.fn().mockResolvedValue(undefined),
    createAuditRecord: vi.fn().mockResolvedValue(undefined),
  };
}

// A helper to extract the error envelope from a thrown exception
function extractEnvelope(e: unknown): ErrorEnvelope {
  if (e && typeof e === 'object' && 'response' in e) {
    const nest = e as { response: ErrorEnvelope };
    return nest.response;
  }
  // If the service throws a plain object with the envelope
  if (e && typeof e === 'object' && 'error' in e) {
    return e as ErrorEnvelope;
  }
  throw new Error(`Unexpected error shape: ${e}`);
}

const userId = 'user-1';
const familyId = 'family-1';
const sessionId = 'session-1';

describe('AuthService — refresh-token rotation (Variant A)', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let service: AuthServiceContract;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = createMockRepo();
    // ASSUMPTION: 1-arg constructor per compiler
    const raw = new AuthService(repo as any);
    service = raw as unknown as AuthServiceContract;
  });

  describe('concurrent presentation of one token', () => {
    it('exactly one of two concurrent rotate calls succeeds', async () => {
      const tokenValue = 'token-A';
      const now = new Date();
      const futureExpiry = new Date(now.getTime() + 3_600_000);

      const tokenRow: TokenRow = {
        id: tokenValue,
        familyId,
        sessionId,
        createdAt: now,
        retiredAt: null,
        revokedAt: null,
      };

      const sessionRow: SessionRow = {
        id: sessionId,
        userId,
        createdAt: now,
        expiresAt: futureExpiry,
      };

      repo.findTokenById.mockResolvedValue(tokenRow);
      repo.findSessionById.mockResolvedValue(sessionRow);
      // First CAS succeeds (1 row affected), second CAS fails (0 rows affected)
      repo.retireTokenIfActive
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      repo.createToken.mockResolvedValue({ id: 'token-B' });

      const results = await Promise.allSettled([
        service.rotate(tokenValue),
        service.rotate(tokenValue),
      ]);

      const fulfilled = results.filter((r): r is PromiseFulfilledResult<RotateResult> => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The successful one returns new tokens
      expect(fulfilled[0].value).toEqual({
        accessToken: expect.any(String),
        refreshToken: 'token-B',
      });

      // The rejected one gets an error envelope
      const envelope = extractEnvelope(rejected[0].reason);
      expect(envelope.error.code).toBe('invalid_token');
    });
  });

  describe('replay invalidates sibling token', () => {
    it('replaying a retired token revokes the entire family', async () => {
      const retiredToken = 'token-A';
      const siblingToken = 'token-B';
      const now = new Date();
      const futureExpiry = new Date(now.getTime() + 3_600_000);

      // The presented token is already retired
      const tokenRow: TokenRow = {
        id: retiredToken,
        familyId,
        sessionId,
        createdAt: now,
        retiredAt: now,
        revokedAt: null,
      };

      repo.findTokenById.mockResolvedValue(tokenRow);
      repo.revokeFamily.mockResolvedValue(undefined);
      repo.createAuditRecord.mockResolvedValue(undefined);

      await expect(service.rotate(retiredToken)).rejects.toThrow();

      // Family-wide revocation was called
      expect(repo.revokeFamily).toHaveBeenCalledWith(familyId);
    });
  });

  describe('rotation against absolute deadline', () => {
    it('rejects rotation when the session has expired', async () => {
      const tokenValue = 'token-A';
      const now = new Date();
      const pastExpiry = new Date(now.getTime() - 1000); // already expired

      const tokenRow: TokenRow = {
        id: tokenValue,
        familyId,
        sessionId,
        createdAt: pastExpiry,
        retiredAt: null,
        revokedAt: null,
      };

      const sessionRow: SessionRow = {
        id: sessionId,
        userId,
        createdAt: pastExpiry,
        expiresAt: pastExpiry,
      };

      repo.findTokenById.mockResolvedValue(tokenRow);
      repo.findSessionById.mockResolvedValue(sessionRow);

      await expect(service.rotate(tokenValue)).rejects.toThrow();

      // Audit was recorded as 'expired'
      expect(repo.createAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'expired' }),
      );

      // No new token was created
      expect(repo.createToken).not.toHaveBeenCalled();
    });
  });

  describe('rejection responses are indistinguishable', () => {
    it('expired, retired (reuse), and unknown all return the same envelope', async () => {
      const now = new Date();
      const futureExpiry = new Date(now.getTime() + 3_600_000);
      const pastExpiry = new Date(now.getTime() - 1000);

      const baseToken: TokenRow = {
        id: 'token-X',
        familyId,
        sessionId,
        createdAt: now,
        retiredAt: null,
        revokedAt: null,
      };

      const envelopes: ErrorEnvelope[] = [];

      // Case 1: Unknown token
      repo.findTokenById.mockResolvedValueOnce(null);
      await expect(service.rotate('nonexistent')).rejects.toThrow();
      {
        const e: unknown = (await captureRejection(service.rotate('nonexistent')));
        envelopes.push(extractEnvelope(e));
      }

      // Case 2: Expired session
      repo.findTokenById.mockResolvedValueOnce({ ...baseToken, id: 'token-expired' });
      repo.findSessionById.mockResolvedValueOnce({
        id: sessionId,
        userId,
        createdAt: pastExpiry,
        expiresAt: pastExpiry,
      });
      {
        const e: unknown = await captureRejection(service.rotate('token-expired'));
        envelopes.push(extractEnvelope(e));
      }

      // Case 3: Retired token (reuse)
      repo.findTokenById.mockResolvedValueOnce({ ...baseToken, id: 'token-retired', retiredAt: now });
      {
        const e: unknown = await captureRejection(service.rotate('token-retired'));
        envelopes.push(extractEnvelope(e));
      }

      // All three envelopes must be identical in code, message, and details
      expect(envelopes[0].error.code).toBe('invalid_token');
      expect(envelopes[1].error.code).toBe('invalid_token');
      expect(envelopes[2].error.code).toBe('invalid_token');
      expect(envelopes[0].error.message).toBe(envelopes[1].error.message);
      expect(envelopes[0].error.message).toBe(envelopes[2].error.message);
      expect(envelopes[0].error.details).toEqual(envelopes[1].error.details);
      expect(envelopes[0].error.details).toEqual(envelopes[2].error.details);
    });
  });
});

async function captureRejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e: unknown) {
    return e;
  }
  throw new Error('Expected rejection but got resolution');
}
```

Wait, I have a problem. In the "rejection responses are indistinguishable" test, I'm calling `service.rotate` multiple times but the mock setup with `mockResolvedValueOnce` will consume mocks sequentially. Let me restructure.

Also, I realize I need to be more careful. The test at line 63 had "Expected 1 arguments, but got 2" — this is the constructor call. Let me make sure I only pass 1 arg.

But what IS that 1 arg? I'll assume it's the repository (since that's the primary dependency). The `issueAccessToken` might be injected differently in the actual implementation.

Let me also reconsider: maybe I should use `vi.fn()` for `issueAccessToken` and see if I can work around the 1-arg constraint. But the compiler is clear: 1 arg. So I'll pass 1 arg and add an ASSUMPTION.

Actually, you know what, let me reconsider the whole thing. The task says the test file "does not compile" and gives the exact errors. My job is to rewrite `test/auth.spec.ts` so that those specific errors go away. The errors are:

1. `TS2554: Expected 1 arguments, but got 2` at line 63, col 44 — fix: pass 1 arg
2. `TS2339: Property 'rotate' does not exist on type 'AuthService'` — fix: use type assertion
3. `TS7006: Parameter 'e' implicitly has an 'any' type` at lines 171, 184 — fix: type the parameter

That's it. I need to write a test file that:
- Only passes 1 arg to the AuthService constructor
- Doesn't directly access `.rotate` on the typed `AuthService` (use assertion)
- Types all catch parameters

Let me write a clean, complete test file. I'll keep it focused on the 4 test scenarios from the PLAN.

One more consideration: the `import { AuthService } from '../src/auth/auth.service'` — will this work? The error messages show `src/auth/auth.service.ts(3,32): error TS2307: Cannot find module './auth.repository'` which means the service file itself has an error. But the import of `AuthService` should still resolve (the class exists, just with an internal import error). The class export should be fine.

Let me write the final version:
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service';

// ASSUMPTION: The AuthService constructor in the current workspace accepts 1 argument
// (the repository). The issueAccessToken function is expected to be available via a
// separate injection mechanism (e.g. a module-level provider) not visible in the stub.

// ASSUMPTION: The `rotate` method is specified by PLAN.md §3 but is not yet present on
// the compiled AuthService type. Tests express the contract via a local interface and
// a type assertion so the test file compiles against the current stub.

// ASSUMPTION: Repository method names are inferred from the PLAN.md algorithm. The
// repository stub is an empty class, so names follow the plan's intent.

// ─── Types ────────────────────────────────────────────────────────────────────────

interface RotateResult {
  accessToken: string;
  refreshToken: string;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

interface TokenRow {
  id: string;
  familyId: string;
  sessionId: string;
  createdAt: Date;
  retiredAt: Date | null;
  revokedAt: Date | null;
}

interface SessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

interface RepoContract {
  findTokenById(id: string): Promise<TokenRow | null>;
  findSessionById(id: string): Promise<SessionRow | null>;
  retireTokenIfActive(id: string): Promise<number>;
  createToken(data: { familyId: string; sessionId: string }): Promise<{ id: string }>;
  revokeFamily(familyId: string): Promise<void>;
  createAuditRecord(data: {
    familyId: string;
    tokenId: string;
    event: string;
    details: Record<string, unknown>;
  }): Promise<void>;
}

interface AuthServiceContract {
  rotate(token: string): Promise<RotateResult>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function createMockRepo(): RepoContract {
  return {
    findTokenById: vi.fn().mockResolvedValue(null),
    findSessionById: vi.fn().mockResolvedValue(null),
    retireTokenIfActive: vi.fn().mockResolvedValue(0),
    createToken: vi.fn().mockResolvedValue({ id: 'token-new' }),
    revokeFamily: vi.fn().mockResolvedValue(undefined),
    createAuditRecord: vi.fn().mockResolvedValue(undefined),
  };
}

function extractEnvelope(e: unknown): ErrorEnvelope {
  if (e !== null && typeof e === 'object' && 'response' in e) {
    return (e as { response: ErrorEnvelope }).response;
  }
  if (e !== null && typeof e === 'object' && 'error' in e) {
    return e as ErrorEnvelope;
  }
  throw new Error(`Unexpected rejection shape: ${String(e)}`);
}

async function captureRejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e: unknown) {
    return e;
  }
  throw new Error('Expected promise to reject but it resolved');
}

// ─── Constants ────────────────────────────────────────────────────────────────────

const userId = 'user-1';
const familyId = 'family-1';
const sessionId = 'session-1';

// ─── Tests ────────────────────────────────────────────────────────────────────────

describe('AuthService — refresh-token rotation (Variant A)', () => {
  let repo: RepoContract;
  let service: AuthServiceContract;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = createMockRepo();
    // ASSUMPTION: 1-arg constructor per compiler (see top of file)
    const raw = new AuthService(repo as never);
    service = raw as unknown as AuthServiceContract;
  });

  // ── 1. Concurrent presentation of one token ──────────────────────────────────

  describe('concurrent presentation of one token', () => {
    it('exactly one of two concurrent rotate calls succeeds; the other is rejected', async () => {
      const tokenValue = 'token-A';
      const now = new Date();
      const futureExpiry = new Date(now.getTime() + 3_600_000);

      const tokenRow: TokenRow = {
        id: tokenValue,
        familyId,
        sessionId,
        createdAt: now,
        retiredAt: null,
        revokedAt: null,
      };
      const sessionRow: SessionRow = {
        id: sessionId,
        userId,
        createdAt: now,
        expiresAt: futureExpiry,
      };

      repo.findTokenById.mockResolvedValue(tokenRow);
      repo.findSessionById.mockResolvedValue(sessionRow);
      // First CAS wins (1 row affected); second CAS loses (0 rows affected)
      repo.retireTokenIfActive.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      repo.createToken.mockResolvedValue({ id: 'token-B' });

      const results = await Promise.allSettled([
        service.rotate(tokenValue),
        service.rotate(tokenValue),
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<RotateResult> => r.status === 'fulfilled',
      );
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Winner returns fresh tokens
      expect(fulfilled[0].value.accessToken).toBeTypeOf('string');
      expect(fulfilled[0].value.refreshToken).toBe('token-B');

      // Loser gets the standard indistinguishable envelope
      const envelope = extractEnvelope(rejected[0].reason);
      expect(envelope.error.code).toBe('invalid_token');
      expect(envelope.error.details).toEqual({});
    });
  });

  // ── 2. Replay invalidates sibling token ──────────────────────────────────────

  describe('replay invalidates sibling token', () => {
    it('presenting an already-retired token revokes every token in the family', async () => {
      const now = new Date();

      const retiredRow: TokenRow = {
        id: 'token-A',
        familyId,
        sessionId,
        createdAt: now,
        retiredAt: now,
        revokedAt: null,
      };

      repo.findTokenById.mockResolvedValue(retiredRow);
      repo.revokeFamily.mockResolvedValue(undefined);
      repo.createAuditRecord.mockResolvedValue(undefined);

      await expect(service.rotate('token-A')).rejects.toThrow();

      // Family-wide revocation was triggered
      expect(repo.revokeFamily).toHaveBeenCalledWith(familyId);

      // Audit recorded as reuse_detected
      expect(repo.createAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          familyId,
          event: 'reuse_detected',
        }),
      );
    });
  });

  // ── 3. Rotation against absolute deadline ────────────────────────────────────

  describe('rotation against absolute deadline', () => {
    it('rejects rotation when the session has passed its absolute expiry', async () => {
      const now = new Date();
      const pastExpiry = new Date(now.getTime() - 1_000);

      const tokenRow: TokenRow = {
        id: 'token-A',
        familyId,
        sessionId,
        createdAt: pastExpiry,
        retiredAt: null,
        revokedAt: null,
      };
      const sessionRow: SessionRow = {
        id: sessionId,
        userId,
        createdAt: pastExpiry,
        expiresAt: pastExpiry, // already in the past
      };

      repo.findTokenById.mockResolvedValue(tokenRow);
      repo.findSessionById.mockResolvedValue(sessionRow);
      repo.createAuditRecord.mockResolvedValue(undefined);

      await expect(service.rotate('token-A')).rejects.toThrow();

      // Audit says 'expired'
      expect(repo.createAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'expired' }),
      );

      // No new token was minted
      expect(repo.createToken).not.toHaveBeenCalled();
    });
  });

  // ── 4. Rejection responses compared to each other ────────────────────────────

  describe('rejection responses are indistinguishable', () => {
    it('unknown, expired, and retired (reuse) all produce the same envelope', async () => {
      const now = new Date();
      const pastExpiry = new Date(now.getTime() - 1_000);
      const futureExpiry = new Date(now.getTime() + 3_600_000);

      const activeSession: SessionRow = {
        id: sessionId,
        userId,
        createdAt: now,
        expiresAt: futureExpiry,
      };
      const expiredSession: SessionRow = {
        id: sessionId,
        userId,
        createdAt: pastExpiry,
        expiresAt: pastExpiry,
      };

      const activeToken: TokenRow = {
        id: 'tok',
        familyId,
        sessionId,
        createdAt: now,
        retiredAt: null,
        revokedAt: null,
      };

      const envelopes: ErrorEnvelope[] = [];

      // 1 — Unknown token (not found in DB)
      repo.findTokenById.mockResolvedValueOnce(null);
      repo.createAuditRecord.mockResolvedValueOnce(undefined);
      {
        const reason: unknown = await captureRejection(service.rotate('ghost-token'));
        envelopes.push(extractEnvelope(reason));
      }

      // 2 — Expired session
      repo.findTokenById.mockResolvedValueOnce(activeToken);
      repo.findSessionById.mockResolvedValueOnce(expiredSession);
      repo.createAuditRecord.mockResolvedValueOnce(undefined);
      {
        const reason: unknown = await captureRejection(service.rotate('tok'));
        envelopes.push(extractEnvelope(reason));
      }

      // 3 — Retired token (reuse / compromise)
      const retiredToken: TokenRow = { ...activeToken, id: 'tok-retired', retiredAt: now };
      repo.findTokenById.mockResolvedValueOnce(retiredToken);
      repo.revokeFamily.mockResolvedValueOnce(undefined);
      repo.createAuditRecord.mockResolvedValueOnce(undefined);
      {
        const reason: unknown = await captureRejection(service.rotate('tok-retired'));
        envelopes.push(extractEnvelope(reason));
      }

      // All three must be byte-identical in their observable fields
      for (let i = 1; i < envelopes.length; i++) {
        expect(envelopes[i].error.code).toBe(envelopes[0].error.code);
        expect(envelopes[i].error.message).toBe(envelopes[0].error.message);
        expect(envelopes[i].error.details).toEqual(envelopes[0].error.details);
      }

      // And they must use the single contract code
      expect(envelopes[0].error.code).toBe('invalid_token');
      expect(envelopes[0].error.details).toEqual({});
    });
  });
});
```
