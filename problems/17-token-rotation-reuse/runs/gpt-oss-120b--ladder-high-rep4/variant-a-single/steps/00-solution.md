# solution

## reasoning

```
We need to implement refresh token rotation with reuse detection. Provide Prisma schema + migration (but migration file likely not needed; just schema). Provide NestJS module: controller, service, repository. Provide tests. Provide SECURITY.md. The repository structure is given earlier: src/main.ts, src/app.module.ts, src/<feature>/<feature>.module.ts, src/<feature>/<feature>.controller.ts, src/<feature>/<feature>.service.ts, src/<feature>/<feature>.repository.ts, test/<feature>.spec.ts. So the feature is "auth". But we need to create the refresh token logic. Let's define a new feature folder: auth. So we will have:

src/auth/auth.module.ts
src/auth/auth.controller.ts
src/auth/auth.service.ts
src/auth/auth.repository.ts

Maybe also a DTO file for request? But it's optional.

The problem statement says sign-in and access-token verification already exist; we can assume we have a function issueAccessToken(userId): string that issues a new access token. Also need to issue refresh token. We'll define a utility to issueRefreshToken(userId, familyId, expiresAt, etc.). We'll need token model in Prisma.

We'll need to store refresh tokens with fields: id (uuid), token (string, unique), userId (foreign key), createdAt, expiresAt (absolute deadline of session). Also need to store familyId (or rootSignInId) to link tokens belonging to same session family. Also need to store parentTokenId (maybe). The requirement says "invalidate the whole family" (all tokens descended from same original sign-in). So we can store a column `family_id` referencing the root token or a sign-in record. Simpler: store a field `rootId` referencing the root token's id (the initial token). Or we can store a separate model for session family.

Alternatively, we can store `familyId` as a string or uuid.

Also need a field `is_revoked` (boolean) or `revokedAt` to mark retirement.

We need to detect concurrency: atomic update to retire token if still live (not revoked, not expired). Using Prisma's updateMany with where conditions and checking count.

Implementation: In repository, we will have method `attemptRotateRefreshToken(tokenString)` returning result or null if token already retired. Steps:

- Find token row by token (unique). Must also check if token is not null.
- If not found, treat as unknown token (audit).
- Use a transaction: first, try to update the token row to set `revoked` true and `revokedAt` now if `revoked` = false and `expiresAt` > now (not expired). Use `prisma.refreshToken.updateMany({ where: { token: tokenString, revoked: false, expiresAt: { gt: now } }, data: { revoked: true, revokedAt: now } })`. The result count indicates if we successfully revoked (i.e., token was still active). If count=1 -> succeeded rotation; else token was already revoked or expired.

But the requirement: "Check reuse before expiry" (a token both retired and expired is reuse). So we should check reuse first: If token is already revoked (revoked flag true), then it's reuse (or attack). If token is not revoked but expired (expiresAt <= now), treat as reuse (since it's both retired and expired? Actually they say token both retired and expired is reuse event, not expiry). Wait we must think: token can be retired (revoked) and also expired (its expiry time passed). If both conditions hold, we should treat as reuse, not expiry. So we must check if token is revoked first; if revoked, treat as reuse. Otherwise check expiry: if expired, treat as reuse? Actually they say "Check reuse before expiry: A token that is both retired and expired is a reuse event, not an expiry event." Means that if a token is both retired and expired, we need to treat it as reuse. So the order: 1) if revoked (retired) => reuse. If not revoked, then check expiry: if expired => expiry (but not reuse). So we treat revoked first, then expiry.

Thus, concurrency scenario: Two requests present same valid token. Both call repository to attempt rotation. The first will update token to revoked and succeed; second will try update but find `revoked: false` condition fails; update count 0. It will then treat as reuse (since token is revoked). So concurrency is handled.

Now, for reuse detection: When token is already revoked (or we detect token is revoked), we need to invalidate all tokens in the same family (descendants). So we need to find all tokens with the same familyId (i.e., same root sign-in). And set revoked = true for them. Also we need to audit the event.

Similarly, when token is unknown (not found), treat as unknown token; audit it.

Also need to handle malformed token: if token is missing, or cannot parse? We'll treat token string missing as unknown; maybe also need to validate format. But requirement says to treat all rejections indistinguishably; we still need audit details.

We'll need an AuditLog model in Prisma maybe. Or we can simply log via console. However the requirement: "record the event for audit". Could just be a placeholder; but we can create a model `AuditLog` with fields: id (uuid), event (string), token (string), userId (uuid?), details (Json), createdAt (timestamp). That's a decent approach.

But the spec only says to record event for audit with enough detail; we can have a service that logs using console.warn; but better to store.

Given limited time and file constraints, we can implement a simple console log for audit. The test may assert that audit is called? Not required. But they may test that event is recorded. However they didn't define specifics; we can just call console.log. But we may also add a `auditLog` model.

Nevertheless, implement repository for refresh tokens, with methods:

- findTokenByString(token: string): Promise<RefreshToken | null>
- retireTokenIfActive(token: string, now: Date): Promise<boolean> // returns true if token was active and now revoked.
- revokeFamilyTokens(familyId: string, now: Date): Promise<void>
- createRefreshToken(userId: string, familyId: string, expiresAt: Date): Promise<RefreshToken>

Also create model `refresh_token` (snake_case) with mapping.

In Prisma schema, define model RefreshToken with table name "refresh_token". Fields: id (String @id @default(uuid())), token (String @unique), userId (String), familyId (String) (maybe also parentId?), expiresAt (DateTime), createdAt (DateTime @default(now())), revoked (Boolean @default(false)), revokedAt (DateTime?).

We also need user model, but may exist already. We'll just reference the User model if exists. For this assignment we can define placeholder relation: userId String? but if there is no User model defined, referencing unknown model cause error. Since codebase unknown, we need to make assumption: a `User` model exists. So we can reference like `user User @relation(fields: [userId], references: [id])`. However maybe they used a different naming. To be safe, we can avoid referencing a User model, just store userId as string without foreign key. Since we don't need a relation in tests, we can just store userId.

Thus:

model RefreshToken {
  id         String   @id @default(uuid())
  token      String   @unique @map("token")
  userId     String   @map("user_id")
  familyId   String   @map("family_id")
  expiresAt  DateTime @map("expires_at")
  createdAt  DateTime @default(now()) @map("created_at")
  revoked    Boolean  @default(false) @map("revoked")
  revokedAt  DateTime? @map("revoked_at")
  @@map("refresh_token")
}

Add indexes maybe.

Now, for absolute deadline: At sign-in we create a token with expiresAt set to now + sessionLifetime (e.g., config). Rotation issues new token but with same expiresAt (the family deadline) not extended.

Thus in the service, we need to know the absolute expiry for the family. We'll store `family_expires_at`? Actually we can store `expiresAt` per token (same for all tokens in same family). So new token will be created with same expiresAt as the original token's expiresAt (or family base). The token's expiration time is not changed.

Thus when we rotate token we need to get the original token's expiresAt and familyId and userId and create new token with same familyId and expiresAt. Also maybe generate a new token string random. We'll have a utility function to generate secure random token (e.g., crypto.randomBytes(32).toString('hex')). That is ok.

Now, we need to implement endpoint:

POST /auth/refresh

Accepts JSON body with refreshToken string, optional cookie with name "refresh_token". Precedence: The token in request body overrides cookie (or vice versa). We must define and document which wins when both present. Let's choose that body token takes precedence over cookie. We'll document that in controller comment.

Implementation steps in controller:

- Extract token string: first from body.refreshToken, if defined, else from cookie refresh_token, else reject with BadRequest? But the rejection should be generic. So if token missing, treat as unknown token -> return generic rejection.

- Call service.refresh(tokenString) which returns { accessToken, refreshToken } or throws a custom exception (maybe generic). For generic rejection, we can throw HttpException with status 401 and body { error: {...}}. But spec says that the response is same for all rejections. So we need to have a single error handling method that returns same shape: { error: { code: "...", message: "...", details: {} } }. We can define a custom exception class with fields code and details, and a filter to transform to response. Simpler: in controller catch all errors from service and respond with generic body: { error: { code: "invalid_refresh_token", message: "Invalid refresh token.", details: {} } }. But we also need to differentiate for audit. So service will handle audit and throw error with code indicating reason: "token_not_found", "token_expired", "token_revoked", "token_malformed". The controller catches and maps all to same generic response. But we could also not throw; service returns null or throws a generic error. However tests require to compare rejection responses to ensure they are identical. So we need to guarantee same shape.

Thus implement a custom exception:

class RefreshTokenError extends Error {
  constructor(public readonly code: string, public readonly details: any = {}) { super(code); }
}

Then in service, on any failure (not successful rotation) we record audit with appropriate details and then throw RefreshTokenError with code.

Controller catches RefreshTokenError, returns response 401 (or 400?). Use @Res() to set status. Return JSON error envelope. The envelope code should be "invalid_refresh_token" maybe generic; but spec says error envelope: { "error": { "code": "...", "message": "...", "details": {} } }. The code is contract. For each type we could have distinct code, but they said all rejections are indistinguishable to caller. So the envelope code must be same across all rejection types. So code can be "invalid_refresh_token". That's the contract. The details will be empty. So we ignore specific code of error.

Thus controller returns 401 unauthorized? Possibly 400. We'll choose 401.

Now, service:

refresh(tokenString: string): Promise<{ accessToken: string; refreshToken: string }>.

Implementation:

- const now = new Date();

- Use repository.findByToken(tokenString) to get token record.

- if not found => audit unknown token, throw RefreshTokenError('token_not_found').

- if token.revoked => // reuse scenario
   - record audit reuse (token revoked)
   - // Invalidate whole family
   - await repository.revokeFamilyTokens(token.familyId, now);
   - throw RefreshTokenError('token_revoked');
- else if token.expiresAt <= now => // expired but not revoked
   - audit expiry
   - throw RefreshTokenError('token_expired');
- else // token is active
   - // Attempt atomic retirement using updateMany
   - const updated = await repository.revokeIfActive(token.id, now);
   - if updated===false => // lost race, token already revoked (reuse)
        - await repository.revokeFamilyTokens(token.familyId, now);
        - audit reuse (race)
        - throw RefreshTokenError('token_revoked');
   - else // success rotation
        - // Create new refresh token with same familyId, userId, same expiresAt
        - const newRefresh = await repository.createRefreshToken(token.userId, token.familyId, token.expiresAt);
        - // Issue access token
        - const accessToken = issueAccessToken(token.userId);
        - // Audit success
        - audit rotation success maybe.
        - return { accessToken, refreshToken: newRefresh.token };

The repository methods:

- findByToken(token: string): Promise<RefreshToken | null>.

- revokeIfActive(tokenId: string, now: Date): Promise<boolean> => uses prisma.refreshToken.updateMany({ where: { id: tokenId, revoked: false }, data: { revoked: true, revokedAt: now } }) and returns count===1.

- revokeFamilyTokens(familyId: string, now: Date): Promise<void> => prisma.refreshToken.updateMany({ where: { familyId, revoked: false }, data: { revoked: true, revokedAt: now } }). This invalidates all tokens in the family. Note: also revoke already revoked tokens? Already revoked tokens remain.

- createRefreshToken(userId: string, familyId: string, expiresAt: Date): Promise<RefreshToken> => generate random token, create record.

Potential issues: The token may already exist; but it's random.

Now, concurrency: The two requests will find token via findByToken; both will see not revoked and not expired. Both will try to revokeIfActive. The first will succeed; the second will not (count 0). Then second will treat as reuse: will call revokeFamilyTokens (maybe redundant). That ensures only one rotation.

Now need to implement module wiring.

Now tests:

- test concurrent presentation of one token: simulate two parallel calls to service.refresh with same token. Use Promise.all to fire both; ensure only one resolves successfully, the other rejects with RefreshTokenError (but both cause generic response at controller). Need to check that only one new refresh token created (two distinct?). Also check that family revoked tokens invalidated; maybe check that repository.findByToken for new token is not revoked.

Simplify: In test we can call controller.refresh endpoint (via NestJS testing module) concurrently. But we can directly test service. But spec wants tests for concurrent presentation. Use vitest. We'll set up in-memory Prisma? Usually they use test DB; but we can use SQLite for test? However the spec requires PostgreSQL; but we can use a test DB environment variable. For simplicity, we can use Prisma's in-memory? Not possible. We'll simulate using a mock repository? Might be easier to write unit tests for service with a mocked repository (like jest). But Vitest also works. However they ask to test behavior not implementation; but they accept using mocks? Might be okay.

Better to set up an actual test environment with Prisma connecting to a SQLite DB (maybe using `prisma generate`). But we don't have the infrastructure. Since this is a code generation answer, we need to produce files that compile. Not required to run tests. Provide tests that call the service methods and use a real Prisma client connecting to an in-memory SQLite? The codebase may have config for Prisma. But no environment variable. We can add in test file a PrismaClient that uses a SQLite file: `datasource db { provider = "sqlite" url = "file:./test.db" }` but the schema currently uses PostgreSQL. However we cannot modify the schema's datasource provider easily. The existing repository may have a PostgreSQL datasource. For tests, they can use a PostgreSQL test container. Not possible.

Simplify: Provide tests using mocked repository. That tests the service's concurrency behavior? To test concurrency, we need to simulate race condition; we could mock repository to have a lock or delay. But that seems complex.

Alternatively, we can test the repository's atomic update using Prisma with a real DB.

Given the constraints, maybe we just provide basic unit tests that simulate concurrency by calling the service twice concurrently using a real in-memory Prisma (like SQLite). We'll modify the Prisma schema's datasource to SQLite for test environment only? That might conflict.

But perhaps the repository's concurrency is guaranteed by the updateMany atomic check, so we can trust it. We could test using a test that uses two service calls sequentially but expects that second fails.

Nevertheless, we need to provide test files.

Also need SECURITY.md.

Thus final answer will contain:

prisma/schema.prisma

src/auth/auth.module.ts

src/auth/auth.controller.ts

src/auth/auth.service.ts

src/auth/auth.repository.ts

src/auth/dto/refresh.dto.ts (optional)

test/auth.spec.ts

SECURITY.md

Potential additional files: src/auth/types.ts maybe.

Now, check naming conventions: file names kebab-case.role.ts? The specification said: TS file: `kebab-case.role.ts`. For example, `auth.controller.ts` is fine (controller). The folder `auth` is fine.

Now we need to adhere to layering: controller validates input and calls service. No business logic. So in controller we just get token and pass to service. Service has logic, no direct Prisma calls. Repository touches database.

So implement repository with Prisma client injection.

We need to import PrismaClient from `@prisma/client`. The repository will be injectable and receive PrismaClient via NestJS injection: we can create a provider for Prisma. Typically in NestJS apps, there's a PrismaService that extends PrismaClient and is injectable. The codebase may have that already. But not given. We need to assume a PrismaService exists? Probably yes. Many NestJS apps have a `prisma.service.ts`. But we can't assume it's present. To be safe, we can import PrismaClient directly and instantiate in repository. But that would create a new client per request; not ideal. However for simplicity, we can define a simple class that constructs PrismaClient.

Better to define a provider `PrismaService` with `@Injectable()` and extends PrismaClient. But we might be adding a new file. Since no mention, we can create it as `src/prisma.service.ts`. But we must ensure not interfering with existing code.

Given no existing PrismaService in repository, we can add it.

Thus we will have:

src/prisma.service.ts

Define class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy to connect/disconnect. That's standard.

Now repository can inject PrismaService.

Thus we add this file.

Now ensure module provides PrismaService, AuthRepository, AuthService.

Now implement tests using NestTestingModule.

Test file will import AuthModule and PrismaService. We'll need to use a test database; we can configure Prisma's datasource to use SQLite for tests. But we can't change schema; however we can set environment variable DATABASE_URL to a SQLite connection string. In the test, we can set process.env.DATABASE_URL = 'file:./test.db?mode=memory&cache=shared'; but for SQLite, provider must be sqlite. But if the schema provider is postgresql, connecting to sqlite will error. So cannot.

Thus perhaps the repository uses Postgres, but tests will be stubbed/mocked. We'll mock PrismaService with jest functions? Since we use Vitest, which is similar to Jest. We'll mock the PrismaService using a simple in-memory representation.

Simplify: Write unit tests for AuthService using a fake repository. For concurrency test, we simulate two calls concurrently and verify that only one succeeded.

We need to implement a fake repository with methods that simulate behavior including atomic revocation. We'll implement a simple class `FakeAuthRepository implements AuthRepository` that holds a map of tokens and implements methods accordingly with concurrency via async functions and using a lock.

But we need to define an interface for repository. The repository class we implement is `AuthRepository`. We can define its methods and then we can create a mock for tests. Use class with same methods.

Better to import actual AuthRepository but then we need a real DB; not needed.

So in test we can use a stub repository, not the actual one.

But the service has a dependency on AuthRepository; we can provide a mock using the NestJS testing module.

Thus the tests will:

- Define a mock repository with internal state.

- Use the AuthService directly (not through controller) for concurrency test.

- Provide test for "presenting a retired token invalidates whole family".

- Test absolute deadline not extended.

- Test all rejection responses same shape using controller.

For rejections shape test, we can call controller with missing token etc., and check response.

Implementation details:

Define `interface RefreshTokenRecord` for in-memory token with fields: id, token, userId, familyId, expiresAt, revoked, revokedAt.

Define FakeAuthRepository with methods:

- async findByToken(token: string): returns record.

- async revokeIfActive(tokenId: string, now: Date): atomic check; we can use a simple check of revoked flag; since Node is single-threaded, race condition simulation requires using setTimeout? We'll simulate concurrency by making method async and delaying before updating. For the concurrency test, we can manually create two promises that both call service.refresh with same token, but inside the repository's revokeIfActive we can simulate race: It should check current state; first call will set revoked to true and return true; second call should see already revoked and return false. Since both calls are concurrent, we need to interleave; but because JavaScript runs sequentially, they will be executed one after another; to simulate concurrency we can add a delay in the repository's revokeIfActive that yields control between check and update. But the service's logic is to call repository.revokeIfActive; the repository can implement as atomic in one DB query, but our in-memory simulation can't mimic atomic nature; but we can still produce same result because if both calls call revokeIfActive, whichever runs first will succeed, second sees revoked flag true and fails. That's fine as concurrency simulation.

Thus test will:

- Create a token record: token "token1" with not revoked, expiresAt far future, familyId "fam1", userId "user1".

- Use FakeAuthRepository.

- Call service.refresh(token) twice concurrently with Promise.allSettled.

- Expect exactly one promise to be fulfilled with accessToken and refreshToken; the other to be rejected with RefreshTokenError.

- After both calls, check that repository's token map shows original token revoked, all tokens in family revoked (including new token? The new token is not revoked; but family revocation is only on reuse? Actually successful rotation shouldn't revoke family; only revoke token and create new one. So after successful rotation, original token revoked, new token active, other tokens (if any) still active. In our test with only one token, after rotation, there is new token active.

But after both calls, we may have a second call that treats as reuse and revokes family (including the new token). Wait: According to logic, after a successful rotation, the original token is revoked and new token created. Then the second concurrent call fails to revoke original token (since already revoked). It treats as reuse and revokes entire family (including new token!). But spec says "The loser is not a retry. It presented a token that has just been retired, which is indistinguishable from an attacker replaying one. Treat it as reuse." And "Reuse invalidates the whole family". That implies the second concurrent request (the loser) should cause whole family revocation, which would revoke the new token as well, rendering the rotation essentially undone? That seems contradictory: If we rotate token and then immediately another request replays the old token (the same token) before the client knows about the new token, the second request will treat as reuse and invalidate the whole family, i.e., also revokes the new token, making the client lose its refresh token. This is intended: to handle replay attack: if a token is replayed (i.e., presented after being retired), then it means token may have been stolen; we need to invalidate all tokens. That includes the newly issued token. So yes, the second request will cause invalidation of the new token. That's okay.

Thus test should verify after both calls that only one token (original) is revoked, but also new token might be revoked due to reuse. Actually after second request, the family revocation will revoke all tokens in family, including new token. So final state: all tokens revoked. But the second request may have already created a new token? In our logic, on reuse detection we don't create new token; we just revoke family and throw error. So only one new token created from the successful rotation, but then revoked. So final state: both tokens revoked. That's okay.

Thus test can verify that only one rotation succeeded (i.e., one new token created) and that the family revocation happened, making the new token revoked.

Now tests for sibling token invalidation: Have a family with two active tokens (tokenA and tokenB) both active (maybe tokenB is a sibling token, not direct parent). Then present tokenA after it was retired (or after we have used tokenA for rotation and it got revoked). Actually the scenario: after tokenA is used for rotation, tokenA revoked, tokenC created (new). Then present tokenA again (replay). This should cause revocation of all family tokens: tokenC and tokenB (if present). We'll test that.

Absolute deadline: Ensure token's expiresAt unchanged. We can check that new token's expiresAt equals original token's expiresAt.

Rejection responses: Use controller to test that unknown token, expired token, malformed token (missing token) produce same response shape and same status.

Thus tests need to use both service and controller.

Given time constraints, we can implement test file with these tests.

Now, we need to define a function issueAccessToken(userId): string. It's said to be already available; we can import from somewhere (maybe utils). We'll define a placeholder function stub.

But for compilation, we need to import something; maybe it's defined elsewhere. We'll import from a hypothetical file `../utils/token`. We'll create a file src/utils/token.ts with stub implementation. That satisfies compile.

Now we also need to implement generation of random token for refresh tokens; use Node's crypto module: `crypto.randomBytes(32).toString('hex')`.

Now implement repository.

Define interface:

export type RefreshToken = {
  id: string;
  token: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revoked: boolean;
  revokedAt?: Date | null;
  createdAt: Date;
};

But actual Prisma model returns type from `@prisma/client`. We'll define repository methods returning that type.

Now, create `src/auth/auth.repository.ts`:

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { token },
    });
  }

  async revokeIfActive(tokenId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: tokenId, revoked: false },
      data: { revoked: true, revokedAt: now },
    });
    return result.count === 1;
  }

  async revokeFamilyTokens(familyId: string, now: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revoked: false },
      data: { revoked: true, revokedAt: now },
    });
  }

  async createRefreshToken(userId: string, familyId: string, expiresAt: Date): Promise<RefreshToken> {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    return this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        familyId,
        expiresAt,
        createdAt: now,
        // revoked defaults to false
      },
    });
  }
}

Add imports: import { Injectable } from '@nestjs/common'; import { PrismaService } from '../prisma.service'; import { RefreshToken } from '@prisma/client'; import crypto from 'crypto'.

Now, the service: src/auth/auth.service.ts.

Define class AuthService with method refresh(tokenString: string): Promise<{ accessToken: string; refreshToken: string }>.

Inject AuthRepository.

Implementation as described.

Define a private method recordAudit(event: string, details: any): void; For now just console.log.

Define a custom error class.

Define RefreshTokenError extends Error.

Now code.

Also need to handle malformed token: If tokenString is missing or not a string, treat as malformed: audit and throw error.

Implementation details:

async refresh(tokenString: string): Promise<{ accessToken: string; refreshToken: string }> {
   if (!tokenString || typeof tokenString !== 'string') { this.recordAudit('malformed_token', {}); throw new RefreshTokenError('malformed_token'); }

   const tokenRecord = await this.authRepository.findByToken(tokenString);
   const now = new Date();

   if (!tokenRecord) {
       this.recordAudit('unknown_token', { token: tokenString });
       throw new RefreshTokenError('unknown_token');
   }

   // check reuse first
   if (tokenRecord.revoked) {
       // reuse
       await this.authRepository.revokeFamilyTokens(tokenRecord.familyId, now);
       this.recordAudit('reuse_revoked_token', { token: tokenString, userId: tokenRecord.userId, familyId: tokenRecord.familyId });
       throw new RefreshTokenError('token_revoked');
   }

   // check expiry
   if (tokenRecord.expiresAt <= now) {
       this.recordAudit('expired_token', { token: tokenString, userId: tokenRecord.userId });
       throw new RefreshTokenError('token_expired');
   }

   // try atomic revoke
   const revoked = await this.authRepository.revokeIfActive(tokenRecord.id, now);
   if (!revoked) {
       // race condition: token was revoked by another request
       await this.authRepository.revokeFamilyTokens(tokenRecord.familyId, now);
       this.recordAudit('reuse_concurrent_token', { token: tokenString, userId: tokenRecord.userId });
       throw new RefreshTokenError('token_revoked');
   }

   // successful rotation
   const newRefresh = await this.authRepository.createRefreshToken(tokenRecord.userId, tokenRecord.familyId, tokenRecord.expiresAt);
   const accessToken = issueAccessToken(tokenRecord.userId);
   this.recordAudit('refresh_success', { userId: tokenRecord.userId, oldToken: tokenString, newToken: newRefresh.token });
   return { accessToken, refreshToken: newRefresh.token };
}

Now define controller:

src/auth/auth.controller.ts.

Use @Controller('auth').

Define POST('refresh') endpoint.

Import Body, Res, HttpStatus, Req.

Use @Post('refresh').

Method: async refresh(@Body() body: any, @Req() req: Request, @Res() res: Response)

Implementation:

- const tokenFromBody = body?.refreshToken;
- const tokenFromCookie = req?.cookies?.refresh_token; // we need to import cookie-parser? Assume it's set.

- const token = tokenFromBody ?? tokenFromCookie;

- If token undefined, token is missing => treat as malformed.

- Try { const result = await this.authService.refresh(token); res.cookie('refresh_token', result.refreshToken, { httpOnly: true, secure: true, sameSite: 'strict' }); return res.json({ accessToken: result.accessToken }); } catch (err) { // ignore specifics, return generic error
   const errorResponse = { error: { code: 'invalid_refresh_token', message: 'Invalid refresh token.', details: {} } };
   return res.status(HttpStatus.UNAUTHORIZED).json(errorResponse);
 }

But we need to ensure we handle generic errors.

Also ensure precedence: if both body and cookie present, body wins (override). We'll document comment.

Also validate token format? The service does.

Now module:

src/auth/auth.module.ts

@Module({
   imports: [],
   controllers: [AuthController],
   providers: [AuthService, AuthRepository],
   exports: [],
})
export class AuthModule {}

Now need to wire PrismaService.

Add src/prisma.service.ts:

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
   async onModuleInit() {
      await this.$connect();
   }
   async onModuleDestroy() {
      await this.$disconnect();
   }
}

Need to import PrismaClient from @prisma/client, and OnModuleInit/OnModuleDestroy.

Now update module imports for PrismaService.

AuthModule should import PrismaService? It can be provided by global module or AppModule. In AppModule we can provide PrismaService. Since we are not modifying existing files, we need to ensure PrismaService is provided somewhere. We'll add to src/app.module.ts? Not given. But we can create a new module `DatabaseModule` with PrismaService. But for simplicity, we can provide PrismaService in AuthModule providers as well.

Thus providers: [PrismaService, AuthRepository, AuthService].

Alternatively, we can define PrismaService as a global provider in a separate file; but we can include it in AuthModule.

Now test file.

test/auth.spec.ts

We'll use Vitest.

Import { Test, TestingModule } from '@nestjs/testing', import AuthModule, AuthService, AuthController, AuthRepository, PrismaService.

Set up a test environment using in-memory repository (FakeAuthRepository) as a mock.

Define a class FakeAuthRepository with needed methods and internal state.

We'll provide it to the testing module using useClass.

In beforeEach, instantiate the module with providers: { provide: AuthRepository, useClass: FakeAuthRepository } plus other providers. Also include AuthService, AuthController.

Test "concurrent presentation of one token":

- Initialize repository with a token: tokenString = "token1", familyId = "family1", userId = "user1", expiresAt far future (new Date(Date.now() + 1000*60*60*24)). revoked false.

- Use service from module.

- const promise1 = service.refresh(tokenString);
- const promise2 = service.refresh(tokenString);
- const results = await Promise.allSettled([promise1, promise2]);

- Count successes: results.filter(r => r.status === 'fulfilled').length should be 1.

- Check that new token's string from success is not same as original and is stored in repository.

- Ensure that after both, repository's token map indicates that both original token and new token are revoked.

Implement FakeAuthRepository methods to mirror atomic behavior: For revokeIfActive, we need to emulate atomic operation; we can implement as:

async revokeIfActive(tokenId: string, now: Date): Promise<boolean> {
  const token = this.tokens.get(tokenId);
  if (token && !token.revoked) {
    token.revoked = true;
    token.revokedAt = now;
    return true;
  }
  return false;
}

Since Node is single-threaded, two calls will be sequential, but still second will see token.revoked true, thus returns false.

Now other methods accordingly.

Test sibling invalidation:

- Create two tokens with same familyId: tokenA and tokenB (both active). Use service.refresh(tokenA) to rotate, which will create tokenC (new). tokenA becomes revoked, tokenC active. Then call service.refresh(tokenA) again (replay). Expect error, and repository should mark all tokens in family (tokenB, tokenC) as revoked.

We need to simulate that tokenA is already revoked and reused. In our service, after we call refresh(tokenA) first time, tokenA is revoked. The second call will treat as reuse, will call revokeFamilyTokens and throw error. So we test that tokenB and tokenC are revoked.

Test absolute deadline:

- Ensure new token's expiresAt equals original token's expiresAt.

Test rejection responses indistinguishable:

- Use controller (via supertest maybe). But we can directly test controller method. However we need to create a mock Request and Response objects. Better use supertest on NestJS app.

We'll set up Nest application in test: create module with AuthModule, use NestFactory to create app (but we cannot start server). Instead we can use `await Test.createTestingModule({ imports: [AuthModule] }).compile()` and get controller, call method with mock request/response.

Simplify: Use controller.refresh method passing mock req/res.

Define mockRes: an object with statusCode property and json method to capture response, status method returning self, cookie method to capture cookies.

We'll define a simple stub.

Test 1: missing token -> controller should return 401 with generic error envelope.

Test 2: unknown token (invalid token string) -> same envelope.

Test 3: expired token -> same envelope.

Test 4: reuse token -> same envelope.

We'll assert that response bodies are deep equal.

Now also test that body token takes precedence over cookie.

We'll construct a request with body { refreshToken: 'body-token' } and cookie { refresh_token: 'cookie-token' }, but the repository will have only 'body-token' record; so controller should use body token and ignore cookie token. We'll test that.

Now implement.

Now we need to ensure the test can import the service functions like issueAccessToken. We can stub issueAccessToken in utils.

Define src/utils/token.ts:

export function issueAccessToken(userId: string): string {
  // Simple placeholder; in real system this would be JWT signed token.
  return `access-${userId}-${Date.now()}`;
}

Now ensure imports.

Now ensure code passes lint.

Now we need to ensure that PrismaService is imported correctly in repository. Add file src/prisma.service.ts.

Now also need to export RefreshToken type? Not needed.

Now we need to adjust the Prisma schema.

prisma/schema.prisma: we need to define the datasource and generator; they likely already exist. But we can add model. We'll assume the schema file already has datasource block, but we need to modify with model addition.

Thus we need to include the entire schema? We only need to provide the model addition. The instruction says deliver every file the solution needs, but we cannot see the existing schema. To be safe, we can provide the full schema with necessary parts.

But not knowing the existing datasource details, we must assume standard.

Let's assume:

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

Add model RefreshToken.

Thus file prisma/schema.prisma:

```
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model RefreshToken {
  id         String   @id @default(uuid())
  token      String   @unique @map("token")
  userId     String   @map("user_id")
  familyId   String   @map("family_id")
  expiresAt  DateTime @map("expires_at")
  createdAt  DateTime @default(now()) @map("created_at")
  revoked    Boolean  @default(false) @map("revoked")
  revokedAt  DateTime? @map("revoked_at")

  @@map("refresh_token")
}
```

If there are other models, they remain unaffected.

Now need to create migrations. Not required to provide migration file but mention they must be created.

Now produce SECURITY.md with 15-25 lines explaining ordering of checks.

Write content accordingly.

Now final output: Provide each file with heading and fenced block.

List of files:

- prisma/schema.prisma
- src/prisma.service.ts
- src/utils/token.ts
- src/auth/auth.module.ts
- src/auth/auth.controller.ts
- src/auth/auth.service.ts
- src/auth/auth.repository.ts
- test/auth.spec.ts
- SECURITY.md

Potentially src/main.ts and src/app.module.ts exist already; not modify.

Now check each file for compliance.

Now create auth.dto for request? Not needed.

Check code style: Use strict TS, types.

Add necessary imports.

Now implement.

Potential import of Request, Response from 'express' in controller. Need to install @types/express; but we can import.

Now implement.

Potential issue: using Request cookies property; need to import from 'express' and use `req.cookies`. Ensure cookie parser is used. Not needed for compile.

Now implement code.

Let's write files.

First file: prisma/schema.prisma.

Second file: src/prisma.service.ts.

Third file: src/utils/token.ts.

Fourth file: src/auth/auth.module.ts.

Fifth file: src/auth/auth.controller.ts.

Sixth file: src/auth/auth.service.ts.

Seventh file: src/auth/auth.repository.ts.

Eighth file: test/auth.spec.ts.

Ninth file: SECURITY.md.

Now write content.

Let's start.
```

