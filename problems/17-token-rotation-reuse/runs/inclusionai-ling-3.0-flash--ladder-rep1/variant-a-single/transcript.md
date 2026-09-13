# Transcript — 17-token-rotation-reuse / variant-a / inclusionai/ling-3.0-flash

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me carefully analyze this task. I need to build a refresh-token rotation system with reuse detection using TypeScript, NestJS, Prisma, and PostgreSQL.

Let me break down the requirements:

1. `POST /auth/refresh` — accepts a refresh token, returns a new access token and a new refresh token. The presented token is retired by the same call.
2. Token can arrive in JSON body as `refreshToken` or in `refresh_token` cookie. Body wins when both present (I'll document this).
3. Concurrent presentation of same valid token — exactly one may rotate (atomic conditional update).
4. Already-retired token = compromise: invalidate all tokens descended from same original sign-in, record audit.
5. Session has absolute lifetime fixed at sign-in. Rotation doesn't extend deadline.
6. Every rejection (expired, retired, unknown, malformed) is indistinguishable to caller. Audit distinguishes them.

Additional from L2-spec:
- Check reuse before expiry (a token both retired and expired is reuse, not expiry)
- The loser in concurrent case is treated as reuse, not benign race
- Model family explicitly for one-operation invalidation

Let me design the file layout:

```
prisma/schema.prisma
src/auth/auth.module.ts
src/auth/auth.controller.ts
src/auth/auth.service.ts
src/auth/auth.repository.ts
src/auth/auth.module.ts
test/auth.spec.ts
SECURITY.md
```

Now let me think about the data model:

**RefreshToken model:**
- id: String (UUID or unique id)
- tokenHash: String (we hash the token for storage — we can't store raw tokens)
- userId: String
- familyId: String (groups all tokens from same sign-in)
- isRetired: Boolean (default false)
- expiresAt: DateTime (absolute deadline fixed at sign-in)
- createdAt: DateTime
- updatedAt: DateTime

**AuthAudit model:**
- id: String
- eventType: String (REUSE, EXPIRY, UNKNOWN, MALFORMED, ROTATION)
- tokenHash: String?
- familyId: String?
- userId: String?
- ip: String?
- userAgent: String?
- details: Json?
- createdAt: DateTime

Actually, let me think about the family model. The family is the group of tokens descended from the same sign-in. I'll use `familyId` as a String field on the refresh token.

For the rotation:
1. Receive token (body or cookie, body wins)
2. Parse/validate the token (if malformed → rejection with MALFORMED audit)
3. Hash the token to look up
4. Check database for the token record
5. If not found → UNKNOWN rejection
6. If found but retired → REUSE (invalidate family, audit)
7. If found but expired → EXPIRED rejection
8. If found and live → ATOMIC rotate:
   - Use conditional update: `update where { AND: { id: tokenId, isRetired: false } }` set `isRetired: true`
   - Check if row was updated (if affected count = 1, success; if 0, another request won → treat as REUSE)
   - Create new refresh token (same family, new token hash, same expiry)
   - Return new access token + new refresh token

Wait, let me re-read requirement 6 and the L2 spec point 6: "Check reuse before expiry". So:
- If token is retired (even if also expired) → REUSE
- If token is not retired but expired → EXPIRED
- If token doesn't exist → UNKNOWN
- If token format is bad → MALFORMED

For the concurrent case: After we successfully rotate (atomic), a concurrent request with the same token will find the token is now retired → REUSE treatment.

Let me think about the token format. Since we're hashing, I'll use JWT-like tokens. The refresh token itself can be a random string. We hash it with SHA-256 for storage.

Now, for the `issueAccessToken(userId): string` — this is given as existing, so I'll call it as an injected dependency.

Let me now write all the files.

Actually, for the schema, I need to be careful about naming conventions. Tables should be `snake_case` via Prisma `@@map`. Columns also `snake_case` via `@map`.

Let me design:

```prisma
model RefreshToken {
  id            String   @id @default(uuid()) @map("id")
  tokenHash     String   @unique @map("token_hash")
  familyId      String   @map("family_id")
  userId        String   @map("user_id")
  isRetired     Boolean  @default(false) @map("is_retired")
  expiresAt     DateTime @map("expires_at")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@map("refresh_tokens")
}

model AuthAudit {
  id         String   @id @default(uuid()) @map("id")
  eventType  String   @map("event_type")
  tokenHash  String?  @map("token_hash")
  familyId   String?  @map("family_id")
  userId     String?  @map("user_id")
  ip         String?  @map("ip")
  userAgent  String?  @map("user_agent")
  details    Json?    @map("details")
  createdAt  DateTime @default(now()) @map("created_at")

  @@map("auth_audit")
}
```

Now let me think about the service logic in detail:

```typescript
class AuthService {
  async refresh(request: HttpRequest): Promise<RefreshResponse> {
    // 1. Extract token
    const token = extractToken(request); // body wins over cookie
    
    // 2. Validate format
    if (!token || !isValidTokenFormat(token)) {
      this.audit('MALFORMED', ...);
      throw new RejectionError('token_invalid'); // generic message
    }
    
    // 3. Hash token
    const tokenHash = await hash(token);
    
    // 4. Look up
    const existing = await this.repo.findByHash(tokenHash);
    
    // 5. Not found → UNKNOWN
    if (!existing) {
      this.audit('UNKNOWN', ...);
      throw new RejectionError('token_invalid');
    }
    
    // 6. Retired → REUSE (check before expiry!)
    if (existing.isRetired) {
      await this.handleReuse(existing);
      throw new RejectionError('token_invalid');
    }
    
    // 7. Expired → EXPIRED
    if (existing.expiresAt < now) {
      this.audit('EXPIRY', ...);
      throw new RejectionError('token_invalid');
    }
    
    // 8. Atomic rotation
    const rotated = await this.repo.atomicRetire(existing.id);
    if (!rotated) {
      // Another request won → treat as reuse
      await this.handleReuse(existing);
      throw new RejectionError('token_invalid');
    }
    
    // 9. Issue new tokens
    const newRefreshToken = generateToken();
    const newTokenHash = await hash(newRefreshToken);
    const newToken = await this.repo.create({
      tokenHash: newTokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      expiresAt: existing.expiresAt, // same deadline!
    });
    
    const accessToken = this.issueAccessToken(existing.userId);
    
    this.audit('ROTATION', ...);
    
    return { accessToken, refreshToken: newRefreshToken };
  }
  
  private async handleReuse(token: RefreshToken) {
    // Invalidate entire family
    await this.repo.invalidateFamily(token.familyId);
    await this.audit('REUSE', { familyId: token.familyId, ... });
  }
}
```

For the atomic operation, the L2 spec says: "a conditional update that retires the token only if it is still live, and a caller that checks whether it changed a row."

In Prisma:
```typescript
const result = await this.prisma.$executeRaw`
  UPDATE refresh_tokens 
  SET is_retired = true, updated_at = now()
  WHERE id = ${tokenId} AND is_retired = false
`;
// Check if affected rows > 0
```

Or using Prisma's `updateMany` with a where clause:
```typescript
const result = await this.repo.retireIfLive(tokenId);
// result.count tells us if it was retired
```

Actually, let me use `updateMany` in the repository since it's cleaner.

Now for the controller, it needs to:
- Accept body `{ refreshToken?: string }` and cookie `refresh_token`
- Body wins over cookie
- Return `{ accessToken: string }` and set `refresh_token` cookie with the new token

For the rejection envelope: `{ "error": { "code": "token_invalid", "message": "...", "details": {} } }`

What should the code be? The spec says the code is `snake_case`. For "rejection" the code could be `token_invalid` or `refresh_failed`. Let me use `token_invalid` since the rejection is indistinguishable.

Actually, re-reading the error envelope: `code` is `snake_case` and is the contract. But the spec says all rejections look the same. So the code should probably be the same for all rejections too. Let me use `token_invalid` for all four cases.

Hmm, but in the error envelope example from conventions: `resource_not_found`. Let me use something appropriate. Since the spec says they're indistinguishable, there's one code: let me call it `auth_failed` or `token_invalid`. I'll go with `token_invalid`.

Now for the tests. I need:
1. Concurrent presentation of one token — exactly one rotates
2. A replay that invalidates a sibling token
3. Rotation against the absolute deadline
4. Rejection responses compared to each other

Let me think about how to test concurrency. I can use `Promise.all` with two calls that both use the same token. Since the DB will serialize the conditional update, one will succeed and one will fail.

But wait — in tests with Prisma, we might need to handle this carefully. The `updateMany` with `WHERE id = ? AND is_retired = false` is atomic at the database level, so even with concurrent calls, only one will succeed.

Now let me also think about what `issueAccessToken` is. The spec says "assume `issueAccessToken(userId): string`". I'll create a simple injectable that generates a JWT or random string.

Let me now write everything.

For the token generation/verification of refresh tokens, I'll use a simple random string and SHA-256 hashing. I'll use Node's `crypto` module.

Let me think about what the `extractToken` logic should be:
- Check body for `refreshToken`
- If not present, check cookies for `refresh_token`
- Body wins

In NestJS, I can use `@Body()` and `@Cookie('refresh_token')`.

Now let me also think about the module wiring:
- `AuthModule` declares controller, service, repository
- Service depends on `PrismaService` (injectable) and some `TokenIssuer` (for `issueAccessToken`)
- Repository uses Prisma directly

Let me check conventions: "A service, repository or processor is listed in its module's `providers`." And "A controller is declared by a module." — so controller in `controllers` array, service/repository in `providers` array.

Let me finalize the file structure:

```
prisma/schema.prisma
prisma/migrations/... (I'll describe but can't actually create real migration files)
src/auth/auth.module.ts
src/auth/auth.controller.ts
src/auth/auth.service.ts
src/auth/auth.repository.ts
src/auth/refresh-token.parser.ts (or inline in service)
src/auth/token-issuer.service.ts
src/app.module.ts
src/main.ts
test/auth.spec.ts
SECURITY.md
```

Actually, let me keep it simpler. I'll put the token extraction in the controller or service. Let me not over-engineer.

Let me think about what files are strictly needed:
1. `prisma/schema.prisma`
2. `src/auth/auth.module.ts`
3. `src/auth/auth.controller.ts`
4. `src/auth/auth.service.ts`
5. `src/auth/auth.repository.ts`
6. `src/main.ts` (or maybe not needed if it exists — but the task says "Build the whole solution")
7. `src/app.module.ts`
8. `test/auth.spec.ts`
9. `SECURITY.md`

The task says "Deliver every file the solution needs, complete." Let me include the main entry points.

Let me think about the Prisma migration. Since I can't run commands, I'll create the migration files manually. A migration file in Prisma typically has:
- `migration.sql`
- `schema.prisma` (the state after migration)
- `migration_lock.toml`

Actually, for the deliverable, I think providing `prisma/schema.prisma` with the models and a migration file is sufficient. Let me create a migration under `prisma/migrations/`.

Let me also think about `@map` carefully. The convention says "Table and column: `snake_case` (via Prisma `@map`/`@@map`)." So the Prisma model uses camelCase for fields but maps to snake_case in the DB.

Wait, re-reading: the Prisma model field names are typically camelCase by convention, and `@map` maps them to snake_case columns. Let me use that.

Now let me write all the code.

One more thing: the spec says "A token both retired and expired is handled as reuse" and "Check reuse before expiry". So in the flow, I check `isRetired` before checking `expiresAt`.

For the family invalidation: "Invalidate every token descended from the same original sign-in." I'll model this as all tokens with the same `familyId`.

Let me also think about what happens when we invalidate the family — we set `isRetired = true` for all tokens in the family. And we need to make sure the current token (which was just found to be reused) is also part of this (it already is, same family).

Now, let me also think about the `details` field in audit. It should contain enough info to investigate. So for REUSE: `{ reason: 'presented_retired_token', tokenId: '...', familyId: '...' }`, for EXPIRY: `{ expiresAt: '...' }`, etc.

Let me now code everything. I'll be thorough.

For the cookie, in the response I'll set it as an httpOnly cookie.

Let me think about the test setup. Vitest with NestJS testing utilities. I'll use `Test.createTestingModule` and then make HTTP requests.

Actually for testing the repository/service layer, I could test at the service level. But the spec says "tests for concurrent presentation" — this really needs integration testing. Let me write integration-style tests that go through the controller using a test server.

Let me think about what `issueAccessToken` looks like. I'll create a simple service:

```typescript
@Injectable()
export class TokenIssuer {
  issueAccessToken(userId: string): string {
    // JWT or random token
    return jwt.sign({ sub: userId }, 'test-secret', { expiresIn: '15m' });
  }
}
```

Actually, for testing purposes and since we don't have a real auth system, I'll keep it simple.

Now let me think about the malformed token detection. What counts as malformed? If the token is not a valid format. Since I'm using random strings, "malformed" would be if the token is empty, null, or not a string. The hash step would fail or produce nonsense. I'll check: if no token is provided (neither body nor cookie), or if it's not a non-empty string, it's malformed.

Wait, but what if someone sends garbage that is a valid string? Then we'd hash it, look it up, find nothing, and it would be UNKNOWN, not MALFORMED. MALFORMED should be reserved for tokens that are structurally invalid (e.g., not a string, empty, or wrong format). For refresh tokens, I think "malformed" = not present or empty string. A wrong-looking string that doesn't match any stored hash is UNKNOWN.

Let me finalize:
- No token at all (neither body nor cookie) → MALFORMED
- Empty string token → MALFORMED
- Non-string token → MALFORMED
- Valid string, hash not found in DB → UNKNOWN
- Found, isRetired=true → REUSE
- Found, isRetired=false, expired → EXPIRED
- Found, isRetired=false, not expired → ROTATE (or REUSE if concurrent lost)

Now let me write the code. I'll aim for completeness.

One more design decision: the `AuthRepository` should be the only layer that touches Prisma. The `AuthService` calls repository methods. Let me define clear repository methods:

- `findByHash(tokenHash: string): Promise<RefreshToken | null>`
- `atomicRetire(id: string): Promise<boolean>` — returns true if row was updated
- `invalidateFamily(familyId: string): Promise<void>` — retire all tokens in family
- `create(token: RefreshTokenCreate): Promise<RefreshToken>`

And for the service, methods:
- `refresh(request: RefreshRequest): Promise<RefreshResponse>` — main entry point
- `handleReuse(token: RefreshToken): Promise<void>` — internal
- `audit(event: AuditEvent): Promise<void>` — internal

Now let me think about Prisma types. The `RefreshToken` type from Prisma client will have camelCase field names (since model is defined in camelCase in Prisma schema).

Wait — with `@map`, the Prisma client returns results with the model field names (camelCase), not DB column names. The `@map` directive tells Prisma to map those model fields to different DB columns.

Let me define the model:

```prisma
model RefreshToken {
  id          String   @id @default(uuid())
  tokenHash   String   @unique
  familyId    String
  userId      String
  isRetired   Boolean  @default(false)
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("refresh_tokens")
}
```

Here, Prisma field names are camelCase (`tokenHash`, `familyId`, etc.) and they map to snake_case DB columns (`token_hash`, `family_id`, etc.) automatically via Prisma's default naming convention... wait no, `@@map("refresh_tokens")` only maps the table name. For column mapping, I need `@map` on each field.

Actually, in recent Prisma versions, without explicit `@map` on fields, the columns are named after the model fields. But the convention says columns should be `snake_case`. Let me add explicit `@map`:

```prisma
model RefreshToken {
  id          String   @id @default(uuid()) @map("id")
  tokenHash   String   @unique @map("token_hash")
  familyId    String   @map("family_id")
  userId      String   @map("user_id")
  isRetired   Boolean  @default(false) @map("is_retired")
  expiresAt   DateTime @map("expires_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("refresh_tokens")
}
```

Now for the audit model:

```prisma
model AuthAudit {
  id         String   @id @default(uuid()) @map("id")
  eventType  String   @map("event_type")
  tokenHash  String?  @map("token_hash")
  familyId   String?  @map("family_id")
  userId     String?  @map("user_id")
  ip         String?  @map("ip")
  userAgent  String?  @map("user_agent")
  details    Json?    @map("details")
  createdAt  DateTime @default(now()) @map("created_at")

  @@map("auth_audit")
}
```

Good. Now let me think about the test. I need to:
1. Set up a test database (or use an in-memory one)
2. Run migrations (or use `prisma.$executeRaw` to set up tables)

In practice, for Vitest + Prisma + NestJS, a common pattern is:
- Use a test database
- Use `prisma.$executeRaw` to set up/clean tables
- Or use `prisma migrate deploy` in setup

I'll write tests that use the actual service through a NestJS testing module, and clean up after each test.

Let me now start writing the actual code. This is going to be extensive.

Actually, let me reconsider the approach. Since I can't run anything, I'll write production-quality code that follows all the conventions and should work. Let me be very careful.

For the `atomicRetire` in the repository, I'll use `updateMany`:

```typescript
async atomicRetire(id: string): Promise<boolean> {
  const result = await this.prisma.refreshToken.updateMany({
    where: {
      id,
      isRetired: false,
    },
    data: {
      isRetired: true,
      updatedAt: new Date(),
    },
  });
  return result.count > 0;
}
```

This is atomic — the database serializes concurrent updates to the same row.

Let me now think about the concurrency test more carefully. I'll create a valid refresh token, then fire two requests simultaneously. One should succeed (get new tokens), the other should get a 401-style rejection. Then I should check that:
- Exactly one succeeded
- The other got a rejection
- Both tokens in the family are now retired (the reused one + the original)

Wait — actually, when the loser hits the `atomicRetire` and it returns false (because the winner already retired it), the loser should then check: is the token retired? Yes (the winner retired it). So it goes down the REUSE path, which invalidates the family.

But wait, the winner's new token should also be part of the family. So invalidating the family would also invalidate the winner's new token. That seems wrong... Let me re-read the spec.

"Clients retry. Two requests presenting the same valid token may arrive concurrently; exactly one may rotate."

"The loser is not a retry. It presented a token that has just been retired, which is indistinguishable from an attacker replaying one. Treat it as reuse."

So the loser is treated as a reuse event, and the family is invalidated. This means after a concurrent race, even the winner's new token gets invalidated? That seems extreme but it's what the spec says. The family is all tokens from the same original sign-in, and the winner's new token is also from that sign-in.

Hmm, but that would mean a concurrent retry of a legitimate client causes the entire session to be terminated. That's a tradeoff the spec explicitly accepts: "Getting this backwards — treating reuse as a benign race — is the mistake that makes rotation decorative."

So yes: when reuse is detected (even from a concurrent race), the entire family is invalidated.

But wait — let me think about this more carefully. In the concurrent case:
1. Token A is live, family F
2. Request 1 and Request 2 both present A
3. Request 1 wins: atomically retires A, creates new token B (family F), returns new tokens
4. Request 2 loses: A is now retired → REUSE → invalidate all tokens in family F (including A and B)

So after the race, both A and B are retired. The client needs to re-authenticate. This is by design.

OK, let me proceed with this understanding.

Actually, wait. Let me re-read: "The loser is not a retry. It presented a token that has just been retired, which is indistinguishable from an attacker replaying one."

So the loser presented token A, which was just retired by the winner. This is exactly the same as an attacker replaying a token that was already used (stolen). The system can't tell the difference, so it treats it the same way: as a compromise.

This means in the test for concurrent refreshes:
- Exactly one request succeeds
- The other is recorded as REUSE
- The family is invalidated

OK, let me code this.

Now for the test for "a replay that invalidates a sibling token":
1. Sign in → token A (family F)
2. Rotate with A → token B (family F), A is retired
3. Replay with A (already retired) → all tokens in family F are invalidated, including B

And "rotation against the absolute deadline":
1. Create a refresh token with a specific expiry (e.g., 1 hour from now)
2. Rotate it before expiry → new token has same expiry (not extended)

And "rejection responses compared":
1. Test expired, retired, unknown, and malformed tokens
2. All return the same response structure (same status code, same body shape)

Now let me write the code. I'll create a comprehensive solution.

One more thing: I need to think about how the test creates a user. Since the task says "Sign-in and access-token verification already exist", I don't need to implement sign-in. For tests, I'll create a user directly via Prisma or mock.

Actually, for the tests, I just need a user ID to associate with refresh tokens. I can use any string.

Let me think about the response format. The controller returns:
- Success: `{ accessToken: string }` and sets a cookie with the refresh token
- Failure: `{ error: { code: 'token_invalid', message: '...', details: {} } }` with 401 status

For the response DTO:

```typescript
class RefreshResponse {
  accessToken: string;
}
```

And the error is handled by a global exception filter or by throwing in the service and having the controller map it.

Actually, let me use a NestJS exception filter or just have the service throw a custom exception and use `@UsePipes` for validation.

Hmm, for simplicity, I'll have the service throw an exception and use an exception filter or handle it in the controller. Let me use a `BadRequestException` or create a custom one.

Actually, the conventions say errors should follow the envelope:
```json
{ "error": { "code": "token_invalid", "message": "...", "details": {} } }
```

I'll create a global exception filter that catches `AuthFailedException` (or similar) and formats it.

Let me define:

```typescript
// In service
class AuthFailedException extends Error {
  constructor(
    public code: string,
    message: string,
    public details: object = {},
  ) { super(message); }
}
```

And an exception filter:

```typescript
@Catch(AuthFailedException)
export class AuthFailedFilter implements ExceptionFilter {
  catch(exception: AuthFailedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    response.status(401).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}
```

This keeps the controller clean (zero business logic) and centralizes the error format.

Now let me put it all together. Let me start writing the files.

Wait — one more important detail. The `refresh` endpoint needs to get the IP and User-Agent for audit logging. I'll get these from the request.

Also, the spec says "record the event for audit" — the audit should include:
- Event type (REUSE, EXPIRY, UNKNOWN, MALFORMED, ROTATION)
- Token hash (of the presented token, for the four rejection types and ROTATION)
- Family ID (for REUSE, EXPIRY, ROTATION — where we know the family)
- User ID (where available)
- IP and User-Agent
- Details (additional context)

For MALFORMED (no token to look up), we can't hash it. So tokenHash might be null or a special value.
For UNKNOWN, we have the hash but no family/user info.
For the others, we have everything.

Let me write the code now.

Let me also think about the Prisma module. NestJS Prisma typically uses `PrismaModule` from `@prisma/nestjs` or a manually created module. I'll create a `PrismaModule` that provides the `PrismaService`.

Actually, I'll inject `PrismaClient` directly or create a service wrapper. Let me create a `PrismaService`:

```typescript
@Injectable()
export class PrismaService {
  constructor(public readonly prisma: PrismaClient) {}
  
  // For testing cleanup
  async cleanup() {
    await this.prisma.$disconnect();
  }
}
```

And the module:

```typescript
@Module({
  providers: [
    PrismaService,
    // ...
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Now let me finalize the structure and write all files. I'll be comprehensive.

Here's my final file plan:

1. `prisma/schema.prisma` — Schema with RefreshToken and AuthAudit models
2. `prisma/migrations/20240101000000_init/migration.sql` — Migration SQL
3. `src/main.ts` — Entry point
4. `src/app.module.ts` — Root module
5. `src/auth/auth.module.ts` — Auth module
6. `src/auth/auth.controller.ts` — Controller
7. `src/auth/auth.service.ts` — Service
8. `src/auth/auth.repository.ts` — Repository
9. `src/auth/token-issuer.service.ts` — IssueAccessToken
10. `src/auth/auth.failed.exception.ts` — Custom exception
11. `src/auth/auth.failed.filter.ts` — Exception filter
12. `src/auth/refresh-request.interface.ts` — Request type
13. `test/auth.spec.ts` — Tests
14. `SECURITY.md` — Security documentation

Let me trim this down a bit — the interface can be inline, and the exception/filter might be small enough to include in the service or controller file.

Actually, following the principle "Do exactly what the task asks", let me keep it to the essential files and not over-engineer.

Essential files:
1. `prisma/schema.prisma`
2. `src/main.ts`
3. `src/app.module.ts`
4. `src/auth/auth.module.ts`
5. `src/auth/auth.controller.ts`
6. `src/auth/auth.service.ts`
7. `src/auth/auth.repository.ts`
8. `test/auth.spec.ts`
9. `SECURITY.md`

I'll put the exception and filter inside the auth module or as separate files within auth.

Let me also add a `src/auth/token-issuer.service.ts` since `issueAccessToken` is assumed to exist.

OK, let me write it now. I'm going to be very thorough.

Hmm, also need a `src/auth/refresh-token.parser.ts` for extracting the token from body/cookie? No, that logic is simple enough to put in the service.

Let me write the code:

```typescript
// src/auth/auth.controller.ts
import { Body, Controller, Post, Req, Res, UseFilters, UsePipes, ValidationPipe, Cookie } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthFailedFilter } from './auth.failed.filter';
import { RefreshRequest } from './refresh-request';

@Controller('auth')
@UseFilters(AuthFailedFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  async refresh(
    @Body('refreshToken') bodyToken: string | undefined,
    @Cookie('refresh_token') cookieToken: string | undefined,
    @Req() req: Request,
  ) {
    const result = await this.authService.refresh({
      token: bodyToken ?? cookieToken, // body wins
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
    return result;
  }
}
```

Wait, but how do I set the cookie in the response? I need access to the Response object.

```typescript
@Post('refresh')
async refresh(
  @Body('refreshToken') bodyToken: string | undefined,
  @Cookie('refresh_token') cookieToken: string | undefined,
  @Req() req: Request,
  @Res() res: Response,
) {
  const result = await this.authService.refresh({
    token: bodyToken ?? cookieToken,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });
  res.cookie('refresh_token', result.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
  });
  return res.json({ accessToken: result.accessToken });
}
```

Hmm, but using `@Res()` without returning means the controller handles the response directly. That's fine.

Actually, let me reconsider. If I use `@Res()`, I shouldn't also return a value from the method (NestJS warning). Let me just return the response.

Or alternatively, I can pass the response object into the service to set the cookie. But that mixes concerns. Better to use `@Res()`.

Let me keep it simple:

```typescript
@Post('refresh')
async refresh(@Req() req: Request, @Res() res: Response) {
  const token = req.body?.refreshToken ?? req.cookies?.refresh_token;
  try {
    const result = await this.authService.refresh({
      token,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });
    return res.status(200).json({ accessToken: result.accessToken });
  } catch (e) {
    // AuthFailedFilter will catch AuthFailedException
    throw e;
  }
}
```

Actually, let me simplify even more. I'll extract the token in the controller and pass it to the service. The controller is responsible for input handling.

Let me now think about what happens in the service more carefully. I need to be very precise.

```typescript
@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokenIssuer: TokenIssuerService,
  ) {}

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    // 1. Extract and validate token format
    const token = input.token;
    if (!token || typeof token !== 'string' || token.length === 0) {
      await this.repo.audit({
        eventType: 'MALFORMED',
        tokenHash: null,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'no_valid_token_provided' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 2. Hash the token
    const tokenHash = await hashToken(token);

    // 3. Look up by hash
    const existing = await this.repo.findByHash(tokenHash);

    // 4. Not found → UNKNOWN
    if (!existing) {
      await this.repo.audit({
        eventType: 'UNKNOWN',
        tokenHash,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'token_not_found' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 5. Retired → REUSE (checked before expiry!)
    if (existing.isRetired) {
      await this.handleReuse(existing, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 6. Expired → EXPIRED
    if (existing.expiresAt < new Date()) {
      await this.repo.audit({
        eventType: 'EXPIRY',
        tokenHash,
        familyId: existing.familyId,
        userId: existing.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { expiresAt: existing.expiresAt.toISOString() },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 7. Atomic rotation attempt
    const rotated = await this.repo.atomicRetire(existing.id);

    if (!rotated) {
      // Token was just retired by another request → treat as reuse
      await this.handleReuse(existing, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 8. Success: create new refresh token
    const newRefreshToken = generateRefreshToken();
    const newTokenHash = await hashToken(newRefreshToken);
    
    await this.repo.createRefreshToken({
      tokenHash: newTokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      expiresAt: existing.expiresAt, // Same absolute deadline!
    });

    // 9. Issue new access token
    const accessToken = this.tokenIssuer.issueAccessToken(existing.userId);

    // 10. Audit the rotation
    await this.repo.audit({
      eventType: 'ROTATION',
      tokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { newTokenHash },
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  private async handleReuse(token: RefreshToken, input: RefreshInput): Promise<void> {
    await this.repo.invalidateFamily(token.familyId);
    await this.repo.audit({
      eventType: 'REUSE',
      tokenHash: await hashToken(/* ... */), // We already have the hash
      familyId: token.familyId,
      userId: token.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { reason: 'presented_retired_or_concurrent_token' },
    });
  }
}
```

Wait, I need to be careful with the hash in `handleReuse`. I already computed the hash earlier. Let me pass it as a parameter.

Let me refactor:

```typescript
async refresh(input: RefreshInput): Promise<RefreshResult> {
  const token = input.token;
  
  if (!token || typeof token !== 'string' || token.length === 0) {
    await this.recordAudit('MALFORMED', null, null, null, input, { reason: 'no_valid_token_provided' });
    throw new AuthFailedException('token_invalid', 'Authentication failed', {});
  }

  const tokenHash = await hashToken(token);
  const existing = await this.repo.findByHash(tokenHash);

  if (!existing) {
    await this.recordAudit('UNKNOWN', tokenHash, null, null, input, { reason: 'token_not_found' });
    throw new AuthFailedException('token_invalid', 'Authentication failed', {});
  }

  if (existing.isRetired) {
    await this.handleReuse(existing, tokenHash, input);
    throw new AuthFailedException('token_invalid', 'Authentication failed', {});
  }

  if (existing.expiresAt < new Date()) {
    await this.recordAudit('EXPIRY', tokenHash, existing.familyId, existing.userId, input, { 
      expiresAt: existing.expiresAt.toISOString() 
    });
    throw new AuthFailedException('token_invalid', 'Authentication failed', {});
  }

  const rotated = await this.repo.atomicRetire(existing.id);

  if (!rotated) {
    await this.handleReuse(existing, tokenHash, input);
    throw new AuthFailedException('token_invalid', 'Authentication failed', {});
  }

  const newRefreshToken = generateRefreshToken();
  const newTokenHash = await hashToken(newRefreshToken);
  
  await this.repo.createRefreshToken({
    tokenHash: newTokenHash,
    familyId: existing.familyId,
    userId: existing.userId,
    expiresAt: existing.expiresAt,
  });

  const accessToken = this.tokenIssuer.issueAccessToken(existing.userId);

  await this.recordAudit('ROTATION', tokenHash, existing.familyId, existing.userId, input, { 
    newTokenHash 
  });

  return { accessToken, refreshToken: newRefreshToken };
}
```

Good. Let me finalize and write all the files now.

One thing I want to make sure: the Prisma schema needs `@@map` and `@map` correctly. And I need to handle the `prisma` import.

Let me also think about what the test structure looks like.

```typescript
// test/auth.spec.ts
import { Test } from '@nestjs/testing';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaClient } from '@prisma/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: PrismaService;
  let server;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
    
    authService = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    
    server = app.getHttpServer(); // or use supertest
  });

  afterEach(async () => {
    // Clean up DB
    await prisma.refreshToken.deleteMany();
    await prisma.authAudit.deleteMany();
  });

  it('should rotate a valid refresh token', async () => {
    // Create a refresh token in DB
    // Make POST /auth/refresh
    // Verify new tokens returned
    // Verify old token is retired
  });

  it('concurrent refresh with same token → exactly one succeeds', async () => {
    // Create a valid refresh token
    // Fire two simultaneous requests
    // Verify exactly one succeeded
    // Verify both recorded correctly
  });

  // etc.
});
```

Actually, let me think about how to make HTTP requests in tests. I'll use NestJS's `supertest` approach.

Let me finalize the test structure. I'll use a more practical approach:

```typescript
import * as request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaService } from '../src/prisma/prisma.service';
```

OK let me just write it all now. I've thought about this enough.

Actually, one more thing: for the test, I need to seed the database with refresh tokens. I'll create them directly via Prisma since the sign-in flow is assumed to exist.

Also, for the `hashToken` function, I'll use Node's `crypto` module:

```typescript
import { createHash } from 'crypto';

function hashToken(token: string): Promise<string> {
  return Promise.resolve(createHash('sha256').update(token).digest('hex'));
}
```

And for generating refresh tokens:

```typescript
import { randomBytes } from 'crypto';

function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}
```

Now let me write all the files.

Let me reconsider: should the repository handle the audit as well, or should the service handle it? The audit is a database operation, so by convention, only the repository should touch the database. But the audit call is a Prisma client call.

Hmm, the convention says: "repository is the only layer that touches the database." So `repo.audit()` is a repository method. And `repo.createRefreshToken()`, `repo.findByHash()`, `repo.atomicRetire()`, `repo.invalidateFamily()` are all repository methods. Good.

Let me also consider: should `createRefreshToken` be the only method name, or should it be more specific? Let me use descriptive names:

- `findByHash(tokenHash: string): Promise<RefreshToken | null>`
- `atomicRetire(id: string): Promise<boolean>`
- `invalidateFamily(familyId: string): Promise<void>`
- `createToken(data: CreateTokenInput): Promise<RefreshToken>`
- `audit(event: AuditEvent): Promise<void>`
- `createToken` creates a new refresh token record

Now let me write it all.

Wait, I also need to think about the `PrismaService` location. Should it be in `src/prisma/prisma.service.ts`? That's a reasonable location. Let me create it.

Actually, the task doesn't mention this file but it's needed for wiring. Let me create a minimal version.

Let me finalize:

Files:
1. `src/main.ts`
2. `src/app.module.ts`
3. `src/prisma/prisma.service.ts`
4. `prisma/schema.prisma`
5. `prisma/migrations/20240101000000_init/migration.sql`
6. `src/auth/auth.module.ts`
7. `src/auth/auth.controller.ts`
8. `src/auth/auth.service.ts`
9. `src/auth/auth.repository.ts`
10. `src/auth/auth.failed.exception.ts`
11. `src/auth/auth.failed.filter.ts`
12. `src/auth/token-issuer.service.ts`
13. `test/auth.spec.ts`
14. `SECURITY.md`

That's a lot of files but each serves a clear purpose. Let me write them all.

Actually, wait. Let me check if I need `AuthModule` to import `PrismaModule` for the repository. Yes — the repository needs `PrismaService`, which is provided by `PrismaModule`. So `AuthModule` imports `PrismaModule`.

And the controller is in `AuthModule`'s `controllers` array.

Let me also make sure `TokenIssuerService` is in `AuthModule`'s `providers`.

Let me write it now.

One more thing: I should think about what HTTP status code to return for rejections. 401 Unauthorized is appropriate since the token is invalid. All four rejection types should return 401.

OK, now I'll write all the files.

Let me think about the test more concretely.

For the concurrent test, I need to:
1. Create a user (just need a user ID — let's say 'user-1')
2. Create a refresh token in the DB with a future expiry, not retired
3. Use supertest to fire two POST /auth/refresh requests simultaneously with the same token
4. Verify one got 200 and the other got 401
5. Verify the original token is retired
6. Verify audit has the appropriate records

For this to work in tests, I need the actual endpoint to receive the token. Since tokens are hashed for storage, the client sends the plaintext token and the server hashes it. So in tests, I'll create a token, store its hash, and then send the plaintext token in the request.

But wait — to test, I need to set up a refresh token in the database. I can do this directly via Prisma in the test setup.

Let me think about the test more carefully:

```typescript
it('concurrent refreshes with same token → exactly one rotates', async () => {
  // Given: a valid, non-retired refresh token
  const rawToken = generateRefreshToken();
  const tokenHash = hashToken(rawToken);
  const familyId = 'family-1';
  const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
  
  await prisma.refreshToken.create({
    data: {
      id: 'token-1',
      tokenHash,
      familyId,
      userId: 'user-1',
      isRetired: false,
      expiresAt,
    },
  });

  // When: two concurrent requests
  const results = await Promise.all([
    request(server)
      .post('/auth/refresh')
      .set('Cookie', [`refresh_token=${rawToken}`])
      .expect(200),
    request(server)
      .post('/auth/refresh')
      .set('Cookie', [`refresh_token=${rawToken}`])
      .expect(401),
  ]);

  // Wait — Promise.all with two requests that expect different status codes...
  // Actually, supertest's .expect() will throw if the status doesn't match.
  // So I need to handle this differently.

  // Better:
  const [res1, res2] = await Promise.all([
    request(server).post('/auth/refresh').cookie(`refresh_token=${rawToken}`).then(r => r),
    request(server).post('/auth/refresh').cookie(`refresh_token=${rawToken}`).then(r => r),
  ]);

  // Then: exactly one is 200, the other is 401
  const successes = [res1, res2].filter(r => r.status === 200);
  const failures = [res1, res2].filter(r => r.status === 401);
  
  expect(successes.length).toBe(1);
  expect(failures.length).toBe(1);
  
  // The original token should be retired
  const dbToken = await prisma.refreshToken.findUnique({ where: { id: 'token-1' } });
  expect(dbToken.isRetired).toBe(true);
});
```

Hmm, there's a timing issue with supertest and concurrent requests. In Node.js, if two requests hit the same endpoint simultaneously, they'll be processed concurrently by the HTTP server. The database-level atomic update will determine which one wins. This should work correctly.

Actually, with supertest and `Promise.all`, both requests will be fired at roughly the same time. The database will serialize them. This should work.

But there's a subtlety: supertest uses the same agent by default, which means cookies are shared. If the first request sets a cookie, the second request might use it. I should use separate agents or explicitly set the cookie header.

Let me use `.cookie()` or `.set('Cookie', ...)` explicitly, and maybe use separate request instances.

Actually, I realize that in supertest, `.cookie()` sets the cookie for that specific request. So that should be fine.

Let me now also think about what happens after the concurrent test: both tokens in the family are retired (original + winner's new token), and the audit log has both a ROTATION and a REUSE event. But this is an edge case — in the test, I just want to verify the concurrency guarantee.

OK, let me write everything now. I'm going to create a comprehensive, production-quality solution.

Let me think about one more thing: the `refresh_token` cookie in the response. The new refresh token should be set as a cookie. I'll configure it as httpOnly, secure, sameSite=strict.

And in the rejection case, no new cookie is set. The response just has the error envelope.

Alright, here goes. Let me write all files.

Wait, one more consideration: the spec says "define which wins when both are present, and write the precedence down where the next reader will find it." I'll document in SECURITY.md that body takes precedence over cookie.

Let me also add the comment in the controller code.

Now let me think about the `TokenIssuerService`. The spec says "assume `issueAccessToken(userId): string`". I'll create a simple service that generates a JWT. For tests, the actual JWT content doesn't matter, just that it returns a string.

Actually, I realize I need to be careful about circular dependencies. `TokenIssuerService` doesn't depend on anything else, and `AuthService` depends on it. No circular dependency.

Let me also think about `AuthFailedException`. It needs to have `code`, `message`, and `details` properties. The exception filter reads these.

OK, I'm going to write all the files now. Let me be very precise and thorough.

Here's the final structure:

```
prisma/schema.prisma
prisma/migrations/.../migration.sql
src/main.ts
src/app.module.ts
src/prisma/prisma.service.ts
src/auth/auth.module.ts
src/auth/auth.controller.ts
src/auth/auth.service.ts
src/auth/auth.repository.ts
src/auth/auth.failed.exception.ts
src/auth/auth.failed.filter.ts
src/auth/token-issuer.service.ts
test/auth.spec.ts
SECURITY.md
```

Let me write them all.

I need to think about one more thing: in the repository's `createToken` method, the Prisma type needs to match. Let me check what fields the Prisma `refreshTokenCreateInput` would have based on my schema. It should include `id`, `tokenHash`, `familyId`, `userId`, `isRetired`, `expiresAt`, `createdAt`, `updatedAt`. But `isRetired` defaults to false, and `createdAt`/`updatedAt` are auto-generated. So I just need: `tokenHash`, `familyId`, `userId`, `expiresAt` (and optionally `id`).

Now, writing the migration. A Prisma migration file is SQL that creates the tables. I need to write raw SQL.

Let me now actually write all the code.

Let me also consider whether I should include the PrismaClient import. The `PrismaService` extends or wraps `PrismaClient`.

In NestJS + Prisma, a common pattern:

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async cleanup() {
    // For tests
    await this.refreshToken.deleteMany();
    await this.authAudit.deleteMany();
  }
}
```

OK let me write everything now. I'll be comprehensive but won't over-engineer.

Actually, let me reconsider the test. The task says "Tests for: concurrent presentation of one token, a replay that invalidates a sibling token, rotation against the absolute deadline, and the rejection responses compared to each other."

So I need exactly these four test scenarios (at minimum):
1. Concurrent presentation — exactly one rotates
2. Replay invalidates sibling — presenting a retired token invalidates all in family
3. Rotation against absolute deadline — new token has same expiry, not extended
4. Rejection responses — expired, retired, unknown, malformed all return identical responses

Let me structure the test file accordingly.

I also need to think about how to run the tests. With Vitest and NestJS, I need the Prisma client generated. In the test setup, I'll need to ensure the Prisma client is available.

Let me write the test using a real database (PostgreSQL via DATABASE_URL) or in-memory. For simplicity, I'll assume a test database is available via `DATABASE_URL`.

In the test setup:
1. Create PrismaService instance
2. Run migrations (or use `prisma.$executeRaw` to set up tables)
3. Create test data
4. Run tests
5. Clean up

Since migrations can't be easily run in a test file (they need the Prisma CLI), I'll create tables directly via Prisma in a setup function, or assume the database is already migrated.

Actually, in practice, for integration tests, you'd typically:
1. Run `prisma migrate deploy` before tests
2. In tests, just use the tables and clean up between tests

I'll note this in the test file and assume the database is migrated.

Let me also consider: do I need to handle the `DATABASE_URL` env var? Yes, Prisma reads it automatically. In tests, I'll use a separate test database URL.

Now let me actually write all the files. I've been overthinking this. Let me produce the output.

One final thought: the `prisma/migrations` directory structure. A Prisma migration folder looks like:
```
prisma/migrations/
  20240101000000_init/
    migration.sql
    schema.prisma
    migration_lock.toml
```

I'll create a minimal migration file.

OK, writing now.

Let me think about whether I want `PrismaService` in `src/prisma/prisma.service.ts` or somewhere else. I'll go with `src/prisma/prisma.service.ts`.

For `src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

For `src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
})
export class AppModule {}
```

Hmm wait, I need to decide if PrismaModule is a separate module. Yes, it should be, so it can be imported by other modules. Let me create:

- `src/prisma/prisma.service.ts` — the PrismaService
- `src/prisma/prisma.module.ts` — the PrismaModule

Let me add that to my file list.

Now, the AuthModule:
```typescript
@Module({
  imports: [PrismaModule],
  providers: [
    AuthService,
    AuthRepository,
    TokenIssuerService,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
```

Wait, but `AuthFailedFilter` should be registered too. I'll use `@UseFilters(AuthFailedFilter)` on the controller, so it doesn't need to be in the module's providers. Actually, if I use it as a decorator on the controller, NestJS needs to instantiate it, so it needs to be available. Let me check: when you use `@UseFilters(SomeFilter)` where `SomeFilter` is a class, NestJS will instantiate it via the DI container if it's a provider. So I should add it to providers.

Alternatively, I can use `@UseFilters(AuthFailedFilter)` and make sure `AuthFailedFilter` is provided. Let me add it to the AuthModule's providers.

```typescript
@Module({
  imports: [PrismaModule],
  providers: [
    AuthService,
    AuthRepository,
    TokenIssuerService,
    AuthFailedFilter,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
```

And the controller uses `@UseFilters(AuthFailedFilter)` as well for explicit association.

Actually, with NestJS, if the filter is in providers and you use `@UseFilters(AuthFailedFilter)`, NestJS resolves it from the container. Good.

Now let me also think about whether I need `@Injectable()` on the exception filter. Yes, it should be `@Injectable()`.

Let me write everything now. Final attempt. I'll write all files completely.

Let me think about potential issues:
1. The `PrismaService` needs `@Injectable()` for DI
2. The repository needs `PrismaService` injected
3. The service needs repository and token issuer injected
4. All proper module wiring

For the `AuthRepository`, constructor injection:
```typescript
constructor(private readonly prisma: PrismaService) {}
```

This assumes `PrismaService` is available in the module's DI tree, which it is via `PrismaModule` import.

Let me now write everything. I'll be careful with TypeScript types and Prisma types.

Actually, let me also think about the `RefreshInput` type. I'll define it as an interface:

```typescript
interface RefreshInput {
  token: string | null | undefined;
  ip: string;
  userAgent: string;
}
```

And `RefreshResult`:
```typescript
interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}
```

I'll put these in the service file or a separate types file. For simplicity, I'll put them in the service file.

OK I'm going to write all the files now. Let me structure my output.

Actually, one more thing. Let me think about the `invalidateFamily` method. It should set `isRetired = true` for all tokens with the given `familyId`:

```typescript
async invalidateFamily(familyId: string): Promise<void> {
  await this.prisma.refreshToken.updateMany({
    where: { familyId },
    data: { isRetired: true, updatedAt: new Date() },
  });
}
```

And the audit method:

```typescript
async audit(event: AuditEvent): Promise<void> {
  await this.prisma.authAudit.create({
    data: {
      eventType: event.eventType,
      tokenHash: event.tokenHash,
      familyId: event.familyId,
      userId: event.userId,
      ip: event.ip,
      userAgent: event.userAgent,
      details: event.details,
    },
  });
}
```

Where `AuditEvent` is an interface:

```typescript
interface AuditEvent {
  eventType: string;
  tokenHash: string | null;
  familyId: string | null;
  userId: string | null;
  ip: string;
  userAgent: string;
  details: Record<string, unknown>;
}
```

Now let me finalize everything and write it out.

One concern: in the concurrent test, if I use `Promise.all` with two HTTP requests, will they truly be concurrent? In Node.js, since it's single-threaded, they'll be processed sequentially by the event loop, but at the HTTP server level, both requests will be accepted and queued. The key is that the database operations are atomic. As long as both requests reach the `atomicRetire` call before either completes, the database will serialize them.

But in practice, with a single-threaded Node.js server, the first request will fully execute (including the database call) before the second starts. Is that still concurrent enough to test the race condition?

Hmm, that's a valid concern. Let me think about this differently.

Actually, in NestJS with Express, the HTTP server does handle multiple incoming requests concurrently (the OS accepts them and queues them). The Node.js event loop processes them one at a time, but the key is the database operation. If I use `await` for the database call, the event loop can switch to another request while waiting for the DB response.

So:
1. Request 1 arrives, starts processing, reaches `atomicRetire`
2. Request 1's DB call is sent, event loop is free
3. Request 2 arrives (or is already queued), starts processing, reaches `atomicRetire`
4. Wait — if request 2 was already in the queue, it might have started processing before request 1's DB call completed

Actually, NestJS's request handling is async. When a request hits the database, the event loop can process another request. So the concurrent scenario IS testable.

But to make the test more reliable, I could also test at the repository/service level: call `atomicRetire` twice concurrently and verify only one succeeds. But the spec says "tests ... including a genuinely concurrent one rather than two sequential calls."

Let me test at the HTTP level with supertest. Both requests will be fired simultaneously via `Promise.all`, and they'll interleave at the async DB boundaries.

Let me verify this works:

```typescript
const [res1, res2] = await Promise.all([
  request(server).post('/auth/refresh').cookie(`refresh_token=${rawToken}`),
  request(server).post('/auth/refresh').cookie(`refresh_token=${rawToken}`),
]);
```

Wait, I need to be careful with supertest — you need to actually send the request. Let me use `request(server).post('/auth/refresh').cookie(...).then(res => res)` to get the response.

Actually, supertest returns a promise when `.end()` is called implicitly. Let me check:

```typescript
const req1 = request(server).post('/auth/refresh').cookie(`refresh_token=${rawToken}`);
const req2 = request(server).post('/auth/refresh').cookie(`refresh_token=${rawToken}`);
const [res1, res2] = await Promise.all([req1, req2]);
```

Hmm, supertest without `.end()` or `.then()` returns a request object. You need to actually execute it. Let me use `.then()` to make it return a promise:

```typescript
const res1Promise = request(server).post('/auth/refresh').cookie(`refresh_token=${rawToken}`).then(r => r);
const res2Promise = request(server).post('/auth/refresh').cookie(`refresh_token=${rawToken}`).then(r => r);
const [res1, res2] = await Promise.all([res1Promise, res2Promise]);
```

This should work. Both requests will be sent concurrently by the HTTP agent.

But wait — there's a subtle issue. Both requests share the same cookie jar in supertest, which might cause issues. Let me use `.cookie()` method which explicitly sets the cookie header for that request.

Actually, I just realized that supertest's `.cookie()` method adds a Cookie header. Let me use it properly:

```typescript
const res1Promise = request(server)
  .post('/auth/refresh')
  .set('Cookie', [`refresh_token=${rawToken}`])
  .then(r => r);
```

This ensures each request explicitly has the cookie without relying on a shared cookie jar.

OK, now I'm really going to write all the files. Let me go.

Hmm, actually, one thing I want to consider is whether I should test the controller endpoint or test the service directly. The spec says "Tests for: concurrent presentation of one token" — this is best tested at the endpoint level since it involves HTTP request handling and cookie parsing.

But testing the full HTTP stack might be complex in a Vitest setup. Let me think...

I'll create a NestJS application in the test setup and use supertest. This is a standard pattern.

Let me write the test as an integration test that creates a full NestJS app, sends HTTP requests, and verifies responses.

Let me also consider that I need Prisma client to be generated. In the test, I'll import from `@prisma/client`.

OK, here's my plan for the test:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    
    // Ensure tables exist
    // (assuming migrations have been run)
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up
    await prisma.authAudit.deleteMany();
    await prisma.refreshToken.deleteMany();
  });

  describe('concurrent presentation', () => {
    it('exactly one request rotates when same token is presented concurrently', async () => {
      // Setup
      const rawToken = 'test-token-' + Date.now();
      // Insert directly via Prisma (simulating sign-in)
      const tokenHash = hash(rawToken);
      await prisma.refreshToken.create({
        data: {
          id: crypto.randomUUID(),
          tokenHash,
          familyId: 'family-1',
          userId: 'user-1',
          isRetired: false,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });

      // Execute two concurrent requests
      const results = await Promise.all([
        request(server)
          .post('/auth/refresh')
          .set('Cookie', [`refresh_token=${rawToken}`])
          .then(r => r),
        request(server)
          .post('/auth/refresh')
          .set('Cookie', [`refresh_token=${rawToken}`])
          .then(r => r),
      ]);

      // Verify exactly one succeeded
      const ok = results.filter(r => r.status === 200);
      const fail = results.filter(r => r.status === 401);
      expect(ok.length).toBe(1);
      expect(fail.length).toBe(1);

      // Verify original token is retired
      const dbToken = await prisma.refreshToken.findFirst({ where: { tokenHash } });
      expect(dbToken.isRetired).toBe(true);
    });
  });

  // More tests...
});
```

Hmm wait, I'm using `crypto.randomUUID()` which is Node 14.17+. For Node 20+, it's available as `crypto.randomUUID()`. Good.

But `hash()` function — I need to implement it in the test file using `crypto.createHash('sha256')`.

Also, I should think about the `crypto` import in the test file. Let me use `import { createHash, randomBytes, randomUUID } from 'crypto';`.

OK let me write everything now. No more deliberation.

Let me also think about error handling in the test. The `AuthFailedException` is thrown in the service and caught by the filter, which returns a 401 with the error envelope. In tests, I need to verify this response structure.

Alright, writing all files now. This will be a long output.

Let me also reconsider the `PrismaModule`. It needs to provide `PrismaService`. Here's the structure:

```typescript
// src/prisma/prisma.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

And `PrismaService`:

```typescript
// src/prisma/prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Great. Now let me write everything.

Actually, one issue with extending PrismaClient and implementing lifecycle hooks. In NestJS, `onModuleInit` and `onModuleDestroy` are standard interfaces. This should work fine.

Let me now think about the `AuthRepository` more carefully. It needs Prisma types. The `PrismaService` extends `PrismaClient`, so it has access to all models. Let me check the Prisma types:

- `prisma.refreshToken.findUnique(...)` — this works because `PrismaClient` has a `refreshToken` property
- `prisma.refreshToken.findMany(...)` — same
- `prisma.refreshToken.create(...)` — same
- `prisma.refreshToken.updateMany(...)` — same
- `prisma.authAudit.create(...)` — same

These are standard Prisma client methods. Good.

Let me now write the `AuthRepository` with proper typing. I'll use the Prisma types directly.

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async atomicRetire(id: string) {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, isRetired: false },
      data: { isRetired: true },
    });
    return result.count > 0;
  }

  async invalidateFamily(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId },
      data: { isRetired: true },
    });
  }

  async createToken(data: {
    tokenHash: string;
    familyId: string;
    userId: string;
    expiresAt: Date;
  }) {
    return this.prisma.refreshToken.create({
      data,
    });
  }

  async audit(data: {
    eventType: string;
    tokenHash: string | null;
    familyId: string | null;
    userId: string | null;
    ip: string;
    userAgent: string;
    details: Record<string, unknown>;
  }) {
    await this.prisma.authAudit.create({ data });
  }
}
```

This looks clean. The repository is the only layer that touches the database (via Prisma).

Now let me write the service. I need to be careful about the flow.

```typescript
import { Injectable } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import { TokenIssuerService } from './token-issuer.service';
import { AuthFailedException } from './auth.failed.exception';

interface RefreshInput {
  token: string | undefined | null;
  ip: string;
  userAgent: string;
}

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokenIssuer: TokenIssuerService,
  ) {}

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    const { token } = input;

    // MALFORMED
    if (!token || typeof token !== 'string' || token.length === 0) {
      await this.repo.audit({
        eventType: 'MALFORMED',
        tokenHash: null,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'no_valid_token_provided' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    const tokenHash = hashToken(token);
    const existing = await this.repo.findByHash(tokenHash);

    // UNKNOWN
    if (!existing) {
      await this.repo.audit({
        eventType: 'UNKNOWN',
        tokenHash,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'token_not_found_in_database' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // REUSE (before expiry — per security policy)
    if (existing.isRetired) {
      await this.handleReuse(existing, tokenHash, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // EXPIRY
    if (existing.expiresAt.getTime() < Date.now()) {
      await this.repo.audit({
        eventType: 'EXPIRY',
        tokenHash,
        familyId: existing.familyId,
        userId: existing.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { expiresAt: existing.expiresAt.toISOString() },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // ATOMIC ROTATION
    const rotated = await this.repo.atomicRetire(existing.id);

    if (!rotated) {
      // Another request won the race — this is reuse
      await this.handleReuse(existing, tokenHash, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // SUCCESS: create new token, same family, same expiry
    const newRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRefreshToken);

    await this.repo.createToken({
      tokenHash: newTokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      expiresAt: existing.expiresAt,
    });

    const accessToken = this.tokenIssuer.issueAccessToken(existing.userId);

    await this.repo.audit({
      eventType: 'ROTATION',
      tokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { newTokenHash },
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  private async handleReuse(
    token: { familyId: string; userId: string; },
    tokenHash: string,
    input: RefreshInput,
  ): Promise<void> {
    await this.repo.invalidateFamily(token.familyId);
    await this.repo.audit({
      eventType: 'REUSE',
      tokenHash,
      familyId: token.familyId,
      userId: token.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { reason: 'presented_retired_or_raced_token' },
    });
  }
}

function hashToken(token: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  const { randomBytes } = require('crypto');
  return randomBytes(32).toString('hex');
}
```

Wait, I should use `import` statements rather than `require`. Let me fix that:

```typescript
import { createHash, randomBytes } from 'crypto';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}
```

Much better.

Now let me write the `AuthFailedException`:

```typescript
export class AuthFailedException extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AuthFailedException';
  }
}
```

And the filter:

```typescript
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { AuthFailedException } from './auth.failed.exception';

@Catch(AuthFailedException)
export class AuthFailedFilter implements ExceptionFilter {
  catch(exception: AuthFailedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    response.status(401).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}
```

Now the controller:

```typescript
import { Controller, Post, Body, Cookie, Req, Res, UseFilters } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthFailedFilter } from './auth.failed.filter';

@Controller('auth')
@UseFilters(AuthFailedFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Body takes precedence over cookie when both are present
    const token = req.body?.refreshToken ?? req.cookies?.refresh_token;

    const result = await this.authService.refresh({
      token,
      ip: req.ip ?? 'unknown',
      userAgent: req.get('User-Agent') ?? 'unknown',
    });

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    return res.status(200).json({ accessToken: result.accessToken });
  }
}
```

Wait, there's an issue with using `@Res()` without `passthrough`. When you use `@Res()`, NestJS doesn't auto-send the response, so you must handle it yourself (which I'm doing). That's fine.

Now the `TokenIssuerService`:

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class TokenIssuerService {
  issueAccessToken(userId: string): string {
    // ASSUMPTION: This method is provided by the existing auth system.
    // Implementation placeholder — replaced by actual JWT/service in production.
    const { randomBytes } = require('crypto');
    return `access_${randomBytes(16).toString('hex')}_${userId}`;
  }
}
```

Hmm, let me use a proper import instead:

```typescript
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

@Injectable()
export class TokenIssuerService {
  issueAccessToken(userId: string): string {
    return `access_${randomBytes(16).toString('hex')}_${userId}`;
  }
}
```

Now the module:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { TokenIssuerService } from './token-issuer.service';
import { AuthFailedFilter } from './auth.failed.filter';

@Module({
  imports: [PrismaModule],
  providers: [
    AuthService,
    AuthRepository,
    TokenIssuerService,
    AuthFailedFilter,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
```

Now `PrismaModule`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

And `PrismaService`:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Now `AppModule`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
})
export class AppModule {}
```

And `main.ts`:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

Now the test. Let me write a comprehensive one:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createHash, randomBytes, randomUUID } from 'crypto';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

describe('AuthController - refresh', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.authAudit.deleteMany();
    await prisma.refreshToken.deleteMany();
  });

  function buildRefreshInput(token: string, ip = '1.2.3.4', ua = 'test-agent') {
    return { token, ip, userAgent: ua };
  }

  async function seedRefreshToken(opts: {
    tokenHash: string;
    familyId: string;
    userId?: string;
    expiresAt?: Date;
    isRetired?: boolean;
  }) {
    return prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        tokenHash: opts.tokenHash,
        familyId: opts.familyId,
        userId: opts.userId ?? 'user-1',
        isRetired: opts.isRetired ?? false,
        expiresAt: opts.expiresAt ?? new Date(Date.now() + 3600000),
      },
    });
  }

  describe('concurrent presentation of one token', () => {
    it('exactly one request rotates, the other is treated as reuse', async () => {
      const rawToken = generateToken();
      const tokenHash = hashToken(rawToken);
      await seedRefreshToken({ tokenHash, familyId: 'family-1' });

      const sendReq = () =>
        request(server)
          .post('/auth/refresh')
          .set('Cookie', [`refresh_token=${rawToken}`])
          .then(r => r);

      const [res1, res2] = await Promise.all([sendReq(), sendReq()]);

      const ok = [res1, res2].filter(r => r.status === 200);
      const fail = [res1, res2].filter(r => r.status === 401);
      expect(ok.length).toBe(1);
      expect(fail.length).toBe(1);

      // Winner should have set a cookie with new refresh token
      const winner = ok[0];
      const setCookie = winner.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie[0]).toContain('refresh_token=');
      expect(setCookie[0]).toContain('HttpOnly');

      // Loser gets error envelope
      const loser = fail[0];
      expect(loser.body).toEqual({
        error: { code: 'token_invalid', message: 'Authentication failed', details: {} },
      });

      // Original token retired
      const original = await prisma.refreshToken.findUnique({ where: { tokenHash } });
      expect(original.isRetired).toBe(true);

      // Audit has a ROTATION and a REUSE event
      const events = await prisma.authAudit.findMany();
      const types = events.map(e => e.eventType);
      expect(types).toContain('ROTATION');
      expect(types).toContain('REUSE');
    });
  });

  describe('replay invalidates sibling tokens', () => {
    it('presenting a retired token invalidates all tokens in the family', async () => {
      // First: rotate a token
      const originalToken = generateToken();
      const originalHash = hashToken(originalToken);
      const familyId = 'family-2';
      await seedRefreshToken({ tokenHash: originalHash, familyId, userId: 'user-1' });

      const rotationRes = await request(server)
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=${originalToken}`])
        .expect(200);

      // Extract the new refresh token from the response body and cookie
      const newRefreshToken = rotationRes.body.refreshToken;
      expect(newRefreshToken).toBeDefined();

      // Now replay the original (retired) token
      await request(server)
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=${originalToken}`])
        .expect(401);

      // All tokens in family should be retired
      const familyTokens = await prisma.refreshToken.findMany({ where: { familyId } });
      for (const t of familyTokens) {
        expect(t.isRetired).toBe(true);
      }

      // Audit has REUSE event
      const events = await prisma.authAudit.findMany();
      const types = events.map(e => e.eventType);
      expect(types).toContain('REUSE');
    });
  });

  describe('rotation against absolute deadline', () => {
    it('new refresh token inherits the original expiry, not extended', async () => {
      const fixedExpiry = new Date('2025-12-31T00:00:00.000Z');
      const token = generateToken();
      const tokenHash = hashToken(token);
      await seedRefreshToken({ tokenHash, familyId: 'family-3', expiresAt: fixedExpiry });

      const res = await request(server)
        .post('/auth/refresh')
        .set('Cookie', [`refresh_token=${token}`])
        .expect(200);

      // Find the new token in the DB
      const newTokenInDb = await prisma.refreshToken.findMany({
        where: { familyId: 'family-3', isRetired: false },
      });

      expect(newTokenInDb).toHaveLength(1);
      expect(newTokenInDb[0].expiresAt).toEqual(fixedExpiry);

      // Original is retired
      const original = await prisma.refreshToken.findUnique({ where: { tokenHash } });
      expect(original.isRetired).toBe(true);
      expect(original.expiresAt).toEqual(fixedExpiry);
    });
  });

  describe('rejection responses', () => {
    it('expired, retired, unknown, and malformed all return identical response shapes', async () => {
      const familyId = 'family-4';

      // Prepare tokens
      const expiredToken = generateToken();
      await seedRefreshToken({
        tokenHash: hashToken(expiredToken),
        familyId,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      });

      const liveToken = generateToken();
      await seedRefreshToken({
        tokenHash: hashToken(liveToken),
        familyId: 'family-5',
      });
      // Retire it immediately via another rotation? Let's just mark it.
      await prisma.refreshToken.update({
        where: { tokenHash: hashToken(liveToken) },
        data: { isRetired: true },
      });

      const testCases = [
        { token: '', desc: 'malformed' },
        { token: 'nonexistent', desc: 'unknown' },
        { token: expiredToken, desc: 'expired' },
        { token: liveToken, desc: 'retired' },
      ];

      const results = await Promise.all(
        testCases.map(async ({ token, desc }) => ({
          desc,
          res: await request(server)
            .post('/auth/refresh')
            .set('Cookie', [`refresh_token=${token}`])
            .then(r => r),
        })),
      );

      for (const { desc, res } of results) {
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          error: { code: 'token_invalid', message: 'Authentication failed', details: {} },
        });
        // Audit should have an entry for each
        const auditCount = await prisma.authAudit.count({
          where: {
            tokenHash: { not: null },
          },
        });
        expect(auditCount).toBeGreaterThanOrEqual(results.length);
      }

      // Verify each rejection type has an audit record
      const events = await prisma.authAudit.findMany();
      const eventTypes = events.map(e => e.eventType);
      expect(eventTypes).toContain('MALFORMED');
      expect(eventTypes).toContain('UNKNOWN');
      expect(eventTypes).toContain('EXPIRY');
      expect(eventTypes).toContain('REUSE');
    });
  });
});
```

Wait, there's an issue with the malformed test case. An empty string token is malformed, but I'm sending it as a cookie `refresh_token=`. The controller should handle this by checking `req.body?.refreshToken ?? req.cookies?.refresh_token`, which would give `''` (empty string), which is falsy... wait, no: `'' ?? 'something'` — actually, `??` only checks for `null` and `undefined`, not empty string. So `'' ?? undefined` = `''`. Then in the service, `!token || typeof token !== 'string' || token.length === 0` → `!''` is `true` → malformed. Good.

Actually wait: `req.body?.refreshToken` when there's no body property returns `undefined`. Then `undefined ?? req.cookies?.refresh_token` evaluates the right side, giving the cookie value. If the cookie is empty string, the token is `''`. Good.

But actually for the malformed case, I should send a request with NO cookie at all. Let me update the test:

```typescript
{ token: '', desc: 'malformed' }, // This sends an empty cookie, which is still malformed
```

This is fine. An empty cookie value is still a malformed token.

Hmm, actually, let me think about this. When I do `.set('Cookie', ['refresh_token='])`, that's a valid HTTP header with an empty value. The controller will get `req.cookies.refresh_token = ''`. Then the service checks `!''` → true → malformed. Good.

But wait, `req.body?.refreshToken` — if there's no JSON body at all, this is `undefined`. Then `undefined ?? req.cookies?.refresh_token` → checks the cookie. Good.

Let me also handle the case where the request has a body with `refreshToken: null` and no cookie. The `??` operator handles this correctly: `null ?? cookie` → cookie.

And if both are present, body wins (I use `??` which doesn't check for empty string, but that's fine — if the body token is a non-empty string, it wins; if it's empty string, it still "wins" but would be treated as malformed anyway).

Actually, this is important: `'' ?? 'cookie'` evaluates to `''` (empty string), not `'cookie'`. So if the body has `refreshToken: ''`, the token is `''`, which is treated as malformed. This is correct behavior — the body value takes precedence.

But what if the body has `refreshToken: null`? `null ?? 'cookie'` → `'cookie'`. So if the body explicitly sends null, the cookie is used. That's a bit ambiguous but reasonable.

What about `refreshToken: undefined`? `undefined ?? 'cookie'` → `'cookie'`. Same.

I think this is fine. The rule is: body wins if it has a value (not null/undefined). Otherwise, cookie is used.

Now let me also think about the `security.md` file:

```markdown
# SECURITY.md — Refresh Rotation Check Ordering

## Token precedence
When both `refreshToken` (JSON body) and `refresh_token` (cookie) are present,
the **body value wins**. This is deliberate: explicit client payloads take
precedence over transport-layer cookies.

## Check ordering (in `AuthService.refresh`)

1. **Malformed** — no token, empty, or non-string. Short-circuit before any DB
   work; there is nothing to look up.
2. **Unknown** — hash not in the database. Recorded as UNKNOWN; the hash is
   stored so it can be correlated with other failed attempts.
3. **Reuse** — token is retired. Checked **before** expiry because a token that
   is both retired and expired is a compromise event, not a normal expiry.
4. **Expiry** — token is live but past its absolute deadline. Only reached when
   the token is confirmed un-retired.
5. **Atomic rotation** — a conditional `UPDATE ... WHERE is_retired = false`
   executed against the database. If no row was modified, another request won
   the race. That other request retired this token in the same family, which
   is indistinguishable from a replay and is treated as **reuse**.
6. **Success** — new refresh token issued (same family, same absolute expiry),
   old token retired, access token generated.

## Why this order?
- Reuse before expiry prevents attackers from disguising replay attacks as
  routine expiries in the audit log.
- The atomic update (not read-then-write) eliminates the race window between
  reading token state and writing the retirement.
- Every failure path writes an audit record with the specific failure reason
  (MALFORMED/UNKNOWN/REUSE/EXPIRY), while the caller receives an identical
  401 for all four.
```

That's about 20 lines. Within the 15-25 line range.

Now let me finalize the Prisma schema and migration.

Schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model RefreshToken {
  id        String   @id @default(uuid()) @map("id")
  tokenHash String   @unique @map("token_hash")
  familyId  String   @map("family_id")
  userId    String   @map("user_id")
  isRetired Boolean  @default(false) @map("is_retred")
  expiresAt DateTime @map("expires_at")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("refresh_tokens")
}

model AuthAudit {
  id         String   @id @default(uuid()) @map("id")
  eventType  String   @map("event_type")
  tokenHash  String?  @map("token_hash")
  familyId   String?  @map("family_id")
  userId     String?  @map("user_id")
  ip         String?  @map("ip")
  userAgent  String?  @map("user_agent")
  details    Json?    @map("details")
  createdAt  DateTime @default(now()) @map("created_at")

  @@map("auth_audit")
}
```

Wait, I had a typo: `isRetired` → `@map("is_retired")`, not `is_retred`. Let me fix that.

Migration SQL:

```sql
CREATE TABLE refresh_tokens (
  id VARCHAR(255) PRIMARY KEY,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  family_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  is_retired BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE auth_audit (
  id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(255) NOT NULL,
  token_hash VARCHAR(255),
  family_id VARCHAR(255),
  user_id VARCHAR(255),
  ip VARCHAR(255),
  user_agent VARCHAR(255),
  details JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

OK, I think I have everything. Let me assemble the final output now.

Let me also double-check one thing: the `@map` annotation for `isRetired`. In my schema I wrote `@map("is_retired")`, which is correct.

Also, `updatedAt` with `@updatedAt` directive — Prisma automatically updates this on record modification. Good.

One thing I want to reconsider: should I use `@default(uuid())` or `@default(cuid())`? `uuid()` is fine with PostgreSQL. Actually, in Prisma, `@default(uuid())` generates a UUID v4. Good.

Let me also verify: in the test, when I create a token via Prisma directly with `prisma.refreshToken.create()`, the Prisma client expects the model field names (camelCase). So I'd use `tokenHash`, `familyId`, etc. But wait — the DB columns are snake_case due to `@map`, but the Prisma client API uses the model field names (camelCase). Let me verify this is correct in Prisma.

Yes, in Prisma, the client API always uses the model field names (as defined in the schema), regardless of `@map`. The `@map` only affects the DB column names.

So in tests:
```typescript
await prisma.refreshToken.create({
  data: {
    id: randomUUID(),
    tokenHash: originalHash,
    familyId: familyId,
    userId: 'user-1',
    isRetired: false,
    expiresAt: new Date('2025-12-31'),
  },
});
```

And in queries:
```typescript
await prisma.refreshToken.findUnique({ where: { tokenHash } });
```

These all use camelCase model fields. Good.

Let me now also double-check that `prisma.refreshToken.findMany({ where: { familyId: '...' } })` will work. Yes, because `familyId` is a model field mapped to `family_id` column.

Now let me assemble everything. I need to make sure all files are complete and consistent.

One last check: the `AuthModule` providers include `AuthFailedFilter`, which is decorated with `@Catch(AuthFailedException)` and `@Injectable()`. When it's used via `@UseFilters(AuthFailedFilter)` on the controller, NestJS will resolve it from the DI container. This should work.

Let me also verify the controller's `@Post('refresh')` — since `AuthController` is decorated with `@Controller('auth')`, the full path is `POST /auth/refresh`. Good.

Alright, I'm confident in the solution. Let me write it all out now.

Wait, I want to reconsider one thing in the test. In the "replay invalidates sibling tokens" test:

1. Create token A (family-2), rotate it → create token B (family-2, A retired), return new refresh token and access token
2. Replay A → should be REUSE → invalidate family-2 (both A and B retired)
3. Verify all tokens in family-2 are retired

But wait, after step 1, the audit log has a ROTATION event. After step 2, it gets a REUSE event. The family has A (retired by rotation) and B (created by rotation, not retired). After REUSE, both A and B should be retired.

Let me verify the code handles this:
- `handleReuse` calls `invalidateFamily(familyId)`, which sets `isRetired = true` for ALL tokens with that familyId, including B.
- So after replay, both A and B are retired.

Good, this is correct.

Let me also make sure the test asserts this correctly.

Now let me write the final output.

Actually, let me also add the `prisma/migrations/20240101000000_init/migration_lock.toml` file, since it's part of a Prisma migration.

```toml
# Prisma Migrate
# More info: https://pris.ly/d/prisma-migrate

[prisma]
shim = "prisma-branch-shadow-shim.js"
```

And the `schema.prisma` inside the migration folder should match the main schema at the time of the migration. Let me just reference the main one.

Actually, I'll keep it simple — just provide the migration SQL file and the main schema. The migration folder structure is a detail that would be generated by the Prisma CLI.

Let me finalize now.

Hmm, one more issue. In the concurrent test, the two requests might actually process sequentially if Node.js handles them one at a time. Let me think about this more carefully.

In NestJS with Express:
- The HTTP server receives both requests and queues them
- Express processes them one at a time in Node.js's event loop
- When Request 1 reaches the DB await, the event loop is free to process Request 2
- So Request 2 can reach the DB layer while Request 1's DB call is still pending
- At this point, the DB serializes the two `UPDATE` operations

So YES, the concurrent scenario is testable. The key is that both requests reach the `atomicRetire` DB operation concurrently, and the database serializes them.

With `updateMany` (which is a single Prisma call → single SQL query), this should work correctly.

Let me verify: Prisma's `updateMany` translates to something like:
```sql
UPDATE "refresh_tokens" SET "is_retired" = true, "updated_at" = ... WHERE "id" = ? AND "is_retired" = false;
```

This is atomic at the row level (due to the WHERE condition and row-level locking in PostgreSQL). Only one of the concurrent updates will succeed.

Perfect. The test should work.

Let me also think about a potential issue: when the loser hits `handleReuse`, it calls `invalidateFamily`. But at this point, the winner has already:
1. Retired the original token
2. Created a new token in the same family
3. Possibly already returned the response

The loser's `invalidateFamily` will retire BOTH the original (already retired — no-op) and the new token. This is by design per the spec.

After this, both tokens in the family are retired. The audit has a REUSE event from the loser. The audit also has a ROTATION event from the winner (if the winner had time to audit before the loser's invalidation).

In the test, I need to account for this. Let me just check that the REUSE event exists and the tokens are retired.

OK, I'm done deliberating. Let me write the final output now.

Let me also consider: in the concurrent test, the winner might not have finished all its work (including the audit ROTATION) before the loser starts its invalidation. This is fine — the test just needs to verify the key behaviors.

Actually, let me reconsider whether I should have separate `beforeEach` vs `beforeAll` for the test. Currently I have `beforeAll` for app init and `beforeEach` for cleanup. This is good — the app is started once, and each test starts with a clean DB.

Let me now write everything.

One more detail: I need to make sure the `cookie` parameter in supertest is correct. Supertest's `.set('Cookie', ['refresh_token=value'])` should work. Or I can use `.cookie('refresh_token', 'value')`.

Let me use `.cookie()` for simplicity:

```typescript
request(server)
  .post('/auth/refresh')
  .cookie(`refresh_token=${rawToken}`)
  .then(r => r);
```

Hmm, actually, `.cookie()` in supertest might encode the value. Let me use `.set()` to be safe:

```typescript
request(server)
  .post('/auth/refresh')
  .set('Cookie', [`refresh_token=${rawToken}`])
  .then(r => r);
```

Wait, but `.set('Cookie', ...)` might override other cookies. Since there's only one cookie, it's fine.

Actually, in supertest, the recommended way is:

```typescript
request(server)
  .post('/auth/refresh')
  .set('Cookie', [`refresh_token=${rawToken}`])
```

Let me use this.

Now let me write the final code. I'll try to keep it complete and accurate.

One final thought about the `req.ip` — in supertest, `req.ip` might be undefined unless there's an `x-forwarded-for` header or trust proxy is set. Let me use `req.ip ?? 'unknown'` in the controller as a fallback. Or I can set the IP explicitly in the test.

Actually, let me just add `req.ip` as `'unknown'` if undefined. The IP is for audit, not for auth, so it doesn't matter if it's missing.

OK, writing the final output now. For real this time.

Hmm, one more thing: the `req.body` for the refresh endpoint. If the request has no JSON body, `req.body` might be `{}` (empty object) with a body parser, or `undefined` without one. In NestJS, by default, there's a body parser. So `req.body?.refreshToken` would be `undefined` if the body is `{}` or doesn't contain `refreshToken`.

In the test, when I don't send a body, the cookie is used. When I send a body with `{ "refreshToken": "..." }`, the body token is used.

Let me add a test for body vs cookie precedence.

Actually, the spec says I need to document the precedence. I'll do that in SECURITY.md and in the controller code. I don't need a separate test for it (the existing tests cover both paths).

OK, truly writing the final output now.

Let me reconsider the test file size. It's going to be substantial. Let me make sure it's well-organized and tests what's needed.

Also, I want to make sure I'm not missing the `npm`/`pnpm` package imports. Since the task assumes the project is already set up with NestJS, Prisma, Vitest, etc., I don't need to provide package.json or tsconfig.

Let me finalize and write.

One more thing: for the test, I need the Prisma client to be generated. The `@prisma/client` import in `prisma.service.ts` and `auth.repository.ts` requires this. In the test, I'll assume the client is generated (`npx prisma generate` has been run).

Let me also consider: the test file might need `import '@prisma/client'` or similar. But since `PrismaService` extends `PrismaClient`, and `AuthRepository` uses `PrismaService`, the client is imported transitively. No explicit import needed in the test file.

OK, here's my final plan:

Files to write:
1. `prisma/schema.prisma`
2. `prisma/migrations/20240101000000_init/migration.sql`
3. `src/main.ts`
4. `src/app.module.ts`
5. `src/prisma/prisma.service.ts`
6. `src/prisma/prisma.module.ts`
7. `src/auth/auth.module.ts`
8. `src/auth/auth.controller.ts`
9. `src/auth/auth.service.ts`
10. `src/auth/auth.repository.ts`
11. `src/auth/auth.failed.exception.ts`
12. `src/auth/auth.failed.filter.ts`
13. `src/auth/token-issuer.service.ts`
14. `test/auth.spec.ts`
15. `SECURITY.md`

Let me write them all in order.

Wait, should I include `migration.sql` and the migration folder? The spec says "Prisma schema + migration" and "Every schema change ships with a migration." Yes, I should include a migration.

Let me write the migration file:

```sql
-- Create "refresh_tokens" table
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" VARCHAR(255) NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "family_id" VARCHAR(255) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "is_retired" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- Create unique index on "token_hash"
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- Create "auth_audit" table
CREATE TABLE IF NOT EXISTS "auth_audit" (
    "id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(255) NOT NULL,
    "token_hash" VARCHAR(255),
    "family_id" VARCHAR(255),
    "user_id" VARCHAR(255),
    "ip" VARCHAR(255),
    "user_agent" VARCHAR(255),
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "auth_audit_pkey" PRIMARY KEY ("id")
);
```

I'll use PostgreSQL-compatible SQL. `JSONB` for the details field.

OK now let me write everything. I'll be comprehensive.

Final note on the test: for the `beforeAll`, I should make sure the Prisma client connects to the database. Since `PrismaService` has `onModuleInit` that calls `$connect()`, and `Test.createTestingModule` will trigger lifecycle hooks... actually, in NestJS testing, `onModuleInit` is called during `app.init()`, not during `compile()`. So the connection happens when `await app.init()` is called. Good.

But wait — in the `beforeEach` cleanup, I'm calling `prisma.authAudit.deleteMany()` and `prisma.refreshToken.deleteMany()`. This requires the DB connection to be established, which it is after `app.init()`. Good.

In the `afterAll`, I call `app.close()`, which should trigger `onModuleDestroy` and disconnect. Good.

Alright, let me write everything now.

Wait, one more thing about the `createToken` method in the repository. In the service, after the atomic rotation succeeds, I create a new token:

```typescript
await this.repo.createToken({
  tokenHash: newTokenHash,
  familyId: existing.familyId,
  userId: existing.userId,
  expiresAt: existing.expiresAt,
});
```

The `expiresAt` is the same as the original token's — the absolute deadline is not extended. This is requirement 4.

The `familyId` is the same — the new token is part of the same family. This is needed for the family invalidation in case of reuse.

The `userId` is the same — the session is for the same user.

Good.

Now let me also verify: in the service, after `atomicRetire` succeeds, the original token is retired in the DB. Then I create a new token. So at the end, there are two tokens in the family: the original (retired) and the new one (active). If someone replays the original, it triggers REUSE, which retires both.

Perfect. This is exactly what the spec wants.

Let me write the output now.
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model RefreshToken {
  id        String   @id @default(uuid()) @map("id")
  tokenHash String   @unique @map("token_hash")
  familyId  String   @map("family_id")
  userId    String   @map("user_id")
  isRetired Boolean  @default(false) @map("is_retired")
  expiresAt DateTime @map("expires_at")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("refresh_tokens")
}

model AuthAudit {
  id         String   @id @default(uuid()) @map("id")
  eventType  String   @map("event_type")
  tokenHash  String?  @map("token_hash")
  familyId   String?  @map("family_id")
  userId     String?  @map("user_id")
  ip         String?  @map("ip")
  userAgent  String?  @map("user_agent")
  details    Json?    @map("details")
  createdAt  DateTime @default(now()) @map("created_at")

  @@map("auth_audit")
}
```

### prisma/migrations/20240101000000_init/migration.sql
```sql
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" VARCHAR(255) NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "family_id" VARCHAR(255) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "is_retired" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

CREATE TABLE IF NOT EXISTS "auth_audit" (
    "id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(255) NOT NULL,
    "token_hash" VARCHAR(255),
    "family_id" VARCHAR(255),
    "user_id" VARCHAR(255),
    "ip" VARCHAR(255),
    "user_agent" VARCHAR(255),
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "auth_audit_pkey" PRIMARY KEY ("id")
);
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
})
export class AppModule {}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/auth/auth.failed.exception.ts
```ts
export class AuthFailedException extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AuthFailedException';
  }
}
```

### src/auth/auth.failed.filter.ts
```ts
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { AuthFailedException } from './auth.failed.exception';

@Catch(AuthFailedException)
export class AuthFailedFilter implements ExceptionFilter {
  catch(exception: AuthFailedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    response.status(401).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}
```

### src/auth/token-issuer.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

@Injectable()
export class TokenIssuerService {
  /**
   * ASSUMPTION: Provided by the existing sign-in system.
   * Issues a short-lived access token for the given user.
   */
  issueAccessToken(userId: string): string {
    return `access_${randomBytes(16).toString('hex')}_${userId}`;
  }
}
```

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  /**
   * Conditionally retires a token only if it is still live.
   * Returns true if a row was actually modified (the caller was the winner).
   * Returns false if the token was already retired by another concurrent request.
   */
  async atomicRetire(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, isRetired: false },
      data: { isRetired: true },
    });
    return result.count > 0;
  }

  /**
   * Retires every token that shares the same familyId — the full descent
   * tree from the original sign-in.
   */
  async invalidateFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId },
      data: { isRetired: true },
    });
  }

  async createToken(data: {
    tokenHash: string;
    familyId: string;
    userId: string;
    expiresAt: Date;
  }) {
    return this.prisma.refreshToken.create({ data });
  }

  async audit(data: {
    eventType: string;
    tokenHash: string | null;
    familyId: string | null;
    userId: string | null;
    ip: string;
    userAgent: string;
    details: Record<string, unknown>;
  }) {
    await this.prisma.authAudit.create({ data });
  }
}
```

### src/auth/auth.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AuthRepository } from './auth.repository';
import { TokenIssuerService } from './token-issuer.service';
import { AuthFailedException } from './auth.failed.exception';

interface RefreshInput {
  token: string | undefined | null;
  ip: string;
  userAgent: string;
}

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokenIssuer: TokenIssuerService,
  ) {}

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    const { token } = input;

    // 1. MALFORMED — no token, empty, or non-string.
    if (!token || typeof token !== 'string' || token.length === 0) {
      await this.repo.audit({
        eventType: 'MALFORMED',
        tokenHash: null,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'no_valid_token_provided' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 2. Hash and look up
    const tokenHash = hashToken(token);
    const existing = await this.repo.findByHash(tokenHash);

    // 3. UNKNOWN — hash not found
    if (!existing) {
      await this.repo.audit({
        eventType: 'UNKNOWN',
        tokenHash,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'token_not_found_in_database' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 4. REUSE — checked BEFORE expiry (a retired+expired token is a compromise event)
    if (existing.isRetired) {
      await this.handleReuse(existing, tokenHash, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 5. EXPIRY — token is live but past its absolute deadline
    if (existing.expiresAt.getTime() < Date.now()) {
      await this.repo.audit({
        eventType: 'EXPIRY',
        tokenHash,
        familyId: existing.familyId,
        userId: existing.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { expiresAt: existing.expiresAt.toISOString() },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 6. ATOMIC ROTATION — conditional update, database-serialised
    const rotated = await this.repo.atomicRetire(existing.id);

    // If another request won the race, this token is now retired → treat as reuse
    if (!rotated) {
      await this.handleReuse(existing, tokenHash, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 7. Success: new refresh token, same family, same absolute deadline
    const newRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRefreshToken);

    await this.repo.createToken({
      tokenHash: newTokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      expiresAt: existing.expiresAt,
    });

    const accessToken = this.tokenIssuer.issueAccessToken(existing.userId);

    await this.repo.audit({
      eventType: 'ROTATION',
      tokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { newTokenHash },
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  private async handleReuse(
    token: { familyId: string; userId: string },
    tokenHash: string,
    input: RefreshInput,
  ): Promise<void> {
    await this.repo.invalidateFamily(token.familyId);
    await this.repo.audit({
      eventType: 'REUSE',
      tokenHash,
      familyId: token.familyId,
      userId: token.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { reason: 'presented_retired_or_concurrent_token' },
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}
```

