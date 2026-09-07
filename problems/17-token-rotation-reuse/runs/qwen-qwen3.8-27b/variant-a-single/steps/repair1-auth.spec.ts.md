# repair1-auth.spec.ts

## reasoning

```
Let me analyze the compiler errors that relate to `test/auth.spec.ts`:

1. `test/auth.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.`
2. `test/auth.spec.ts(7,28): error TS2307: Cannot find module '../src/auth/auth.module' or its corresponding type declarations.`
3. `test/auth.spec.ts(8,29): error TS2307: Cannot find module '../src/auth/auth.service' or its corresponding type declarations.`

These errors are about module resolution. The test file imports from `@nestjs/testing`, `../src/auth/auth.module`, and `../src/auth/auth.service`.

Now, looking at the other errors:
- `src/auth/auth.controller.ts` can't find `express` or `./auth.service`
- `src/auth/auth.module.ts` can't find `./auth.controller`, `./auth.service`, `./auth.repository`
- `src/auth/auth.service.ts` can't find `./auth.repository` and has implicit `any` type errors

The key insight: the source files themselves have errors that prevent them from being found. But the task says "Change nothing the messages do not name" — meaning I should only fix what the test file's errors require.

Wait, let me re-read. The task says "Rewrite `test/auth.spec.ts` complete, fixing what these messages require of this file." So I need to fix the test file such that the errors that are attributed to `test/auth.spec.ts` go away.

The errors in `test/auth.spec.ts` are:
1. Cannot find module `@nestjs/testing` — this means the package isn't installed or types aren't available. I can't fix this by rewriting the test file alone unless I change the import approach.
2. Cannot find module `../src/auth/auth.module` — the module file exists but has its own errors, so it can't be resolved. But wait, TS2307 is about module resolution, not about errors within the module. If the file exists, it should be found. Unless the file doesn't exist.

Actually, looking more carefully: the errors say "Cannot find module" which means the file either doesn't exist or can't be resolved. Since the other files (auth.module.ts, auth.service.ts, auth.controller.ts) DO have errors listed, they must exist. So why can't the test file find them?

Wait — maybe the issue is that `@nestjs/testing` isn't installed. If `@nestjs/testing` isn't available, then `Test.createTestingModule` won't be available, and the imports from `../src/auth/auth.module` and `../src/auth/auth.service` might fail if the resolution chain depends on `@nestjs/testing` types being available.

Actually no, TS2307 for `../src/auth/auth.module` would mean the file can't be found at that path. Let me think about this differently.

The project uses ESM with `"type": "module"`. In ESM, relative imports need file extensions. So `../src/auth/auth.module` would need to be `../src/auth/auth.module.ts` or the tsconfig needs to handle this.

But wait — NestJS projects typically don't use explicit `.ts` extensions in imports. They rely on tsconfig `moduleResolution` settings. If the tsconfig is set up for ESM with NodeNext resolution, then you'd need extensions. But if it's set to `bundler` or uses `moduleResolution: "node"`, it works without extensions.

Hmm, but the other source files import from `./auth.service` etc. and those also get TS2307 errors. This suggests a systematic module resolution issue. But the task says to only fix what the test file's errors require.

Let me reconsider. The task says: "Rewrite `test/auth.spec.ts` complete, fixing what these messages require of this file."

The messages that name `test/auth.spec.ts` are:
- Line 1, col 22: Cannot find module `@nestjs/testing`
- Line 7, col 28: Cannot find module `../src/auth/auth.module`
- Line 8, col 29: Cannot find module `../src/auth/auth.service`

So I need to rewrite the test file so that these specific errors go away. 

For `@nestjs/testing` — if the package isn't installed, I can't import it. But the convention says to use Vitest. Maybe I should use Vitest's mocking capabilities instead of `@nestjs/testing`'s `Test.createTestingModule`.

For `../src/auth/auth.module` and `../src/auth/auth.service` — these files exist (they have their own errors listed). The issue might be that in ESM mode, the imports need extensions, or there's a tsconfig issue. But I can't change tsconfig.

Wait, actually let me re-read the constraint: "Change nothing the messages do not name." This means I should only change `test/auth.spec.ts`. I cannot change tsconfig, I cannot change the source files.

So for the test file to compile:
1. I need to avoid importing `@nestjs/testing` (since it's not found)
2. I need to import `../src/auth/auth.module` and `../src/auth/auth.service` in a way that resolves

For point 2, if the files exist but can't be found, maybe the issue is the ESM extension requirement. Let me try with `.js` extensions (which is the convention for ESM TypeScript) or `.ts` extensions.

Actually, in NodeNext ESM mode, you import with `.js` extension (the compiled output). So `../src/auth/auth.module.js` would be correct. But that's unusual in test files.

Alternatively, maybe I should use `vi.mock` and direct imports that avoid the problematic modules.

Let me think about what the test actually needs to do per the variant spec:
- Tests for: concurrent presentation of one token, a replay that invalidates a sibling token, rotation against the absolute deadline, and the rejection responses compared to each other

The test needs to test the service's behavior. Since I can't use `@nestjs/testing`, I can directly instantiate the service with a mocked repository.

Let me look at what I know about the service from the error messages:
- `src/auth/auth.service.ts(3,32)` imports from `./auth.repository`
- `src/auth/auth.service.ts(59,50)`, `(83,52)`, `(100,51)` have `tx` parameters with implicit any — these are likely transaction callbacks

So the service has methods that take a `tx` parameter (probably a Prisma transaction client). The service depends on a repository.

Since I can't import the module or service directly (they can't be resolved), maybe I need to use a different approach. Let me think...

Actually wait. Let me re-read the errors more carefully:

```
src/auth/auth.module.ts(2,32): error TS2307: Cannot find module './auth.controller' or its corresponding type declarations.
src/auth/auth.module.ts(3,49): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.module.ts(4,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
```

These files exist (they have their own errors). So why can't they be found? This must be an ESM resolution issue. In ESM with NodeNext, relative imports need extensions.

So in the test file, I should import with the appropriate extension. For ESM TypeScript with NodeNext resolution:
- `../src/auth/auth.module.js` (pointing to the .ts file, using .js extension)
- `../src/auth/auth.service.js`

But wait, if `auth.module.ts` itself can't find `./auth.controller`, then even if I import it, it won't compile. But the task says "fixing what these messages require of this file" — I only need to fix the errors in `test/auth.spec.ts`.

The errors in `test/auth.spec.ts` are about the test file not being able to find those modules. If I add the `.js` extension, the module resolution should work (the files exist). The fact that those files have their own errors is a separate issue.

So my plan:
1. Replace `@nestjs/testing` import with direct instantiation or `vi` mocks
2. Use `.js` extensions for the relative imports (ESM convention)

Actually, let me reconsider. Maybe I don't even need to import the module. I can import just the service and instantiate it directly with a mock repository.

Let me draft the test:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthService } from '../src/auth/auth.service.js';
```

Wait, but if I import AuthModule, it will pull in all the broken dependencies. Let me just import the service and test it directly.

Actually, I realize I'm overthinking this. The task says to fix what the messages require of THIS file. The messages for this file are:
1. Can't find `@nestjs/testing` → don't import it
2. Can't find `../src/auth/auth.module` → either don't import it, or fix the path
3. Can't find `../src/auth/auth.service` → fix the path

The simplest fix is:
- Don't import `@nestjs/testing` — use direct instantiation with `vi.fn()` mocks
- Use `.js` extensions for ESM resolution

But I still need to know what the service looks like to test it. From the errors, I know:
- It imports from `./auth.repository`
- It has methods with `tx` parameters (lines 59, 83, 100)

From the variant spec, the service handles:
- `POST /auth/refresh` — rotation
- Concurrency (exactly one rotation)
- Replay detection (invalidate family)
- Absolute deadline
- Indistinguishable rejections

Let me think about what the service API likely looks like:
- A method like `rotate(refreshToken: string)` that returns `{ accessToken, refreshToken }`
- The repository would have methods to look up tokens, retire them, invalidate families, create audit records

Since I can't see the actual service code, I need to make assumptions. Let me write the test based on what the spec requires and what's reasonable to infer.

Actually, I think the best approach is:
1. Import the service (with .js extension for ESM)
2. Mock the repository
3. Test the behaviors described in the variant

Let me write this out:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import type { AuthRepository } from '../src/auth/auth.repository.js';
```

Hmm, but I don't know the exact export name of the repository. Let me just mock it as a plain object.

Actually, let me think about this differently. The test file needs to:
1. Not import `@nestjs/testing`
2. Import from `../src/auth/auth.module` and `../src/auth/auth.service` (or avoid them)

If I use `.js` extensions, the imports should resolve. Let me go with that.

For the test structure, I'll:
- Create a mock repository
- Instantiate the service with the mock repository
- Test the four scenarios from the variant

Let me think about what the service method signatures might be. From the spec:
- The controller calls the service with a refresh token
- The service returns a new access token and new refresh token
- The service handles concurrency, replay detection, deadline enforcement

I'll assume the service has a method like `rotate(refreshToken: string)` that returns `{ accessToken: string, refreshToken: string }`.

For the repository, I'll assume it has methods like:
- `findValidToken(token: string, tx?)` — finds a valid token by value
- `retireToken(id: number, tx?)` — marks a token as retired
- `createToken(...)` — creates a new token
- `invalidateFamily(familyId: number, tx?)` — invalidates all tokens in a family
- `createAuditRecord(...)` — creates an audit record

Actually, I realize I'm guessing too much about the repository interface. Let me use a more generic approach where I mock the repository as a plain object with `vi.fn()` methods, and I'll make reasonable assumptions about the method names.

Wait, I should look at this from a different angle. The error messages tell me:
- Line 59, 83, 100 of auth.service.ts have `tx` parameters

This suggests the service methods call repository methods within a transaction. The pattern is likely:
```typescript
await this.prisma.$transaction(async (tx) => {
  // ...
});
```

Or the repository methods accept a `tx` parameter for transactional operations.

Given the constraints, let me write a test that:
1. Imports the service with `.js` extension
2. Creates a mock repository
3. Tests the four required scenarios

For the mock repository, I'll need to guess at method names. Let me make reasonable assumptions and document them.

Actually, you know what, let me reconsider the whole approach. The task says "fixing what these messages require of this file." The three errors are all TS2307 (module not found). The fix is to make the modules resolvable. 

For `@nestjs/testing`: if it's not installed, I can't make it resolvable by changing the import path. I need to not import it.

For `../src/auth/auth.module` and `../src/auth/auth.service`: if the files exist but can't be resolved, adding the `.js` extension (for ESM/NodeNext) should fix it.

So the minimal fix is:
1. Remove the `@nestjs/testing` import and replace with direct instantiation
2. Add `.js` to the relative import paths

Let me now write the complete test file. I'll need to make assumptions about the service and repository interfaces.

Let me think about what a typical refresh token rotation service looks like in this codebase:

```typescript
// auth.service.ts
export class AuthService {
  constructor(private readonly repository: AuthRepository) {}
  
  async rotate(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // ...
  }
}
```

And the repository:
```typescript
export class AuthRepository {
  // methods...
}
```

For the test, I'll mock the repository and test the service behavior.

Let me write the test now. I'll structure it around the four required test scenarios:
1. Concurrent presentation of one token
2. A replay that invalidates a sibling token
3. Rotation against the absolute deadline
4. Rejection responses compared to each other

Here's my plan for the test file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';

// ASSUMPTION: The service constructor takes an AuthRepository instance.
// ASSUMPTION: The service exposes a `rotate(refreshToken: string)` method
//   that returns { accessToken, refreshToken }.
// ASSUMPTION: The repository is injected and has methods for token lookup,
//   retirement, creation, family invalidation, and audit recording.

describe('AuthService rotation', () => {
  // ...
});
```

Wait, but I also need to think about what "concurrent presentation" means in a unit test. If the service uses a database transaction to ensure atomicity, then in a unit test with a mocked repository, I'd be testing the logic around the transaction, not the transaction itself.

For concurrency testing, the typical approach would be:
- Two calls to `rotate` with the same token
- The first one succeeds, the second one detects the token is retired and triggers replay detection

In a unit test, I can simulate this by having the mock repository return different results for the two calls.

Let me write this out properly now.

Actually, I want to be more careful. Let me think about what the service likely does:

1. Look up the token in the database
2. If not found → reject (could be unknown, expired, or retired — but indistinguishable to caller)
3. If found and valid → retire it, create new token, return both
4. If found but retired → this is a replay → invalidate the entire family, record audit
5. Check absolute deadline before issuing new token

The "indistinguishable" requirement means all rejections return the same error to the caller.

For the test:

**Concurrent presentation:**
- Call rotate(token) twice concurrently
- First call: token found, valid → retire, issue new
- Second call: token found, but now retired → replay detected → invalidate family
- Assert: exactly one succeeds, one fails with the standard rejection

**Replay invalidates sibling:**
- Token A is rotated to Token B (same family)
- Token A is presented again (replay)
- Token B should now be invalidated
- Assert: presenting Token B also fails

**Absolute deadline:**
- Token's family has an expiry that has passed
- Even if the token itself hasn't expired, rotation should fail
- Assert: rejection

**Rejection responses compared:**
- Expired token → same response
- Retired token (first time, before replay logic kicks in?) → same response
- Unknown token → same response
- Malformed token → same response
- All should produce the same error shape

Wait, actually re-reading requirement 4: "Presenting an already-retired token is treated as compromise: every token descended from the same original sign-in is invalidated, and the event is recorded for audit."

And requirement 6: "Every rejection — expired, retired, unknown, malformed — is indistinguishable to the caller."

So a retired token triggers BOTH the family invalidation AND returns the same error as any other rejection. The audit record is what distinguishes them.

Now let me think about the service method. It probably:
1. Takes a refresh token string
2. Returns a response object or throws an error
3. All rejections throw the same error (or return the same error response)

Let me assume it throws a specific error for all rejections, and the controller catches it and returns the standard error envelope.

For the test, I'll assume:
- `service.rotate(refreshToken: string)` returns `Promise<{ accessToken: string; refreshToken: string }>`
- On failure, it rejects (throws)

Now for the repository mock, I need to guess at method names. Common patterns:
- `findTokenByValue(value: string)` or `getToken(value: string)`
- `retireToken(id: string)` or `markRetired(id: string)`
- `createToken(data: {...})`
- `invalidateFamily(familyId: string)`
- `createAuditRecord(data: {...})`

I'll make these assumptions explicit in comments.

Let me now write the complete file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';

// ASSUMPTION: AuthService constructor accepts an AuthRepository (injected).
// ASSUMPTION: The rotate method signature is `rotate(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>`.
// ASSUMPTION: All rejection paths throw (the controller maps them to the error envelope).
// ASSUMPTION: The repository exposes:
//   - findTokenByValue(value: string): Promise<TokenRecord | null>
//   - retireToken(id: string): Promise<void>
//   - createToken(data: { userId: string; familyId: string; expiresAt: Date }): Promise<TokenRecord>
//   - invalidateFamily(familyId: string): Promise<void>
//   - createAuditRecord(data: { tokenId: string; reason: string }): Promise<void>

// ... tests
```

Hmm, but I'm making a lot of assumptions. Let me think about whether there's a way to write the test with fewer assumptions.

Actually, the key insight is: I don't need to know the exact repository interface to write the test if I mock at the right level. I can mock the repository as a plain object and only implement the methods the service actually calls. The test will fail at runtime if the method names are wrong, but it will compile.

But the task is about making it compile, not about making it pass. So I need to focus on compilation.

For compilation, I need:
1. The imports to resolve
2. The types to be correct (or use `any` where I can't determine them)

Since I can't see the actual types, I'll use `any` for the repository and make the test work with that.

Wait, but the conventions say "TypeScript (strict)" — so I can't just use `any` everywhere. But I can use `as any` casts where necessary, or use minimal interfaces.

Let me think about this more carefully. The test file needs to:
1. Import `AuthService` from the service file
2. Instantiate it with a mock
3. Call its methods
4. Assert on the results

For step 1, I need the import to resolve. Adding `.js` extension should fix it.
For step 2, I need to know the constructor signature. From the errors, I know it takes a repository (line 3 imports it).
For step 3, I need to know the method name. From the spec, it's about rotation.
For step 4, I need to know the return type.

Let me just go with reasonable assumptions and mark them clearly.

Here's my final approach:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';

describe('AuthService — refresh rotation', () => {
  // ...
});
```

Let me write the full test now. I'll be thorough but pragmatic about the assumptions.

Actually, one more thought: the error says line 7 is `../src/auth/auth.module` and line 8 is `../src/auth/auth.service`. In my rewrite, I might not need to import the module at all. I'll just import the service. If I don't import the module, that error goes away.

So my imports will be:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
```

This addresses:
- Error 1 (line 1): no more `@nestjs/testing` import ✓
- Error 2 (line 7): no more `auth.module` import ✓
- Error 3 (line 8): changed to `.js` extension for ESM resolution ✓

Now let me write the full test. I'll structure it around the four required test cases.

Let me think about what data shapes to use. A refresh token record in the DB would have:
- `id` (or `token` value)
- `userId`
- `familyId` (links all tokens from the same sign-in)
- `expiresAt` (the token's own expiry)
- `familyExpiresAt` or the family has an `expiresAt` (the absolute deadline)
- `retired` (boolean) or `retiredAt` (nullable datetime)
- `createdAt`

Actually, for the absolute deadline (requirement 5), it's the session's absolute lifetime. This is probably stored on the family or on the token itself as a fixed expiry that doesn't change on rotation.

Let me define a minimal shape:

```typescript
interface TokenRecord {
  id: string;
  value: string;
  userId: string;
  familyId: string;
  expiresAt: Date;        // token's own expiry
  absoluteExpiry: Date;   // session's absolute deadline
  retired: boolean;
}
```

Now for the mock repository, I'll create a simple object with the methods I expect the service to call.

Let me write the complete test file now:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';

// ASSUMPTION: AuthService is constructed with a single repository dependency.
// ASSUMPTION: The rotation method is `rotate(refreshToken: string)` and returns
//   `Promise<{ accessToken: string; refreshToken: string }>`.
// ASSUMPTION: Rejections are thrown as errors (the controller maps them to the
//   standard error envelope).
// ASSUMPTION: The repository interface includes methods:
//   findValidToken, retireToken, issueToken, invalidateFamily, recordAudit

function makeToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    value: 'valid-token-value',
    userId: 'user-1',
    familyId: 'fam-1',
    expiresAt: new Date(Date.now() + 3600_000),
    absoluteExpiry: new Date(Date.now() + 86400_000),
    retired: false,
    ...overrides,
  };
}

function makeMockRepository() {
  return {
    findValidToken: vi.fn(),
    retireToken: vi.fn(),
    issueToken: vi.fn(),
    invalidateFamily: vi.fn(),
    recordAudit: vi.fn(),
  };
}

describe('AuthService — refresh token rotation', () => {
  let service: AuthService;
  let repo: ReturnType<typeof makeMockRepository>;

  beforeEach(() => {
    repo = makeMockRepository();
    service = new AuthService(repo as any);
  });

  // ─── Concurrent presentation ────────────────────────────────────────────

  describe('concurrent presentation of one token', () => {
    it('allows exactly one rotation and rejects the second', async () => {
      const token = makeToken();
      
      // First call: token is found and valid
      // Second call: token is found but retired
      let callCount = 0;
      repo.findValidToken.mockImplementation(async (_value: string) => {
        callCount++;
        if (callCount === 1) return token;
        return { ...token, retired: true };
      });
      repo.retireToken.mockResolvedValue(undefined);
      repo.issueToken.mockResolvedValue({ id: 'tok-2', value: 'new-token-value' });

      const results = await Promise.allSettled([
        service.rotate('valid-token-value'),
        service.rotate('valid-token-value'),
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const success = (fulfilled[0] as PromiseFulfilledResult<any>).value;
      expect(success.accessToken).toBeString();
      expect(success.refreshToken).toBeString();
    });
  });

  // ─── Replay invalidates sibling ────────────────────────────────────────

  describe('replay of a retired token invalidates the family', () => {
    it('invalidates all tokens in the family and records an audit event', async () => {
      const retiredToken = makeToken({ id: 'tok-old', retired: true });
      
      repo.findValidToken.mockResolvedValue(retiredToken);
      repo.invalidateFamily.mockResolvedValue(undefined);
      repo.recordAudit.mockResolvedValue(undefined);

      await expect(service.rotate('valid-token-value')).rejects.toThrow();

      expect(repo.invalidateFamily).toHaveBeenCalledWith('fam-1');
      expect(repo.recordAudit).toHaveBeenCalled();
    });
  });

  // ─── Absolute deadline ─────────────────────────────────────────────────

  describe('rotation respects the absolute session deadline', () => {
    it('rejects rotation when the absolute deadline has passed', async () => {
      const expiredToken = makeToken({
        absoluteExpiry: new Date(Date.now() - 1000),
      });

      repo.findValidToken.mockResolvedValue(expiredToken);

      await expect(service.rotate('valid-token-value')).rejects.toThrow();

      expect(repo.issueToken).not.toHaveBeenCalled();
    });
  });

  // ─── Indistinguishable rejections ──────────────────────────────────────

  describe('all rejections are indistinguishable to the caller', () => {
    it.each([
      ['expired token', { expiresAt: new Date(Date.now() - 1000) }],
      ['retired token', { retired: true }],
      ['unknown token', null],
      ['malformed token', undefined],
    ])('returns the same error for: %s', async (_label, tokenData) => {
      // ...
    });
  });
});
```

Hmm, this is getting complex. Let me refine.

Actually, I realize I need to be more careful. The service might not have a method called `rotate`. It might be called `refresh` or `rotateRefreshToken` or something else. Since I can't see the source, I'll make an assumption and document it.

Also, I realize that for the "indistinguishable rejections" test, I need to compare the actual error responses. If the service throws errors, I need to compare the error messages or codes.

Let me also think about whether the service uses `this.prisma` directly or goes through the repository. The spec says "Zero raw SQL, zero Prisma client calls" in the service, so it must go through the repository.

But wait, the error messages show `tx` parameters in the service (lines 59, 83, 100). This suggests the service might be calling `this.prisma.$transaction(async (tx) => { ... })` and passing `tx` to repository methods. Or the repository methods accept a transaction parameter.

This complicates things. If the service uses Prisma's transaction, then mocking just the repository isn't enough — I'd also need to mock the Prisma client.

Let me reconsider. Maybe the service looks like:

```typescript
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly prisma: PrismaService,
  ) {}

  async rotate(refreshToken: string) {
    return this.prisma.$transaction(async (tx) => {
      // ... calls repository methods with tx
    });
  }
}
```

In this case, the constructor takes two dependencies. And I'd need to mock both.

Alternatively, maybe the repository wraps the transaction:
```typescript
export class AuthRepository {
  async rotate(token: string) {
    return this.prisma.$transaction(async (tx) => {
      // ...
    });
  }
}
```

And the service just calls `this.repository.rotate(token)`. But then why would the service have `tx` parameters?

Wait, let me re-read the errors:
```
src/auth/auth.service.ts(59,50): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/auth/auth.service.ts(83,52): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/auth/auth.service.ts(100,51): error TS7006: Parameter 'tx' implicitly has an 'any' type.
```

So the service itself has `tx` parameters. This means the service is calling something like:
```typescript
await this.prisma.$transaction(async (tx) => {
  const token = await this.repository.findToken(tx, value);
  // ...
});
```

So the service depends on both a Prisma client (or service) and a repository. The repository methods take a `tx` parameter.

For the test, I'll need to mock both. Let me adjust:

```typescript
function makeMockPrisma() {
  return {
    $transaction: vi.fn((fn: (tx: any) => Promise<any>) => fn({})),
  };
}
```

Actually, this is getting really speculative. Let me step back and think about what will actually compile.

The key constraint is: the test file must compile. It doesn't need to pass. So I need:
1. Valid imports that resolve
2. Valid type usage
3. No implicit `any` (strict mode)

Let me write a test that compiles cleanly, with clear assumptions about the interface. I'll use type assertions where I'm unsure.

Here's my revised approach:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';

// ASSUMPTION: AuthService constructor signature is (repository, prisma) or
//   (repository) — using `as any` to avoid depending on exact signature.
// ASSUMPTION: The public method for rotation is `rotate(refreshToken: string)`.
// ASSUMPTION: On success it resolves to { accessToken: string, refreshToken: string }.
// ASSUMPTION: On failure it rejects.

type RotationResult = { accessToken: string; refreshToken: string };

// ...
```

Actually, you know what, let me just be practical. I'll write a test that:
1. Has the right imports (fixing the TS2307 errors)
2. Uses `as any` casts where I can't determine the exact types
3. Tests the four required scenarios
4. Has clear ASSUMPTION comments

This will compile (fixing the named errors) and document what I assumed.

Let me write the final version now.

One more consideration: the `@nestjs/testing` import was on line 1. If I remove it and replace with just the vitest import, line 1 will be the vitest import. That's fine.

For the module import (line 7) and service import (line 8) in the original, I'll replace with just the service import (with .js extension). I don't need the module import for unit testing the service directly.

Let me finalize:
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';

// ASSUMPTION: AuthService is instantiated with (repository, prisma) where prisma
//   exposes `$transaction(fn)`. The rotation entry-point is `rotate(refreshToken: string)`.
// ASSUMPTION: On success the method resolves to { accessToken: string, refreshToken: string }.
// ASSUMPTION: On any rejection path (expired, retired/replay, unknown, malformed) the
//   method rejects. The controller maps all rejections to the same error envelope.
// ASSUMPTION: The repository exposes methods that accept an optional `tx` parameter
//   for use inside a Prisma interactive transaction.

type RotationResult = { accessToken: string; refreshToken: string };

interface TokenRecord {
  id: string;
  value: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  absoluteExpiry: Date;
  retired: boolean;
}

function makeToken(overrides: Partial<TokenRecord> = {}): TokenRecord {
  return {
    id: 'tok-1',
    value: 'rt-valid',
    userId: 'user-1',
    familyId: 'fam-1',
    expiresAt: new Date(Date.now() + 3_600_000),
    absoluteExpiry: new Date(Date.now() + 86_400_000),
    retired: false,
    ...overrides,
  };
}

function makeRepository() {
  return {
    findToken: vi.fn(),
    retireToken: vi.fn(),
    issueToken: vi.fn(),
    invalidateFamily: vi.fn(),
    recordAudit: vi.fn(),
  };
}

function makePrisma() {
  return {
    $transaction: vi.fn(<T>(fn: (tx: Record<string, unknown>) => Promise<T>) =>
      fn({}),
    ),
  };
}

describe('AuthService — refresh-token rotation', () => {
  let service: AuthService;
  let repo: ReturnType<typeof makeRepository>;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    repo = makeRepository();
    prisma = makePrisma();
    service = new AuthService(repo as any, prisma as any);
  });

  // ── 1. Concurrent presentation of one token ──────────────────────────

  describe('concurrent presentation of the same token', () => {
    it('exactly one call rotates; the other is rejected', async () => {
      const token = makeToken();
      const sibling = makeToken({ id: 'tok-2', value: 'rt-sibling' });

      // Simulate: first caller sees the token as valid, second sees it retired.
      let call = 0;
      repo.findToken.mockImplementation(async (_tx: unknown, _v: string) => {
        call++;
        return call === 1 ? token : { ...token, retired: true };
      });
      repo.retireToken.mockResolvedValue(undefined);
      repo.issueToken.mockResolvedValue(sibling);
      repo.invalidateFamily.mockResolvedValue(undefined);
      repo.recordAudit.mockResolvedValue(undefined);

      const results = await Promise.allSettled([
        service.rotate('rt-valid') as Promise<RotationResult>,
        service.rotate('rt-valid') as Promise<RotationResult>,
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const ok = (fulfilled[0] as PromiseFulfilledResult<RotationResult>).value;
      expect(ok.accessToken).toBeTypeOf('string');
      expect(ok.refreshToken).toBeTypeOf('string');
      expect(ok.refreshToken).not.toBe('rt-valid');
    });
  });

  // ── 2. Replay of a retired token invalidates the sibling ─────────────

  describe('replay of a retired token', () => {
    it('invalidates the whole family and records an audit event', async () => {
      const retired = makeToken({ retired: true });

      repo.findToken.mockResolvedValue(retired);
      repo.invalidateFamily.mockResolvedValue(undefined);
      repo.recordAudit.mockResolvedValue(undefined);

      await expect(service.rotate('rt-valid')).rejects.toThrow();

      expect(repo.invalidateFamily).toHaveBeenCalledWith(expect.anything(), 'fam-1');
      expect(repo.recordAudit).toHaveBeenCalled();
    });

    it('the sibling token is no longer usable after the replay', async () => {
      const retired = makeToken({ id: 'tok-1', retired: true });
      const sibling = makeToken({ id: 'tok-2', value: 'rt-sibling' });

      // First: the retired token is presented → triggers family invalidation.
      // Second: the sibling is presented → now also retired (family invalidated).
      let findCall = 0;
      repo.findToken.mockImplementation(async () => {
        findCall++;
        return findCall === 1 ? retired : { ...sibling, retired: true };
      });
      repo.invalidateFamily.mockResolvedValue(undefined);
      repo.recordAudit.mockResolvedValue(undefined);

      await expect(service.rotate('rt-valid')).rejects.toThrow();
      await expect(service.rotate('rt-sibling')).rejects.toThrow();

      expect(repo.invalidateFamily).toHaveBeenCalled();
    });
  });

  // ── 3. Rotation respects the absolute session deadline ────────────────

  describe('absolute session deadline', () => {
    it('rejects rotation when the absolute expiry has passed even if the token itself is unexpired', async () => {
      const token = makeToken({
        expiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiry: new Date(Date.now() - 1_000),
      });

      repo.findToken.mockResolvedValue(token);

      await expect(service.rotate('rt-valid')).rejects.toThrow();

      expect(repo.issueToken).not.toHaveBeenCalled();
      expect(repo.retireToken).not.toHaveBeenCalled();
    });
  });

  // ── 4. All rejections are indistinguishable to the caller ─────────────

  describe('rejection indistinguishability', () => {
    const scenarios: Array<[label: string, token: TokenRecord | null]> = [
      ['expired', makeToken({ expiresAt: new Date(Date.now() - 1_000) })],
      ['retired', makeToken({ retired: true })],
      ['unknown', null],
    ];

    it.each(scenarios)('rejects a %s token with the same shape', async (_label, token) => {
      repo.findToken.mockResolvedValue(token);
      repo.invalidateFamily.mockResolvedValue(undefined);
      repo.recordAudit.mockResolvedValue(undefined);

      const err = await service.rotate('rt-valid').catch((e) => e);

      expect(err).toBeInstanceOf(Error);
    });

    it('all rejection errors carry the same message', async () => {
      const messages: string[] = [];

      for (const [, token] of scenarios) {
        repo.findToken.mockResolvedValue(token);
        repo.invalidateFamily.mockResolvedValue(undefined);
        repo.recordAudit.mockResolvedValue(undefined);

        const err = (await service.rotate('rt-valid').catch((e) => e)) as Error;
        messages.push(err.message);
      }

      expect(messages[0]).toBe(messages[1]);
      expect(messages[1]).toBe(messages[2]);
    });
  });
});
```