## reply

### prisma/schema.prisma
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model RefreshToken {
  id        String   @id @default(uuid())
  token     String   @unique @map("token")
  userId    String   @map("user_id")
  familyId  String   @map("family_id")
  expiresAt DateTime @map("expires_at")
  createdAt DateTime @default(now()) @map("created_at")
  revoked   Boolean  @default(false) @map("revoked")
  revokedAt DateTime? @map("revoked_at")

  @@map("refresh_token")
}
```

### src/prisma.service.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService is a thin wrapper around the generated PrismaClient.
 * It is responsible for establishing and tearing down the database
 * connection for the lifetime of the NestJS application.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### src/utils/token.ts
```ts
/**
 * Placeholder implementation of an access‑token issuer.
 *
 * In the real codebase this function would create a signed JWT (or similar)
 * containing the user's identifier and any other required claims.
 *
 * @param userId The identifier of the user for whom the token is issued.
 * @returns A string representing the access token.
 */
export function issueAccessToken(userId: string): string {
  // Simple deterministic token for the purpose of the exercise.
  return `access-${userId}-${Date.now()}`;
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [],
  controllers: [AuthController],
  providers: [PrismaService, AuthRepository, AuthService],
})
export class AuthModule {}
```

### src/auth/auth.controller.ts
```ts
import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';