### src/auth/auth.controller.ts
```ts
import { Controller, Post, Req, Res, UseFilters } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthFailedFilter } from './auth.failed.filter';

@Controller('auth')
@UseFilters(AuthFailedFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * Token precedence (when both present): the JSON body field `refreshToken`
   * takes priority over the `refresh_token` cookie.
   *
   * Sets the new refresh token as an httpOnly, secure, sameSite=strict cookie
   * named `refresh_token` on success only.
   */
  @Post('refresh')
  async refresh(@Req() req: Request, @Res() res: Response) {
    // Body wins over cookie when both are present
    const token = req.body?.refreshToken ?? req.cookies?.refresh_token;

    const result = await this.authService.refresh({
      token,
      ip: req.ip ?? 'unknown',
      userAgent: req.get('User-Agent') ?? 'unknown',
    });

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    return res.status(200).json({ accessToken: result.accessToken });
  }
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { TokenIssuerService } from './token-issuer.service';
import { AuthFailedFilter } from './auth.failed.filter';

@Module({
  imports: [PrismaModule],
  providers: [
    AuthService,
    AuthRepository,
    TokenIssuerService,
    AuthFailedFilter,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
```

### test/auth.spec.ts
```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createHash, randomBytes, randomUUID } from 'crypto';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

describe('AuthController — POST /auth/refresh', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.authAudit.deleteMany();
    await prisma.refreshToken.deleteMany();
  });

  async function seedRefreshToken(opts: {
    tokenHash: string;
    familyId: string;
    userId?: string;
    expiresAt?: Date;
    isRetired?: boolean;
  }) {
    await prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        tokenHash: opts.tokenHash,
        familyId: opts.familyId,
        userId: opts.userId ?? 'user-1',
        isRetired: opts.isRetired ?? false,
        expiresAt: opts.expiresAt ?? new Date(Date.now() + 3600_000),
      },
    });
  }

  function cookieHeader(token: string) {
    return [`refresh_token=${token}`];
  }

  describe('concurrent presentation of one valid token', () => {
    it('exactly one request rotates; the loser is recorded as reuse and family is invalidated', async () => {
      const rawToken = generateRefreshToken();
      const tokenHash = hashToken(rawToken);
      const familyId = `family-concurrent-${randomUUID()}`;
      await seedRefreshToken({ tokenHash, familyId });

      const send = () =>
        request(server)
          .post('/auth/refresh')
          .set('Cookie', cookieHeader(rawToken))
          .then((r) => r);

      const [res1, res2] = await Promise.all([send(), send()]);

      const successes = [res1, res2].filter((r) => r.status === 200);
      const failures = [res1, res2].filter((r) => r.status === 401);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      // Winner sets a new refresh token cookie
      const winner = successes[0];
      const setCookie = winner.headers['set-cookie'] as string | undefined;
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain('refresh_token=');
      expect(setCookie).toContain('HttpOnly');

      // Loser gets indistinguishable rejection
      const loser = failures[0];
      expect(loser.body).toEqual({
        error: { code: 'token_invalid', message: 'Authentication failed', details: {} },
      });

      // Original token retired
      const original = await prisma.refreshToken.findUnique({ where: { tokenHash } });
      expect(original?.isRetired).toBe(true);

      // Family fully invalidated (both original and new token retired)
      const familyTokens = await prisma.refreshToken.findMany({ where: { familyId } });
      expect(familyTokens.every((t) => t.isRetired)).toBe(true);

      // Audit contains ROTATION and REUSE events
      const events = await prisma.authAudit.findMany();
      const types = events.map((e) => e.eventType);
      expect(types).toContain('ROTATION');
      expect(types).toContain('REUSE');
    });
  });

  describe('replay invalidates the sibling tokens', () => {
    it('presenting a retired token retires every token in the same family', async () => {
      const originalToken = generateRefreshToken();
      const originalHash = hashToken(originalToken);
      const familyId = `family-replay-${randomUUID()}`;
      await seedRefreshToken({ tokenHash: originalHash, familyId });

      // First rotation succeeds
      const rotation = await request(server)
        .post('/auth/refresh')
        .set('Cookie', cookieHeader(originalToken))
        .expect(200);

      expect(rotation.body.accessToken).toBeDefined();
      expect(rotation.body.refreshToken).toBeDefined();

      // Replay the now-retired original token
      await request(server)
        .post('/auth/refresh')
        .set('Cookie', cookieHeader(originalToken))
        .expect(401);

      // Every token in the family is retired
      const familyTokens = await prisma.refreshToken.findMany({ where: { familyId } });
      expect(familyTokens).toHaveLength(2);
      for (const t of familyTokens) {
        expect(t.isRetired).toBe(true);
      }

      // REUSE event recorded
      const events = await prisma.authAudit.findMany();
      const types = events.map((e) => e.eventType);
      expect(types).toContain('REUSE');
      expect(types).toContain('ROTATION');
    });
  });

  describe('rotation respects the absolute deadline', () => {
    it('new refresh token inherits the original expiry; the deadline is never extended', async () => {
      const fixedExpiry = new Date('2030-06-15T00:00:00.000Z');
      const token = generateRefreshToken();
      const tokenHash = hashToken(token);
      const familyId = `family-deadline-${randomUUID()}`;
      await seedRefreshToken({ tokenHash, familyId, expiresAt: fixedExpiry });

      await request(server)
        .post('/auth/refresh')
        .set('Cookie', cookieHeader(token))
        .expect(200);

      const familyTokens = await prisma.refreshToken.findMany({ where: { familyId } });
      const original = familyTokens.find((t) => t.tokenHash === tokenHash);
      const fresh = familyTokens.find((t) => t.tokenHash !== tokenHash);

      expect(original?.isRetired).toBe(true);
      expect(original?.expiresAt).toEqual(fixedExpiry);
      expect(fresh?.isRetired).toBe(false);
      expect(fresh?.expiresAt).toEqual(fixedExpiry);
    });
  });

  describe('rejection responses compared', () => {
    it('malformed, unknown, expired, and retired all return identical 401 envelopes', async () => {
      const familyIdExpired = `family-exp-${randomUUID()}`;
      const expiredToken = generateRefreshToken();
      await seedRefreshToken({
        tokenHash: hashToken(expiredToken),
        familyId: familyIdExpired,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      });

      const familyIdRetired = `family-ret-${randomUUID()}`;
      const retiredToken = generateRefreshToken();
      await seedRefreshToken({
        tokenHash: hashToken(retiredToken),
        familyId: familyIdRetired,
      });
      await prisma.refreshToken.update({
        where: { tokenHash: hashToken(retiredToken) },
        data: { isRetired: true },
      });

      const cases: { token: string; expectedType: string }[] = [
        { token: '', expectedType: 'MALFORMED' },
        { token: 'this-token-does-not-exist-in-db', expectedType: 'UNKNOWN' },
        { token: expiredToken, expectedType: 'EXPIRY' },
        { token: retiredToken, expectedType: 'REUSE' },
      ];

      const results = await Promise.all(
        cases.map(async ({ token }) => ({
          res: await request(server)
            .post('/auth/refresh')
            .set('Cookie', cookieHeader(token))
            .


---

# repair1-set

## reasoning

```
Let me analyze the errors carefully. Every single error is `TS2307: Cannot find module` — meaning TypeScript can't resolve the module paths. This is a classic issue with ESM and file extensions.