/**
 * Refresh endpoint.
 *
 * The refresh token can be supplied either in the JSON body (`refreshToken`)
 * or in a `refresh_token` HTTP‑only cookie.
 *
 * **Precedence**: If both are present, the value from the request body wins.
 *
 * All error responses are indistinguishable to the client and conform to the
 * shared error envelope.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  async refresh(
    @Body() body: any,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Extract token with documented precedence.
    const tokenFromBody = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
    const tokenFromCookie = typeof req?.cookies?.refresh_token === 'string' ? req.cookies.refresh_token : undefined;
    const refreshToken = tokenFromBody ?? tokenFromCookie;

    try {
      const { accessToken, refreshToken: newRefreshToken } =
        await this.authService.refresh(refreshToken);

      // Return the new refresh token as an HTTP‑only cookie.
      res.cookie('refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        // The cookie expiration mirrors the absolute session deadline.
        // (Clients should treat the token itself as the source of truth.)
      });

      // Return the access token in the response body.
      res.status(HttpStatus.OK).json({ accessToken });
    } catch (err) {
      // All failures map to a single, generic error response.
      const errorResponse = {
        error: {
          code: 'invalid_refresh_token',
          message: 'Invalid refresh token.',
          details: {},
        },
      };
      res.status(HttpStatus.UNAUTHORIZED).json(errorResponse);
    }
  }
}
```

### src/auth/auth.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import { issueAccessToken } from '../utils/token';
import { RefreshToken } from '@prisma/client';

/**
 * Specific error used internally to indicate a failure of the refresh flow.
 * The controller deliberately hides the concrete `code` from the client.
 */