The codebase uses ESM (`"type": "module"`). In ESM, imports must include file extensions. The reference files use extensionless imports like:
- `import { Module } from '../prisma/prisma.module';`
- `import { PrismaService } from './prisma.service';`

In ESM, these need to be `./prisma.module.js` or `./prisma.service.js` etc. But wait — let me reconsider. The errors span across all files. Every import is failing. Let me count distinct mistakes:

1. All imports are missing `.js` extensions (since it's ESM). This affects every import in every file.
2. The `express` module is missing type declarations — this needs `@types/express` or a `require` call.

Actually, let me look more carefully. The errors are:
- `Cannot find module './prisma/prisma.module'` in app.module.ts
- `Cannot find module './auth/auth.module'` in app.module.ts
- `Cannot find module 'express'` in auth.controller.ts and auth.failed.filter.ts
- `Cannot find module './auth.service'` in auth.controller.ts
- `Cannot find module './auth.failed.filter'` in auth.controller.ts
- etc.

All of these are module resolution failures. In an ESM project (`"type": "module"`), TypeScript requires explicit file extensions in imports. So `./auth/service` should be `./auth/auth.service.js`.

But wait — some of these are cross-directory imports like `../prisma/prisma.module` and `./auth.service`. All need `.js` extensions.

Also, `express` not being found is a separate issue — likely missing `@types/express` package. But I'm told not to add features or change things not in the error list. The fix would be to change how express is imported. In a NestJS ESM project, typically you'd use `import * as express from 'express'` or use `require`. But actually, the real fix for `Cannot find module 'express'` in TypeScript ESM is usually having the types installed. Since I can't install packages, I should change the import style.

Actually, let me reconsider. The instruction says "Fix all of them in one reply" and "Change exactly what the compiler requires." The compiler errors are all TS2307 (Cannot find module). 

For the ESM imports: the fix is to add `.js` extensions to all relative imports.
For `express`: this is a third-party module. In ESM, you can't do `import { Response } from 'express'` without proper type declarations. The fix might be to use `import * as express from 'express'` or to use `require`. But the real issue might be that `@types/express` isn't installed. Since I can't install packages, I need to change the import.

Wait, but in many NestJS projects with ESM, `import { Response } from 'express'` works fine if `@types/express` is installed and `esModuleInterop` is enabled. The issue might be specifically about ESM not finding the types.

Hmm, but looking at the error more carefully — ALL imports fail, even intra-project ones. The common factor is ESM requiring extensions. Let me focus on that.

For `express` specifically — in ESM, you need `@types/express` installed. Since it's not found, maybe the fix is to use a different import pattern. In TypeScript ESM, you might need:
```ts
import type { Response } from 'express';
import type { Request } from 'express';
```
Or use `require`.

Actually, I think the most pragmatic fix for all these errors in an ESM context is:
1. Add `.js` extensions to all relative imports
2. For express imports, change to use `import` with proper type-only imports or `require`

But let me think about this differently. The fact that EVERY relative import fails suggests the root cause is definitely the ESM extension issue. The `express` error is likely a separate but related issue.

Let me list all files that need changes and all their imports:

1. `src/app.module.ts` — imports `./prisma/prisma.module` and `./auth/auth.module` → add `.js`
2. `src/auth/auth.controller.ts` — imports `express`, `./auth.service`, `./auth.failed.filter` → add `.js` to relative, fix express
3. `src/auth/auth.failed.filter.ts` — imports `express`, `./auth.failed.exception` → add `.js` to relative, fix express
4. `src/auth/auth.module.ts` — imports `../prisma/prisma.module`, `./auth.controller`, `./auth.service`, `./auth.repository`, `./token-issuer.service`, `./auth.failed.filter` → add `.js`
5. `src/auth/auth.repository.ts` — imports `../prisma/prisma.service` → add `.js`
6. `src/auth/auth.service.ts` — imports `./auth.repository`, `./token-issuer.service`, `./auth.failed.exception` → add `.js`
7. `src/main.ts` — imports `./app.module` → add `.js`
8. `src/prisma/prisma.module.ts` — imports `./prisma.service` → add `.js`

For `express`, in ESM TypeScript, a common fix is:
```ts
import { Request, Response } from 'express';
```
This is already what's there. The issue might be that `@types/express` is missing. But since I can't install packages, maybe I should use:
```ts
import type { Request, Response } from 'express';
```
No, that wouldn't help with resolution either.

Actually, thinking about this more carefully — in NestJS ESM projects, a very common pattern is to use `@nestjs/common` decorators like `@Req()` and `@Res()` which inject Express request/response objects. The controller imports `Request` and `Response` from `express` for typing. 

The fix for `Cannot find module 'express'` in ESM TypeScript without `@types/express` could be to use `require` or to change to `import * as express from 'express'`. But really, this is a package installation issue. Since I'm told to fix the compiler errors, I think the intended fix is either:

1. Change the express import to work without types (use `any` or inline types)
2. Use `// @ts-ignore` or similar

Actually, let me reconsider the whole problem. The instruction says "The typecheck failed" and I need to fix all errors. The most likely intended fix for an ESM project is adding `.js` extensions. For `express`, perhaps using `import type` or changing to a different import.

In many ESM TypeScript setups, `import { Request, Response } from 'express'` should work if `@types/express` is a dependency. Since the error says it can't find the module, maybe the fix is:

```ts
import { Request, Response } from 'express';
```
→
```ts
import type { Request, Response } from 'express';
```

Wait, that's the same resolution issue. Let me try another approach. Maybe the issue is that in ESM, you need:
```ts
import { Request, Response } from 'express';
```
to be changed to:
```ts
import { Request, Response } from 'express';
```
and ensure `esModuleInterop: true`... but I can't change tsconfig.

OK, I think the most likely scenario is:
1. All relative imports need `.js` extensions (this is the main ESM issue)
2. For `express`, change to `import * as express from 'express'` and access Request/Response from there, or use a different approach

Actually, let me look at this from another angle. In TypeScript with ESM, when `moduleResolution` is `node16` or `nodenext`, you MUST include `.js` extensions in relative imports. Third-party modules like `express` should still resolve via `node_modules`. The fact that it can't find `express` might be a genuine missing types issue.

But the task says to fix the errors, not install packages. So perhaps the fix for express is to use `require`:

```ts
import { Request, Response } from 'express';
```
→ 
```ts
import type { Request, Response } from 'express';
import { Request as Req, Response as Res } from 'express';
```

No, that's overcomplicating it. Let me just change it to use `import * as express`:

```ts
import { Request, Response } from 'express';
```
→
```ts
import * as express from 'express';
```
and then use `express.Request` and `express.Response` in the type annotations.

Hmm, but that changes the code. Let me think about what's the minimal change.

Actually, the simplest fix for the express issue in ESM without types might be:
```ts
import { Request, Response } from 'express';
```
→
```ts
import type { Request, Response } from 'express';
```

Wait, if the types aren't available at all, `import type` won't help either. 

Let me just go with adding `.js` to all relative imports and for express, I'll change to:
```ts
import { Request, Response } from 'express';
```
to
```ts
import type { Request, Response } from 'express';
```

No wait. Let me re-examine. In ESM TypeScript with `moduleResolution: "nodenext"`:
- Relative imports MUST have `.js` extensions
- Non-relative imports (like `express`) resolve via standard Node.js resolution, finding `@types/express` if installed

The fact that `express` can't be found while other third-party imports (like `@nestjs/common`) aren't in the error list suggests that either:
1. `@types/express` isn't installed
2. Or there's something else going on

Since the instructions say to fix compiler errors, and I can't install packages, I think the right approach is to change the express imports to not rely on `@types/express`. 

One approach: use `any` type instead:
```ts
import { Request, Response } from 'express';
```
→
```ts
// use generic types instead
```
And change the type annotations to use `any` or inline types.

But that's changing more than needed. Let me just try the approach of adding `.js` to relative imports and for express, keep it as-is since it's a third-party module. Maybe adding `.js` to all other imports is enough and the express error is a side effect that gets resolved. No, that doesn't make sense.

Let me go with this plan:
1. Add `.js` to all relative imports
2. For express imports, change `import { Request, Response } from 'express'` to use `require` or `import * as`

Actually, you know what, let me just try: for the express imports, since these are only used for type annotations (`@Req() req: Request` and `@Res() res: Response`), I can use `import type { Request, Response } from 'express'`. This is valid ESM and might resolve differently.

Hmm, but if the module itself can't be found, `import type` won't help. Let me check if there's a `tsconfig.json` setting issue.

I think the most reasonable approach, given the constraints, is:
1. Add `.js` to ALL relative imports (the main ESM issue)
2. For express, change to `import * as express from 'express'` and reference `express.Request`/`express.Response`

Let me enumerate all the files I need to modify:

1. `src/app.module.ts`
2. `src/auth/auth.controller.ts`
3. `src/auth/auth.failed.filter.ts`
4. `src/auth/auth.module.ts`
5. `src/auth/auth.repository.ts`
6. `src/auth/auth.service.ts`
7. `src/main.ts`
8. `src/prisma/prisma.module.ts`

Now let me also think about the `auth.failed.exception` import. It's imported in `auth.failed.filter.ts` and `auth.service.ts`. The error list includes:
- `src/auth/auth.failed.filter.ts(3,37): Cannot find module './auth.failed.exception'`
- `src/auth/auth.service.ts(5,37): Cannot find module './auth.failed.exception'`

So `auth.failed.exception.ts` exists (since it's referenced but not in the error list as a file with errors). I just need to fix the import path.

Let me now write out all the fixes. The key insight from the problem statement: "nineteen single-file rounds on this repository left twenty-one instances of the same import error standing" — this confirms it's a systemic issue (missing `.js` extensions in ESM).

For express, let me go with `import * as express from 'express'` approach and update the type annotations accordingly.

Wait, actually. Let me re-read the errors more carefully:

```
src/auth/auth.controller.ts(2,35): error TS2307: Cannot find module 'express'
src/auth/auth.failed.filter.ts(2,26): error TS2307: Cannot find module 'express'
```

These are at character positions 35 and 26 respectively. Let me check:
- `import { Request, Response } from 'express';` — 'express' starts at position... let me count: `import { Request, Response } from 'express';` — position 26 would be around the `from` keyword. Actually, position counting in TypeScript is 0-based from the start of the line. Let me count: `import { Request, Response } ` = 27 chars, position 26 = the space before `from`. Position 35 would be... hmm.

Actually TypeScript column numbers are 1-based and count from the start of the line including the filename prefix. But that's getting too detailed. The key point is these are errors on the `'express'` import.

For NestJS ESM projects, a common approach is to just have `@types/express` installed. Since it's not, and I need to fix the compiler error, I'll change to `import * as express from 'express'` and use `express.Request`/`express.Response`. But wait, that has the same module resolution issue.

OK, let me think about this differently. The `@nestjs/common` package is NOT in the error list. That means it resolves fine. `express` doesn't. What's the difference? `@nestjs/common` has proper ESM exports with types. `express` is a CommonJS package that needs `@types/express` for TypeScript.

The practical fix: since we can't install `@types/express`, and the only uses of `Request`/`Response` from express are type annotations, I can just use `any` or define minimal interfaces.

Let me use `any` for the controller and remove the express import:

In `auth.controller.ts`:
- Change `import { Request, Response } from 'express'` → remove
- Change `@Req() req: Request` → `@Req() req: any`
- Change `@Res() res: Response` → `@Res() res: any`

In `auth.failed.filter.ts`:
- Change `import { Response } from 'express'` → remove
- Change `Response` → `any`

Wait, but the problem says "Do not add features, do not rename anything the errors do not mention." Changing `Request` to `any` is changing a type, which is necessary to fix the error.

Actually, a cleaner approach: use `import type` which might be resolved differently. But no, it still needs the types to exist.

Let me just go with `any` since that's the minimal change to make it compile. Actually, even better — let me just remove the import and use `any`:

Actually, I realize there might be a simpler explanation. In ESM TypeScript with `moduleResolution: "nodenext"`, you need to import with `.js` extension even for node_modules in some configurations. But that's unusual.

Let me just go with my plan:
1. Add `.js` to all relative imports
2. For express, remove the import and use `any`

Let me draft all the files now.

Wait, one more thought. Let me check if `import type { Response } from 'express'` would work differently from `import { Response } from 'express'`. In ESM, `import type` is erased at compile time, but the module still needs to be resolvable by TypeScript during type-checking. So it won't help if the types aren't found.

OK, I'll go with `any`. Let me now write out all the fixed files.

Actually, hmm. Let me reconsider whether the express issue might be fixed by adding `.js`. In some TypeScript configurations with `moduleResolution: "bundler"` or similar, node_modules packages might need `.js` too. But that's uncommon.

No. I'll go with my plan. Let me also check: does `auth.failed.exception.ts` need changes? It's not in the error list, so it probably doesn't.

Let me now write all 8 files:

For express imports, I'll replace them with `any` types. Here's my approach for each file:

### src/app.module.ts
Just add `.js` to relative imports.

### src/auth/auth.controller.ts
- Remove `import { Request, Response } from 'express'`
- Change `@Req() req: Request` → `@Req() req: any`
- Change `@Res() res: Response` → `@Res() res: any`
- Add `.js` to remaining relative imports

### src/auth/auth.failed.filter.ts
- Remove `import { Response } from 'express'`
- Change `Response` → `any`
- Add `.js` to remaining relative imports

### src/auth/auth.module.ts
- Add `.js` to all relative imports

### src/auth/auth.repository.ts
- Add `.js` to relative import

### src/auth/auth.service.ts
- Add `.js` to relative imports

### src/main.ts
- Add `.js` to relative import

### src/prisma/prisma.module.ts
- Add `.js` to relative import

Let me write them all out now.

For auth.controller.ts:
```ts
import { Controller, Post, Req, Res, UseFilters } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthFailedFilter } from './auth.failed.filter.js';

@Controller('auth')
@UseFilters(AuthFailedFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * Token precedence (when both present): the JSON body field `refreshToken`
   * takes priority over the `refresh_token` cookie.
   *
   * Sets the new refresh token as an httpOnly, secure, sameSite=strict cookie
   * named `refresh_token` on success only.
   */
  @Post('refresh')
  async refresh(@Req() req: any, @Res() res: any) {
    // Body wins over cookie when both present
    const token = req.body?.refreshToken ?? req.cookies?.refresh_token;

    const result = await this.authService.refresh({
      token,
      ip: req.ip ?? 'unknown',
      userAgent: req.get('User-Agent') ?? 'unknown',
    });

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    return res.status(200).json({ accessToken: result.accessToken });
  }
}
```

For auth.failed.filter.ts:
```ts
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { AuthFailedException } from './auth.failed.exception.js';

@Catch(AuthFailedException)
export class AuthFailedFilter implements ExceptionFilter {
  catch(exception: AuthFailedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();
    response.status(401).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}
```

All the others just need `.js` added. Let me write them all out.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
})
export class AppModule {}
```

### src/auth/auth.controller.ts
```ts
import { Controller, Post, Req, Res, UseFilters } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthFailedFilter } from './auth.failed.filter.js';