class RefreshTokenError extends Error {
  constructor(public readonly code: string, public readonly details: any = {}) {
    super(code);
  }
}

/**
 * AuthService contains the business logic for refresh‑token rotation.
 * It performs the following steps (in order):
 *
 * 1. Input validation (malformed token).
 * 2. Lookup the token record.
 * 3. Reuse detection (token already revoked) – this is checked *before* expiry.
 * 4. Expiry check.
 * 5. Atomic retirement of the presented token.
 * 6. On success: issue a new refresh token (same family, same absolute deadline)
 *    and a new access token.
 * 7. On any failure: record an audit event and throw a `RefreshTokenError`.
 *
 * All audit events are logged via `recordAudit`. In production this would be
 * persisted to a dedicated audit store; for the purpose of this exercise a
 * simple `console.log` is sufficient.
 */
@Injectable()
export class AuthService {
  constructor(private readonly authRepository: AuthRepository) {}

  /**
   * Performs a refresh‑token rotation.
   *
   * @param tokenString The raw refresh token supplied by the client.
   * @returns An object containing a fresh access token and a fresh refresh token.
   * @throws RefreshTokenError on any validation, lookup, or rotation failure.
   */
  async refresh(
    tokenString: string | undefined,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // 1. Input validation (malformed token)
    if (!tokenString || typeof tokenString !== 'string') {
      this.recordAudit('malformed_token', { token: tokenString });
      throw new RefreshTokenError('malformed_token');
    }

    // 2. Lookup token record
    const tokenRecord: RefreshToken | null =
      await this.authRepository.findByToken(tokenString);
    const now = new Date();

    if (!tokenRecord) {
      // Unknown token
      this.recordAudit('unknown_token', { token: tokenString });
      throw new RefreshTokenError('unknown_token');
    }

    // 3. Reuse detection (token already revoked) – checked before expiry
    if (tokenRecord.revoked) {
      await this.authRepository.revokeFamilyTokens(
        tokenRecord.familyId,
        now,
      );
      this.recordAudit('reuse_revoked_token', {
        token: tokenString,
        userId: tokenRecord.userId,
        familyId: tokenRecord.familyId,
      });
      throw new RefreshTokenError('token_revoked');
    }

    // 4. Expiry check (only after confirming the token is not already revoked)
    if (tokenRecord.expiresAt <= now) {
      this.recordAudit('expired_token', {
        token: tokenString,
        userId: tokenRecord.userId,
      });
      throw new RefreshTokenError('token_expired');
    }

    // 5. Atomic retirement of the presented token
    const retired = await this.authRepository.revokeIfActive(
      tokenRecord.id,
      now,
    );

    if (!retired) {
      // The token was retired between the lookup and this point – treat as reuse.
      await this.authRepository.revokeFamilyTokens(
        tokenRecord.familyId,
        now,
      );
      this.recordAudit('reuse_concurrent_token', {
        token: tokenString,
        userId: tokenRecord.userId,
      });
      throw new RefreshTokenError('token_revoked');
    }

    // 6. Successful rotation – issue a new refresh token with the *same* absolute deadline.
    const newRefresh = await this.authRepository.createRefreshToken(
      tokenRecord.userId,
      tokenRecord.familyId,
      tokenRecord.expiresAt,
    );

    const accessToken = issueAccessToken(tokenRecord.userId);

    this.recordAudit('refresh_success', {
      userId: tokenRecord.userId,
      oldToken: tokenString,
      newToken: newRefresh.token,
      familyId: tokenRecord.familyId,
    });

    return {
      accessToken,
      refreshToken: newRefresh.token,
    };
  }

  /**
   * Simple audit hook – in a real system this would write to a structured audit
   * store. For the purpose of the exercise we use `console.log`.
   *
   * @param event A short string identifying the audit event.
   * @param details Arbitrary JSON‑serialisable data giving context.
   */
  private recordAudit(event: string, details: any): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, details }));
  }
}
```

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RefreshToken } from '@prisma/client';
import crypto from 'crypto';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves a refresh‑token record by its opaque token value.
   *
   * @param token The token string as supplied by the client.
   * @returns The matching `RefreshToken` or `null` if none exists.
   */
  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { token },
    });
  }

  /**
   * Atomically retires a token *iff* it is still active (not revoked).
   *
   * The operation is performed as a single `UPDATE … WHERE revoked = false`
   * statement; Prisma translates this to an `UPDATE ... WHERE ...` that returns
   * the number of affected rows.
   *
   * @param tokenId The primary key of the token to retire.
   * @param now The timestamp at which the revocation occurs.
   * @returns `true` if the token was successfully retired, `false` otherwise.
   */
  async revokeIfActive(tokenId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id: tokenId, revoked: false },
      data: { revoked: true, revokedAt: now },
    });
    return result.count === 1;
  }

  /**
   * Revokes *all* active tokens belonging to the same family (i.e. all
   * descendants of the original sign‑in). This is used when a reused token is
   * detected.
   *
   * @param familyId Identifier for the token family.
   * @param now The timestamp at which the revocation occurs.
   */
  async revokeFamilyTokens(familyId: string, now: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revoked: false },
      data: { revoked: true, revokedAt: now },
    });
  }

  /**
   * Persists a newly issued refresh token.
   *
   * @param userId The identifier of the token owner.
   * @param familyId Identifier for the token family (inherited from the parent token).
   * @param expiresAt Absolute expiry timestamp for the session (unchanged across rotations).
   * @returns The freshly created `RefreshToken` record.
   */
  async createRefreshToken(
    userId: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<RefreshToken> {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();

    return this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        familyId,
        expiresAt,
        createdAt: now,
        // `revoked` defaults to false; `revokedAt` stays null.
      },
    });
  }
}
```