@Controller('auth')
@UseFilters(AuthFailedFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/refresh
   *
   * Token precedence (when both present): the JSON body field `refreshToken`
   * takes priority over the `refresh_token` cookie.
   *
   * Sets the new refresh token as an httpOnly, secure, sameSite=strict cookie
   * named `refresh_token` on success only.
   */
  @Post('refresh')
  async refresh(@Req() req: any, @Res() res: any) {
    // Body wins over cookie when both present
    const token = req.body?.refreshToken ?? req.cookies?.refresh_token;

    const result = await this.authService.refresh({
      token,
      ip: req.ip ?? 'unknown',
      userAgent: req.get('User-Agent') ?? 'unknown',
    });

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    });

    return res.status(200).json({ accessToken: result.accessToken });
  }
}
```

### src/auth/auth.failed.filter.ts
```ts
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { AuthFailedException } from './auth.failed.exception.js';

@Catch(AuthFailedException)
export class AuthFailedFilter implements ExceptionFilter {
  catch(exception: AuthFailedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<any>();
    response.status(401).json({
      error: {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      },
    });
  }
}
```

### src/auth/auth.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { TokenIssuerService } from './token-issuer.service.js';
import { AuthFailedFilter } from './auth.failed.filter.js';

@Module({
  imports: [PrismaModule],
  providers: [
    AuthService,
    AuthRepository,
    TokenIssuerService,
    AuthFailedFilter,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
```

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  /**
   * Conditionally retires a token only if it is still live.
   * Returns true if a row was actually modified (the caller was the winner).
   * Returns false if the token was already retired by another concurrent request.
   */
  async atomicRetire(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, isRetired: false },
      data: { isRetired: true },
    });
    return result.count > 0;
  }

  /**
   * Retires every token that shares the same familyId — the full descent
   * tree from the original sign-in.
   */
  async invalidateFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId },
      data: { isRetired: true },
    });
  }

  async createToken(data: {
    tokenHash: string;
    familyId: string;
    userId: string;
    expiresAt: Date;
  }) {
    return this.prisma.refreshToken.create({ data });
  }

  async audit(data: {
    eventType: string;
    tokenHash: string | null;
    familyId: string | null;
    userId: string | null;
    ip: string;
    userAgent: string;
    details: Record<string, unknown>;
  }) {
    await this.prisma.authAudit.create({ data });
  }
}
```

### src/auth/auth.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AuthRepository } from './auth.repository.js';
import { TokenIssuerService } from './token-issuer.service.js';
import { AuthFailedException } from './auth.failed.exception.js';

interface RefreshInput {
  token: string | undefined | null;
  ip: string;
  userAgent: string;
}

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly tokenIssuer: TokenIssuerService,
  ) {}

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    const { token } = input;

    // 1. MALFORMED — no token, empty, or non-string.
    if (!token || typeof token !== 'string' || token.length === 0) {
      await this.repo.audit({
        eventType: 'MALFORMED',
        tokenHash: null,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'no_valid_token_provided' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 2. Hash and look up
    const tokenHash = hashToken(token);
    const existing = await this.repo.findByHash(tokenHash);

    // 3. UNKNOWN — hash not found
    if (!existing) {
      await this.repo.audit({
        eventType: 'UNKNOWN',
        tokenHash,
        familyId: null,
        userId: null,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { reason: 'token_not_found_in_database' },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 4. REUSE — checked BEFORE expiry (a retired+expired token is a compromise event)
    if (existing.isRetired) {
      await this.handleReuse(existing, tokenHash, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 5. EXPIRY — token is live but past its absolute deadline
    if (existing.expiresAt.getTime() < Date.now()) {
      await this.repo.audit({
        eventType: 'EXPIRY',
        tokenHash,
        familyId: existing.familyId,
        userId: existing.userId,
        ip: input.ip,
        userAgent: input.userAgent,
        details: { expiresAt: existing.expiresAt.toISOString() },
      });
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 6. ATOMIC ROTATION — conditional update, database-serialised
    const rotated = await this.repo.atomicRetire(existing.id);

    // If another request won the race, this token is now retired → treat as reuse
    if (!rotated) {
      await this.handleReuse(existing, tokenHash, input);
      throw new AuthFailedException('token_invalid', 'Authentication failed', {});
    }

    // 7. Success: new refresh token, same family, same absolute deadline
    const newRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRefreshToken);

    await this.repo.createToken({
      tokenHash: newTokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      expiresAt: existing.expiresAt,
    });

    const accessToken = this.tokenIssuer.issueAccessToken(existing.userId);

    await this.repo.audit({
      eventType: 'ROTATION',
      tokenHash,
      familyId: existing.familyId,
      userId: existing.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { newTokenHash },
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  private async handleReuse(
    token: { familyId: string; userId: string },
    tokenHash: string,
    input: RefreshInput,
  ): Promise<void> {
    await this.repo.invalidateFamily(token.familyId);
    await this.repo.audit({
      eventType: 'REUSE',
      tokenHash,
      familyId: token.familyId,
      userId: token.userId,
      ip: input.ip,
      userAgent: input.userAgent,
      details: { reason: 'presented_retired_or_concurrent_token' },
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```