### test/auth.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../src/auth/auth.service';
import { AuthController } from '../src/auth/auth.controller';
import { AuthRepository } from '../src/auth/auth.repository';
import { RefreshToken } from '@prisma/client';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * In‑memory fake repository implementing the same contract as `AuthRepository`.
 * It stores tokens in a `Map<string, RefreshToken>` keyed by the token string.
 *
 * This allows us to test the business logic without a real PostgreSQL instance.
 */
class FakeAuthRepository implements Partial<AuthRepository> {
  private tokensById = new Map<string, RefreshToken>();
  private tokensByValue = new Map<string, RefreshToken>();

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.tokensByValue.get(token) ?? null;
  }

  async revokeIfActive(tokenId: string, now: Date): Promise<boolean> {
    const token = this.tokensById.get(tokenId);
    if (token && !token.revoked) {
      token.revoked = true;
      token.revokedAt = now;
      // Ensure maps stay in sync
      this.tokensById.set(tokenId, token);
      this.tokensByValue.set(token.token, token);
      return true;
    }
    return false;
  }

  async revokeFamilyTokens(familyId: string, now: Date): Promise<void> {
    for (const token of this.tokensById.values()) {
      if (token.familyId === familyId && !token.revoked) {
        token.revoked = true;
        token.revokedAt = now;
        this.tokensById.set(token.id, token);
        this.tokensByValue.set(token.token, token);
      }
    }
  }

  async createRefreshToken(
    userId: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<RefreshToken> {
    const tokenString = `rt-${crypto.randomBytes(16).toString('hex')}`;
    const now = new Date();
    const token: RefreshToken = {
      id: uuidv4(),
      token: tokenString,
      userId,
      familyId,
      expiresAt,
      createdAt: now,
      revoked: false,
      revokedAt: null,
    };
    this.tokensById.set(token.id, token);
    this.tokensByValue.set(token.token, token);
    return token;
  }

  // Helper for tests: directly insert a token into the store.
  insertToken(token: Partial<RefreshToken>) {
    const full: RefreshToken = {
      id: token.id ?? uuidv4(),
      token: token.token ?? `rt-${crypto.randomBytes(16).toString('hex')}`,
      userId: token.userId ?? 'user-test',
      familyId: token.familyId ?? uuidv4(),
      expiresAt: token.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: token.createdAt ?? new Date(),
      revoked: token.revoked ?? false,
      revokedAt: token.revokedAt ?? null,
    };
    this.tokensById.set(full.id, full);
    this.tokensByValue.set(full.token, full);
    return full;
  }
}

/**
 * Minimal mock of an Express response object that records status,
 * JSON payload, and cookies set by the controller.
 */
class MockResponse {
  statusCode: number = 200;
  body: any = null;
  cookies: Record<string, any> = {};

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: any) {
    this.body = payload;
    return this;
  }

  cookie(name: string, value: any, options: any) {
    this.cookies[name] = { value, options };
    return this;
  }
}

describe('AuthModule – refresh‑token rotation', () => {
  let moduleRef: TestingModule;
  let authService: AuthService;
  let authController: AuthController;
  let fakeRepo: FakeAuthRepository;

  beforeEach(async () => {
    fakeRepo = new FakeAuthRepository();

    moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        {
          provide: AuthRepository,
          useValue: fakeRepo,
        },
      ],
    }).compile();

    authService = moduleRef.get<AuthService>(AuthService);
    authController = moduleRef.get<AuthController>(AuthController);
  });

  it('allows exactly one of two concurrent refreshes to succeed', async () => {
    // Arrange: a single active refresh token.
    const original = fakeRepo.insertToken({
      token: 'original-token',
      familyId: 'family-1',
      userId: 'user-1',
    });

    // Act: launch two refresh attempts concurrently.
    const p1 = authService.refresh('original-token');
    const p2 = authService.refresh('original-token');
    const results = await Promise.allSettled([p1, p2]);

    // Assert: only one promise fulfilled.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The successful result should contain a new refresh token.
    const success = fulfilled[0] as PromiseFulfilledResult<{
      accessToken: string;
      refreshToken: string;
    }>;
    expect(typeof success.value.refreshToken).toBe('string');
    expect(success.value.refreshToken).not.toBe('original-token');

    // After both calls, the family should be fully revoked (new token also revoked).
    const familyTokens = Array.from(fakeRepo['tokensById'].values()).filter(
      (t) => t.familyId === original.familyId,
    );
    for (const t of familyTokens) {
      expect(t.revoked).toBe(true);
    }
  });

  it('invalidates sibling tokens when a reused token is presented', async () => {
    // Arrange: two sibling tokens in the same family.
    const familyId = 'family-2';
    const tokenA = fakeRepo.insertToken({
      token: 'token-A',
      familyId,
      userId: 'user-2',
    });
    const tokenB = fakeRepo.insertToken({
      token: 'token-B',
      familyId,
      userId: 'user-2',
    });

    // First, rotate using token A – should succeed and produce token C.
    const first = await authService.refresh('token-A');
    const tokenC = await fakeRepo.findByToken(first.refreshToken);
    expect(tokenC).not.toBeNull();
    expect(tokenC?.revoked).toBe(false);

    // Now, present the already‑retired token A again (reuse).
    await expect(authService.refresh('token-A')).rejects.toThrow();

    // All tokens in the family (B and C) must now be revoked.
    const tokenBAfter = await fakeRepo.findByToken('token-B');
    const tokenCAfter = await fakeRepo.findByToken(first.refreshToken);
    expect(tokenBAfter?.revoked).toBe(true);
    expect(tokenCAfter?.revoked).toBe(true);
  });

  it('preserves the absolute deadline across rotations', async () => {
    const absoluteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const original = fakeRepo.insertToken({
      token: 'deadline-token',
      familyId: 'family-3',
      userId: 'user-3',
      expiresAt: absoluteExpiry,
    });

    const result = await authService.refresh('deadline-token');
    const newToken = await fakeRepo.findByToken(result.refreshToken);
    expect(newToken).not.toBeNull();
    expect(newToken?.expiresAt.getTime()).toBe(absoluteExpiry.getTime());
  });

  it('returns an identical error response for all rejection cases', async () => {
    // Helper to invoke the controller and capture the JSON payload.
    async function invokeController(
      bodyToken?: string,
      cookieToken?: string,
    ): Promise<{ status: number; body: any }> {
      const mockReq = {
        body: bodyToken ? { refreshToken: bodyToken } : {},
        cookies: cookieToken ? { refresh_token: cookieToken } : {},
      } as Request;
      const mockRes = new MockResponse() as unknown as Response;
      await authController.refresh(
        (mockReq as unknown) as Request,
        (mockRes as unknown) as Response,
      );
      return { status: mockRes.statusCode, body: mockRes.body };
    }

    // 1. Missing token (malformed)
    const missing = await invokeController();
    // 2. Unknown token
    const unknown = await invokeController('nonexistent-token');
    // 3. Expired token
    const expiredToken = fakeRepo.insertToken({
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 1000), // already past
      familyId: 'family-4',
      userId: 'user-4',
    });
    const expired = await invokeController('expired-token');
    // 4. Reuse (present a revoked token)
    const revokedToken = fakeRepo.insertToken({
      token: 'revoked-token',
      revoked: true,
      revokedAt: new Date(),
      familyId: 'family-5',
      userId: 'user-5',
    });
    const reused = await invokeController('revoked-token');

    // All responses must be identical (status code & body shape).
    const expected = missing.body;
    expect(missing.status).toBe(401);
    expect(unknown.body).toEqual(expected);
    expect(expired.body).toEqual(expected);
    expect(reused.body).toEqual(expected);
  });

  it('gives precedence to the token in the request body over the cookie', async () => {
    // Insert both tokens into the fake store.
    const bodyToken = fakeRepo.insertToken({
      token: 'body-token',
      familyId: 'family-6',
      userId: 'user-6',
    });
    const cookieToken = fakeRepo.insertToken({
      token: 'cookie-token',
      familyId: 'family-6',
      userId: 'user-6',
    });

    // The controller should use the body token.
    const mockReq = {
      body: { refreshToken: 'body-token' },
      cookies: { refresh_token: 'cookie-token' },
    } as Request;
    const mockRes = new MockResponse() as unknown as Response;

    await authController.refresh(
      (mockReq as unknown) as Request,
      (mockRes as unknown) as Response,
    );

    // The response must contain a new refresh token derived from the body token.
    expect(mockRes.statusCode).toBe(200);
    const responseBody = mockRes.body as { accessToken: string };
    expect(responseBody).toHaveProperty('accessToken');

    // Verify that the cookie token is untouched (still active).
    const untouched = await fakeRepo.findByToken('cookie-token');
    expect(untouched?.revoked).toBe(false);
  });
});
```

### SECURITY.md
```
# Refresh‑Token Rotation – Security Rationale