---

# repair2-set

## reasoning

```
Let me analyze the error:

The error is in `src/auth/auth.repository.ts` at line 54, in the `audit` method. The issue is that `details` is typed as `Record<string, unknown>` but Prisma expects `NullableJsonNullValueInput | InputJsonValue | undefined` for the `details` field which is of type `Json?` in the schema.

The fix is to change the type of `details` in the `audit` method's parameter from `Record<string, unknown>` to `Json` (or `InputJsonValue` which Prisma provides). Let me check what Prisma's Json type looks like - it's typically `any` or a specific type from `@prisma/client`.

Looking at the Prisma schema, `details` is `Json?` which maps to `any` in Prisma Client (or `InputJsonValue` for input types). The simplest fix is to change `Record<string, unknown>` to `any` or use Prisma's `InputJsonValue` type.

The most correct approach is to use `Prisma.Json` or `Prisma.InputJsonValue` or simply `any` since JSON can be any valid JSON value.

Let me look at the exact line. The `audit` method takes `details: Record<string, unknown>`. I need to change this to something compatible with Prisma's Json type. The cleanest approach that fixes the type error without adding imports would be `any` or the Prisma-generated type.

Looking at the import - the file imports from `../prisma/prisma.service.js`. I could import `Prisma` from prisma to get `Prisma.InputJsonValue` or `Prisma.Json`.

Actually, the simplest and most common approach is to type it as `any` since JSON values can be objects, arrays, strings, numbers, etc. - not just `Record<string, unknown>`.

Or I could use `Record<string, unknown> | unknown[] | string | number | boolean | null` but that's verbose.

The most practical fix: change `Record<string, unknown>` to `any` in the audit method signature. Or better, use Prisma's type. Let me just use `any` since that's what Prisma's Json maps to anyway.

Wait, let me reconsider. The task says "Change exactly what the compiler requires" and "Do not add features". The simplest fix is to change the type of `details` parameter.

Let me write the fixed file:

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async atomicRetire(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, isRetired: false },
      data: { isRetired: true },
    });
    return result.count > 0;
  }

  async invalidateFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId },
      data: { isRetired: true },
    });
  }

  async createToken(data: {
    tokenHash: string;
    familyId: string;
    userId: string;
    expiresAt: Date;
  }) {
    return this.prisma.refreshToken.create({ data });
  }

  async audit(data: {
    eventType: string;
    tokenHash: string | null;
    familyId: string | null;
    userId: string | null;
    ip: string;
    userAgent: string;
    details: any;
  }) {
    await this.prisma.authAudit.create({ data });
  }
}
```

That's the only file with errors and the only fix needed. The error message is clear: `Record<string, unknown>` is not assignable to Prisma's Json input type. Changing it to `any` resolves it since Prisma's Json type is essentially `any`.

Actually, let me double-check - is there only one error in one file? Yes, there's just one error listed: `src/auth/auth.repository.ts(54,42)`. So only one file needs to be changed.
```

## reply

### src/auth/auth.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async atomicRetire(id: string): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, isRetired: false },
      data: { isRetired: true },
    });
    return result.count > 0;
  }

  async invalidateFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId },
      data: { isRetired: true },
    });
  }

  async createToken(data: {
    tokenHash: string;
    familyId: string;
    userId: string;
    expiresAt: Date;
  }) {
    return this.prisma.refreshToken.create({ data });
  }

  async audit(data: {
    eventType: string;
    tokenHash: string | null;
    familyId: string | null;
    userId: string | null;
    ip: string;
    userAgent: string;
    details: any;
  }) {
    await this.prisma.authAudit.create({ data });
  }
}
```


---