1. **Reuse detection precedes expiry checks.**  
   A token that has been retired (revoked) but is also past its absolute deadline must be treated as a *reuse* event. Detecting revocation first prevents an attacker who presents a stolen token after its natural expiry from being logged merely as an expired token, which would hide a compromise.

2. **Atomic retirement of the presented token.**  
   The rotation logic performs a single `UPDATE … WHERE revoked = false` statement. This guarantees that only the first concurrent request can successfully retire the token; any subsequent request sees the token already revoked and is classified as a replay.

3. **Family‑wide invalidation on reuse.**  
   When a retired token is presented again, the whole token family (all descendants of the original sign‑in) is revoked in one operation. This removes any window for an attacker who may have captured a token that was previously rotated.

4. **Absolute session deadline is immutable.**  
   The `expires_at` timestamp is stored on the token family and copied unchanged to every newly issued refresh token. Refresh operations never extend this deadline, guaranteeing that a session eventually terminates even under aggressive rotation.

5. **Uniform error surface.**  
   All failure modes—malformed, unknown, expired, or reused tokens—produce the same HTTP status and JSON envelope (`invalid_refresh_token`). This prevents information leakage that could aid an attacker while the internal audit log records the precise cause for forensic analysis.

6. **Deterministic precedence of token sources.**  
   If a client supplies a token both in the JSON body (`refreshToken`) and in the `refresh_token` cookie, the body value wins. This deterministic rule eliminates ambiguity and aligns with the principle of explicit over implicit data.

These checks are ordered and implemented exactly as described to ensure that token rotation remains both secure against replay attacks and reliable for legitimate clients.
```
