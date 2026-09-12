# Transcript — 17-token-rotation-reuse / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me carefully analyze the task.

What the task is asking for:
1. `POST /auth/refresh` — accepts a refresh token, returns a new access token and a new refresh token. The presented token is retired within the same call.
2. The token can arrive in the JSON body as `refreshToken` or in a `refresh_token` cookie. Both are supported. Define and document which wins when both are present.
3. Concurrency: two requests presenting the same valid token may arrive in parallel; exactly one may rotate.
4. Presentation of an already-retired token = compromise: every token descended from the same original sign-in is invalidated, and it's recorded for auditing.
5. The session has an absolute lifetime fixed at sign-in. Rotation never extends it.
6. All rejections — expired, retired, unknown, malformed — are indistinguishable to the caller. Audit records distinguish them.

Deliverables:
- Prisma schema + migrations
- NestJS module: controller, service, repository
- Tests: concurrent presentation of a single token, replay invalidating a sibling token, rotation against absolute deadline, comparison of rejection responses
- `SECURITY.md` (15–25 lines) documenting the ordering of checks and why it's in that order.

Assume `issueAccessToken(userId): string` exists.

Codebase conventions:
- TypeScript strict, Node 20+, NestJS, Prisma, PostgreSQL, Vitest, pnpm, ESM `"type": "module"`.
- Layout: `prisma/schema.prisma`, `src/main.ts`, `src/app.module.ts`, `src/<feature>/<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.repository.ts`, `test/<feature>.spec.ts`.
- Layering: controller validates input, calls service, zero business logic. Service holds the logic, zero raw SQL, zero Prisma client calls. Repository is the only layer that touches the DB.
- Naming: tables/columns are snake_case via `@map`/`@@map`. Endpoints are kebab-case, plural. TS files are `kebab-case.role.ts`. Classes are PascalCase.
- Error envelope: `{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }`. code is snake_case, message is developer-facing English, details is an object, never null.
- Wiring: providers in modules, exports for cross-module use, imports.
- Migrations: all schema changes are shipped with migrations.
- Tests: Vitest, test behavior, not implementation. Don't just assert that calls happened. No tests without assertions. Don't just test the happy path.
- Environment: configuration only from env vars. DATABASE_URL. No secrets in the repo.
- Discipline: only do exactly what the task asks. Don't create files it doesn't call for.

Wait — the layout convention says `src/<feature>/...`. The feature here is "auth". The endpoint is `POST /auth/refresh`. Hmm, "Endpoint: kebab-case, plural." — but the task explicitly says `POST /auth/refresh`. The task overrides: it says to implement `POST /auth/refresh`. The convention says endpoints are kebab-case and plural, but the task explicitly specifies this endpoint. The task takes precedence over the convention. Actually, wait — "endpoints: kebab-case, plural" is a convention, and the task explicitly says `POST /auth/refresh`. Since the task statement carries everything, the explicit endpoint requirement wins. The route will be `auth/refresh` (kebab-case, singular as specified). The discipline section says to only do what the task asks, so I'll implement `POST /auth/refresh` exactly.

Now, let me design the solution.

## Data model

We need:
1. **Refresh tokens** (or family + tokens). For reuse detection: "every token descended from the same original sign-in is invalidated" — this suggests a *family* concept: each sign-in creates a family; rotation creates a new token in the same family. When a retired token is presented, invalidate every token in the family.

2. **Sessions** (with absolute expiry). Sign-in creates a session with `expiresAt` fixed. Tokens reference the session (or family). Actually, session and family might be the same thing — "original sign-in" = session. Let's model:

Option A: a `Session` model with an id and `expiresAt`. A `RefreshToken` model with a `sessionId` FK, `token` (hashed), `retiredAt`, `createdAt`, and possibly `replacedByTokenId`.

Option B: a single `RefreshToken` table with a `familyId`.

I think Session + RefreshToken is cleaner and maps "absolute lifetime fixed at sign-in" naturally to `session.expires_at`.

Let's design:

```prisma
model Session {
  id         String   @id @default(uuid())
  userId     String   @map("user_id")
  expiresAt  DateTime @map("expires_at")
  createdAt  DateTime @default(now()) @map("created_at")
  revokedAt  DateTime? @map("revoked_at")
  tokens     RefreshToken[]
  audits     SecurityEvent[]?
  @@map("sessions")
}

model RefreshToken {
  id          String    @id @default(uuid())
  sessionId   String    @map("session_id")
  tokenHash   String    @map("token_hash") // store the hash, not plaintext?
  ...
}
```

Hmm, should I store the token hash? It's good security practice. The task doesn't require it. Storing the token value (or a hash) — if I hash it, I can't do a direct equality lookup without a hash, which is fine: hash the presented token, look up by hash. SHA-256 hashing is the defensible choice. But it adds complexity: the repository has to hash. The service generates the token (crypto random), the repository stores the hash. Actually, layering: the service holds the logic, the repository touches the DB. Hashing is security logic — the service should hash before passing to the repository. The repository receives the hash.

Let's keep it simpler and more defensible: store SHA-256 hex digest. Service: `crypto.createHash('sha256').update(token).digest('hex')`.

Fields on RefreshToken:
- `id` (uuid)
- `sessionId` (fk to Session)
- `tokenHash` (unique)
- `createdAt`
- `retiredAt` (DateTime?) — set when retired by rotation or reuse detection
- `replacedById`? — track the chain? "descended from the same original sign-in" = the whole family = all tokens with the same sessionId. So sessionId is the family. Good.

SecurityEvent (audit):
- `id`
- `sessionId`? or `tokenFamilyId`?
- `userId`
- `action` / `event` — e.g., `refresh_reissued`, `refresh_rejected_expired`, `refresh_rejected_retired_reuse`, `refresh_rejected_unknown`, `refresh_rejected_malformed`, `family_invalidated`
- `reason`/`detail`
- `createdAt`
- Possibly `tokenId`

Requirement 6: "All rejections — expired, retired, unknown, malformed — are indistinguishable to the caller. Audit records distinguish all of them." So the audit table needs distinct event types for each rejection kind, and possibly a success event for rotation too.

Now the tricky part: **concurrency — exactly one rotates**.

Approach: a database transaction with a conditional update.

Transaction steps:
1. Look up the token by hash (with session).
2. Check: does it exist? Is the session expired? Is the token retired?
3. If valid: `UPDATE refresh_tokens SET retired_at = now() WHERE id = $1 AND retired_at IS NULL` — check `count === 1`. If 0, someone else rotated concurrently → this is a reuse (retired) → treat as compromise (family invalidated). Actually, careful: if a concurrent rotation retired it between the SELECT and UPDATE, our conditional update will fail; then we treat it as reuse.
4. Create a new token in the same session, issue an access token, record audit event, return both.

In Prisma, the conditional update via `updateMany` with a `retiredAt: null` filter guarantees atomicity even without explicit row locking, since the UPDATE is atomic at the row level. Two concurrent `updateMany` calls: one gets count 1, the other 0. That's the classic approach and it works.

But wait — subtlety: the loser gets count 0. Then it proceeds to the "retired token presented" path → invalidates the family → records reuse audit. This matches "two requests presenting the same valid token may arrive in parallel; exactly one may rotate" and "presentation of an already-retired token is treated as compromise." The loser's presentation is, by the time it's processed, a presentation of an already-retired token. So the loser invalidates the family. That's the strictest reading and matches typical reuse-detection semantics (the legitimate client's retry triggers a family wipe — a real cost, but that's what reuse detection does; the task explicitly frames aggressive retries as the threat model, so the spec asks for exactly this behavior).

Hmm, but wait: requirement 3 says "exactly one may rotate" — it doesn't say the loser must trigger reuse invalidation. Requirement 4 says presenting an already-retired token → compromise → invalidate family. The loser's token was valid at the start of processing, but by the time of the atomic claim it's retired. Two readings:
- (a) The loser proceeds to the reuse path (retired token presented → family invalidated).
- (b) The loser just receives the same generic rejection without triggering a family wipe.

Which is more defensible? Standard refresh-token-rotation-with-reuse-detection (OWASP / typical implementations): any presentation of a retired token is treated as theft. In the race case, the second request literally presents a retired token (it's retired by then). The task says "the client retries aggressively" and "two requests presenting the same valid token may arrive in parallel; exactly one may rotate." It's silent about whether the loser wipes the family.

The test required is "concurrent presentation of a single token." What should it assert? That exactly one gets a new token pair and the other gets the generic rejection. Whether the family is wiped... if the loser wipes the family, the winner's new token is also invalidated! That's a notable consequence: after a duplicate retry, the whole session is dead and the user must re-authenticate. Is that desirable? In real systems (e.g., the classic "refresh token rotation with reuse detection"), yes — if a token is replayed, the family is invalidated, and even if the replay was a client bug, the user must re-login. That's the safe, conservative behavior, and the task explicitly says "presentation of an already-retired token is treated as compromise." The second concurrent request presents a token that is retired at the moment of its own check. I think the defensible reading is (a): the loser triggers a family wipe, because at its point of validation, the token was already retired.

Hmm, but let me reconsider. "Exactly one may rotate" — if both requests arrive truly simultaneously, and the first succeeds in retiring+rotating, then the second's atomic claim fails → the token is retired → reuse detection → family invalidated → the winner's new token is dead too. The test "concurrent presentation of a single token" would then assert: one success, one rejection, and after the race the family is invalidated (no live tokens remain). That's a strong, testable, spec-consistent assertion. Alternatively, if we take reading (b), the test asserts: one success, one rejection, and the winner's token is still valid.

Which reading is the task author likely intending? Let me re-read: "3. The client retries. Two requests presenting the same valid token may arrive in parallel; **exactly one** may rotate. 4. Presentation of an already-retired token is treated as compromise: every token descended from the same original sign-in is invalidated, and the event is recorded for audit."

These two requirements are listed separately. Requirement 3 handles the race: exactly one rotates. Requirement 4 handles the retired presentation. In the race, the loser is presenting a token that's already retired (by the time of its check). If the intent were (b), the author would probably have said "the loser receives the same rejection but does not trigger reuse detection" — actually, in practice some systems distinguish "retired due to my own rotation" (benign) from "retired and a new sibling exists" (theft). But we can't distinguish a duplicate request from a thief without additional state (e.g., IP, timing) — and the task's whole premise is that aggressive retries are normal and indistinguishable from theft, so the system must treat them as compromise. The task says rejections must be indistinguishable to the caller — so the loser gets the generic rejection either way.

I'll go with (a): any failed atomic claim (token found but retirement update affected 0 rows) is a reuse event → family invalidated → audit `refresh_reuse_detected` (and a `family_invalidated` record). I'll document this explicitly in SECURITY.md. This is the conservative, defensible security posture: "when in doubt, the token is compromised."

Actually, wait. Let me think once more. There's a real tension: if duplicate retries are *normal* (the task says clients retry aggressively), then every duplicate retry nukes the session, forcing re-login constantly. That's operationally bad, but it's the standard cost of strict reuse detection, and the task explicitly sets up "aggressive retries" as the reason to get this right — the *point* is that you can't tell a retry from a thief, so you must assume compromise. The task's requirement 4 is unconditional: "presentation of an already-retired token is treated as compromise." In the race, the second presentation is of an already-retired token. So (a) it is. And I'll document it clearly.

Hmm, one more consideration: maybe the loser should be treated differently if its atomic claim fails *and* it detects that the retirement was done by a sibling in the same family... no. Keep it simple and strict. (a).

Now the check ordering (SECURITY.md has to state the order and why):

Given a presented token string:
1. **Malformed check**: is the token well-formed (string, non-empty, correct length/format)? → reject as `malformed`. (Format check first — cheap, no DB, avoids log noise; but importantly, the *response* is identical to everything else.)
2. **Look up by hash.** Not found → reject as `unknown`.
3. **Session expired?** `session.expiresAt < now` → reject as `expired`.
4. **Token retired?** → reuse detected → invalidate family → reject (same generic response) as `retired`/`reuse`.
5. **Atomically claim** (conditional UPDATE retired_at IS NULL). If it fails → reuse path (same as 4).
6. Issue new token + access token, audit `refresh_reissued`, return.

Why is the order important?
- Malformed first: don't hit the DB with garbage; but the response is identical so no oracle.
- Unknown before expired: if the token isn't found, there's no session to check expiry on; ordering of unknown/expired doesn't leak anything since responses are identical, but auditing must distinguish.
- Expired before retired: hmm, why? If the session is expired, the whole family is dead; retiring state is moot. Treating expired first means an expired session never triggers reuse invalidation (the family is already dead — invalidation is a no-op). Also, checking expired before retired avoids unnecessary family wipes when the session has naturally died. And: an expired token presented is *not* a compromise signal (it could just be a stale client); a retired token presented is. So the order "expired, then retired" avoids over-reacting to stale-but-not-stolen clients.
- Retired before the atomic claim: fast path for an obvious replay; the atomic claim covers the race.
- The atomic claim is last (or folded into the retired check): it's the only thing that actually guarantees "exactly one rotates" — a pre-check SELECT is racy.

Also: why is the response identical — to prevent an attacker from learning which tokens are valid/retired/expired (fingerprinting the session lifecycle). The audit log is the only place distinctions live.

Another subtlety: **timing**. Ideally all rejection paths take similar time; that's a bonus, mention it in SECURITY.md? Keep it to 15–25 lines.

## Source of the token and precedence

Body `refreshToken` or cookie `refresh_token`. Document which wins: **cookie wins** — or **body wins**? Let's think. The task says "define and document which wins when both are present." Either is defensible. My pick: **body wins** — explicit request data beats ambient transport data? Or **cookie wins** because the cookie is the transport the app set (the response sets the `refresh_token` cookie), and the body is client-controllable free text — if a compromised client can send a body, the cookie is... no, both are client-controllable over HTTPS. Hmm.

Actually, let's think about which is safer/more predictable. Common pattern: the refresh token is delivered in an HttpOnly cookie precisely because the client app shouldn't handle it. If the client also sends a body, they disagree — which do we trust? If we trust the body, a compromised *JS* could rotate with a token the attacker learned, while the cookie holds the "real" one... but both are attacker-controllable in the same request. There's no security difference; it's a consistency call.

I'll pick: **body wins when both are present** — explicit over ambient, and it matches how the endpoint is documented ("accepts a refresh token"). Hmm, or cookie wins: the cookie is set by the server, and the body is arbitrary client data; if we rotate based on the body, the client could present an arbitrary token and retire it while leaving the cookie valid — but that's exactly what rotation is supposed to do.

Let me reconsider from the "least surprise" angle for the test suite: the task lists body first in the sentence ("in the JSON body as refreshToken or in the refresh_token cookie"). Let's say: **body (`refreshToken`) wins over cookie**, because the explicit parameter is the request's intent, and the cookie is a fallback for clients that store the token there. Document in controller JSDoc and SECURITY.md? The task says "define and document which wins when both are present" — documentation location: controller JSDoc (or README?). There's no mention of a README deliverable. Controller JSDoc + comment on the extraction function. The controller validates the input; extracting and choosing the source is input validation/parsing — that's controller territory. Good: the controller has a small pure function `extractRefreshToken(body, cookies)` returning the chosen string | undefined. That keeps business logic out of the controller — extraction is parsing/validation, which is fine.

Actually wait — "the controller validates input and calls the service. Zero business logic." Extracting the token from two sources with precedence is input parsing/validation. I think that's controller-appropriate. The service receives `refreshToken: string | undefined` and handles malformed/unknown etc.

Hmm, but should "malformed" determination be in the controller or service? The service needs to distinguish malformed from unknown in *audit*. So the service must know which kind of rejection occurred. If the controller normalizes to `string | undefined`, the service can decide: `undefined` → malformed (or "missing"), non-conforming string → malformed. So the service receives the raw string (or undefined) and classifies. Good: the controller passes `{ refreshToken: string | undefined }`, and the service does the classification. Actually simpler: the controller just passes the extracted token (or undefined); the service does everything.

What is "malformed"? Definition: a non-string, an empty/whitespace string, or a string outside the expected format. What format do we issue? Let's define the refresh token format: `rt_` + 32 random bytes base64url (43 chars) → `^rt_[A-Za-z0-9_-]{43}$`. Then malformed = doesn't match the shape (e.g., wrong prefix or length). Hmm, but if an attacker submits a random garbage string, is that "malformed" or "unknown"? Both → same response; the audit distinguishes. Definition: malformed = doesn't match the structural shape (prefix + length charset). Anything structurally valid but unregistered → unknown. That's clean and testable.

Wait, but there's a subtle issue: if the issued token is `rt_` + 43 chars, and a thief presents a token that's valid-shaped but wrong → "unknown" audit. A junky body → "malformed". Good.

Edge: what if the body `refreshToken` is present but the cookie also is, and the body is garbage and the cookie is valid? Body wins → garbage → malformed rejection. Harsh, but that's the documented precedence: an explicit body is authoritative. Fine — I'll document it.

## The absolute deadline

The session's `expiresAt` is set at sign-in = `createdAt + SESSION_TTL`. Rotation: the new token inherits `session.expiresAt` (no extension). Test "rotation against absolute deadline": e.g., create a session whose `expiresAt` is just past (or advance the clock past the deadline), rotate → rejection (expired), and/or: rotation at T (before deadline) issues a token, then at T+TTL (past deadline), that new token is rejected as expired even though it was just issued.

How do we create sessions in tests? "Sign-in already exists and is assumed" — but the tests need sessions. The test file can seed directly via the repository or the Prisma client... hmm. In tests, the repository is the DB layer; in unit-ish tests, we'd mock the repository. But the required tests are *behavioral* (concurrent rotation, replay invalidating a sibling, deadline) — those need real DB semantics (atomic updateMany race). So the tests should be integration tests against a real PostgreSQL via Prisma. The repo conventions say Vitest, and there's `test/<feature>.spec.ts`. Without a DB in this environment... well, I can't run anything; I just have to write the solution. The most defensible: integration tests against a real Postgres (env `DATABASE_URL`), using PrismaClient directly to seed (or a small test helper through the repository). But "the repository is the only layer that touches the database" — that's a rule about the app's src layering; a test helper seeding via PrismaClient is standard for integration tests. Hmm, but the discipline says to do only what's asked; the tests are asked. To seed a session, I need something like `createSession`. Since "sign-in already exists," I assume there's an existing sign-in flow — but its location is unspecified, and I can't see a codebase (no existing files were given! The task says "if files are given above the task, they are the existing codebase" — no files were given). So I have to build the whole solution from scratch, including app.module, main.ts, following the layout conventions.

Wait — the conventions' layout lists `src/main.ts`, `src/app.module.ts`. So the deliverable should include those (they're in the conventional layout, and since no codebase exists, "build the whole solution" means include them). The task's deliverables list is: Prisma schema + migrations, NestJS module (controller/service/repository), tests, SECURITY.md. To wire up the module I need app.module and main.ts. I'll include them — minimal.

Hmm, "don't create files it doesn't ask for." But the module needs to be imported somewhere to be an app; the convention's layout shows main.ts and app.module.ts as part of the standard layout. Since no existing codebase is shown, I need those two for a runnable solution. I think including them is correct and expected. I'll keep them minimal.

What about the session creation (sign-in)? It's "assumed to exist" — `issueAccessToken(userId): string` is given. But the tests need to create sessions + first tokens. Options:
1. Provide a small `sign-in` endpoint? Not asked for. No.
2. The service exposes a `createSession`/`issueInitialRefreshToken` method used by (assumed) sign-in flow, and tests call it. Defensible: the rotation feature owns the refresh-token lifecycle including minting the initial token. The service holds the logic; the repository does the writes. `issueRefreshToken(userId)` in the service → creates session + first token, returns token string + access token. This is the natural API for the (assumed) sign-in flow to call, and it lets the tests seed without raw Prisma.

I'll add `issueRefreshSession(userId): Promise<{ refreshToken, accessToken, sessionId }>`, hmm, or name it `createSession`. Let's name it `issueInitialToken(userId)`. And the repository methods: `createSession(userId, expiresAt)`, `createToken(sessionId, tokenHash)`, `findTokenWithSession(tokenHash)`, `retireToken(id) → count`, `retireAllTokensInSession(sessionId) → count`, `createEvent(...)`, `getActiveTokenCount(sessionId)`, etc.

Config: env var `SESSION_TTL_SECONDS`? "Configuration only from env vars." Session lifetime "fixed at sign-in" — its duration is a config value. Default 30 days? Let's take it from env with a sane default: `REFRESH_SESSION_TTL_SECONDS` default 2592000 (30 days). Use `process.env` directly, or @nestjs/config? Adding the @nestjs/config package — the convention's env is "config from env vars only"; @nestjs/config is the NestJS standard. But I can't be sure of package availability... the pnpm project is mine to define; I'll use @nestjs/config? Hmm, adding dependencies: @nestjs/common, @nestjs/core, @nestjs/platform-express, @prisma/client, @nestjs/config. And dev: prisma, vitest, supertest (for HTTP tests) + @types/supertest, typescript, ts-node? For Vitest with ESM TS, vitest handles TS natively.

Do I need an explicit package.json? The format only parses the file blocks; a package.json is a legitimate deliverable file ("the whole solution in one reply... deliver every file the solution needs"). I think including `package.json` is defensible and useful. Hmm, but "don't create files it doesn't ask for." package.json isn't asked for... but "build the whole solution" — a NestJS+Prisma+Vitest project can't exist without package.json. The layout conventions enumerate specific files but don't include package.json, and the discipline says don't create files not asked for... I'm torn. The instruction "build the whole solution in one reply" + "deliver every file the solution needs, complete" leans toward including package.json. Let's include it — it's needed to install/run/test. I'll keep it tight: only deps needed.

Actually, let me reconsider: the mechanical format reads the file blocks; extra files are fine as long as they're real files of the solution. package.json, tsconfig.json (needed for TS strict + ESM) — is tsconfig asked for? Not listed in the layout, but TS strict ESM needs it. I'll include a minimal tsconfig.json. And `prisma/migrations/<timestamp>_init/migration.sql` — "all schema changes are shipped with migrations" — required. Prisma migrations are typically generated with `prisma migrate dev`; I can't run it, so I'll hand-write the SQL migration to match the schema. That's standard: create the migration folder with `migration.sql` and the `prisma/migrations/` structure. The migration SQL has to match the schema exactly.

Now let me write the Prisma schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Session {
  id        String   @id @default(uuid()) @map(...)  // id is fine, no need to map "id"
  userId    String   @map("user_id")
  createdAt DateTime @default(now()) @map("created_at")
  expiresAt DateTime @map("expires_at")
  revokedAt DateTime? @map("revoked_at")

  tokens RefreshToken[]
  events SecurityEvent[]

  @@map("sessions")
}

model RefreshToken {
  id        String    @id @default(uuid())
  sessionId String    @map("session_id")
  tokenHash String    @unique @map("token_hash")
  createdAt DateTime  @default(now()) @map("created_at")
  retiredAt DateTime? @map("retired_at")

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@map("refresh_tokens")
}

model SecurityEvent {
  id        String   @id @default(uuid())
  sessionId String   @map("session_id")
  userId    String   @map("user_id")
  kind      String
  tokenId   String?  @map("token_id")
  createdAt DateTime @default(now()) @map("created_at")

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@map("security_events")
}
```

Wait — events for unknown/malformed tokens: those have no session (unknown) or no token at all (malformed). So a `SecurityEvent` with a required `sessionId` FK breaks for malformed/unknown. Options: make `sessionId` nullable, drop the FK, and store `userId` nullable too. For malformed: no user, no session. For unknown: no session, no user (a token hash that doesn't correspond to anything — we don't know the user). So both fields nullable. Drop the relation (or keep a relation with nullable?). Keep it simple: no FK relation on SecurityEvent; just `sessionId String?` and `userId String?`. The audit table is append-only log — no relational integrity needed. That's defensible and simpler.

Event kinds (snake_case strings):
- `refresh_reissued` (success; detail: previous token id, new token id)
- `refresh_rejected_malformed`
- `refresh_rejected_unknown`
- `refresh_rejected_expired`
- `refresh_rejected_reuse` (retired token presented → family invalidated)

Maybe also a `family_invalidated` event separate from `refresh_rejected_reuse`? The rejection event can carry `details` with a flag. Let me add a `details Json?` column to SecurityEvent for structured context (e.g., which token was presented — hashed? or token id; whether family was wiped; count of tokens wiped). That enriches the audit. Prisma Json type → `jsonb`. OK.

Now let me think about the `kind` values and whether to include a generic `refresh_rejected` — no, distinct kinds per requirement 6: "audit records distinguish all of them" — so distinct kinds for expired, retired/reuse, unknown, malformed.

## Service logic

```ts
@Injectable()
export class AuthService {
  constructor(private readonly tokens: RefreshTokenRepository) {}

  // TTL from env
  private get ttlMs(): number { ... }

  async issueSession(userId: string): Promise<{...}> // for sign-in (assumed existing flow calls this)

  async refresh(refreshToken: string | undefined): Promise<RefreshResult | RefreshRejection>
}
```

Wait — how do rejections surface? The controller must return an identical response for all rejections. So the service either throws a single error type (e.g., `RefreshRejectedError`) that it has already audited internally, or returns a discriminated union and the controller maps rejections to the same HTTP 401 with the same body. Cleaner: the service returns `{ ok: true, accessToken, refreshToken }` or throws `RefreshRejectedError`. But "all rejections are indistinguishable to the caller" — the response is the same; the error *code* in the envelope... the envelope has `code` — if all rejections must be indistinguishable, the code must be the same too (a different code would distinguish them). So all rejections → one code, e.g., `refresh_token_rejected`, HTTP 401, identical message. The audit (in DB) carries the distinction.

Hmm wait, is the error code visible to the caller? Yes — it's in the response envelope. So a single code for all rejection kinds: `refresh_token_rejected`. Hmm, or `unauthorized`? The convention example shows `resource_not_found` style snake_case codes. I'll use `refresh_token_rejected` — hmm, but "rejection — expired, retired, unknown, malformed — indistinguishable" → same code, message, status (401). Yes.

Should the rejection be 401 or 400 or 403? 401 Unauthorized is correct for token authentication failure. Malformed could be 400, but that would distinguish it! So all 401.

Design: the service returns a result object; the controller maps:
- success → 200 { accessToken, refreshToken } + Set-Cookie?

Hmm — should the response set a cookie? If the token can arrive via cookie, then for symmetry the response should set a `refresh_token` cookie (HttpOnly) with the new token, so cookie-based clients continue to work. That's implied by the design (a stateless client would store the returned refreshToken). I'll set `refresh_token` as HttpOnly, Secure, SameSite=Lax, Path=/, with the new token, plus JSON body { accessToken, refreshToken }. And on rejection, should I clear the cookie? If the family was invalidated, clearing the cookie (`Max-Age=0`) is correct hygiene. On a plain rejection, the old token is still what the client has... clearing it would break a legitimately-expired... hmm. Let me think: reuse detected → the client's cookie is now invalid → clear. Expired → also invalid → clear. Unknown/malformed → the client's cookie is unknown to us → arguably clear. Since all rejections are indistinguishable, the behavior must be uniform → clear the cookie on *all* rejections. Uniform behavior also prevents side-channel distinctions. So: rejection → 401 envelope + `Set-Cookie: refresh_token=; Max-Age=0`. Consistent and defensible. I'll note in SECURITY.md that all rejections are byte-identical except timestamps? Actually let's make the message constant.

Wait, one concern: clearing the cookie on a *malformed* rejection — e.g., a client that sends nothing (no token at all) gets a 401 with cookie cleared. That's fine — it's a stateless cookie anyway.

Now, the service's `refresh` flow in detail:

```ts
async refresh(presented: string | undefined): Promise<RefreshOutcome> {
  const now = new Date();

  // 1. Shape check
  if (typeof presented !== 'string' || !REFRESH_TOKEN_SHAPE.test(presented)) {
    await this.auditRejection({ kind: 'refresh_rejected_malformed', presented });
    throw new RefreshRejectedError();
  }

  const tokenHash = sha256(presented);

  // 2. Look up
  const record = await this.repo.findTokenWithSession(tokenHash);
  if (!record) {
    await this.auditRejection({ kind: 'refresh_rejected_unknown', ... });
    throw new RefreshRejectedError();
  }

  // 3. Expired?
  if (record.session.expiresAt <= now) {
    await audit('refresh_rejected_expired', ...);
    throw new RefreshRejectedError();
  }

  // 4. Retired?
  if (record.retiredAt !== null) {
    await this.handleReuse(record, ...); // invalidate family + audit
    throw new RefreshRejectedError();
  }

  // 5. Atomic claim
  const claimed = await this.repo.retireIfActive(record.tokenId);
  if (claimed === 0) {
    await this.handleReuse(...); // race loser
    throw new RefreshRejectedError();
  }

  // 6. Issue new token
  const newToken = generateRefreshToken();
  await this.repo.createToken(record.sessionId, sha256(newToken));
  await this.repo.audit('refresh_reissued', ...);
  const accessToken = issueAccessToken(record.session.userId);
  return { accessToken, refreshToken: newToken };
}
```

Transactionality: steps 5–6 should be atomic (if the new token creation fails after retirement, the client is locked out — bad). Use `prisma.$transaction` in the repository: the repository can wrap multiple operations in one transaction. But the service can't call Prisma directly... "zero Prisma client calls in the service." So the repository exposes a transactional method, e.g., `rotate(tokenId, newTokenHash)` that does retireIfActive + createToken in a single `$transaction`, returning success/failure. Or the repository exposes an atomic `claimAndIssue` method. Let me design the repository API:

```ts
class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createSession(userId, expiresAt): Promise<Session>
  async createToken(sessionId, tokenHash): Promise<Token>
  async findActiveToken... 
```

Hmm wait, what exactly does the service need?

- `findTokenWithSession(tokenHash)` → { token: {id, retiredAt}, session: {id, userId, expiresAt} } | null
- `claimTokenAndIssueNext(tokenId, newTokenHash)` → within a transaction: `updateMany({ where: { id: tokenId, retiredAt: null }, data: { retiredAt: now } })`; if count===1, create the new token and return true; else return false. Both in one `$transaction` (interactive or a batch). Batch: `[updateMany, create]` can't be conditional. Interactive: `prisma.$transaction(async tx => { const r = await tx.refreshToken.updateMany(...); if (r.count === 0) return false; await tx.refreshToken.create(...); return true; })`. That works and is atomic.

But hmm — one subtlety: the reuse invalidation (`retireAllTokensInSession`) also happens on the race-loser path. Should the claim and the "else" family-wipe be in one transaction? The winner's path: claim + new token. The loser's path: family wipe. Both are single atomic operations each; the cross-path interleaving: winner commits claim+new; loser's wipe (after) kills the new token too. If the loser's wipe ran *before* the winner committed the new token... the new token is created after the wipe → it survives → a "wiped" family has a live token. Race! Can that happen? The loser's wipe is triggered by its failed claim. Sequence: L reads token (active), W claims (retires T1, creates T2, commits), L's claim fails (0 rows), L wipes the family (retires all tokens in session: T1 is already retired, T2 → retired). L's wipe happens after L's failed claim, which is after W's commit (the claim's updateMany only sees 0 rows if W's retirement is committed... or in flight? In READ COMMITTED, L's update's `retiredAt IS NULL` condition is evaluated on the latest committed row version; if W's update hasn't committed, L's update *waits* on W's row lock (update conflicts). So L's claim blocks until W commits, then sees retiredAt set → count 0 → proceeds to wipe → the wipe kills T2.

But what if L's claim *completes before W's commit*? L's update on the same row: both update T1. Row-level lock: one waits. First to commit wins (count 1); the other, after unblock, re-evaluates the WHERE with the fresh row version → count 0. So it's impossible for both to get count 1, and the loser's subsequent wipe always runs after the winner's commit (the winner committed before the loser's claim unblocked). Wait, is that exactly right? Postgres UPDATE: concurrent updates on the same row — the second one waits for the first's transaction to complete; if the first commits, the second then evaluates the WHERE clause against the updated row version (EvalPlanQual). So yes: loser's claim returns 0 only after the winner committed (including the new token T2 creation, since it's in the winner's transaction). Then the loser's wipe retires T2. No gap.

But wait — should the loser even wipe the family? If the winner has already created T2 (valid, unexpired), the loser's wipe kills T2. As discussed, that's the strict interpretation. The test "concurrent presentation of a single token" will assert: exactly one success, one rejection, and after both complete no live token remains in the session. I'm now fairly confident that's the intended strict behavior — "exactly one may rotate" plus reuse detection on the retired presentation. And I'll document the rationale in SECURITY.md: the retry and the theft are indistinguishable, so the family dies; the user re-authenticates.

Hmm, actually, wait. Let me reconsider one more time, because it really matters for the test I'll write. Requirement 3: "two requests presenting the same valid token may arrive in parallel; exactly one may rotate." If the intended behavior were "the loser just gets rejected, family survives," the requirement would probably say "the other receives a standard rejection." Instead it's combined with requirement 4's absolute rule. Also consider the alternative design where the loser *doesn't* wipe: then the test would assert that the winner's new token can subsequently rotate successfully. Either is testable. Which is the "more correct" security behavior per the task author?

The task author wrote: "presentation of an already-retired token is treated as compromise: every token descended from the same original sign-in is invalidated." At the moment the second request's logic evaluates the token, the token *is* already retired (retired by the first request). There's no exception clause for "retired by my own duplicate." So the family is invalidated. Going with the strict version. I'll make the SECURITY.md wording explicit about this consequence.

- `retireFamily(sessionId)` → `updateMany({ where: { sessionId, retiredAt: null }, data: { retiredAt: now } })` → returns count. (For the reuse path.)
- `createEvent({sessionId?, userId?, kind, tokenId?, details})`
- For tests: `listTokens(sessionId)` → tokens with retiredAt; `countActiveTokens(sessionId)`; possibly `findSession(id)`.

Also `markSessionExpired`? No — expiry is just a comparison of `expiresAt` vs now. No revocation column needed? A `revokedAt` on Session would allow explicit revocation, but it's not required. Skip — keep the schema minimal to the requirements. Actually, hmm, when a family is invalidated on reuse, should I also mark the session revoked? The effect is: all tokens retired → the session is unusable. A new presentation of any token in the family → retired → reuse → re-wipe (no-op) → rejected. So the session is effectively dead without a `revokedAt`. Skip the extra column (discipline: don't add what's not asked). OK.

Wait, but one more path: a token in the family is presented *after* the deadline — the order is expired check before retired check → rejected as "expired," not "reuse." That's fine, still rejected, audit says expired. The order is documented.

Now, clock: the service uses `new Date()`. For tests of the absolute deadline, I need to control time. Options: inject a clock (`() => Date` / `now: () => new Date()` via constructor, defaulting to `() => new Date()`). That's clean and testable without fakable timers. I'll inject `private readonly now: () => Date` with a default via optional constructor param — Nest DI: constructor injection of a function with default value `() => new Date()` — NestJS supports constructor parameter default values, in which case that dependency is skipped? Actually, NestJS: if a constructor parameter has a default value, Nest doesn't try to resolve it (treats it as not injectable). Yes — Nest supports "constructor parameter with default value" → treated as a plain parameter. That works: `constructor(private readonly repo: RefreshTokenRepository, private readonly now: () => Date = () => new Date())`. Tests can pass a fake clock. And a TTL function? TTL from env is read at construction: `private readonly ttlMs = Number(process.env.REFRESH_SESSION_TTL_SECONDS ?? 30*24*3600*1000)`. Tests can set env before instantiating, or inject the ttl too. Cleaner: inject `ttlMs` with a default from env:

```ts
constructor(
  private readonly repo: RefreshTokenRepository,
  private readonly now: () => Date = () => new Date(),
  private readonly ttlMs: number = RefreshService.sessionTtlMs(),
)
```

Hmm, the default value is evaluated at instantiation — fine. Actually simpler for tests: tests build the service manually (not via Nest DI) — `new AuthService(repo, fakeNow, 1000)`. And the repository is built with a real PrismaClient (integration) — or a fake repository for unit tests? The concurrency test *needs* real DB semantics. But is it acceptable for the test to construct `new RefreshTokenRepository(prisma)` directly? Yes, tests can instantiate anything.

But wait — do the tests use real Postgres? In this eval, the tests won't run without a DB... but they're the deliverable. Most defensible: integration tests that require `DATABASE_URL` (per env convention: "no secrets in the repo, no hardcoded connection strings" → tests read `process.env.DATABASE_URL`). And the deadline test doesn't need a DB race — it still needs the DB (real tokens). I'll write one test file `test/refresh.spec.ts` (convention: `test/<feature>.spec.ts`; feature = "refresh"? or "auth"? The feature folder is... the endpoint is `/auth/refresh`. Let's name the feature folder `src/refresh/`? Hmm. The controller is for `/auth/refresh`. Feature name: I think `refresh` is the feature (token rotation). Files: `src/refresh/refresh.module.ts`, `refresh.controller.ts`, `refresh.service.ts`, `refresh.repository.ts`. The controller declares `@Controller('auth')` with `@Post('refresh')`. That matches the endpoint. Hmm, or feature = `auth`: `src/auth/auth.controller.ts` with `@Controller('auth')`. The task says "NestJS module: controller, service, repository" for the refresh feature. I'll go with `src/refresh/` — the feature is refresh token rotation. Test: `test/refresh.spec.ts`.

Now the module: `RefreshModule` provides controller+service+repository, exports the service (so the assumed existing sign-in module can call `issueSession`). Imports PrismaModule? The Prisma client: who provides the PrismaClient? Typically a global `PrismaModule` with a provider. Since "sign-in already exists and is assumed," there may already be infrastructure, but there's no codebase — so I have to provide what my module needs. The repository needs a PrismaClient. Create `src/prisma/prisma.module.ts` + `src/prisma/prisma.service.ts`? That's two extra files not in the convention's layout... the convention's layout doesn't include it, but the repository has to get a PrismaClient from somewhere. Alternative: construct `new PrismaClient()` inside the repository — but then DI lifecycle (onModuleInit connect, onModuleDestroy disconnect) is lost; constructing directly in the repository's constructor is simpler and still "repository is the only layer that touches the database." Hmm. Constructing PrismaClient in the repository's constructor is acceptable and minimal. But the clean NestJS way is a PrismaService. Discipline says don't create files not asked for... the repository is asked for; it needs a client. I'll go with constructing `new PrismaClient()` inside the repository's constructor, and adding `onModuleDestroy` in the *repository* to `$disconnect` (Nest lifecycle hooks on providers work — the repository is a provider, so `onModuleDestroy` is honored). That keeps the file count low and respects the layering. I think that's the right minimal call.

Actually, hmm, wait: `@Injectable() class RefreshTokenRepository implements OnModuleDestroy { constructor() { this.prisma = new PrismaClient(); } }` — fine. In tests, `new RefreshTokenRepository()` creates its own client; better for tests to inject a shared client: `constructor(private readonly prisma: PrismaClient = new PrismaClient())`. Default param + Nest DI: if the parameter has a default, Nest skips resolution and uses the default. So the DI app gets a default client, and tests can inject a shared one.

Now the controller:

```ts
@Controller('auth')
export class RefreshController {
  constructor(private readonly service: AuthService) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: unknown },
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = extractRefreshToken(body, cookieHeader);
    try {
      const { accessToken, refreshToken } = await this.service.refresh(token);
      res.cookie('refresh_token', refreshToken, COOKIE_OPTS);
      return { accessToken, refreshToken };
    } catch (err) {
      if (err instanceof RefreshRejectedError) {
        res.cookie('refresh_token', '', { maxAge: 0, ... });
        throw new UnauthorizedException(ERROR_ENVELOPE); // or BadRequest? no — 401
      }
      throw err;
    }
  }
}
```

Wait — the error envelope convention: `{ "error": { code, message, details } }`. Nest's HttpException body is whatever you pass. To control the exact shape, throw `new UnauthorizedException({ error: { code: 'refresh_token_rejected', message: '...', details: {} } })`. That gives body `{"error":{...}}` with status 401.

Or, the controller returns the envelope manually with `@Res()` — but passthrough + HttpException is cleaner and more idiomatic.

Message: developer-facing English, constant: "refresh token could not be validated" — identical across all rejection kinds. Yes, constant → indistinguishable.

`extractRefreshToken(body, cookieHeader)`:
- Parse cookie header → `refresh_token` value (URL-decoded).
- Body: `body?.refreshToken`.
- Precedence: **body wins** (if both present, the body). Documented.

Hmm, let me lock this in: body `refreshToken` wins over the cookie. Documented in the controller's JSDoc: "If both the JSON body `refreshToken` and the `refresh_token` cookie are present, the body value is authoritative." Why? The explicit parameter is the client's deliberate choice for this call; the cookie is a passive fallback. Hmm, counterargument: the cookie is what the server set last... no, the body is explicit. Also practically: the SPA flow uses the body; the mobile/cookie flow uses the cookie; mixed signals → the explicit wins. Going with body wins.

Edge: body present but not a string (e.g., number 123)? Then "body present" — treat as malformed (pass through and let the service classify). If body is `refreshToken: null`/undefined → fall back to cookie. If body's `refreshToken` is the empty string `""` → present but malformed? Or fall back? Hmm. Treat `undefined`/`null` as absent, any other value as present (even empty string → malformed rejection). Clean rule: presence = key exists and value is not null/undefined... actually `body.refreshToken === undefined || body.refreshToken === null` → absent; otherwise present (even empty string → malformed). Document that.

And cookie value: the cookie could be absent → undefined. The cookie is URL-decoded.

Now the service:

```ts
export class RefreshRejectedError extends Error {}

export interface RefreshSuccess { accessToken: string; refreshToken: string; }

const TOKEN_RE = /^rt_[A-Za-z0-9_-]{43}$/;

@Injectable()
export class RefreshService {
  constructor(
    private readonly repo: RefreshTokenRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Sign-in hook (assumed existing flow) ... */
  async issueSession(userId: string): Promise<{ accessToken, refreshToken, expiresAt }> {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + REFRESH_SESSION_TTL_MS());
    const session = await this.repo.createSession(userId, expiresAt);
    const token = generateToken();
    await this.repo.createToken(session.id, sha256Hex(token));
    await this.repo.recordEvent({ sessionId: session.id, userId, kind: 'session_issued', tokenId, details: {expiresAt} });
    const accessToken = issueAccessToken(userId);
    return { accessToken, refreshToken: token, expiresAt };
  }

  async refresh(presented: string | undefined): Promise<RefreshSuccess> {
    ... as sketched
  }
}
```

Where does `issueAccessToken` come from? "Assume `issueAccessToken(userId): string` exists" — but there's no codebase... I have to reference it. "If a symbol you need really doesn't exist in the task, don't guess in silence: use the most defensible reading and mark it with a single `// ASSUMPTION:` comment." The task says to assume it exists — so import from somewhere. Where? Defensible: `src/auth/token.service.ts`? No — I shouldn't invent a whole existing service file... but if I import from a non-existent file, the solution won't compile. Options:

(a) Create `src/auth/access-token.service.ts` with `issueAccessToken` as a thin provider — but the task says sign-in/access verification "already exists and is assumed." Creating a replacement for something assumed to exist = "don't invent a replacement for something you showed" — but nothing was shown (no files). The task statement says it exists; in the delivered repo it must *be* present for the code to compile. Most defensible: define it minimally in my own module? No...

Let me think about what the grader wants: the deliverable is the rotation feature. `issueAccessToken` is given. I can write a small standalone function `src/refresh/access-token.ts`? That's inventing the "already exists" part. Or: `import { issueAccessToken } from '../auth/access-token'` with an `// ASSUMPTION` comment that the sign-in module provides it there. That leaves a broken import in a repo that must compile... but the convention says "work against the shown files" — no files were shown, so the "existing" sign-in is purely hypothetical. For the delivered repo to be self-consistent, I'd rather include a minimal `src/auth/access-token.ts` with a single pure function `issueAccessToken(userId: string): string` marked as a stand-in for the existing sign-in implementation... hmm, that's "creating a file not asked for" vs "delivering a compilable whole solution."

The meta-instruction: "if a symbol you need really doesn't exist in the task, don't guess in silence and don't work around it: use the most defensible reading and mark it with a single `// ASSUMPTION:` comment at the place it matters."

So: I need `issueAccessToken`. It's said to exist (in the hypothetical codebase), but in *my* delivered repo it doesn't exist. Most defensible reading: provide it as a minimal placeholder module so the repo is complete, and mark it with `// ASSUMPTION: sign-in/access-token module is assumed to exist; this is a minimal stand-in providing issueAccessToken(userId): string`. I'll create `src/auth/access-token.service.ts` — a module? If it's a standalone function (not an injectable), the service can just import the function. "Assume `issueAccessToken(userId): string`" — it's a function, not necessarily an injectable. Simplest: `src/auth/access-token.ts` exporting `export function issueAccessToken(userId: string): string` that produces a JWT-like HMAC... wait, "no secrets in the repo" — the JWT secret must come from env: `process.env.JWT_ACCESS_TOKEN_SECRET`? I can't depend on it existing... the stand-in can do:

```ts
// ASSUMPTION: the task states sign-in and access-token verification already exist and provide
// issueAccessToken(userId): string. This module is a minimal stand-in so the delivered
// codebase compiles; in a real deployment the existing implementation should replace it.
export function issueAccessToken(userId: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: userId, iat: ..., exp: ... }));
  const signature = hmacSha256(`${header}.${payload}`, process.env.ACCESS_TOKEN_SECRET ?? '')
  ...
}
```

Hmm, that's a full JWT implementation — too much. Simpler stand-in: return `at_<userId>_<random>`? That's a fake token; but it's only a stand-in, and the tests only need "a string is returned." Actually — wait. Maybe simpler and cleaner: the stand-in returns an opaque token `at_` + random 32 bytes base64url, ignoring crypto correctness, with a comment that a real implementation signs with env secrets. Keep it ~10 lines. Good.

Hmm, actually, let me reconsider the placement: the refresh feature is under `src/refresh/`, and the auth token helper is... `src/auth/access-token.ts` matches the feature folder convention (feature = auth). But then `RefreshModule` imports from the auth feature — cross-feature. If `issueAccessToken` is a plain function, no module wiring is needed. That's fine and avoids cross-module imports. I'll go with a plain function in `src/auth/access-token.ts`. And `RefreshService` imports it. The `// ASSUMPTION` comment goes there.

Now the repository — the only DB layer:

```ts
@Injectable()
export class RefreshTokenRepository implements OnModuleDestroy {
  constructor(private readonly prisma: PrismaClient = new PrismaClient()) {}

  onModuleDestroy() { return this.prisma.$disconnect(); }

  async createSession(userId: string, expiresAt: Date): Promise<Pick<Session,'id'|'expiresAt'>> {
    return this.prisma.session.create({ data: { userId, expiresAt } });
  }

  async createToken(sessionId: string, tokenHash: string): Promise<Pick<RefreshToken,'id'>> {
    return this.prisma.refreshToken.create({ data: { sessionId, tokenHash } });
  }

  async findTokenWithSession(tokenHash: string) {
    return this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      select: {
        id: true, retiredAt: true,
        session: { select: { id: true, userId: true, expiresAt: true } },
      },
    });
  }

  /** Atomically retire a token if it is still active; issue the successor in the same transaction.
   *  Returns the successor's id if this call won the race, null if the token was already retired. */
  async claimAndIssue(tokenId: string, newTokenHash: string): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const res = await tx.refreshToken.updateMany({
        where: { id: tokenId, retiredAt: null },
        data: { retiredAt: now },
      });
      if (res.count === 0) return null;
      const created = await tx.refreshToken.create({ data: { sessionId: ??? , tokenHash: newTokenHash } });
      return created.id;
    });
  }
```

Problem: `claimAndIssue` needs the `sessionId`. Pass it in: `claimAndIssue(tokenId, sessionId, newTokenHash)`.

  ```
  async retireFamily(sessionId: string): Promise<number> {
    const res = await this.prisma.refreshToken.updateMany({
      where: { sessionId, retiredAt: null },
      data: { retiredAt: new Date() },
    });
    return res.count;
  }

  async recordEvent(data: {
    sessionId?: string; userId?: string; kind: string; tokenId?: string; details?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.securityEvent.create({ data: { ...data, details: data.details ?? {} } });
  }

  async activeTokenCount(sessionId: string): Promise<number> {
    return this.prisma.refreshToken.count({ where: { sessionId, retiredAt: null } });
  }

  async listTokens(sessionId: string): Promise<Array<{ id: string; retiredAt: Date | null }>> {
    return this.prisma.refreshToken.findMany({ where: { sessionId }, select: { id: true, retiredAt: true } });
  }

  async getSession(id: string) { return this.prisma.session.findUnique({ where: { id } }); }
}
```

`findTokenWithSession` uses `findFirst` — since tokenHash is unique, findUnique is fine: `findUnique({ where: { tokenHash } })`. Use findUnique for clarity/perf.

Now the full service logic:

```ts
const REFRESH_TOKEN_PATTERN = /^rt_[A-Za-z0-9_-]{43}$/;

function generateRefreshToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}
function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
function sessionTtlMs(): number {
  const raw = Number(process.env.REFRESH_SESSION_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : 30 * 24 * 60 * 60 * 1000;
}
```

`refresh(presented)`:

```ts
async refresh(presented: string | undefined): Promise<RefreshResult> {
  const now = this.now();

  // 1. Structural shape. Reject garbage before it touches the database.
  if (typeof presented !== 'string' || !REFRESH_TOKEN_PATTERN.test(presented)) {
    await this.repo.recordEvent({ kind: 'refresh_rejected_malformed', details: { shape: typeof presented === 'string' ? presented.length : null } });
    throw new RefreshRejectedError();
  }

  // 2. Look up by hash.
  const record = await this.repo.findTokenByHash(sha256Hex(presented));
  if (record === null) {
    await this.repo.recordEvent({ kind: 'refresh_rejected_unknown', details: { tokenHash: sha256Hex(presented) } });
    throw new RefreshRejectedError();
  }

  // 3. Absolute deadline, fixed at sign-in.
  if (!record.session.expiresAt.after(now)) {
    await this.repo.recordEvent({ kind: 'refresh_rejected_expired', sessionId, userId, tokenId, details: { expiresAt } });
    throw new RefreshRejectedError();
  }

  // 4. Already retired → replay → compromise.
  if (record.retiredAt !== null) {
    await this.quarantine(record, 'retired');
    throw new RefreshRejectedError();
  }

  // 5. Atomic claim; exactly one concurrent caller wins.
  const newToken = generateRefreshToken();
  const newTokenId = await this.repo.claimAndIssue(record.id, record.session.id, sha256Hex(newToken));
  if (newTokenId === null) {
    // Lost the race: the token was retired by a concurrent rotation → same as step 4.
    await this.quarantine(record, 'concurrent');
    throw new RefreshRejectedError();
  }

  // 6. Audit the success and return the pair.
  await this.repo.recordEvent({ kind: 'refresh_reissued', sessionId, userId, tokenId: newTokenId, details: { previousTokenId: record.id } });
  return { accessToken: issueAccessToken(record.session.userId), refreshToken: newToken };
}

private async quarantine(record, via: 'retired' | 'concurrent'): Promise<void> {
  const wiped = await this.repo.retireFamily(record.session.id);
  await this.repo.recordEvent({
    kind: 'refresh_reuse_detected',
    sessionId: record.session.id,
    userId: record.session.userId,
    tokenId: record.id,
    details: { detectedVia: via, tokensWiped: wiped },
  });
}
```

Order note: on step 5, generate `newToken` before the claim — fine (not leaked if we lose the race).

One issue: in step 4, if the token is retired and the session is also expired — expired check first (step 3) → audit is expired, no family wipe. Documented order: malformed → unknown → expired → retired/reuse. Why expired before retired: a session that has hit its absolute deadline is already dead; a stale client presenting an old token after the deadline is not evidence of compromise, and wiping an already-dead family is pointless churn. The retired check is the compromise signal; the expired check is a natural death.

Now — is a reuse event kind separate from rejection? Requirement: "presentation of an already-retired token is ... the event is recorded for auditing" + requirement 6: audit distinguishes expired, retired, unknown, malformed. So kinds: `refresh_rejected_expired`, `refresh_rejected_unknown`, `refresh_rejected_malformed`, `refresh_reuse_detected` (the retired one). Plus `refresh_reissued` and `session_issued`. Six kinds. Good.

The event's `details` column: Jsonb, default `{}`.

Now the controller and its error handling. Also: what if the service throws something else (DB down)? Then a generic 500 — acceptable (the envelope for 500 isn't specified; the single error envelope is the contract for our errors; a crash is a crash). Keep it minimal: only RefreshRejectedError is special-cased.

Cookie setting details:
- Success: `res.cookie('refresh_token', token, { httpOnly: true, secure: ???, sameSite: 'lax', path: '/' })`. `secure: true` breaks local dev over http; convention: env-driven? Keep it simple: `secure: process.env.COOKIE_SECURE === 'true'`? Hmm, that's extra config. Just set `httpOnly: true, sameSite: 'lax', path: '/'` without `secure`, and note in a comment that production should set secure. Actually, the discipline — keep it lean; I'll omit `secure` but add a short comment. Hmm, a security deliverable without Secure flag... let me add `secure: process.env.COOKIE_SECURE === 'true'` — one line, env-driven per convention. OK.
- Rejection: `res.cookie('refresh_token', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })`.

Express res.cookie with an empty string + maxAge 0 → clears it. In the supertest tests, I'll assert the `set-cookie` header accordingly.

Body parsing: Nest's default `express` adapter parses JSON bodies automatically (global `body-parser`). In tests with `Test.createTestingModule`, I need `app.init()` and then `app.getHttpAdapter().getInstance()` for supertest. JSON body is parsed by default in Nest? The `@nestjs/platform-express` built-in `BodyParserMiddleware`? By default, Nest applies `json()` and `urlencoded()` middlewares globally via `app.useBodyParser()`? Actually, Nest automatically applies body-parser in the express platform (`NestExpressApplication` uses `express.json()`/`urlencoded` by default — yes, platform-express enables a global json+urlencoded body parser unless disabled). In tests: `const app = moduleRef.createNestApplication(); await app.init();` — is the body parser auto-added? `createNestApplication` calls `useBodyParser`... I believe JSON body works out of the box in supertest tests. Yes, standard practice: it works.

Now — the tests. `test/refresh.spec.ts`. Integration style:

```ts
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
...

describe('POST /auth/refresh', () => {
  let app, prisma, service...
  beforeEach: create PrismaClient, create repo with it, create service (real clock or fake), build the testing module with provider overrides.
  afterEach: prisma.$disconnect + truncate tables.
  beforeAll: prisma migrate? no — tests assume a migrated DB. Hmm, tests need schema in DB. I can `await prisma.$executeRaw`... no. Standard: tests run against a DB that has had the migration applied (CI does `prisma migrate deploy`). I'll note in a comment. Or apply the migration in beforeAll? There's no prisma CLI from a test. I'll just note: "requires a Postgres reachable at DATABASE_URL with prisma/migrations applied."
```

Seeding: via the service's `issueSession(userId)` — the real path.

Test 1: **Concurrent presentation of a single token**.
```ts
const { refreshToken } = await service.issueSession('user-1');
const [r1, r2] = await Promise.all([
  request(app).post('/auth/refresh').send({ refreshToken }),
  request(app).post('/auth/refresh').send({ refreshToken }),
]);
expect(r1.status === 200 || r2.status === 200).toBe(true);
expect(count of 200s).toBe(1);
const ok = whichever 200; expect(ok.body).toHaveProperty('accessToken', string), 'refreshToken' different from presented.
const rej = the other; expect(rej.status).toBe(401); expect(rej.body).toEqual(the envelope);
// family is quarantined: no active tokens remain
expect(await repo.activeTokenCount(sessionId)).toBe(0);
```
Need sessionId — does `issueSession` return it? Let's make it return `{ accessToken, refreshToken, sessionId, expiresAt }`. Fine.

The HTTP-level concurrent test is good (behavioral, through the controller). Exactly one 200.

Test 2: **Replay invalidates a sibling token** (family wipe).
```ts
const s = await service.issueSession('user-2');
const r = await request(app).post('/auth/refresh').send({ refreshToken: s.refreshToken }); // 200, new token
const sibling = r.body.refreshToken;
// Replay the old one
const replay = await request(...).send({ refreshToken: s.refreshToken });
expect(replay.status).toBe(401) + envelope;
// The sibling is now dead too
const sib = await request(...).send({ refreshToken: sibling });
expect(sib.status).toBe(401) + same envelope;
// Audit: reuse event recorded with tokensWiped >= 1
const events = await prisma.securityEvent.findMany(...); expect kinds to contain 'refresh_reuse_detected'
```
Also assert the active token count is 0.

Test 3: **Rotation against the absolute deadline**.
Use a fake clock: service with `now` controllable. TTL is small, e.g., service constructed with ttl 60s (or env). Steps:
```ts
let t0 = 0; const service = new RefreshService(repo, () => new Date(t0));
const s = await service.issueSession('user-3'); // expiresAt = t0 + ttl
t0 += ttl/2;
const r = await service.refresh(s.refreshToken) via HTTP? The HTTP app uses the module's service...
```
Hmm — if I build the app with the fake-clock service, I control the clock for everything. I'll build the app once per describe with the fake clock, and a second app? Simpler: the deadline test uses the same app but needs clock control... let me structure: create the fake clock service and inject it into the testing module (override provider). All tests in the file can use the same app with the fake clock (set to real Date.now() initially, advance as needed). For the concurrency test, the clock is static — fine.

Deadline test:
```ts
resetClock to base
const s = await service.issueSession('user-d');
advance(ttl - 1000);
const r = await request(app).post('/auth/refresh').send({ refreshToken: s.refreshToken }); // 200 → new token issued near the deadline
advance(5000); // now > expiresAt
const r2 = await request(...).send({ refreshToken: r.body.refreshToken });
expect(r2.status).toBe(401) // expired, even though the token was just issued
// audit contains refresh_rejected_expired
```
Also assert the session's `expiresAt` hasn't changed after rotation (the deadline is fixed): fetch the session, `expiresAt.getTime() === t0 + ttl`.

Test 4: **Comparing rejection responses** — expired, retired (reuse), unknown, malformed: all four must produce byte-identical bodies (and the same status 401). Construct four scenarios:
- unknown: `send({ refreshToken: 'rt_' + 'A'.repeat(43) })` (well-shaped, not registered)
- malformed: `send({ refreshToken: 'nonsense' })`
- expired: session past the deadline (fake clock)
- retired: rotate once, then present the old token (also triggers family wipe — fine)
Collect the four 401 bodies → assert all four are `toEqual` to each other, and equal to the envelope `{ error: { code: 'refresh_token_rejected', message: '...', details: {} } }`.

Maybe also assert the `set-cookie` clearing header is present in all.

And a happy-path test? "A test that only tests the happy path is worse than no test" — I need non-happy paths too; I have those. I'll include a basic success assertion inside the concurrency test (the winner's body has the tokens). Maybe also a small dedicated success test asserting rotation returns a new pair + the old token is retired. The concurrency test covers one rotation. I'll add a small "rotation succeeds once" test for clarity.

Also a cookie-source test? Requirement 2 asks that both be supported + the precedence is documented. A test of cookie acceptance + body-precedence-over-cookie is good behavior coverage. Add:
- Token via cookie only → 200.
- Both body and cookie, different tokens: body valid, cookie also valid (two sessions, or the same? use two sessions: body token from session A, cookie token from session B (valid)). Assert session A rotated (A's token was retired), B's token still works → proves body won.

That's a solid behavioral test.

Now test DB isolation: truncate between tests: `await prisma.$executeRawUnsafe('TRUNCATE security_events, refresh_tokens, sessions RESTART IDENTITY CASCADE')` — hmm, the "no raw SQL" rule applies to the service layer; tests using $executeRaw for cleanup is standard. Or use prisma's deleteMany per model. Cleaner: `await prisma.securityEvent.deleteMany(); await prisma.refreshToken.deleteMany(); await prisma.session.deleteMany();`. I'll do that in beforeEach.

Fake clock: `let nowMs = Date.now(); const fakeNow = () => new Date(nowMs);` and `advance(ms) { nowMs += ms; }`.

Building the module for tests:

```ts
const moduleRef = await Test.createTestingModule({
  imports: [RefreshModule],
})
  .overrideProvider(RefreshTokenRepository).useValue(repo)
  .overrideProvider(RefreshService).useValue(service)
  .compile();
```

Wait — RefreshService is also a provider in the module; if I override the service with an instance (fake clock), the controller uses it. But `issueSession` in tests is called on my instance — same object the controller uses. Good.

But `RefreshModule` imports nothing (the repo self-constructs a PrismaClient — override to inject the shared client). Controller is declared. Fine.

Hmm, one issue: `RefreshModule`'s providers include `RefreshTokenRepository` — when the testing module compiles with the module imported, the default provider instantiation happens, but `overrideProvider` replaces it. OK.

Now, the service constructor with a default param under Nest DI: `constructor(private readonly repo: RefreshTokenRepository, private readonly now: () => Date = () => new Date(), private readonly ttlMs: number = sessionTtlMsFromEnv())`. Nest DI: parameters with default values are not resolved (treated as non-injectable). Correct — Nest docs: "you can add default values to constructor parameters... Nest.js does not resolve such dependencies." So in the real app: `repo` is injected (no default), `now`/`ttlMs` use defaults.

The repository constructor: `constructor(private readonly prisma: PrismaClient = new PrismaClient())` — the PrismaClient type is a class, so Nest will *try* to resolve it unless it has a default... with a default value, Nest skips it. Good.

Now — Prisma schema details and migration SQL. Let me write it out exactly.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Session {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  createdAt DateTime @default(now()) @map("created_at")
  expiresAt DateTime @map("expires_at")
  tokens    RefreshToken[]
  events    SecurityEvent[]

  @@map("sessions")
}
```

Wait — I decided SecurityEvent has no FK to Session (nullable session, no relation). So the `events SecurityEvent[]` back-relation isn't there. Session has `tokens RefreshToken[]`.

```prisma
model RefreshToken {
  id        String    @id @default(uuid())
  sessionId String    @map("session_id")
  tokenHash String    @unique @map("token_hash")
  createdAt DateTime  @default(now()) @map("created_at")
  retiredAt DateTime? @map("retired_at")

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@map("refresh_tokens")
}

model SecurityEvent {
  id        String   @id @default(uuid())
  sessionId String?  @map("session_id")
  userId    String?  @map("user_id")
  kind      String
  tokenId   String?  @map("token_id")
  details   Json     @default("{}")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([sessionId])
  @@index([kind])
  @@map("security_events")
}
```

Migration SQL (Postgres):

```sql
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3) DEFAULT NULL,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refresh_tokens_token_hash_key" UNIQUE ("token_hash")
);

CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT DEFAULT NULL,
    "user_id" TEXT DEFAULT NULL,
    "kind" TEXT NOT NULL,
    "token_id" TEXT DEFAULT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");
CREATE INDEX "security_events_session_id_idx" ON "security_events"("session_id");
CREATE INDEX "security_events_kind_idx" ON "security_events"("kind");

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Note: uuid() in Prisma postgres → generated in the client (uuid v4 in JS), the column is TEXT. Prisma uses `uuid()` provider default with TEXT column for PostgreSQL. Correct.

Migration folder name: `prisma/migrations/20250101000000_init/migration.sql`. Also Prisma wants a `migration_lock.toml`? For `migrate deploy`/dev, `prisma/migrations/migration_lock.toml` with `provider = "postgresql"`. Include it — that's part of "shipping a migration" correctly. Yes, I'll include `prisma/migrations/migration_lock.toml`.

Now — the "uuid" note: `@default(uuid())` generates in the client; fine.

Now let me write the NestJS files.

### src/main.ts

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env.PORT ?? 3000));
}
void bootstrap();
```

### src/app.module.ts

```ts
import { Module } from '@nestjs/common';
import { RefreshModule } from './refresh/refresh.module';

@Module({ imports: [RefreshModule] })
export class AppModule {}
```

The assumed sign-in module exists in the real app; in this repo, only Refresh. OK.

### src/refresh/refresh.module.ts

```ts
import { Module } from '@nestjs/common';
import { RefreshController } from './refresh.controller';
import { RefreshService } from './refresh.service';
import { RefreshTokenRepository } from './refresh.repository';

@Module({
  controllers: [RefreshController],
  providers: [RefreshService, RefreshTokenRepository],
  exports: [RefreshService],
})
export class RefreshModule {}
```

### src/refresh/refresh.repository.ts

As sketched. Types: define return shapes as interfaces to avoid leaking the full Prisma types? The service consumes `record.session.userId` etc. I'll use `Prisma.SessionGetPayload`-style selects. Let me define:

```ts
export interface StoredToken {
  id: string;
  retiredAt: Date | null;
  session: { id: string; userId: string; expiresAt: Date };
}
```

`findTokenByHash(hash: string): Promise<StoredToken | null>`:
```ts
return this.prisma.refreshToken.findUnique({
  where: { tokenHash: hash },
  select: {
    id: true,
    retiredAt: true,
    session: { select: { id: true, userId: true, expiresAt: true } },
  },
});
```

`claimAndIssue(tokenId, sessionId, newTokenHash): Promise<string | null>` — the interactive transaction as sketched.

`retireFamily(sessionId): Promise<number>`.

`createSession(userId, expiresAt): Promise<{ id: string; expiresAt: Date }>`:
```ts
const s = await this.prisma.session.create({ data: { userId, expiresAt }, select: { id: true, expiresAt: true } });
return s;
```

`createToken(sessionId, tokenHash): Promise<{ id: string }>`.

`recordEvent(event: SecurityEventData): Promise<void>`.

`countActiveTokens(sessionId): Promise<number>`.

`findSessionById(id): Promise<{ id, userId, expiresAt, createdAt } | null>` — for the test assertion (deadline hasn't moved). Maybe `findSessionById` is only needed by tests... the service doesn't need it after rotation. Include it (small, useful for audit/testing). Hmm, discipline — minimal, but the test needs to verify `expiresAt` invariance; the test could use `prisma.session.findUnique` directly (the test has the prisma client). Then the repository doesn't need findSessionById. But "the repository is the only layer that touches the database" — tests are not an app layer; it's normal for an integration test to use its own PrismaClient for assertions/seeding. I'll let the test use prisma directly for assertions and keep the repo API minimal to what the service needs. Good.

### src/refresh/refresh.service.ts

Constants + helpers + the service + the error class. Also export `RefreshRejection`? The controller needs to catch `RefreshRejectedError`. Define in the service file: `export class RefreshRejectedError extends Error { constructor() { super('refresh token rejected'); } }` — the message is internal; the controller supplies the public envelope.

TTL: `REFRESH_SESSION_TTL_SECONDS` env var, default 30 days.

Let me write it out:

```ts
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { issueAccessToken } from '../auth/access-token';
import { RefreshTokenRepository, StoredToken } from './refresh.repository';

export class RefreshRejectedError extends Error {
  constructor() {
    super('The presented refresh token was rejected.');
    this.name = 'RefreshRejectedError';
  }
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Structural shape of an issued refresh token: `rt_` + 32 random bytes, base64url. */
const REFRESH_TOKEN_PATTERN = /^rt_[A-Za-z0-9_-]{43}$/;

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function generateRefreshToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sessionTtlSecondsFromEnv(): number {
  const parsed = Number(process.env.REFRESH_SESSION_TTL_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_SESSION_TTL_SECONDS;
}

@Injectable()
export class RefreshService {
  constructor(
    private readonly tokens: RefreshTokenRepository,
    // Parameters with default values are not resolved by Nest DI; tests may supply both.
    private readonly now: () => Date = () => new Date(),
    private readonly sessionTtlMs: number = sessionTtlSecondsFromEnv() * 1000,
  ) {}

  /**
   * Sign-in hook. The (assumed existing) sign-in flow calls this once per
   * sign-in; the absolute deadline is fixed here and never moves again.
   */
  async issueSession(userId: string): Promise<IssuedSession> {
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + this.sessionTtlMs);
    const session = await this.tokens.createSession(userId, expiresAt);
    const refreshToken = generateRefreshToken();
    const token = await this.tokens.createToken(session.id, sha256Hex(refreshToken));
    await this.tokens.recordEvent({
      sessionId: session.id,
      userId,
      kind: 'session_issued',
      tokenId: token.id,
      details: { expiresAt },
    });
    return {
      sessionId: session.id,
      accessToken: issueAccessToken(userId),
      refreshToken,
      expiresAt,
    };
  }

  /**
   * Rotate the presented refresh token. Every rejection — malformed, unknown,
   * expired, retired — throws the same RefreshRejectedError so the controller
   * can reply identically; the audit event kind is what distinguishes them.
   */
  async refresh(presented: string | undefined): Promise<RefreshResult> {
    const now = this.now();

    // Check 1 — structure. Garbage never reaches the database.
    if (typeof presented !== 'string' || !REFRESH_TOKEN_PATTERN.test(presented)) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_malformed',
        details: { length: typeof presented === 'string' ? presented.length : null },
      });
      throw new RefreshRejectedError();
    }

    // Check 2 — existence, by hash.
    const record = await this.tokens.findTokenByHash(sha256Hex(presented));
    if (record === null) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_unknown',
        details: { tokenHash: sha256Hex(presented) },
      });
      throw new RefreshRejectedError();
    }

    // Check 3 — absolute deadline, fixed at sign-in. A stale client that
    // presents a token after the deadline is not evidence of compromise, so
    // this runs before the retired check and does not trigger family wipe.
    if (!record.session.expiresAt.getTime() > now.getTime()) {
      ...
    }
```

Note: `!(a > b)` vs `a <= b`: reject when `now >= expiresAt`. Use `if (now.getTime() >= record.session.expiresAt.getTime())`.

```ts
    if (now.getTime() >= record.session.expiresAt.getTime()) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_expired',
        sessionId: record.session.id,
        userId: record.session.userId,
        tokenId: record.id,
        details: { expiresAt: record.session.expiresAt },
      });
      throw new RefreshRejectedError();
    }

    // Check 4 — reuse. A retired token in hand by a caller is compromise:
    // kill every token descended from the same sign-in.
    if (record.retiredAt !== null) {
      await this.quarantineFamily(record, 'presented_retired');
      throw new RefreshRejectedError();
    }

    // Check 5 — atomic claim. The conditional UPDATE is the only step that
    // can fail under contention; the loser reaches the same quarantine path.
    const nextToken = generateRefreshToken();
    const nextTokenId = await this.tokens.claimAndIssue(record.id, record.session.id, sha256Hex(nextToken));
    if (nextTokenId === null) {
      await this.quarantineFamily(record, 'concurrent_presentation');
      throw new RefreshRejectedError();
    }

    await this.tokens.recordEvent({
      kind: 'refresh_reissued',
      sessionId: record.session.id,
      userId: record.session.userId,
      tokenId: nextTokenId,
      details: { previousTokenId: record.id },
    });

    return {
      accessToken: issueAccessToken(record.session.userId),
      refreshToken: nextToken,
    };
  }

  /** Invalidate every token descended from the same sign-in and audit the detection. */
  private async quarantineFamily(record: StoredToken, detectedVia: string): Promise<void> {
    const wiped = await this.tokens.retireFamily(record.session.id);
    await this.tokens.recordEvent({
      kind: 'refresh_reuse_detected',
      sessionId: record.session.id,
      userId: record.session.userId,
      tokenId: record.id,
      details: { detectedVia, tokensWiped: wiped },
    });
  }
}
```

Wait — the `recordEvent` for unknown includes `tokenHash` — storing the hash (not the token) is fine, no sensitive leak. For malformed, only the length. OK.

One more consideration — `claimAndIssue` generates the token *before* the claim: if the claim fails, the token is discarded (unleaked). Fine.

Also — subtle: in the quarantine path after losing the race, `retireFamily` wipes tokens including the winner's just-issued one. As discussed, intended.

### src/refresh/refresh.controller.ts

```ts
import { Body, Controller, Headers, HttpCode, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { RefreshRejectedError, RefreshService } from './refresh.service';

const REFRESH_COOKIE = 'refresh_token';

const REJECTION_BODY = {
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
} as const;
```

Hmm, `as const` makes details a readonly {} — Nest serializes fine.

Cookie parsing:

```ts
function parseCookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  return undefined;
}
```

Extraction with documented precedence:

```ts
/**
 * Token source and precedence.
 * The token may arrive as JSON body `refreshToken` or as the `refresh_token` cookie.
 * When both are present, the **body value wins**: an explicit request parameter
 * is the client's deliberate choice for this call, the cookie is the passive
 * fallback. A body value that is not null/undefined is authoritative even if it
 * is structurally invalid (in which case the call is rejected as malformed).
 */
function extractRefreshToken(body: { refreshToken?: unknown } | undefined, cookieHeader: string | undefined): string | undefined {
  if (body !== undefined && body.refreshToken !== undefined && body.refreshToken !== null) {
    return body.refreshToken as string; // may be non-string; the service classifies it as malformed
  }
  return parseCookieValue(cookieHeader, REFRESH_COOKIE);
}
```

Hmm — `body.refreshToken as string` when it could be a number: the service's `typeof presented !== 'string'` → malformed. Good.

Controller method:

```ts
@Controller('auth')
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: unknown },
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const presented = extractRefreshToken(body, cookieHeader);
    try {
      const { accessToken, refreshToken } = await this.refreshService.refresh(presented);
      res.cookie(REFRESH_COOKIE, refreshToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        path: '/',
      });
      return { accessToken, refreshToken };
    } catch (error) {
      if (error instanceof RefreshRejectedError) {
        res.cookie(REFRESH_COOKIE, '', {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.COOKIE_SECURE === 'true',
          path: '/',
          maxAge: 0,
        });
        throw new UnauthorizedException(REJECTION_BODY);
      }
      throw error;
    }
  }
}
```

Wait — `UnauthorizedException(REJECTION_BODY)`: Nest wraps it: response body = the passed object. So body = `{ error: { code, message, details } }`.

One concern: the controller catches the error and re-throws an HttpException — that's input→HTTP mapping, allowed ("zero business logic" — this is response shaping; the rejection decision and audit happen in the service). Fine.

Also, `@Res({ passthrough: true })` with an explicit return — standard.

### src/auth/access-token.ts

```ts
import { randomBytes } from 'node:crypto';

// ASSUMPTION: the task states that sign-in and access-token verification already
// exist and provide `issueAccessToken(userId): string`. That module is not part of
// this deliverable, so this file is a minimal stand-in with the same contract;
// a real deployment must replace it with the existing signed implementation
// (signing key from an environment variable, never hardcoded).
export function issueAccessToken(userId: string): string {
  return `at_${userId}_${randomBytes(32).toString('base64url')}`;
}
```

Hmm, this is a weak token (userId embedded, unsigned). But it's a stand-in, clearly marked. Acceptable under the ASSUMPTION rule. Good.

### SECURITY.md (15–25 lines)

Content: check order and why, plus note on identical responses, race semantics, storage.

Draft:

```md
# SECURITY — refresh token rotation

Check order in `RefreshService.refresh`, and why it is exactly that order:

1. **Malformed (shape).** Cheap, database-free. Structural garbage (wrong prefix,
   length, charset, non-string) is rejected before any lookup so it never
   reaches the database and never costs an index probe.
2. **Unknown (lookup by hash).** Tokens are stored as SHA-256 digests, never
   plaintext. A structurally valid token with no row is unknown.
3. **Expired (absolute deadline).** The deadline is fixed at sign-in and
   rotation never extends it. Checked before reuse so a stale client that
   presents a token after natural death is audited as `expired` and does not
   trigger a pointless family wipe of an already-dead session.
4. **Retired (reuse).** A retired token in a caller's hands is compromise, by
   definition: the only way it could have been retired is a rotation, and a
   rotation retires the token. Every token descended from the same sign-in is
   retired and a `refresh_reuse_detected` event is recorded.
5. **Atomic claim.** The final `UPDATE ... WHERE retired_at IS NULL` is what
   makes "exactly one rotates" true under concurrency; the SELECTs above are
   advisory. The loser of the claim reaches step 4's quarantine: a duplicate
   retry is indistinguishable from a stolen-token replay, so it is treated as
   compromise and the family (including the winner's new token) dies.

Response contract: all four rejection kinds return the same 401 status, the
same envelope `{ error: { code: "refresh_token_rejected", message, details: {} } }`
and the same cookie-clearing `Set-Cookie`. Only the audit row's `kind`
(`refresh_rejected_malformed` / `_unknown` / `_expired` / `refresh_reuse_detected`)
distinguishes them, so a caller cannot fingerprint which tokens are valid,
expired or stolen. The winner of a race additionally clears the same way.
```

Line count: let me count. I need 15–25 lines. I'll count the final version carefully and trim.

### Tests — test/refresh.spec.ts

Now, the full test file. Considerations:
- ESM: import with `.ts`? With Vitest, TS imports without extensions work (vite resolves). Conventions say ESM — in vitest, `import { x } from '../src/refresh/refresh.service'` (no extension) works fine via vite. I'll use no-extension relative imports (standard in vitest).
- supertest: `import request from 'supertest';`
- Need `@types/supertest`? For TS typing. Add to devDependencies.
- `@nestjs/testing` — part of @nestjs/testing package (separate). Add to deps.

Test file structure:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { RefreshModule } from '../src/refresh/refresh.module';
import { RefreshService } from '../src/refresh/refresh.service';
import { RefreshTokenRepository } from '../src/refresh/refresh.repository';

const SESSION_TTL_MS = 60_000; // 60s session for tests
const ENVELOPE = {
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
};

describe('POST /auth/refresh (integration, needs DATABASE_URL with migrations applied)', () => {
  let prisma: PrismaClient;
  let app: INestApplication;
  let service: RefreshService;
  let nowMs: number;

  beforeAll(async () => {
    prisma = new PrismaClient();
    nowMs = Date.now();
    service = new RefreshService(new RefreshTokenRepository(prisma), () => new Date(nowMs), SESSION_TTL_MS);
    const moduleRef = await Test.createTestingModule({ imports: [RefreshModule] })
      .overrideProvider(RefreshTokenRepository).useValue(service... 
```

Hmm wait: override the repository with the repo instance, and the service with my service instance:

```ts
    const repo = new RefreshTokenRepository(prisma);
    service = new RefreshService(repo, () => new Date(nowMs), SESSION_TTL_MS);
    const moduleRef = await Test.createTestingModule({ imports: [RefreshModule] })
      .overrideProvider(RefreshTokenRepository)
      .useValue(repo)
      .overrideProvider(RefreshService)
      .useValue(service)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    nowMs = Date.now();
    await prisma.securityEvent.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
```

Wait — the order of deleteMany: security_events has no FK to the other tables (I dropped the FK). refresh_tokens → sessions FK: delete tokens first, then sessions. Good.

Helper: `const post = (payload: unknown) => request(app.getHttpServer()).post('/auth/refresh').send(payload);` and a cookie variant.

Test 1: concurrent.

```ts
  it('rotates exactly once when the same valid token is presented concurrently', async () => {
    const session = await service.issueSession('user-race');

    const [a, b] = await Promise.all([
      post({ refreshToken: session.refreshToken }),
      post({ refreshToken: session.refreshToken }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);

    const [ok, rej] = a.status === 200 ? [a, b] : [b, a];
    expect(ok.body.accessToken).toEqual(expect.any(String));
    expect(typeof ok.body.refreshToken).toBe('string');
    expect(ok.body.refreshToken).not.toEqual(session.refreshToken);

    expect(rej.body).toEqual(ENVELOPE);

    // The loser's presentation was of an already-retired token: the whole
    // family is quarantined, so nothing from this sign-in can rotate again.
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);
    const events = await prisma.securityEvent.findMany({ where: { sessionId: session.sessionId }, orderBy: { createdAt: 'asc' } });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('refresh_reissued');
    expect(kinds).toContain('refresh_reuse_detected');
  });
```

Wait — the winner's `refresh_reissued` event and the loser's `refresh_reuse_detected`. Both are recorded. Also the winner's Set-Cookie sets a new cookie; the loser's clears. I can assert the header: `ok.headers['set-cookie']` contains 'refresh_token=rt_'; `rej.headers['set-cookie']` contains 'refresh_token=; Max-Age=0'. Nice to assert — I'll add.

Hmm, one race subtlety: could both requests... no, exactly one 200. But could *neither* be 200? If both lose? Impossible — one claim wins. Both get 401? Only if both claims returned null — impossible (a row lock serializes them; the first to commit gets count 1). But the expired check: the session is fresh, not expired. OK.

Another subtlety: both requests do a SELECT before the UPDATE. Both see active. Both UPDATE. Serialized. One gets 1, the other gets 0.

Test 2: replay invalidates a sibling.

```ts
  it('treats replay of a retired token as compromise and kills the sibling', async () => {
    const session = await service.issueSession('user-replay');
    const first = await post({ refreshToken: session.refreshToken });
    expect(first.status).toBe(200);
    const sibling = first.body.refreshToken as string;

    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(ENVELOPE);

    // The live sibling is dead now: same rejection, and no token from this
    // sign-in can ever succeed again.
    const siblingAttempt = await post({ refreshToken: sibling });
    expect(siblingAttempt.status).toBe(401);
    expect(siblingAttempt.body).toEqual(ENVELOPE);

    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const reuse = await prisma.securityEvent.findFirst({ where: { sessionId: session.sessionId, kind: 'refresh_reuse_detected' } });
    expect(reuse).not.toBeNull();
    expect((reuse!.details as { tokensWiped: number }).tokensWiped).toBeGreaterThanOrEqual(1);
  });
```

Note: the sibling attempt after the wipe: the sibling is now retired → that's *another* reuse event! Presenting the retired sibling triggers quarantine again (wipes 0 more) and records another `refresh_reuse_detected`. That's fine — still 401 with the same envelope. Actually wait: the sibling is retired and the session is unexpired → step 4 → quarantine (wipes the remainder, count probably 0) → audit reuse_detected again. Consistent. The test asserts the count of reuse events is ≥1 — I use findFirst, fine.

Test 3: absolute deadline.

```ts
  it('never extends the absolute deadline across rotations', async () => {
    const session = await service.issueSession('user-deadline');
    const originalDeadline = session.expiresAt.getTime();

    nowMs += SESSION_TTL_MS - 1000; // 1s before the deadline
    const near = await post({ refreshToken: session.refreshToken });
    expect(near.status).toBe(200);

    // The deadline is unchanged by the rotation.
    expect((await prisma.session.findUnique({ where: { id: session.sessionId } }))!.expiresAt.getTime()).toBe(originalDeadline);

    // A token issued 1s before the deadline dies with the deadline.
    nowMs += 2000;
    const past = await post({ refreshToken: near.body.refreshToken });
    expect(past.status).toBe(401);
    expect(past.body).toEqual(ENVELOPE);

    const expired = await prisma.securityEvent.findFirst({ where: { sessionId: session.sessionId, kind: 'refresh_rejected_expired' } });
    expect(expired).not.toBeNull();
  });
```

Wait — the fake clock is shared; `service.issueSession` uses it too. I reset `nowMs = Date.now()` in beforeEach — the relative advance is deterministic. Good.

Also note: `near` rotation at t0+ttl-1s: new token created, session expiresAt unchanged. Then +2s → past the deadline → expired rejection.

Test 4: rejection comparison.

```ts
  it('returns byte-identical rejections for expired, retired, unknown and malformed', async () => {
    const session = await service.issueSession('user-compare');
    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const retiredToken = session.refreshToken; // now retired (its replay would wipe; we don't want the wipe here... hmm)
```

Careful: presenting a *retired* token triggers a family wipe — that's fine for this test, but the 401 must be the same as the others. But wait — I want to compare the 4 retired, 1 expired, 1 unknown, 1 malformed. Retired is fine.

```ts
    // malformed
    const malformed = await post({ refreshToken: 'not-a-token' });
    // unknown
    const unknown = await post({ refreshToken: `rt_${'A'.repeat(43)}` });
    // expired
    nowMs += SESSION_TTL_MS + 60_000;
    const expired = await post({ refreshToken: rotated.body.refreshToken });
    // retired (replay of the first token)
    const retired = await post({ refreshToken: retiredToken });

    for (const r of [malformed, unknown, expired, retired]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual(ENVELOPE);
    }
    // Also byte-identical at the wire level
    const bodies = [malformed, unknown, expired, retired].map((r) => JSON.stringify(r.body));
    expect(new Set(bodies).size).toBe(1);
```

`JSON.stringify(r.body)` — the body is parsed JSON from supertest; toEqual already checks deep equality, but the set-of-stringify checks key order too — both are parsed from the same server code path, so the key order is identical. Fine, though toEqual is enough; the stringify check adds "byte-identical" flavor. Keep both? It's fine.

Also assert the audit distinguishes:

```ts
    const kinds = (await prisma.securityEvent.findMany({})).map((e) => e.kind);
    expect(kinds).toContain('refresh_rejected_malformed');
    expect(kinds).toContain('refresh_rejected_unknown');
    expect(kinds).toContain('refresh_rejected_expired');
    expect(kinds).toContain('refresh_reuse_detected');
```

Hmm — the `expired` presentation: `rotated.body.refreshToken` after advancing the clock. The session is expired → expired check before retired → `refresh_rejected_expired`, no wipe. Good.

The `retired` presentation: the original token — is the session still expired at that point? Order: I advanced the clock past the deadline *before* the retired presentation. Then the retired presentation: token found → step 3 expired check fires first (session expired) → audit is `expired`, not reuse! That breaks the intent (I want a "retired" case). Fix the order: present the retired token *before* advancing the clock. Reorder: malformed, unknown, retired, then advance the clock, then expired.

But wait, the retired presentation triggers a family wipe — which wipes `rotated.body.refreshToken`. Then the expired presentation of `rotated.body.refreshToken`: token still *found* (it exists, retired), session expired → step 3 → expired. Good — still found, so the expired audit works regardless of retirement. The order: malformed → unknown → retired (401, wipe) → advance clock → expired (401). All four 401s, same envelope, and the audit kinds present.

Test 5: cookie source + precedence.

```ts
  it('accepts the token from the refresh_token cookie', async () => {
    const session = await service.issueSession('user-cookie');
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('cookie', [`refresh_token=${session.refreshToken}`])
      .send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.refreshToken).toBe('string');
  });
```

Note: sending `.set('cookie', ...)` and `.send({})` — with an empty JSON body; does the cookie header get through? Supertest: `.set('cookie', 'refresh_token=...')`. And `.send({})` sets a JSON body. The controller reads the body's refreshToken → undefined → falls back to the cookie. Good.

Precedence test:

```ts
  it('lets the body token win over the cookie when both are present', async () => {
    const bodySession = await service.issueSession('user-body');
    const cookieSession = await service.issueSession('user-cookie2');

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('cookie', [`refresh_token=${cookieSession.refreshToken}`])
      .send({ refreshToken: bodySession.refreshToken });

    expect(res.status).toBe(200);
    // The body token was rotated (retired); the cookie token is untouched.
    const bodyRotated = await post({ refreshToken: bodySession.refreshToken });
    expect(bodyRotated.status).toBe(401); // retired → reuse
    const cookieStillWorks = await post({ refreshToken: cookieSession.refreshToken });
    expect(cookieStillWorks.status).toBe(200);
  });
```

Hmm wait: bodySession's token is rotated → presenting it again → retired → wipe → 401. cookieSession's token: untouched → 200. This proves the body won.

Also a test: body present but invalid, cookie valid → malformed rejection (body is authoritative):

```ts
  it('rejects when the body token is malformed even if the cookie holds a valid one', async () => {
    const session = await service.issueSession('user-bodybad');
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('cookie', [`refresh_token=${session.refreshToken}`])
      .send({ refreshToken: 'garbage' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(ENVELOPE);
    // The cookie token survived (no wipe happened for a malformed body).
    const still = await post({ refreshToken: session.refreshToken });
    expect(still.status).toBe(200);
  });
```

Nice behavior coverage. And a "no token at all" test → 401 envelope:

Maybe fold into the comparison test? Add a small one:

```ts
  it('rejects when no token is presented at all', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual(ENVELOPE);
  });
```

And a success test (the happy path is needed as a baseline):

```ts
  it('rotates a valid token: new pair, old token retired', async () => {
    const session = await service.issueSession('user-rotate');
    const res = await post({ refreshToken: session.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
    // The old token is retired
    const old = await post({ refreshToken: session.refreshToken });
    expect(old.status).toBe(401);
  });
```

Hmm, that last part overlaps with the replay test but is the minimal happy+retire assertion. Fine — or fold it into the rotation test and skip the extra. I'll keep it; it directly asserts requirement 1.

Wait — note: after `old` → 401 reuse → family wipe → the new token (res.body.refreshToken) is also killed. The test doesn't use it afterwards. Fine.

Now — `post` helper: `function post(payload: Record<string, unknown>) { return request(app.getHttpServer()).post('/auth/refresh').send(payload); }`. Type: supertest's Response.

TS strict: `rotated.body.refreshToken` — body is `any` in supertest. Fine under strict (any is allowed).

`prisma.session.findUnique(...)` returns `Session | null` — use `!` after non-null assertion. OK.

Now — the ENVELOPE constant must exactly match the controller's REJECTION_BODY. The message string: "The presented refresh token could not be validated." Both files must use the same. Risk of duplication: the test defines its own copy — acceptable (it's a contract assertion). To avoid drift, the test could import REJECTION_BODY from the controller... importing a controller-internal constant into a test is a bit implementation-leaning; a contract test should hardcode the expected shape. I'll hardcode it in the test (contract) and keep the controller's copy identical.

Now the package.json:

```json
{
  "name": "refresh-token-rotation",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "vitest run",
    "prisma:migrate": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@prisma/client": "^5.10.0",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.3.0",
    "@nestjs/testing": "^10.3.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.10.0",
    "supertest": "^6.3.4",
    "typescript": "^5.3.3",
    "vitest": "^1.2.0"
  }
}
```

Nest 10 + Node 20 is fine. Do I need @nestjs/cli for start:dev? If it's just for convenience; drop it to keep deps lean? "Do not create files it doesn't ask for" applies to files, not deps. Lean is better: drop @nestjs/cli, drop the start:dev script. `start` requires a build to dist with main.ts as the entry. tsconfig with outDir dist.

tsconfig.json:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": false,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

Hmm — `"module": "NodeNext"` with ESM: NestJS + decorators + NodeNext requires `.js` extensions on relative imports! That's a pain: `import { AppModule } from './app.module.js'`. Under `"type": "module"` and NodeNext, TS requires extensions on ESM imports. Nest's TS docs recommend `"module": "commonjs"` even with type module? No — the convention here is ESM `"type": "module"`. Nest supports ESM. With NodeNext ESM, all relative imports need the `.js` suffix. That's valid and works with `tsc` output. But vitest is... vitest handles both fine.

Hmm, but do I want to force `.js` extensions in src? Under the strict ESM convention, yes: `import { AppModule } from './app.module.js'`. It's the correct NodeNext ESM style. Alternatively, `"module": "ESNext"` + `"moduleResolution": "Bundler"` — no extensions needed, but then the output of `tsc` won't run directly under node ESM (the emitted imports lack extensions → node fails). Since `"type": "module"` and we want `node dist/main.js` to work, NodeNext is the honest choice, with `.js` suffixes on relative imports.

Hmm wait, but Prisma client with NodeNext... `@prisma/client` has proper exports. Fine.

supertest import: `import request from 'supertest';` — CJS default interop, fine with esModuleInterop + NodeNext.

Actually, let me reconsider: is `node dist/main.js` a required runtime? main.ts is a conventional file; the grader might just run tests. I'll keep NodeNext + `.js` extensions — correct ESM.

Hmm, one gotcha: `reflect-metadata` — Nest requires `import 'reflect-metadata';` at the entry (main.ts). I'll add it to main.ts.

Now — does vitest need a config? Vitest handles TS out of the box; no config needed. But decorators: vitest uses esbuild — esbuild supports TS decorators *only* if `experimentalDecorators` is enabled in tsconfig (esbuild reads tsconfig). Vitest reads tsconfig for esbuild options — yes, vitest's esbuild picks up `experimentalDecorators` from tsconfig. `emitDecoratorMetadata` — esbuild does *not* emit decorator metadata! Nest DI relies on `emitDecoratorMetadata` (design:paramtypes) for constructor injection... In my design, the service constructor: `constructor(private readonly tokens: RefreshTokenRepository, ...)` — Nest needs to resolve `RefreshTokenRepository` from the metadata `design:paramtypes`. Without metadata (esbuild/vitest), Nest can't resolve it!

This is a classic Nest+ESM/vitest problem. Solutions:
1. `@Inject()` decorator with the token — explicit, metadata-free.
2. `useValue` override in tests → the provider is overridden, but Nest still needs to know *which* provider the controller depends on for resolution... actually with `.overrideProvider(X).useValue(...)` in the testing module, Nest still needs to know the controller depends on X. Without paramtypes metadata, Nest throws "Nest can't resolve dependencies" or treats it as an empty dependency list.

Hmm. How do people do Nest testing under vitest? Options: use `@Inject` decorators with explicit class tokens:

```ts
constructor(@Inject(RefreshTokenRepository) private readonly tokens: RefreshTokenRepository, ...)
```

Wait, `@Inject(Token)` provides the DI token explicitly — works without metadata! `@Inject(RefreshTokenRepository)` — the class itself as the token. Yes — that's the metadata-free approach. It works under both tsc (with or without metadata) and esbuild/vitest.

So: in the controller: `constructor(@Inject(RefreshService) private readonly service: RefreshService) {}`. In the service: `@Inject(RefreshTokenRepository)`. In the repository: the prisma default parameter — no DI needed (default value).

And in the testing module: `overrideProvider(RefreshTokenRepository).useValue(repo)` — the controller's constructor param is annotated with `@Inject(RefreshService)`; the service is overridden with my instance. The resolution uses the explicit token. Works without metadata.

For *production* runtime (tsc-compiled with emitDecoratorMetadata), `@Inject` also works fine. So use `@Inject` everywhere for constructor dependencies. Slightly unusual, but correct and portable. I'll add a brief comment: explicit `@Inject` keeps DI metadata-free so the same source works under tsc (metadata on) and esbuild/vitest (no metadata emission).

Hmm — is that over-engineering? The alternative is a vitest config using `unplugin-swc` or swc with decorator metadata — a vitest.config.ts file + swc deps — heavier. `@Inject` is simpler. Going with `@Inject`.

Also, the `@Controller('auth')`/`@Post('refresh')` decorators work under esbuild (they're just decorator calls, no metadata needed). `@Body()`, `@Headers()`, `@Res()` — parameter decorators, fine.

Now, `@Res({ passthrough: true }) res: Response` — the type import `import type { Response } from 'express';` needs @types/express (in devDeps). Good.

Now, let me re-check the Nest + supertest flow: `app.getHttpServer()` returns the express instance; supertest posts JSON; the body parser — Nest's express app auto-adds a global body parser? Let me recall: `NestExpressApplication` in `@nestjs/platform-express` — its `createHttpServer` calls... In recent Nest versions, the express adapter applies `express.json()` and `express.urlencoded()` by default (there's an `app.useBodyParser(options)` called in NestFactory.create? hmm). Actually, I recall: Nest applies the body parser automatically in the express platform since v7 ("Body Parser Middleware" — enabled by default, `NestFactory.create(AppModule, { bodyParser: false })` to disable). Yes — Nest's express adapter uses `app.use(express.json()); app.use(express.urlencoded())` by default in `createNestApplication`. I'm fairly sure JSON parsing works in supertest tests out of the box. (Common in the Nest docs' e2e examples: `supertest(app.getHttpServer()).post('/').send({ ... })` works without extra setup.) Good.

Now the cookie header from supertest: `.set('cookie', 'refresh_token=abc')` — sent as-is. The controller reads `@Headers('cookie')`. Good.

Set-Cookie assertion: on success, `res.headers['set-cookie']` is an array (Express sets one). I'll assert `expect(ok.headers['set-cookie'].join()).toContain('refresh_token=rt_')`. On rejection, it contains 'refresh_token=;'. Let me confirm the express res.cookie output: `refresh_token=; Path=/; Expires=...`? With maxAge 0 → `Expires` is in the past or `Max-Age=0`? Express: with maxAge → sets `Max-Age=0`? Actually express's res.cookie: if maxAge is specified, it sets `Max-Age` and computes expires. Hmm: express's cookie.serialize: with `maxAge: 0` → sets `Max-Age=0`? Let me recall cookie.serialize's behavior: `if (options.maxAge != null) { maxAge = ...; opts.maxAge = maxAge; }` and the cookie library: with maxAge 0 → `expires` is now+0 → it outputs `Expires=...`? The `cookie` package: if maxAge is provided, sets expires = now + maxAge. Output includes `Expires=<date>`, and `Max-Age` too? The cookie library's serialize: when maxAge is provided, it sets expires = now + maxAge. I don't think it outputs Max-Age (older versions); newer cookie versions output `Max-Age` when maxAge is given? Let's not over-assert: I'll assert the joined header contains `refresh_token=;` and *not* `refresh_token=rt_`. That's robust.

On success: the header contains `refresh_token=rt_`.

Now — the `refresh` endpoint returns 200 with a JSON body + set-cookie. `@HttpCode(200)` — POST defaults to 201, so I explicitly set 200.

Now, let me think about: `details: {}` — in the envelope, details is an object, never null. My REJECTION_BODY has `details: {}`. Nest JSON-serializes it fine.

Also — the 500 path (DB down): Nest's default exception filter returns `{"message":...,"error":...,"statusCode":500}` — not our envelope. The task's envelope is "the" error envelope for rejections; the spec only requires that *rejections* are indistinguishable. A 500 on infra failure is different (and honestly shouldn't be disguised). I won't add a global exception filter (not asked for). Hmm — "Errors — a single envelope" is a *codebase convention*: all errors use the envelope. Should I add a global filter to normalize 500s? That's scope creep beyond the task; the convention holds for the errors the feature produces. But if the DB is down, the caller gets a non-envelope 500 — is that a leak? It's an infrastructure failure; distinguishable from a rejection... an attacker can crash the DB to get a 500 and learn "the token was valid"? No — a 500 could happen at any point in the flow. Not a meaningful oracle. Skip the global filter; keep the discipline. Actually... hmm, let me reconsider. The convention is stated as a stack-level rule ("Errors — a single envelope"). A minimal `ExceptionFilter` in the refresh module? A module-scoped filter (`app.useGlobalFilters` is app-level; a filter in the module's providers applies to that module's exceptions). I could add a small `AllExceptionsFilter` that wraps any thrown error in the envelope with a code `internal_error` for non-refresh errors... that's an extra file not asked for. The task's deliverables are specific. I'll skip it and note nothing. The four rejection kinds — all rejections — are indistinguishable, which is the requirement. Fine.

Wait, actually, one more: unknown exceptions from the service (e.g., Prisma errors) propagate to Nest → 500 with the default body. OK, skip.

Now — `SECURITY.md` line count constraint: 15–25 lines. Let me write it and count exactly.

Draft:

```
# Security notes — refresh token rotation

`RefreshService.refresh` runs these checks in this order, and no other order is
safe:

1. **Malformed.** Structural shape (`rt_` + 43 base64url chars) is checked
   first: it is free, and garbage must not cost a database round trip.
2. **Unknown.** The token is looked up by its SHA-256 digest; plaintext is
   never stored. A well-formed token with no row is unknown.
3. **Expired.** The absolute deadline is fixed at sign-in and rotation never
   extends it. Expired is checked *before* retired: a stale client presenting
   a token after natural death is not evidence of compromise, and wiping an
   already-dead family would be pointless churn.
4. **Retired (reuse).** A retired token in a caller's hand is compromise by
   definition — only a rotation retires a token, so holding a retired one
   means a copy was stolen or duplicated. Every token descended from the same
   sign-in is retired and `refresh_reuse_detected` is recorded.
5. **Atomic claim.** `UPDATE ... WHERE retired_at IS NULL` is the only step
   that guarantees "exactly one rotates" under concurrency; every earlier
   check is advisory. The loser of the claim takes the step-4 path: a
   duplicate retry is indistinguishable from a stolen-token replay, so it is
   treated as compromise and the family — including the winner's fresh token
   — dies, forcing a clean re-authentication.

All four rejection kinds return the same 401, the same envelope
(`error.code = "refresh_token_rejected"`, same message, `details: {}`) and the
same cookie-clearing `Set-Cookie`. Only the audit row's `kind`
(`refresh_rejected_malformed` / `_unknown` / `_expired` / `refresh_reuse_detected`)
distinguishes them, so no caller can fingerprint which tokens are valid,
stale or stolen.
```

Let me count the lines:
1 `# Security notes — refresh token rotation`
2 (blank line)
3 `` `RefreshService.refresh` runs these checks in this order, and no other order is ``
4 `safe:`
5 (blank line)
6 `1. **Malformed.** ...`
7 `   first: it is free, and garbage must not cost a database round trip.`
8 `2. **Unknown.** ...`
9 `   never stored. ...`
10 `3. **Expired.** ...`
11 `   extends it. Expired is checked *before* retired: ...`
12 `   already-dead family would be pointless churn.`
13 `4. **Retired (reuse).** ...`
14 `   definition — only a rotation retires a token, ...`
15 `   means a copy was stolen or duplicated. ...`
16 `5. **Atomic claim.** ...`
17 `   that guarantees "exactly one rotates" ...`
18 `   check is advisory. The loser of the claim ...`
19 `   treated as compromise ...`
20 `   — dies, forcing a clean re-authentication.`
21 (blank line)
22 `All four rejection kinds return the same 401, ...`
23 `(`error.code = "refresh_token_rejected", ...`
24 `same cookie-clearing `Set-Cookie`. Only the audit row's `kind``
25 `distinguishes them, so no caller can fingerprint ...`

Exactly 25 lines. Tight. To be safe, I'll trim to about 20–22 lines so any counting quirk (trailing newline) stays in range. Let me compress:

```
# Security notes — refresh token rotation

`RefreshService.refresh` checks, in this order, and no other order is safe:

1. **Malformed** — shape (`rt_` + 43 base64url chars) is free to test, and
   garbage must not cost a database round trip.
2. **Unknown** — lookup by SHA-256 digest; plaintext is never stored. A
   well-formed token with no row is unknown.
3. **Expired** — the absolute deadline is fixed at sign-in and rotation never
   extends it. Checked *before* retired: a stale client presenting a token
   after natural death is not evidence of compromise, and wiping a dead
   family is pointless churn.
4. **Retired (reuse)** — a retired token in a caller's hand is compromise:
   only a rotation retires a token, so holding a retired one means a copy was
   stolen or duplicated. Every token descended from the same sign-in is
   retired and `refresh_reuse_detected` is recorded.
5. **Atomic claim** — `UPDATE ... WHERE retired_at IS NULL` is the only step
   that guarantees exactly one rotation under concurrency; earlier checks are
   advisory. The claim's loser takes path 4: a duplicate retry is
   indistinguishable from a stolen-token replay, so it is treated as
   compromise and the family — winner's fresh token included — dies.

All four rejections return the same 401, the same envelope
(`error.code = "refresh_token_rejected"`, identical message, `details: {}`)
and the same cookie-clearing `Set-Cookie`. Only the audit row's `kind`
(`refresh_rejected_malformed` / `_unknown` / `_expired` / `refresh_reuse_detected`)
distinguishes them, so callers cannot fingerprint which tokens are valid,
stale or stolen.
```

Count:
1 `# Security notes — refresh token rotation`
2 ``
3 `` `RefreshService.refresh` checks, in this order, and no other order is safe: ``
4 ``
5 `1. **Malformed** — ...`
6 `   garbage must not cost...`
7 `2. **Unknown** — ...`
8 `   well-formed token with no row is unknown.`
9 `3. **Expired** — ...`
10 `   extends it. Checked *before* retired: ...`
11 `   after natural death is not evidence...`
12 `   family is pointless churn.`
13 `4. **Retired (reuse)** — ...`
14 `   only a rotation retires a token, ...`
15 `   stolen or duplicated. Every token descended...`
16 `   retired and `refresh_reuse_detected` is recorded.`
17 `5. **Atomic claim** — ...`
18 `   that guarantees exactly one rotation...`
19 `   advisory. The claim's loser takes path 4: ...`
20 `   indistinguishable from a stolen-token replay, ...`
21 `   compromise and the family — winner's fresh token included — dies.`
22 ``
23 `All four rejections return the same 401, ...`
24 `(`error.code = "refresh_token_rejected", ...`
25 `and the same cookie-clearing `Set-Cookie`. ...`
26 `(`refresh_rejected_malformed` / `_unknown` / ...`
27 `distinguishes them, ...`
28 `stale or stolen.`

28 lines — too many. Trim the last paragraph:

```
All four rejections return the same 401, the same envelope
(`error.code = "refresh_token_rejected"`, identical message, `details: {}`)
and the same cookie-clearing `Set-Cookie`; only the audit row's `kind`
distinguishes them, so callers cannot fingerprint valid, stale or stolen
tokens.
```

5 lines (23–27). Total = 27? Let me recount with the trimmed tail:

Lines:
1. `# Security notes — refresh token rotation`
2. ``
3. `` `RefreshService.refresh` checks, in this order, and no other order is safe: ``
4. ``
5. `1. **Malformed** — shape (`rt_` + 43 base64url chars) is free to test, and`
6. `   garbage must not cost a database round trip.`
7. `2. **Unknown** — lookup by SHA-256 digest; plaintext is never stored. A`
8. `   well-formed token with no row is unknown.`
9. `3. **Expired** — the absolute deadline is fixed at sign-in and rotation`
10. `   never extends it. Checked *before* retired: a stale client presenting a`
11. `   token after natural death is not evidence of compromise, and wiping a`
12. `   dead family is pointless churn.`
13. `4. **Retired (reuse)** — a retired token in a caller's hand is compromise:`
14. `   only a rotation retires a token, so holding a retired one means a copy`
15. `   was stolen or duplicated. Every token descended from the same sign-in`
16. `   is retired and `refresh_reuse_detected` is recorded.`
17. `5. **Atomic claim** — `UPDATE ... WHERE retired_at IS NULL` is the only`
18. `   step that guarantees exactly one rotation under concurrency; earlier`
19. `   checks are advisory. The claim's loser takes path 4: a duplicate retry`
20. `   is indistinguishable from a stolen-token replay, so it is treated as`
21. `   compromise and the family — winner's fresh token included — dies.`
22. ``
23. `All four rejections return the same 401, the same envelope`
24. `(`error.code = "refresh_token_rejected"`, identical message, `details: {}`)`
25. `and the same cookie-clearing `Set-Cookie`; only the audit row's `kind``
26. `distinguishes them, so callers cannot fingerprint valid, stale or stolen`
27. `tokens.`

27 lines. Still over 25. Cut more. Combine the intro lines: drop the blank line after the heading? Markdown headings usually want a blank line, but for line count... I can tighten the prose. Target ≤25.

Rewrite more tightly:

```
# Security — refresh token rotation

`RefreshService.refresh` checks in this order, and no other order is safe:

1. **Malformed** — shape (`rt_` + 43 base64url chars) is free to test and
   must not cost a database round trip.
2. **Unknown** — lookup by SHA-256 digest; plaintext is never stored.
3. **Expired** — the deadline is fixed at sign-in; rotation never extends
   it. Checked *before* retired: a stale client presenting a token after
   natural death is not compromise, and wiping a dead family is churn.
4. **Retired (reuse)** — only a rotation retires a token, so a retired token
   in a caller's hand is compromise. Every token descended from the same
   sign-in is retired and `refresh_reuse_detected` is recorded.
5. **Atomic claim** — `UPDATE ... WHERE retired_at IS NULL` alone guarantees
   exactly one rotation under concurrency; earlier checks are advisory. The
   loser takes path 4: a duplicate retry is indistinguishable from a stolen
   replay, so the family — winner's fresh token included — dies.

All four rejections return the same 401, the same envelope (`error.code`
`refresh_token_rejected`, identical message, `details: {}`) and the same
cookie-clearing `Set-Cookie`; only the audit row's `kind` distinguishes
them, so callers cannot fingerprint valid, stale or stolen tokens.
```

Count:
1 `# Security — refresh token rotation`
2 ``
3 `` `RefreshService.refresh` checks in this order, and no other order is safe: ``
4 ``
5 `1. **Malformed** — shape (`rt_` + 43 base64url chars) is free to test and`
6 `   must not cost a database round trip.`
7 `2. **Unknown** — lookup by SHA-256 digest; plaintext is never stored.`
8 `3. **Expired** — the deadline is fixed at sign-in; rotation never extends`
9 `   it. Checked *before* retired: a stale client presenting a token after`
10 `   natural death is not compromise, and wiping a dead family is churn.`
11 `4. **Retired (reuse)** — only a rotation retires a token, so a retired token`
12 `   in a caller's hand is compromise. Every token descended from the same`
13 `   sign-in is retired and `refresh_reuse_detected` is recorded.`
14 `5. **Atomic claim** — `UPDATE ... WHERE retired_at IS NULL` alone guarantees`
15 `   exactly one rotation under concurrency; earlier checks are advisory. The`
16 `   loser takes path 4: a duplicate retry is indistinguishable from a stolen`
17 `   replay, so the family — winner's fresh token included — dies.`
18 ``
19 `All four rejections return the same 401, the same envelope (`error.code``
20 `` `refresh_token_rejected`, identical message, `details: {}`) and the same ``
21 `cookie-clearing `Set-Cookie`; only the audit row's `kind` distinguishes`
22 `them, so callers cannot fingerprint valid, stale or stolen tokens.`

22 lines. Within 15–25.

Now, let me reconsider the "which wins" documentation requirement: "define and document which wins when both are present." I document it in the controller's JSDoc on the extraction function. Should I also mention it in SECURITY.md? SECURITY.md is about check order (15–25 lines) — I won't add it. The controller JSDoc is the documentation. Fine.

Now let me re-verify the layering rules:
- Controller: parses cookie header, extracts the token with precedence, calls the service, shapes the HTTP response (status, cookie, envelope). No business logic. ✓ (extraction is input handling; the *classification* malformed/unknown is in the service).
- Service: all logic; no Prisma calls — calls repository methods. ✓
- Repository: only Prisma. ✓

Naming: files `refresh.module.ts`, `refresh.controller.ts`, `refresh.service.ts`, `refresh.repository.ts` — kebab-case.role.ts ✓. Classes: `RefreshModule`, `RefreshController`, `RefreshService`, `RefreshTokenRepository` ✓. Endpoint: `auth/refresh` — kebab-case, but singular (the task explicitly says `POST /auth/refresh`; the task overrides the plural convention). Table/columns are snake_case via @map ✓.

Now, potential compilation issues to double-check:

1. `import { PrismaClient } from '@prisma/client';` — requires the generated client (after `prisma generate`). In the delivered repo, `@prisma/client`'s postinstall runs generate if a schema is present. Fine; I'll note it in a comment? The package.json's `postinstall: "prisma generate"` script is standard. Add it.

2. ESM + NodeNext `.js` import suffixes — every relative import in src needs `.js`. In the test files (consumed by vitest, not tsc-build... tsconfig `include: ["src"]` excludes test → the test files aren't compiled by the build; vitest transpiles them on the fly, no extensions needed). But tsconfig excludes test → if someone runs `tsc --noEmit` at the root, the test types aren't checked... acceptable. I could include test in tsconfig with a separate config... keep it simple: `include: ["src"]`, tests are type-checked by vitest/esbuild (no full type-checking). Hmm — that means type errors in tests go unnoticed... but esbuild fails on syntax; type errors are silent. Fine for a deliverable.

Actually wait — I should double-check that vitest + decorators work with a tsconfig that has `experimentalDecorators: true`. Vitest's esbuild reads tsconfig.json's compilerOptions.experimentalDecorators. Yes, vitest passes it (esbuild's `tsconfigRaw`). Confirmed working in practice.

3. Nest DI with `@Inject` + default constructor parameters:

```ts
@Injectable()
export class RefreshService {
  constructor(
    @Inject(RefreshTokenRepository) private readonly tokens: RefreshTokenRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly sessionTtlMs: number = defaultSessionTtlMs(),
  ) {}
}
```

Nest resolution: for each constructor parameter, it looks at the injected token metadata. With `@Inject(RefreshTokenRepository)` → token = the class. Parameters 2 and 3 have defaults → Nest's `getInstanceToken`... hmm, how does Nest decide to skip a parameter? It uses the reflected `design:paramtypes` metadata (undefined under esbuild) or checks... let me think carefully. Nest's `WrapperHost`/`Injector`: `loadPerContext`... The relevant logic: `injectable`'s dependencies come from `this.getDependencies(metadata)`, which reads `Reflect.getMetadata('design:paramtypes', constructor)`. Under tsc with emitDecoratorMetadata, paramtypes = [RefreshTokenRepository, Function, Number]. With the `@Inject` decorator, paramtypes[0] is overridden by the explicit token. For params 1 and 2 (Function, Number): does Nest try to resolve `Function`?? That would fail!

Wait — no. Nest's handling of default values: in `Injector.loadInstance` / `getInstanceByCallback`... let me recall the actual code path. `NestInjector.loadInstance`:

```ts
const dependencies = this.getDependenciesMetadata(instanceClass, ...);
...
```

`getDependenciesMetadata` reads the 'dependencies' custom metadata, then falls back to `design:paramtypes`. For each dependency: `dependency.token` — the token of a parameter with `@Inject` is explicit; otherwise, it's the paramtype. But there's special handling: `if (paramtype === Object || paramtype === undefined)` → skip? Hmm.

Actually, I recall the specific behavior: **NestJS supports constructor parameters with default values** — documented: "If you're using constructor parameter with a default value, Nest.js will skip the dependency injection" — hmm, is that documented? Let me think... The Nest docs (DI, "constructor parameter with default value"?) I recall there being support: in `getDependencies`, Nest checks `Reflect.getMetadata('design:paramtypes')`; parameters with default values have their paramtype... with esbuild (no metadata), paramtypes is undefined → Nest treats all parameters as unresolvable unless `@Inject` is present. With tsc metadata, paramtypes includes Function/Number.

The real mechanism (Nest source, `inquirer`... let me recall `constants`/`dependencies`): in `NestContainer.loadInstanceOfWrapper`... I remember the function:

```ts
private getDependenciesMetadata(...): { index: number; wrapper: { token } }[] {
  ...
  const paramsTypes = Reflect.getMetadata(PARAMTYPES_METADATA, constructor);
  ...
  paramsTypes.forEach((paramType, index) => {
    const isCustomDependency = Reflect.getMetadata(OPTIMIZE_METADATA... 
    const paramToken = ...;
    if (paramType === Object || (paramToken === undefined && isNil(paramType))) return; // skip
    ...
  });
}
```

Hmm, specifically I recall: `if (paramType === Object) return;` — parameters with default values have their paramtype as `Object` in emitted metadata? No... with `tsc`, `constructor(a: A, b: string = 'x')` → design:paramtypes = [A, String]. Nest would try to resolve `String` → fail with "Nest can't resolve dependencies of the RefreshService (?, ?, ?)".

Hmm wait, but I clearly recall people injecting values with default constructors in Nest... let me think about what actually happens. I remember the Nest issue discussion: "constructor parameter with a default value" — Nest's docs mention that default values in constructor parameters are not supported for DI, and you should use a factory provider instead? Hmm.

Actually — I remember now! There is special handling. In `NestInjector.getDependenciesMetadata` (packages/core/injector/injector.ts? or `scanner`/`module`):

Looking at the @nestjs/core source (v10), `NestInjector` has:

```ts
public getInstanceByCallback(callback: Type<any> | Function, collectionKey?: string, instantiable = true, inquirer?: Function) { ... }
```

And `loadInstance`:

```ts
const dependencies = this.getDependenciesMetadata(instanceClass, moduleRef, instanceWrapper, enhancers, ...);
```

`getDependenciesMetadata` → `getInstanceToken`... I recall the line:

```ts
private getDependenciesMetadata(...) {
  ...
  const paramsTypes = Reflect.getMetadata(PARAMTYPES_METADATA, constructor);
  const customInject = Reflect.getMetadata(INJECT_METADATA, constructor);
  ...
  paramsTypes.forEach((paramType, index) => {
    const isCustom = customInject && index in customInject;
    const isVarArgParams = paramType === Object && paramsTypes.length === 1;
    if (!isVarArgParams && (paramType === Object || isNil(paramType))) {
      // "Nest cannot create the module instance. The module ... is not defined" — no...
    }
    ...
  });
}
```

Hmm, I really don't remember exactly whether a parameter with a default value is skipped. Let me think of concrete experience: I've definitely seen Nest code like:

```ts
constructor(@Inject(CONFIG) private config: ConfigService = new ConfigService()) 
```

Hmm. There *is* a documented pattern... the Nest docs "Dependency Injection" → "Custom Providers" mention using default values? I recall the doc line: "you can also use a default value in a constructor parameter" — hmm.

Let me approach from another angle: avoid the uncertainty entirely. Instead of default parameters, make the dependencies explicit and DI-safe:

Option: provide the clock and TTL as injectable tokens with defaults in the module:

That bloats the module. Alternative: have the service read env/config internally, and make the clock injectable *only via a static test seam*:

```ts
@Injectable()
export class RefreshService {
  constructor(@Inject(RefreshTokenRepository) private readonly tokens: RefreshTokenRepository) {}

  private now(): Date { return (RefreshService as any).__now ? ... }
```

Ugly. Cleaner: **inject the clock as a provider in the module**. Add a small injectable `ClockProvider`? That's an extra class/file...

Hmm, wait. Actually, let me recall more specifically, since it really matters. Nest core, `injector.ts` (v9/10), method `getDependenciesMetadata`:

```ts
private getDependenciesMetadata(
    instanceClass: Type<Function>,
    moduleRef: Module,
    instanceWrapper: InstanceWrapper<Function>,
    enhancers: Enhancers,
    scope?: Scope,
  ): EnhancedInstanceWrapper<Function>[] {
    const dependencies = instanceWrapper.injectProperties || {};
    const { prototype } = instanceClass;
    const callback = prototype && prototype.constructor;
    ...
    const paramsTypes = Reflect.getMetadata(PARAMTYPES_METADATA, callback) || [];
    const customInject = Reflect.getMetadata(INJECT_METADATA, callback);
    const customParams = Reflect.getMetadata(PARAMS_METADATA, callback);
    const forwardRefTokens = Reflect.getMetadata(FORWARD_REF_METADATA, callback);
    const isCustomProvider = isCustomToken(instanceWrapper.token);
    const collection = instanceWrapper.isDependency
      ? ...
    paramsTypes.forEach((paramType, index) => {
      const isCustom = customInject && index in customInject;
      const isVarArgParams = paramType === Object && paramsTypes.length === 1;
      if (!isVarArgParams && (paramType === Object || isNil(paramType))) {
        if (forwardRefTokens?.[index]) {
          this.addDependency...
        }
        return; // ← I think this exists: skip Object/undefined paramtypes
      }
      const paramToken = isCustom ? (customInject as any)[index] : paramType;
      ...
    });
    return dependencies;
}
```

I'm fairly sure there's a `return` for `paramType === Object || isNil(paramType)`. The question: what does tsc emit for `b: string = 'x'`? design:paramtypes emits the *declared type* `String` — not Object. So it would *not* be skipped, and Nest would try to resolve the token `String` → no provider `String` → error "Nest can't resolve dependencies".

Hmm, but wait — is that really true? There *is* a known Nest behavior: "parameters with default values are ignored by DI" — I've seen it in the Nest docs under "constructor parameter with default value"... Let me search my memory: Nest docs, "Dependency Injection" chapter, section "Custom decorators"... I recall a GitHub issue #3932 "Default value in constructor" and the answer was...

Honestly, I can't be 100% sure. Risk mitigation: **don't use default constructor parameters for injectable services.** Restructure:

- `RefreshService` constructor: only `@Inject(RefreshTokenRepository) tokens`.
- Clock: the service uses `Date.now()` by default; for tests, allow override via a *static* or instance property set before use? Tests can do `(service as any).clock = fake` — a bit hacky but common in tests... but "test behavior not implementation" — poking private seams is implementation-leaning. Hmm.

Better: **make the clock an injectable provider**. The clean Nest way:

```ts
// refresh.module.ts
providers: [
  RefreshService,
  RefreshTokenRepository,
  { provide: REFRESH_CLOCK, useValue: () => new Date() },  // token
]
```

And the service: `constructor(@Inject(RefreshTokenRepository) ..., @Inject(REFRESH_CLOCK) private readonly now: () => Date)`.

But then the TTL (env-based) — the service reads env directly inside a method? `sessionTtlMs` from env at call time: fine, no injection needed: `private get ttlMs() { return sessionTtlMsFromEnv(); }` — read `process.env` on each call (cheap, env can be read at call time; for the default case). Tests that need a custom TTL... the deadline test needs a *known* TTL to advance the clock. If TTL is read from env, the test can set `process.env.REFRESH_SESSION_TTL_SECONDS = '60'` in beforeAll and read it as 60000ms. Then the fake clock advance is deterministic. That works without injecting the TTL!

So:
- Clock: inject via a token `REFRESH_CLOCK` (a `() => Date`), default in the module `{ provide: REFRESH_CLOCK, useValue: () => new Date() }`. Tests override with a fake. Clean, DI-idiomatic, no default parameters, no metadata worries.
- TTL: read from `process.env.REFRESH_SESSION_TTL_SECONDS` (default 30 days) in the service. Tests set the env var.

Hmm, is the clock token over-engineered? It's the standard Nest pattern for time injection. And it keeps `issueSession` deterministic in tests. I think it's clean and defensible. Export the token constant from the service file: `export const REFRESH_CLOCK = 'REFRESH_CLOCK';`

Wait, but then the tests construct the app via Test.createTestingModule with the module import + clock override:

```ts
.overrideProvider(REFRESH_CLOCK).useValue(() => new Date(nowMs))
.overrideProvider(RefreshTokenRepository).useValue(repo)
```

And `service` — I need the service instance for `issueSession`. Get it from the compiled module: `const service = app.get(RefreshService);` — the *real* service (with the fake clock via the overridden provider, and the real repository via the override). Then tests call `service.issueSession(...)` and hit HTTP.

So the test no longer manually constructs the service — better, more "black-box." And no constructor with default parameters anywhere:

- `RefreshService(@Inject(RefreshTokenRepository) tokens, @Inject(REFRESH_CLOCK) now)` — both explicit `@Inject`. ✓ Metadata-free safe.
- `RefreshController(@Inject(RefreshService) service)` — explicit. ✓
- `RefreshTokenRepository()` — no constructor dependencies (PrismaClient constructed inside). Hmm — but the test wants to share a PrismaClient with the repository for cleanup. The repository constructs its own `new PrismaClient()`; the test has *another* PrismaClient for deleteMany/findMany. Two clients = two connections — fine for tests. Or the repository constructor accepts an optional client: `constructor(prisma: PrismaClient = new PrismaClient())` — a parameter without a decorator and with a default: Nest with tsc metadata: paramtypes = [PrismaClient, ...]? With a default value, tsc emits `PrismaClient` (the declared type) → Nest tries to resolve PrismaClient → no provider → crash in the real app!

Ugh, the same uncertainty. Safe play: **no constructor parameters at all** on the repository:

```ts
@Injectable()
export class RefreshTokenRepository implements OnModuleDestroy {
  private readonly prisma: PrismaClient;
  constructor() {
    this.prisma = new PrismaClient();
  }
```

Tests: the repository makes its own client; the test has its own client for assertions. Both hit the same DB. Fine — slightly less elegant but zero DI risk. Actually, I can have both: `constructor(private readonly prisma?: PrismaClient)` — optional parameter, no default. Nest with tsc metadata: paramtypes[0] = PrismaClient (class) → tries to resolve → no provider → crash. Optional `?` doesn't change the emitted metadata. So no. Final: `new PrismaClient()` inside the repository constructor, no parameters. Hmm wait — but under esbuild/vitest (no metadata), no problem anyway; the risk is only the *real* app compiled with tsc. So no-parameter constructor is the safe choice for both.

Hmm, actually — wait. Let me re-reconsider whether the `paramType === Object` skip covers default-valued parameters. I now recall more specifically: there's a Nest doc FAQ/GitHub answer: "Nest does not support default values in constructor parameters for DI; use a provider." And I recall the tsc metadata for `b: string = 'x'` being `String`. So Nest tries `String` → `UnknownElementException`? It would throw "Nest can't resolve dependencies of the X (?, ?, ?). Please verify that ... exists." So default parameters are dangerous. My restructure avoids them completely.

And `@Inject` everywhere: even under tsc+metadata, `@Inject(token)` overrides the paramtype — safe. Under esbuild — explicit token — safe.

Now the clock provider in the module:

```ts
providers: [
  { provide: REFRESH_CLOCK, useValue: () => new Date() },
  RefreshService,
  RefreshTokenRepository,
],
exports: [RefreshService, REFRESH_CLOCK]? 
```

Export REFRESH_CLOCK? If another module wants the same clock... not needed. Export only RefreshService. Hmm, but if the sign-in module uses the service, it gets the clock transitively. Fine.

Wait, actually — do I even need the clock as a provider? Alternative: the service reads `Date.now()`, and tests use `vi.useFakeTimers().setSystemTime()`! Vitest's fake timers with `shouldAdvanceTime`... `vi.useFakeTimers({ now: t })` mocks Date.now and `new Date()`. Then the service uses plain `new Date()` — no injection needed at all!

In tests:
```ts
vi.useFakeTimers();
vi.setSystemTime(new Date(baseMs));
// ... act
vi.setSystemTime(new Date(baseMs + 30_000));
```

Does Nest code path + Prisma + fake timers interact? Prisma uses real timers for the network; fake timers only mock the Date/clock used in my assertions. `vi.setSystemTime` mocks `Date` — Prisma client internals might use Date for timestamps (it uses real time via the native binding; vi's fake timers mock the JS Date global — Prisma's query engine is native (Rust) → not affected). `new Date()` in my service → mocked. `Date.now()` → mocked. That works and is a standard Vitest pattern.

That's *cleaner* — no clock provider, no token, no DI gymnastics. The service uses `new Date()` directly. Tests control time with `vi.useFakeTimers()`/`vi.setSystemTime()`.

But a subtlety: with fake timers on, does anything in the Nest/supertest/Prisma stack break (setTimeout, etc.)? `vi.useFakeTimers()` fakes setTimeout, etc. Prisma's JS client uses `setTimeout` for timeouts... during queries, with fake timers *not advancing* (I don't call vi.advanceTimersByTime), pending fake timeouts will never fire — Prisma's query timeout (default 5s, via setTimeout) would never fire with fake timers — fine, I don't want it to fire. But does the query itself complete? The native engine does the work; the promise resolves via microtasks/the engine callback — not via a timer. Supertest/express: uses `setTimeout` for response timeouts? Express's `res.setTimeout`... in practice, Nest+Prisma integration tests under vi.useFakeTimers are a known pain area, but generally work for simple requests if you don't depend on timer firing... hmm, actually there *is* a known issue: supertest uses `setTimeout` for its own request timeout? If the timer is faked and not advanced, the request could hang forever if anything depends on a timer. Express's server keep-alive timers? Hmm.

Risk assessment: vi.useFakeTimers with real I/O is genuinely flaky-prone. The clock injection approach is deterministic and immune to that. I'll go back to clock injection — it's the professional solution for "test rotation against the absolute deadline" and avoids the fake-timer/async-I/O minefield.

Decision: `REFRESH_CLOCK` token, `() => Date`, provided in the module, overridden in tests. The TTL via env read in the service (tests set the env).

Hmm, one more consideration — reading TTL from env in the service method: `sessionTtlMs()` called in `issueSession`. In tests, I set `process.env.REFRESH_SESSION_TTL_SECONDS = '60'` in beforeAll (and delete afterwards? the test process is isolated — fine, set in beforeAll). The service reads it at issueSession time → 60000. Deterministic.

Now the service:

```ts
export const REFRESH_CLOCK: unique symbol? or string constant
```

A string constant is simplest: `export const REFRESH_CLOCK = 'REFRESH_CLOCK';` — hmm, a symbol is safer as a DI token: `export const REFRESH_CLOCK = Symbol('REFRESH_CLOCK');` — and `@Inject(REFRESH_CLOCK)` works with a symbol token. useValue with a symbol provider in the module: `{ provide: REFRESH_CLOCK, useValue: () => new Date() }`. Test: `.overrideProvider(REFRESH_CLOCK).useValue(() => new Date(nowMs))`. Symbols work in overrideProvider. I'll use a symbol.

Now — let me verify the controller again: `@Inject(RefreshService)`.

Now the repository's PrismaClient lifecycle: `onModuleDestroy() { return this.prisma.$disconnect(); }` — the repository is a provider → Nest calls onModuleDestroy on app close. In tests, the `app.close()` in afterAll disconnects it; the test's own client is disconnected separately. Good.

Now — the test module: `imports: [RefreshModule]` + overrides for the repository and the clock. The module's `RefreshTokenRepository` default instantiation (constructor `new PrismaClient()`) — with `overrideProvider(...).useValue(repo)`, the default provider is *replaced* and never instantiated (Nest skips instantiating overridden providers). So no stray PrismaClient is created. Good.

Wait — is that right? With overrideProvider useValue, Nest replaces the provider definition; the original class provider is not instantiated. Yes.

Now — let me double-check the ENVELOPE match and the `UnauthorizedException` behavior: `throw new UnauthorizedException(REJECTION_BODY)` → response 401, body = REJECTION_BODY exactly (Nest uses the passed object as the body). REJECTION_BODY is `as const` — a frozen readonly object; Nest serializes via JSON — fine. But `details: {}` is readonly `{}` — JSON.stringify → `{}`. ✓.

Message: developer-facing English: "The presented refresh token could not be validated." — hmm, "developer-facing" per the convention (message is for developers). It's in the API response but the convention says developer-facing. OK.

Now — the `code`: `refresh_token_rejected` — snake_case ✓.

Now, the *success* response shape: `{ accessToken, refreshToken }` — the task says "returns a new access token and a new refresh token." ✓ Plus a set-cookie.

Now — the issue of the `refresh` route path: the controller `@Controller('auth')` + `@Post('refresh')` → `/auth/refresh` ✓.

Now — package.json scripts: add `prisma:generate` in postinstall. Also `test` = `vitest run`. And maybe `db:migrate` = `prisma migrate deploy`.

Now — do I need `nest-cli.json`? Only for @nestjs/cli; I've dropped the cli. `node dist/main.js` works with tsc build. Keep: build (tsc), start (node dist/main.js), test (vitest run), postinstall (prisma generate), db:migrate (prisma migrate deploy).

Now, `tsconfig.json` — let me finalize:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "declaration": false,
    "noUnusedLocals": false
  },
  "include": ["src/**/*.ts"]
}
```

Wait — `rootDir: src` and only src is included → dist/main.js at the root ✓.

NodeNext + `import { AppModule } from './app.module.js'` — every relative import in src uses `.js`. Let me be careful in each file.

`import 'reflect-metadata';` in main.ts — bare import, fine.

`import { NestFactory } from '@nestjs/core';` etc. — bare, fine.

`import { Response } from 'express'` — type only: `import type { Response } from 'express';`.

In the repository: `import { PrismaClient } from '@prisma/client';` — value (constructor) ✓. Also possibly `import type { Prisma } from '@prisma/client';` for types? I use explicit select shapes; the return type is inferred. `StoredToken` is hand-defined — the inferred type of findUnique with select should structurally match. Let me define:

```ts
export interface StoredToken {
  id: string;
  retiredAt: Date | null;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
}
```

findUnique with that select returns exactly that shape. Assigning the inferred type to `Promise<StoredToken | null>` — compatible ✓.

The Json type of `details`: `SecurityEventCreateInput['details']` is `InputJsonValue`. My `recordEvent` parameter type: `details?: Record<string, unknown>` → passing to prisma create's data: `details: data.details ?? {}` — does `Record<string, unknown>` satisfy `InputJsonValue`? InputJsonValue = string | number | boolean | InputJsonObject | InputJsonArray | { toJSON(): unknown }. `Record<string, unknown>` → is it assignable to InputJsonObject? InputJsonObject = { readonly [Key in string]?: InputJsonValue | null } — `unknown` is *not* assignable to InputJsonValue | null! So `Record<string, unknown>` might fail type-check. Safer: type details as `object` or use `Prisma.InputJsonValue`:

```ts
import type { Prisma } from '@prisma/client';
export interface SecurityEventData {
  sessionId?: string;
  userId?: string;
  kind: string;
  tokenId?: string;
  details?: Prisma.InputJsonValue;
}
```

And the service passes `details: { expiresAt }` — a Date is *not* an InputJsonValue (does Date have toJSON? Prisma's InputJsonValue includes `{ toJSON(): unknown }` — Date has toJSON → assignable? Prisma's docs say Date objects in Json are supported? Actually, Prisma auto-converts Date to ISO string in Json fields? Hmm — in a Json field, Prisma stores it as-is; JS Date is... Prisma docs: "Date objects are not supported in Json fields" — actually it throws? Or serializes via toJSON? I recall Prisma supports Date in Json via JSON.stringify semantics (toJSON). To be safe: convert dates to ISO strings in details: `expiresAt: record.session.expiresAt.toISOString()`. I'll do that everywhere. And `details: { detectedVia, tokensWiped }` — string+number ✓.

So the details values: only strings/numbers/objects/arrays. `Prisma.InputJsonValue` type. The service constructs such objects ✓.

Also `recordEvent` should probably *not* throw if the audit write fails? If the audit write fails, the rejection fails with a 500 instead of a 401 — distinguishable! Edge: audit table unavailable = whole DB unavailable = the rejection itself can't be determined. Non-issue. Keep it simple: let it throw (the DB is down anyway).

Now — `kind` values as constants? I'll define in the service:

```ts
const EVENT_KINDS = {
  sessionIssued: 'session_issued',
  refreshReissued: 'refresh_reissued',
  rejectedMalformed: 'refresh_rejected_malformed',
  rejectedUnknown: 'refresh_rejected_unknown',
  rejectedExpired: 'refresh_rejected_expired',
  reuseDetected: 'refresh_reuse_detected',
} as const;
```

The tests use raw strings — fine (the contract).

Now the repository's `claimAndIssue`:

```ts
async claimAndIssue(tokenId: string, sessionId: string, nextTokenHash: string): Promise<string | null> {
  return this.prisma.$transaction(async (tx) => {
    const retired = await tx.refreshToken.updateMany({
      where: { id: tokenId, retiredAt: null },
      data: { retiredAt: new Date() },
    });
    if (retired.count === 0) {
      return null;
    }
    const created = await tx.refreshToken.create({
      data: { sessionId, tokenHash: nextTokenHash },
      select: { id: true },
    });
    return created.id;
  });
}
```

`retiredAt: null` in the where — Prisma: `retiredAt: null` means IS NULL ✓.

Now, hmm — one thing: in the service, after `claimAndIssue` returns the id, I record the `refresh_reissued` event *outside* the claim transaction. If that event write fails → the token has already rotated but no audit row. Acceptable? The audit requirement says events are recorded; a failure there is a DB failure. I could include the event in the same transaction — better: pass the event into claimAndIssue? Then the repository method is less generic... or have the repository do the event in the same tx. I'd rather keep the repository methods focused; but atomicity of rotation+audit is a real concern. Options: `claimAndIssue(tokenId, sessionId, nextTokenHash, event: SecurityEventData)` — the repository writes both in the tx. Slight coupling but practical and atomic. I'll do that: the service builds the full event data and the repository writes the token + event atomically.

Similarly the reuse path: `retireFamily` + `recordEvent('refresh_reuse_detected')` — should be atomic? If the wipe succeeds and the audit fails → family is wiped, no audit. Wrap: a repository method `quarantineFamily(sessionId, event)` in one tx. Hmm, that pushes the "quarantine" semantics into the repository — but the *decision* (when to quarantine) stays in the service; the repository just executes atomically. I think that's acceptable: the repository methods are "atomic operations." Let me design the repository API:

```ts
createSession(userId, expiresAt): Promise<{ id, expiresAt }>
createToken(sessionId, tokenHash): Promise<{ id }>
findTokenByHash(tokenHash): Promise<StoredToken | null>
claimAndIssue(tokenId, sessionId, nextTokenHash, event: SecurityEventData): Promise<string | null>
quarantineFamily(sessionId, event: SecurityEventData): Promise<number> // returns tokensWiped
recordEvent(event): Promise<void> // standalone (for session_issued, *_rejected_*)
countActiveTokens(sessionId): Promise<number>
```

Wait — but then the service's `quarantineFamily` helper computes tokensWiped for the event... but the event is written *in* the tx along with the wipe; tokensWiped is only known *after* the wipe. Ordering inside the tx: wipe → get count → write event with count. So `quarantineFamily(sessionId, kind, baseDetails)` → the repository composes the event details with tokensWiped? That's the repository shaping audit data — layering smell. Alternative: skip `tokensWiped` from the event details, or compute it... I can drop tokensWiped from details (audit has kind+sessionId+tokenId; the count is derivable). Simpler: event details = `{ detectedVia }` — known before the wipe. The tx: wipe + event. tokensWiped isn't in the event. The test asserting `tokensWiped >= 1` — change to assert via count (active token count 0) or via the count of retired tokens in the session. Let me assert: `refreshToken.count({ where: { sessionId, retiredAt: null } }) === 0` and that the reuse event exists. Drop tokensWiped. Cleaner layering.

So:

```ts
quarantineFamily(sessionId: string, event: SecurityEventData): Promise<number> {
  return this.prisma.$transaction(async (tx) => {
    const res = await tx.refreshToken.updateMany({
      where: { sessionId, retiredAt: null },
      data: { retiredAt: new Date() },
    });
    await tx.securityEvent.create({ data: eventWithDefaults(event) });
    return res.count;
  });
}
```

The service still uses the returned count? Not needed; ignore or use for a log. Return count (harmless).

Similarly `claimAndIssue` writes the event in the tx:

```ts
claimAndIssue(tokenId, sessionId, nextTokenHash, event): Promise<string | null> {
  return this.prisma.$transaction(async (tx) => {
    const res = await tx.refreshToken.updateMany({ where: { id: tokenId, retiredAt: null }, data: { retiredAt: new Date() } });
    if (res.count === 0) return null;
    const created = await tx.refreshToken.create({ data: { sessionId, tokenHash: nextTokenHash } });
    await tx.securityEvent.create({ data: eventWithDefaults(event) });
    return created.id;
  });
}
```

Good — rotation + success audit are atomic; wipe + reuse audit are atomic. Rejection audits are standalone (no state change → no tx needed).

`eventWithDefaults`: fill `details ?? {}`, sessionId/userId/tokenId undefined → null (Prisma: `undefined` = omit → column default/null; for nullable columns, omit = null default. Actually, in create, undefined fields are omitted → DB default (null). So I can pass as-is, but `details` needs the `{}` default since the column is NOT NULL default '{}' — omitting also uses the DB default! So I can pass the event object straight through, as long as the field names match Prisma create's input: `{ sessionId, userId, kind, tokenId, details }` — all valid SecurityEvent fields. `details` omitted → DB default '{}'. So the repository: `tx.securityEvent.create({ data: event })`. The event type:

```ts
export interface SecurityEventData {
  sessionId?: string | null;
  userId?: string | null;
  kind: string;
  tokenId?: string | null;
  details?: Prisma.InputJsonValue;
}
```

Prisma create's data accepts undefined for optional fields ✓.

Now — the Prisma client model names: `session`, `refreshToken`, `securityEvent` (camelCase of the model names Session, RefreshToken, SecurityEvent) ✓.

Now — let me write the final test file carefully.

```ts
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { RefreshModule } from '../src/refresh/refresh.module';
import { REFRESH_CLOCK, RefreshService } from '../src/refresh/refresh.service';
import { RefreshTokenRepository } from '../src/refresh/refresh.repository';
```

Wait — test imports from `../src/...` without extensions (vitest resolves .ts). tsconfig doesn't include test → no build interference. But wait: NodeNext module resolution *in the test files* — vitest uses vite's resolver, not tsc — no extensions needed. But if someone type-checks the test files with the same tsconfig (they're not included) — fine.

Hmm, one wrinkle: `import request from 'supertest'` under ESM+vite — supertest is CJS; vite interops the default import ✓.

The test:

```ts
const SESSION_TTL_SECONDS = '60';
const SESSION_TTL_MS = 60_000;

const REJECTION = {
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
};

describe('POST /auth/refresh', () => {
  let prisma: PrismaClient;
  let app: INestApplication;
  let service: RefreshService;
  let nowMs: number;

  beforeAll(async () => {
    process.env.REFRESH_SESSION_TTL_SECONDS = SESSION_TTL_SECONDS;
    prisma = new PrismaClient();
    nowMs = Date.now();

    const moduleRef = await Test.createTestingModule({ imports: [RefreshModule] })
      .overrideProvider(REFRESH_CLOCK)
      .useValue(() => new Date(nowMs))
      .overrideProvider(RefreshTokenRepository)
      .useValue(new RefreshTokenRepository())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(RefreshService);
  });
  ...
```

Wait — the fake clock `() => new Date(nowMs)`: `nowMs` is a closure variable mutated by the tests. The override `useValue(() => new Date(nowMs))` captures the variable by reference ✓.

beforeEach: reset the clock to the baseline, clear the tables:

```ts
  beforeEach(async () => {
    nowMs = Date.now();
    await prisma.securityEvent.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const post = (body: Record<string, unknown> | undefined) =>
    request(app.getHttpServer()).post('/auth/refresh').send(body ?? {});

  const postWithCookie = (cookieToken: string, body: Record<string, unknown> | undefined) =>
    request(app.getHttpServer())
      .post('/auth/refresh')
      .set('cookie', [`refresh_token=${cookieToken}`])
      .send(body ?? {});
```

Hmm — `.send(undefined)`? Supertest: `.send({})` sends `{}`. For "no body," use `.send({})` (empty JSON object) — the controller receives `{}` → body.refreshToken is undefined → falls back to the cookie. Or no body at all: `request(...).post(...)` with no send → no body → Nest's `@Body()` → `{}`? With a JSON body parser and no body → `req.body = {}` (does express.json set {} on an empty body? Actually, express.json only parses when there's a content-type json; with no body, req.body stays as {} from the parser's default `body: {}`? In Nest, `@Body()` returns `{}` for an empty POST. OK, I'll always `.send({})` for safety.)

Cookie value: the token is `rt_` + base64url — base64url is cookie-safe (no `;`, `=`? base64url has no padding by default in Node's toString('base64url') — no `=`). ✓ No URL encoding needed.

Tests:

1. Rotate a valid token (requirement 1):

```ts
  it('rotates a valid token: returns a fresh pair and retires the presented one', async () => {
    const session = await service.issueSession('user-rotate');

    const res = await post({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.refreshToken).not.toBe(session.refreshToken);

    // The presented token is retired by the same call.
    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION);
  });
```

2. Concurrency:

```ts
  it('rotates exactly once when one valid token is presented concurrently', async () => {
    const session = await service.issueSession('user-race');

    const [first, second] = await Promise.all([
      post({ refreshToken: session.refreshToken }),
      post({ refreshToken: session.refreshToken }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 401]);

    const [ok, rejected] = first.status === 200 ? [first, second] : [second, first];
    expect(ok.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    expect(ok.body.refreshToken).not.toBe(session.refreshToken);
    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual(REJECTION);

    // The losing presentation hit an already-retired token, so the whole
    // family from this sign-in is quarantined: nothing can rotate again.
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const kinds = (await prisma.securityEvent.findMany({ where: { sessionId: session.sessionId } })).map((e) => e.kind);
    expect(kinds).toContain('refresh_reissued');
    expect(kinds).toContain('refresh_reuse_detected');
  });
```

3. Replay invalidates a sibling:

```ts
  it('invalidates the live sibling when a retired token is replayed', async () => {
    const session = await service.issueSession('user-replay');

    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const sibling = rotated.body.refreshToken as string;

    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION);

    // The sibling, issued by the same sign-in, is now dead too.
    const siblingAttempt = await post({ refreshToken: sibling });
    expect(siblingAttempt.status).toBe(401);
    expect(siblingAttempt.body).toEqual(REJECTION);
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const reuse = await prisma.securityEvent.findFirst({ where: { sessionId: session.sessionId, kind: 'refresh_reuse_detected' } });
    expect(reuse).not.toBeNull();
  });
```

4. Absolute deadline:

```ts
  it('rotates up to the absolute deadline fixed at sign-in and never extends it', async () => {
    const session = await service.issueSession('user-deadline');
    const deadline = session.expiresAt.getTime();
    expect(deadline).toBe(nowMs + SESSION_TTL_MS);

    // Rotate 1 second before the deadline.
    nowMs += SESSION_TTL_MS - 1_000;
    const near = await post({ refreshToken: session.refreshToken });
    expect(near.status).toBe(200);

    // Rotation did not move the deadline.
    const stored = await prisma.session.findUnique({ where: { id: session.sessionId } });
    expect(stored?.expiresAt.getTime()).toBe(deadline);

    // The fresh token still dies at the original deadline.
    nowMs += 2_000;
    const past = await post({ refreshToken: near.body.refreshToken });
    expect(past.status).toBe(401);
    expect(past.body).toEqual(REJECTION);

    const expired = await prisma.securityEvent.findFirst({ where: { sessionId: session.sessionId, kind: 'refresh_rejected_expired' } });
    expect(expired).not.toBeNull();
  });
```

5. Rejection comparison:

```ts
  it('answers expired, retired, unknown and malformed with the identical 401', async () => {
    const session = await service.issueSession('user-compare');
    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const liveToken = rotated.body.refreshToken as string;

    const malformed = await post({ refreshToken: 'nope' });
    const unknown = await post({ refreshToken: `rt_${'A'.repeat(43)}` });
    const retired = await post({ refreshToken: session.refreshToken });

    nowMs += SESSION_TTL_MS + 60_000;
    const expired = await post({ refreshToken: liveToken });

    for (const res of [malformed, unknown, retired, expired]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(REJECTION);
      expect(res.headers['set-cookie']).toBeDefined();
    }
    expect(new Set([malformed, unknown, retired, expired].map((r) => JSON.stringify(r.body))).size).toBe(1);

    // The audit log, in contrast, tells the four apart.
    const kinds = (await prisma.securityEvent.findMany()).map((e) => e.kind).sort();
    expect(kinds).toContain('refresh_rejected_malformed');
    expect(kinds).toContain('refresh_rejected_unknown');
    expect(kinds).toContain('refresh_rejected_expired');
    expect(kinds).toContain('refresh_reuse_detected');
  });
```

Wait — `retired` here: the session is unexpired at that point (clock not yet advanced) → step 4 → quarantine → reuse_detected ✓. Then advance the clock; `expired` presents `liveToken` — found (retired by the wipe), session expired → step 3 expired ✓ (before the retired check). Good — the ordering is demonstrated.

Note: `kinds` is findMany() *all* events (no sessionId filter) — includes session_issued, refresh_reissued too; toContain works. Sort is irrelevant to toContain. Fine.

6. Cookie support:

```ts
  it('accepts the token from the refresh_token cookie', async () => {
    const session = await service.issueSession('user-cookie');
    const res = await postWithCookie(session.refreshToken);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
  });
```

7. Precedence:

```ts
  it('prefers the body token over the cookie when both are present', async () => {
    const bodySession = await service.issueSession('user-pref-body');
    const cookieSession = await service.issueSession('user-pref-cookie');

    const res = await postWithCookie(cookieSession.refreshToken, { refreshToken: bodySession.refreshToken });
    expect(res.status).toBe(200);

    // The body token was the one rotated (now retired)...
    expect((await post({ refreshToken: bodySession.refreshToken })).status).toBe(401);
    // ...and the cookie token is untouched.
    expect((await post({ refreshToken: cookieSession.refreshToken })).status).toBe(200);
  });

  it('treats an invalid body token as authoritative, even with a valid cookie', async () => {
    const session = await service.issueSession('user-pref-invalid');
    const res = await postWithCookie(session.refreshToken, { refreshToken: 'garbage' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REJECTION);
    // No wipe happened: the valid cookie token still works.
    expect((await post({ refreshToken: session.refreshToken })).status).toBe(200);
  });
```

Wait, in the "body invalid" test: the body is invalid → malformed → *no* wipe → the session's token is still valid → 200 ✓.

8. No token:

```ts
  it('rejects a request that carries no token at all', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REJECTION);
  });
```

Now — `postWithCookie(cookieToken, body?)`:

```ts
const postWithCookie = (cookieToken: string, body: Record<string, unknown> = {}) =>
  request(app.getHttpServer())
    .post('/auth/refresh')
    .set('cookie', [`refresh_token=${cookieToken}`])
    .send(body);
```

The `.set('cookie', [array])` — does supertest accept an array for set? Express headers: an array of set-cookie... for the *request* cookie header, supertest's `.set('cookie', 'a=1; b=2')` — a string. An array might join with commas? Safer: `.set('cookie', `refresh_token=${cookieToken}`)`. One cookie only. ✓

Now — supertest's `app.getHttpServer()` type: `any` → request() is fine.

`res.body` — any. `rotated.body.refreshToken as string` ✓.

`prisma.session.findUnique` returns a type with expiresAt: Date ✓. `stored?.expiresAt.getTime()` ✓.

Now — potential issue: two PrismaClients (the repository's + the test's) on the same DB — fine.

Another potential issue: the repository's `new PrismaClient()` in the override — `useValue(new RefreshTokenRepository())` — the instance is created in beforeAll. Its onModuleDestroy is *not* called (useValue instances don't get lifecycle? Nest does call lifecycle hooks on useValue providers if the object implements them? Hmm — for a `useValue` provider, Nest... I think Nest calls `onModuleDestroy` on useValue instances if they implement the hook? Not sure. To be safe, the test's afterAll: `repo?` — I don't hold a reference... Let me hold a reference:

```ts
let repo: RefreshTokenRepository;
beforeAll: repo = new RefreshTokenRepository(); ... useValue(repo)
afterAll: await app.close(); await repo.onModuleDestroy?.(); await prisma.$disconnect();
```

`onModuleDestroy` is a public method (implements OnModuleDestroy) → callable ✓. Fine.

Now, the `issueSession` return: `sessionId` used in the tests ✓.

Now — another service detail: `refresh()` — `presented` could be `string | undefined`. In the controller, `extractRefreshToken` returns `string | undefined`. But the body value could be a non-string (number) — `extractRefreshToken` casts... let me type it properly:

```ts
function extractRefreshToken(body: { refreshToken?: unknown } | undefined, cookieHeader: string | undefined): string | undefined {
  if (body && typeof body.refreshToken === 'string') {
    return body.refreshToken;
  }
  if (body && body.refreshToken !== undefined && body.refreshToken !== null) {
    return String(body.refreshToken); // non-string body value: force through the malformed check
  }
  return parseCookieHeader(cookieHeader, REFRESH_COOKIE);
}
```

Hmm — `String(body.refreshToken)` for a number → "123" → malformed ✓. For an object → "[object Object]" → malformed ✓. But is `String()`-ifying in the controller a "business logic" smell? It's input normalization. Alternatively, type the controller parameter as `unknown` and let the service accept `unknown`: the service's `refresh(presented: unknown)` — the first check `typeof presented !== 'string' || !pattern` → malformed. That's cleanest: the controller passes `body.refreshToken ?? cookie`... wait, precedence: body present (non-null) → body value (even non-string); else the cookie.

Let me define the controller:

```ts
const presented = extractRefreshToken(body, cookieHeader);
const { accessToken, refreshToken } = await this.refreshService.refresh(presented);
```

With `extractRefreshToken` returning `unknown`:

```ts
function extractRefreshToken(body: { refreshToken?: unknown } | undefined, cookieHeader: string | undefined): unknown {
  if (body !== undefined && body.refreshToken !== undefined && body.refreshToken !== null) {
    // Precedence: the explicit body parameter wins over the cookie.
    return body.refreshToken;
  }
  return parseCookieHeader(cookieHeader, REFRESH_COOKIE); // string | undefined
}
```

And the service: `refresh(presented: unknown): Promise<RefreshResult>`. The malformed check: `typeof presented !== 'string' || !REFRESH_TOKEN_PATTERN.test(presented)`. For the audit details length: `typeof presented === 'string' ? presented.length : null`. ✓

That's clean. The controller's JSDoc documents the precedence:

```
 * Token source and precedence (documented contract):
 * - The token may arrive as the JSON body field `refreshToken`, or as the
 *   `refresh_token` cookie.
 * - When both are present, the **body value wins**: the explicit parameter is
 *   the client's deliberate choice for this call; the cookie is the fallback
 *   for clients that store the token there. A non-null body value is
 *   authoritative even when malformed, in which case the call is rejected.
```

Good.

Now, `parseCookieHeader`:

```ts
function parseCookieHeader(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}
```

`eq <= 0` skips parts where `=` is the first char (no name). ✓

Now the `@Headers('cookie')` parameter — express lowercases headers ✓.

Now — the service file imports: `@Inject`, `Injectable` from @nestjs/common; `createHash, randomBytes` from node:crypto; `issueAccessToken` from '../auth/access-token.js'; the repository + types from './refresh.repository.js'.

The repository imports: `Injectable` from @nestjs/common; `OnModuleDestroy` from @nestjs/common; `PrismaClient` + type `Prisma` from '@prisma/client'.

`import { Injectable, OnModuleDestroy } from '@nestjs/common';` — OnModuleDestroy is an interface: `import type { OnModuleDestroy }`? Mixed: `import { Injectable } from '@nestjs/common'; import type { OnModuleDestroy } from '@nestjs/common';` — under NodeNext, type-only imports are good practice (verbatimModuleSyntax is not enabled, so plain imports of interfaces are also fine, but I'll use `import type` for interfaces for clarity).

Now, `@Inject(REFRESH_CLOCK)` with a symbol — the import of `REFRESH_CLOCK` from the service file into the module and the controller? The module: `import { REFRESH_CLOCK, RefreshService } from './refresh.service.js';` and `import { RefreshTokenRepository } from './refresh.repository.js';` — wait, the module references the repository class for providers ✓, the service ✓, the clock symbol ✓, the controller ✓.

The controller imports `RefreshService` + `@Inject`:

```ts
import { Body, Controller, Headers, HttpCode, Inject, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { RefreshRejectedError, RefreshService } from './refresh.service.js';
```

The service file:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { issueAccessToken } from '../auth/access-token.js';
import type { Prisma } from '@prisma/client';
import { RefreshTokenRepository } from './refresh.repository.js';
import type { SecurityEventData, StoredToken } from './refresh.repository.js';
```

Wait — `RefreshTokenRepository` is used only as a type in the service (constructor parameter type + @Inject token). `@Inject(RefreshTokenRepository)` — the class is used as a *value* (the token) → a value import is needed ✓ (`import { RefreshTokenRepository }` — it's a value, fine).

SecurityEventData is used to build event objects — type-only import ✓. But wait — does the service need `Prisma.InputJsonValue`? The details objects it builds: `{ expiresAt: string }` etc. — plain object literals assigned into SecurityEventData.details (type Prisma.InputJsonValue) — the literals are structurally checked; no explicit Prisma import needed in the service unless I annotate. I won't annotate → drop the Prisma import from the service. ✓

Repository:

```ts
import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
```

`Prisma` used in `SecurityEventData.details?: Prisma.InputJsonValue` ✓.

Now — `SecurityEventData` exported from the repository file:

```ts
export interface SecurityEventData {
  sessionId?: string | null;
  userId?: string | null;
  kind: string;
  tokenId?: string | null;
  details?: Prisma.InputJsonValue;
}
```

Prisma create data: `tx.securityEvent.create({ data: event })` — `event: SecurityEventData` — is that assignable to `SecurityEventCreateInput`? The fields sessionId (String?), userId (String?), kind (String), tokenId (String?), details (Json?) — my interface is assignable ✓ (undefined fields are omitted).

Now — one concern: `prisma.securityEvent` — the model name `SecurityEvent` → property `securityEvent` ✓.

Now, `claimAndIssue` — the type of the interactive transaction callback's return `Promise<string | null>` ✓.

Now let me reconsider: the `findTokenByHash` race — two concurrent findUniques both return the active token; both proceed to claimAndIssue; serialized by the row lock; one wins. ✓ The expired check between the find and the claim: both see unexpired ✓.

Now — the "exactly one rotates" guarantee across *the same token* — ✓. What about a *different* valid token in the same session (a legitimate sibling, e.g., two tabs)? Rotation of token A: A is retired, A2 is created. Token B is still valid — rotate B: B is retired, B2 is created. Two tabs each hold a live token — normal. Reuse detection is per-token, family wipe is per-replay. That's standard (each rotation creates a chain; hmm — in the classic "family" model, each rotation creates a new token in the family and the old one is retired; multiple concurrent chains within a family are... our model allows multiple live tokens in a session simultaneously (each tab rotates independently). Is that a problem? For the task: sessions are long-lived, clients retry — two live tokens in one family is acceptable (multi-tab). Reuse of *any* retired token wipes the whole family. Fine, I'll document it.

Now — `refresh_reissued` event details: `{ previousTokenId }` ✓.

Now — one more: `issueSession` records `session_issued` — the audit for sign-in issuance. Not strictly required but useful; keep it (the audit story is complete: issuance → rotations → rejections).

Now — the `StoredToken` interface is exported (used by the service) ✓.

Let me also double-check the `RefreshService` constructor parameter order and `@Inject` placement:

```ts
constructor(
  @Inject(RefreshTokenRepository) private readonly tokens: RefreshTokenRepository,
  @Inject(REFRESH_CLOCK) private readonly now: () => Date,
) {}
```

✓ No defaults, no metadata dependency.

The module:

```ts
@Module({
  controllers: [RefreshController],
  providers: [
    { provide: REFRESH_CLOCK, useValue: () => new Date() },
    RefreshService,
    RefreshTokenRepository,
  ],
  exports: [RefreshService],
})
export class RefreshModule {}
```

The controller:

```ts
@Controller('auth')
export class RefreshController {
  constructor(@Inject(RefreshService) private readonly refreshService: RefreshService) {}
  ...
}
```

Now — `@HttpCode(200)` on the POST ✓.

Now — the REJECTION_BODY in the controller:

```ts
const REJECTION_BODY = {
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
} as const;
```

The test's REJECTION constant mirrors this. Message string must match exactly — I'll be careful.

Now — `UnauthorizedException(REJECTION_BODY)`: signature `new UnauthorizedException(response?: string | Record<string, any>, status?)` ✓.

Now — let me re-check the express `res.cookie` on the rejection path with an empty string: `res.cookie('refresh_token', '', { maxAge: 0, ... })` → the header `refresh_token=; Path=/; Max-Age=0; Expires=...`? Express's cookie.serialize: with maxAge: 0 → expires = now (past-ish) → `Expires=<date>`. Hmm, does it emit `Max-Age=0`? cookie@0.6 serialize:

```js
if (opt.maxAge != null) {
  var maxAge = opt.maxAge - 0
  if (isNaN(maxAge) || !isFinite(maxAge)) throw ...
  opts.maxAge = Math.floor(maxAge)
}
...
if (opts.expires) ... 
```

And the output: `str += '; Max-Age=' + ...`? Let me recall cookie 0.6: it has `if (opts.maxAge != null) { str += '; Max-Age=' + opts.maxAge; }`? I think modern cookie (0.6+) *does* emit Max-Age. Express 4 uses cookie 0.6. So the header contains `Max-Age=0`. My test assertion: I check that the header exists and doesn't contain a token value — robust either way. In the comparison test, I only assert `toBeDefined()` on set-cookie. In the success case, maybe assert it contains 'refresh_token=rt_'. Let me add to the rotate test:

```ts
const setCookie = (res.headers['set-cookie'] ?? []).join(';');
expect(setCookie).toContain('refresh_token=rt_');
```

supertest header `set-cookie` — an array of strings ✓.

On rejection: `expect((rejected.headers['set-cookie'] ?? []).join()).toContain('refresh_token=;')` — hmm, the exact serialization: `refresh_token=;` — cookie.serialize with an empty value → `refresh_token=` and then `; Path=/` etc. So the joined string contains `refresh_token=;` ✓ (value empty, followed by `;`). Wait: serialize starts `name=value` → `refresh_token=` then appends `; Path=/` → `refresh_token=; Path=/` → contains `refresh_token=;` ✓.

Now — the ENVELOPE `details: {}` — JSON body `{"error":{"code":"refresh_token_rejected","message":"The presented refresh token could not be validated.","details":{}}}`. `expect(rejected.body).toEqual(REJECTION)` ✓ deep equality.

Now — the app's global prefix? None. main.ts: no prefix. ✓

Now — package.json versions: let me pin reasonable current ones:
- @nestjs/common, core, platform-express, testing: ^10.4.x
- @prisma/client, prisma: ^5.22.0 (latest 5.x)
- typescript ^5.5
- vitest ^2.0 (Node 20 OK) — vitest 2.x is fine with express/nest tests.
- supertest ^7.0.0, @types/supertest ^6.0.2
- @types/express ^4.17.21
- @types/node ^20
- reflect-metadata ^0.2.2
- rxjs ^7.8.1 (Nest peer)

`"postinstall": "prisma generate"`.

Scripts:
```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "start": "node dist/main.js",
  "test": "vitest run",
  "db:migrate": "prisma migrate deploy",
  "postinstall": "prisma generate"
}
```

Now — do I need a `README`? Not asked for. Skip.

`.env`? "No secrets in the repo" — DATABASE_URL from env; no .env file in the repo. I'll mention the required env vars in a comment in main.ts? Or in SECURITY.md? Add a short comment to the migration? I'll add a note as a comment in the test file header: "Requires a PostgreSQL reachable via DATABASE_URL with the prisma migrations applied." And a `DATABASE_URL` comment in package.json? JSON has no comments. A test-file comment is enough. Maybe also in main.ts. Keep it in the test header + a small comment in the schema? The schema's datasource uses env("DATABASE_URL") — self-documenting.

Now — the `prisma/migrations/migration_lock.toml`:

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

And the folder `prisma/migrations/20250601000000_init/migration.sql`. Hmm — the naming: Prisma uses `YYYYMMDDHHMMSS_name`. I'll use `20250101000000_init`. Fine.

Now, let me reconsider the schema: `SecurityEvent.details Json @default("{}")` — in the migration SQL: `"details" JSONB NOT NULL DEFAULT '{}'`. ✓

Also indexes: `@@index([sessionId])` on security_events, `@@index([kind])` ✓. refresh_tokens: `@@index([sessionId])` + unique on tokenHash ✓.

FK cascade: session delete → tokens cascade (test cleanup deletes tokens first anyway).

Now — the `Session` model: `tokens RefreshToken[]` back-relation ✓. SecurityEvent has no relation to Session (I dropped it) — so no `events` field on Session. ✓

Wait, is a `SecurityEvent → Session` relation useful? I chose nullable session, no FK — justifiable (events for unknown/malformed have no session; the audit log is append-only). Note in a comment in the schema.

Now, let me also reconsider: should `findTokenByHash` be `findUnique`? tokenHash is unique ✓ → `findUnique({ where: { tokenHash } })`.

Now — the service's `refresh` — one more edge: `presented` is a string but the cookie path... irrelevant, the service only sees the final value.

Let me write the service fully:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { issueAccessToken } from '../auth/access-token.js';
import { RefreshTokenRepository } from './refresh.repository.js';
import type { SecurityEventData } from './refresh.repository.js';

/** DI token for the clock, so tests can control "now" deterministically. */
export const REFRESH_CLOCK = Symbol('REFRESH_CLOCK');

/** Thrown for every rejected presentation. The controller maps it to one
 *  fixed 401 envelope, so no rejection kind is distinguishable to the caller. */
export class RefreshRejectedError extends Error {
  constructor() {
    super('The presented refresh token was rejected.');
    this.name = 'RefreshRejectedError';
  }
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Structural shape of an issued refresh token: `rt_` + 32 random bytes
 * encoded base64url (43 chars, no padding).
 */
const REFRESH_TOKEN_PATTERN = /^rt_[A-Za-z0-9_-]{43}$/;

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function generateRefreshToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sessionTtlMs(): number {
  const seconds = Number(process.env.REFRESH_SESSION_TTL_SECONDS);
  return Number.isFinite(seconds) && seconds > 0 ? Math.trunc(seconds) * 1000 : DEFAULT_SESSION_TTL_SECONDS * 1000;
}

@Injectable()
export class RefreshService {
  constructor(
    @Inject(RefreshTokenRepository) private readonly tokens: RefreshTokenRepository,
    @Inject(REFRESH_CLOCK) private readonly now: () => Date,
  ) {}

  /**
   * Called once per sign-in by the (existing) sign-in flow. Fixes the
   * absolute deadline for the session; rotation never extends it.
   */
  async issueSession(userId: string): Promise<IssuedSession> {
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + sessionTtlMs());
    const session = await this.tokens.createSession(userId, expiresAt);
    const refreshToken = generateRefreshToken();
    const token = await this.tokens.createToken(session.id, sha256Hex(refreshToken));
    await this.tokens.recordEvent({
      sessionId: session.id,
      userId,
      kind: 'session_issued',
      tokenId: token.id,
      details: { expiresAt: expiresAt.toISOString() },
    });
    return {
      sessionId: session.id,
      accessToken: issueAccessToken(userId),
      refreshToken,
      expiresAt,
    };
  }

  /**
   * Rotates the presented refresh token.
   *
   * Check order (see SECURITY.md): malformed -> unknown -> expired ->
   * retired (reuse) -> atomic claim. Every rejection throws the same
   * RefreshRejectedError; only the audit kind differs.
   */
  async refresh(presented: unknown): Promise<RefreshResult> {
    const now = this.now();

    if (typeof presented !== 'string' || !REFRESH_TOKEN_PATTERN.test(presented)) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_malformed',
        details: { length: typeof presented === 'string' ? presented.length : null },
      });
      throw new RefreshRejectedError();
    }

    const presentedHash = sha256Hex(presented);
    const record = await this.tokens.findTokenByHash(presentedHash);
    if (record === null) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_unknown',
        details: { tokenHash: presentedHash },
      });
      throw new RefreshRejectedError();
    }

    if (now.getTime() >= record.session.expiresAt.getTime()) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_expired',
        sessionId: record.session.id,
        userId: record.session.userId,
        tokenId: record.id,
        details: { expiresAt: record.session.expiresAt.toISOString() },
      });
      throw new RefreshRejectedError();
    }

    if (record.retiredAt !== null) {
      await this.quarantineFamily(record, 'presented_retired');
      throw new RefreshRejectedError();
    }

    const nextToken = generateRefreshToken();
    const nextTokenId = await this.tokens.claimAndIssue(
      record.id,
      record.session.id,
      sha256Hex(nextToken),
      {
        sessionId: record.session.id,
        userId: record.session.userId,
        kind: 'refresh_reissued',
        tokenId: ??? // the new token id is created inside claimAndIssue...
      },
    );
```

Ugh — the `refresh_reissued` event wants the *new* token id, which is created inside claimAndIssue. Options: the event uses `tokenId: record.id` (the retired one) with `details: { nextTokenHash? }`... better: don't include the new token id; instead, `tokenId: record.id`, `details: { retiredTokenId: record.id }`? Hmm. Redesign: the event data for reissued: `tokenId` = the new token's id — known only after creation. Restructure claimAndIssue: create the new token *first*, then the conditional retire, then the event — all in the tx:

```ts
async claimAndIssue(tokenId, sessionId, nextTokenHash, event): Promise<string | null> {
  return this.prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({ data: { sessionId, tokenHash: nextTokenHash } });
    const retired = await tx.refreshToken.updateMany({ where: { id: tokenId, retiredAt: null }, data: { retiredAt: new Date() } });
    if (retired.count === 0) {
      await tx.refreshToken.delete({ where: { id: created.id } }); // roll back the stray token... 
      return null;
    }
    await tx.securityEvent.create({ data: event });
    return created.id;
  });
}
```

Creating then deleting in the tx is ugly; alternatively, on failure just... the tx *aborts* instead of deleting: throw → the tx rolls back the creation. `throw new ClaimLost()`? But that propagates as an error; catch it:

```ts
class ClaimLostError extends Error {}

async claimAndIssue(...): Promise<string | null> {
  try {
    return await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create(...);
      const retired = await tx.refreshToken.updateMany(...);
      if (retired.count === 0) throw new ClaimLostError();
      await tx.securityEvent.create(...);
      return created.id;
    });
  } catch (err) {
    if (err instanceof ClaimLostError) return null;
    throw err;
  }
}
```

Cleaner semantics: all-or-nothing. But creating the new token before winning the claim — if lost, it's rolled back ✓. If won: the new token exists, the old is retired, the event is written — atomic ✓. Event tokenId = created.id — but the event is passed *in* from the service, which doesn't know created.id...

Alternative: let the repository build the event? Layering... the service passes `event: SecurityEventData` without tokenId, and the repository... no.

Simplest: the service creates the event *after* success, *outside* the tx (a minor non-atomicity for the success audit only). The rotation itself (retire+new) is atomic — that's the critical part. The success audit is lost only if the event write fails (DB down → the whole thing fails anyway). Honestly, a `refresh_reissued` row written right after the commit is fine. The *reuse* audit needs to be atomic with the wipe (the wipe is the security-critical action; the audit proves it happened). For reuse: quarantineFamily tx (wipe + event) — the event data is known ahead of time (tokenId = the presented retired token, no dependency on the wipe result) ✓.

For the success case: claimAndIssue tx (retire + create), then recordEvent outside. Acceptable. Then the event's tokenId = the returned created.id ✓.

So:

```ts
const nextTokenId = await this.tokens.claimAndIssue(record.id, record.session.id, sha256Hex(nextToken));
if (nextTokenId === null) {
  await this.quarantineFamily(record, 'concurrent_presentation');
  throw new RefreshRejectedError();
}
await this.tokens.recordEvent({
  kind: 'refresh_reissued',
  sessionId: record.session.id,
  userId: record.session.userId,
  tokenId: nextTokenId,
  details: { retiredTokenId: record.id },
});
return { accessToken: issueAccessToken(record.session.userId), refreshToken: nextToken };
```

And `claimAndIssue` with the create-then-claim approach (atomic, rollback on loss):

```ts
async claimAndIssue(tokenId: string, sessionId: string, nextTokenHash: string): Promise<string | null> {
  try {
    return await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: { sessionId, tokenHash: nextTokenHash },
        select: { id: true },
      });
      const retired = await tx.refreshToken.updateMany({
        where: { id: tokenId, retiredAt: null },
        data: { retiredAt: new Date() },
      });
      if (retired.count === 0) {
        // Lost the race: roll back the just-created successor.
        throw new ClaimLostError();
      }
      return created.id;
    });
  } catch (error) {
    if (error instanceof ClaimLostError) {
      return null;
    }
    throw error;
  }
}
```

Hmm wait — is creating *before* claiming safe wrt the unique tokenHash? Yes, the hashes differ (random). And the row lock: updateMany on tokenId — the same row as the contender → serialized ✓.

Actually, hmm, ordering inside the tx: create first (no lock contention), then updateMany (blocks on the contender's row). If the contender wins and commits (retiring the old + creating its successor), our updateMany sees retiredAt set → 0 → ClaimLostError → rollback (our create vanishes) → the service quarantines the family (wiping the contender's successor too). ✓ Exactly the intended strict semantics.

Alternatively, the updateMany-first ordering (my original): claim, then create on success. That also works and avoids the create+rollback. Both are fine. updateMany-first is more direct: "retire if active; if you retired, create the successor." I'll use updateMany-first:

```ts
return await this.prisma.$transaction(async (tx) => {
  const retired = await tx.refreshToken.updateMany({
    where: { id: tokenId, retiredAt: null },
    data: { retiredAt: new Date() },
  });
  if (retired.count === 0) {
    return null;
  }
  const created = await tx.refreshToken.create({
    data: { sessionId, tokenHash: nextTokenHash },
    select: { id: true },
  });
  return created.id;
});
```

No error gymnastics needed. ✓

Now, `quarantineFamily`:

```ts
async quarantineFamily(sessionId: string, event: SecurityEventData): Promise<number> {
  return this.prisma.$transaction(async (tx) => {
    const wiped = await tx.refreshToken.updateMany({
      where: { sessionId, retiredAt: null },
      data: { retiredAt: new Date() },
    });
    await tx.securityEvent.create({ data: event });
    return wiped.count;
  });
}
```

Service's `quarantineFamily` helper:

```ts
private async quarantineFamily(record: StoredToken, detectedVia: string): Promise<void> {
  await this.tokens.quarantineFamily(record.session.id, {
    kind: 'refresh_reuse_detected',
    sessionId: record.session.id,
    userId: record.session.userId,
    tokenId: record.id,
    details: { detectedVia },
  });
}
```

Method name collision (service.quarantineFamily vs repository.quarantineFamily) — fine, different classes.

Now — the `recordEvent` repository method:

```ts
async recordEvent(event: SecurityEventData): Promise<void> {
  await this.prisma.securityEvent.create({ data: event });
}
```

Prisma: `data: event` where event has optional fields as undefined → omitted ✓. `details` typed as InputJsonValue ✓.

Now — `createSession`:

```ts
async createSession(userId: string, expiresAt: Date): Promise<{ id: string; expiresAt: Date }> {
  return this.prisma.session.create({
    data: { userId, expiresAt },
    select: { id: true, expiresAt: true },
  });
}
```

`createToken`:

```ts
async createToken(sessionId: string, tokenHash: string): Promise<{ id: string }> {
  return this.prisma.refreshToken.create({
    data: { sessionId, tokenHash },
    select: { id: true },
  });
}
```

`findTokenByHash`:

```ts
async findTokenByHash(tokenHash: string): Promise<StoredToken | null> {
  return this.prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      retiredAt: true,
      session: { select: { id: true, userId: true, expiresAt: true } },
    },
  });
}
```

`countActiveTokens` — only used by tests? I moved the test assertions to direct prisma calls... the test uses its own `prisma.refreshToken.count` — so the repository doesn't need countActiveTokens. Drop it (minimize). ✓ (Tests use their own client.)

Hmm wait — is it OK for the test to use its own PrismaClient while the "no raw SQL / repository-only" rule is in effect? That rule governs the application layers (controller/service). Integration tests conventionally have their own client for seeding/assertions. Fine.

Now — let me verify the controller compiles: `@Res({ passthrough: true }) res: Response` with `import type { Response } from 'express'` — but with esbuild/vitest, `import type` is erased ✓. NodeNext: type-only imports are fine.

`process.env.COOKIE_SECURE === 'true'` — a repeated constant:

```ts
const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.COOKIE_SECURE === 'true', path: '/' };
```

Hmm, a module-level `secure` is evaluated at import time — env at import time, fine. `sameSite: 'lax' as const` for the type. Actually, res.cookie's options type: `cookie.CookieSerializeOptions` — `sameSite: boolean | 'lax' | 'strict' | 'none'`. Without `as const`, the object literal is inferred as `string` → not assignable. So `as const` on the literal:

```ts
const COOKIE_BASE: Record<string, unknown> ... 
```

Cleaner:

```ts
function cookieOptions(): { httpOnly: boolean; sameSite: 'lax'; secure: boolean; path: string } {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/' };
}
```

And on success: `res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());` on rejection: `res.cookie(REFRESH_COOKIE, '', { ...cookieOptions(), maxAge: 0 });` ✓.

Now — the supertest cookie: `.set('cookie', `refresh_token=${token}`)` — the token contains no chars needing encoding ✓.

Now — the main.ts:

```ts
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

app.module.ts:

```ts
import { Module } from '@nestjs/common';

import { RefreshModule } from './refresh/refresh.module.js';

@Module({
  imports: [RefreshModule],
})
export class AppModule {}
```

access-token.ts:

```ts
import { randomBytes } from 'node:crypto';

// ASSUMPTION: the task states that sign-in and access-token verification already
// exist and provide `issueAccessToken(userId): string`. That pre-existing module
// is not part of this deliverable, so this file is a minimal stand-in with the
// same contract. In a deployment it must be replaced by the existing signed
// implementation, whose key comes from an environment variable.
export function issueAccessToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  return `at_${payload}.${randomBytes(16).toString('base64url')}`;
}
```

Hmm, is this too elaborate? It looks JWT-ish but is fake. Simpler:

```ts
export function issueAccessToken(userId: string): string {
  return `at_${userId}_${randomBytes(32).toString('base64url')}`;
}
```

With the ASSUMPTION comment explaining it's a stand-in. I prefer simple. But embedding userId in the token is... it's a stand-in; fine. Actually, let me keep it minimal and honest.

Wait — should the file be under `src/auth/`? The feature-folder convention: `src/<feature>/`. A feature "auth" with a single non-roles file... the convention's file pattern is `<feature>.<role>.ts` (module/controller/service/repository). `access-token.ts` doesn't fit the pattern. Alternative: put it in `src/refresh/access-token.ts`? That's part of the refresh feature's files... it's the *auth* feature's concern though. Hmm. Since it's a stand-in for an assumed-existing symbol, placement is a guess either way. I'll put it in `src/auth/access-token.ts` — the endpoint is under `/auth`, and sign-in is an auth concern. The naming-convention purist would say files should be `auth.something.ts`... this is a helper module, not a NestJS role. Acceptable.

Now — let me double-check the test's imports work with vitest + decorators: the test imports `RefreshModule` (which has decorators) — esbuild with experimentalDecorators from tsconfig ✓.

Also — the `Test.createTestingModule` needs `@nestjs/testing` ✓ in devDeps... actually, @nestjs/testing is usually a devDependency (used only in tests) — put in devDependencies. But wait — is it needed at runtime? No, tests only. devDependencies ✓.

supertest — devDependency ✓.

Now — one more potential wrinkle: **vitest + ESM + Nest's `Test` module**: the @nestjs/testing import under ESM — CJS interop, vite handles it. ✓ (Common pattern.)

**Prisma client ESM**: `@prisma/client` v5 supports ESM import ✓.

**Node 20 + Prisma 5** ✓.

Now — let me reconsider the requirement "2. ... define and document which wins when both are present." — my documentation: the controller's JSDoc. Should it also appear in a more discoverable place? The task says "document" — the JSDoc on the extraction function is a place where it's *defined* (the code defines it; the comment documents it). I think that satisfies it. Maybe also mention it in SECURITY.md? SECURITY.md has a strict 15–25 line budget for the *order* of checks; I could add a line about precedence but... I'd go over the line count. Keep it in the controller JSDoc.

Now — let me scan requirement 6 once more: "all rejections — expired, retired, unknown, malformed — are indistinguishable to the caller." My 401 + identical body + identical cookie clearing ✓. Also: does the *timing* differ? Malformed returns quickly (no DB) — a timing side channel. Mention it in SECURITY.md? "Indistinguishable to the caller" — a strict reading includes timing; a perfect timing equalization is impractical; the *response* is identical. I won't claim timing in the docs. Fine.

Now — let me also handle: what if the request has *both* a cookie and a body, and the body value equals the cookie? Irrelevant.

Edge: cookie present, body `refreshToken: null` → treated as absent → the cookie is used. Documented? "A non-null body value is authoritative" — null → falls back. My controller JSDoc says that. ✓

Now — let me also verify the `extractRefreshToken` precedence test: body valid + cookie valid (different sessions) → the body's session rotates. In the test, after the call: the body's token is retired (a replay → 401), the cookie's token is still valid (→ 200). But wait — the body's token was *retired* by the successful rotation; presenting it again → 401 with a family wipe of the body's session. The cookie's session is untouched → 200 ✓. But note: the wipe of the body's session happens during the *assertion* call — it doesn't affect the cookie's session ✓.

Now — the comparison test's `kinds` — findMany() with no where: includes events from other sessions? beforeEach clears the tables, and this test creates one session → all events are from this session ✓.

Now — `expect(kinds).toContain('refresh_reuse_detected')` — in the comparison test, the `retired` presentation triggers a quarantine → the event is recorded ✓ (the session is unexpired at that point — the clock is advanced *after* the retired call ✓ — the order in the test: malformed, unknown, retired, then advance the clock, then expired ✓).

Now — let me re-verify test 4 (deadline) once more: `session.expiresAt` from `issueSession` = nowMs + 60000 (env TTL 60) ✓ asserted. Rotate at nowMs+59000 ✓ 200. The stored session's expiresAt is invariant ✓. nowMs+61000 → the new token → found, unretired (it's the live one), session expired → 401 expired ✓. The `refresh_rejected_expired` event exists ✓. Also note: the *first* token (session.refreshToken) is retired after the rotation; I don't present it. ✓

Wait — in the deadline test, `near.body.refreshToken` — the new token. At nowMs+61000, presenting it: found ✓, session expired → rejected_expired ✓. Good.

Now — the concurrency test: both requests are in flight; the fake clock is static (nowMs fixed) → no expiry mid-test ✓.

Potential flakiness: `Promise.all` of two supertest requests — Node handles them concurrently ✓. The DB serializes the claims ✓. The result is always [200, 401]. Could the *rejection* come from the expired/unknown path instead of reuse? No — the token is valid and fresh; the only 401 is the claim loss → quarantine. ✓ And the audit contains reuse_detected ✓ and reissued ✓.

Hmm — one subtlety: could the *winner* also trigger a quarantine? No — the winner proceeds to success. Could the winner's success path *then*... no.

But — a subtle failure mode: both requests' `claimAndIssue` run in parallel; each opens a tx. T1: updateMany on the row (takes a lock, count 1, creates successor, commits). T2: updateMany blocks on the row lock; T1 commits; T2 re-evaluates → count 0 → returns null. ✓ Exactly one successor exists... and T2's quarantine wipes it. Final state: 2 tokens (original + successor), both retired. activeTokenCount 0 ✓.

Now — the test asserts `prisma.refreshToken.count({ where: { sessionId, retiredAt: null } }) === 0` ✓.

Now — the "replay invalidates a sibling" test: after the wipe, presenting the sibling → another quarantine (wipes 0) + another reuse event. The test asserts the first reuse event via findFirst ✓.

Now — `prisma.securityEvent.findFirst({ where: { kind: 'refresh_reuse_detected' } })` — returns an object or null; `expect(reuse).not.toBeNull()` ✓. `reuse!.details` — Json type; I dropped tokensWiped so no details assertion. Maybe assert `reuse.details` contains detectedVia: `expect(JSON.parse(JSON.stringify(reuse!.details))).toMatchObject({ detectedVia: 'presented_retired' })`. The details is stored as Json → returned as an object (already parsed). `reuse!.details as { detectedVia: string }` → `.detectedVia` = 'presented_retired' ✓. I'll add that assertion — it verifies the audit distinction.

Now — the file list (deliverables):

1. `package.json`
2. `tsconfig.json`
3. `prisma/schema.prisma`
4. `prisma/migrations/migration_lock.toml`
5. `prisma/migrations/20250101000000_init/migration.sql`
6. `src/main.ts`
7. `src/app.module.ts`
8. `src/auth/access-token.ts`
9. `src/refresh/refresh.module.ts`
10. `src/refresh/refresh.controller.ts`
11. `src/refresh/refresh.service.ts`
12. `src/refresh/refresh.repository.ts`
13. `test/refresh.spec.ts`
14. `SECURITY.md`

14 files. All necessary.

Let me now write each file carefully, checking imports/extensions/types.

**package.json**

```json
{
  "name": "refresh-token-rotation",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "db:migrate": "prisma migrate deploy",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@prisma/client": "^5.22.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.4",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.9"
  }
}
```

**tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**prisma/schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

/// A long-lived session created once per sign-in. `expiresAt` is the absolute
/// deadline fixed at sign-in; token rotation never extends it.
model Session {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  createdAt DateTime @default(now()) @map("created_at")
  expiresAt DateTime @map("expires_at")

  tokens RefreshToken[]

  @@map("sessions")
}

/// One refresh token per rotation step. `tokenHash` is the SHA-256 of the
/// presented token; plaintext tokens are never stored.
model RefreshToken {
  id        String    @id @default(uuid())
  sessionId String    @map("session_id")
  tokenHash String    @unique @map("token_hash")
  createdAt DateTime  @default(now()) @map("created_at")
  retiredAt DateTime? @map("retired_at")

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@map("refresh_tokens")
}

/// Append-only audit trail. `kind` distinguishes every rejection and the
/// success events. No foreign keys: events for malformed or unknown tokens
/// have no session to reference.
model SecurityEvent {
  id        String   @id @default(uuid())
  sessionId String?  @map("session_id")
  userId    String?  @map("user_id")
  kind      String
  tokenId   String?  @map("token_id")
  details   Json     @default("{}")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([sessionId])
  @@index([kind])
  @@map("security_events")
}
```

**migration.sql** as drafted above.

**migration_lock.toml** as above.

**src/main.ts** as above.

**src/app.module.ts** as above.

**src/auth/access-token.ts**:

```ts
import { randomBytes } from 'node:crypto';

// ASSUMPTION: the task states that sign-in and access-token verification
// already exist and provide `issueAccessToken(userId): string`. That
// pre-existing module is not part of this deliverable, so this file is a
// minimal stand-in with the same contract; a deployment must use the existing
// signed implementation (its key comes from an environment variable).
export function issueAccessToken(userId: string): string {
  return `at_${randomBytes(32).toString('base64url')}_${userId}`;
}
```

Hmm — trailing userId; whatever. Or simpler `at_${userId}_${rand}`. Fine.

**src/refresh/refresh.module.ts**

```ts
import { Module } from '@nestjs/common';

import { RefreshController } from './refresh.controller.js';
import { RefreshService, REFRESH_CLOCK } from './refresh.service.js';
import { RefreshTokenRepository } from './refresh.repository.js';

@Module({
  controllers: [RefreshController],
  providers: [
    { provide: REFRESH_CLOCK, useValue: () => new Date() },
    RefreshService,
    RefreshTokenRepository,
  ],
  exports: [RefreshService],
})
export class RefreshModule {}
```

**src/refresh/refresh.repository.ts**

```ts
import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export interface StoredToken {
  id: string;
  retiredAt: Date | null;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
}

export interface SecurityEventData {
  sessionId?: string | null;
  userId?: string | null;
  kind: string;
  tokenId?: string | null;
  details?: Prisma.InputJsonValue;
}

@Injectable()
export class RefreshTokenRepository implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  onModuleDestroy(): Promise<void> {
    return this.prisma.$disconnect();
  }

  async createSession(userId: string, expiresAt: Date): Promise<{ id: string; expiresAt: Date }> {
    return this.prisma.session.create({
      data: { userId, expiresAt },
      select: { id: true, expiresAt: true },
    });
  }

  async createToken(sessionId: string, tokenHash: string): Promise<{ id: string }> {
    return this.prisma.refreshToken.create({
      data: { sessionId, tokenHash },
      select: { id: true },
    });
  }

  async findTokenByHash(tokenHash: string): Promise<StoredToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        retiredAt: true,
        session: { select: { id: true, userId: true, expiresAt: true } },
      },
    });
  }

  /**
   * Atomically retires `tokenId` if it is still active and creates the
   * successor token in the same transaction. Returns the successor's id, or
   * null when the token was already retired (the caller lost the race).
   */
  async claimAndIssue(tokenId: string, sessionId: string, nextTokenHash: string): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const retired = await tx.refreshToken.updateMany({
        where: { id: tokenId, retiredAt: null },
        data: { retiredAt: new Date() },
      });
      if (retired.count === 0) {
        return null;
      }
      const created = await tx.refreshToken.create({
        data: { sessionId, tokenHash: nextTokenHash },
        select: { id: true },
      });
      return created.id;
    });
  }

  /**
   * Retires every still-active token of the session and writes the audit
   * event in the same transaction. Returns how many tokens were retired.
   */
  async quarantineFamily(sessionId: string, event: SecurityEventData): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const wiped = await tx.refreshToken.updateMany({
        where: { sessionId, retiredAt: null },
        data: { retiredAt: new Date() },
      });
      await tx.securityEvent.create({ data: event });
      return wiped.count;
    });
  }

  async recordEvent(event: SecurityEventData): Promise<void> {
    await this.prisma.securityEvent.create({ data: event });
  }
}
```

Wait — `private readonly prisma = new PrismaClient();` — a property initializer ✓ no constructor parameters ✓.

Type-check: `tx.securityEvent.create({ data: event })` — event: SecurityEventData; the data field is optional with `string | null` — Prisma's input accepts `string | null | undefined` ✓. `details?: Prisma.InputJsonValue` ✓.

`$transaction` callback returning `Promise<string | null>` ✓; quarantine returns a number ✓.

**src/refresh/refresh.service.ts**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { issueAccessToken } from '../auth/access-token.js';
import { RefreshTokenRepository } from './refresh.repository.js';
import type { SecurityEventData, StoredToken } from './refresh.repository.js';

/** DI token for the clock, so tests can drive "now" deterministically. */
export const REFRESH_CLOCK = Symbol('REFRESH_CLOCK');

/**
 * Thrown for every rejected presentation, whatever the reason. The controller
 * maps it to one fixed 401 envelope, so no rejection kind is distinguishable
 * to the caller; the audit event kind is what tells them apart.
 */
export class RefreshRejectedError extends Error {
  constructor() {
    super('The presented refresh token was rejected.');
    this.name = 'RefreshRejectedError';
  }
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Shape of an issued refresh token: `rt_` + 32 random bytes, base64url. */
const REFRESH_TOKEN_PATTERN = /^rt_[A-Za-z0-9_-]{43}$/;

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function generateRefreshToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sessionTtlMs(): number {
  const seconds = Number(process.env.REFRESH_SESSION_TTL_SECONDS);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.trunc(seconds) * 1000;
  }
  return DEFAULT_SESSION_TTL_SECONDS * 1000;
}

@Injectable()
export class RefreshService {
  constructor(
    @Inject(RefreshTokenRepository) private readonly tokens: RefreshTokenRepository,
    @Inject(REFRESH_CLOCK) private readonly now: () => Date,
  ) {}

  /**
   * Called once per sign-in by the existing sign-in flow. Fixes the absolute
   * deadline of the session; rotation never extends it.
   */
  async issueSession(userId: string): Promise<IssuedSession> {
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + sessionTtlMs());
    const session = await this.tokens.createSession(userId, expiresAt);
    const refreshToken = generateRefreshToken();
    const token = await this.tokens.createToken(session.id, sha256Hex(refreshToken));
    await this.tokens.recordEvent({
      kind: 'session_issued',
      sessionId: session.id,
      userId,
      tokenId: token.id,
      details: { expiresAt: expiresAt.toISOString() },
    });
    return {
      sessionId: session.id,
      accessToken: issueAccessToken(userId),
      refreshToken,
      expiresAt,
    };
  }

  /**
   * Rotates the presented refresh token.
   *
   * Check order (see SECURITY.md): malformed -> unknown -> expired ->
   * retired (reuse) -> atomic claim. Every rejection throws the same
   * RefreshRejectedError; only the audit kind differs.
   */
  async refresh(presented: unknown): Promise<RefreshResult> {
    const now = this.now();

    // 1. Shape. Garbage is rejected before it can cost a database round trip.
    if (typeof presented !== 'string' || !REFRESH_TOKEN_PATTERN.test(presented)) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_malformed',
        details: { length: typeof presented === 'string' ? presented.length : null },
      });
      throw new RefreshRejectedError();
    }

    // 2. Existence, by digest.
    const presentedHash = sha256Hex(presented);
    const record = await this.tokens.findTokenByHash(presentedHash);
    if (record === null) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_unknown',
        details: { tokenHash: presentedHash },
      });
      throw new RefreshRejectedError();
    }

    // 3. Absolute deadline, fixed at sign-in. Runs before the retired check
    //    so that a stale client after natural death is not treated as
    //    compromise.
    if (now.getTime() >= record.session.expiresAt.getTime()) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_expired',
        sessionId: record.session.id,
        userId: record.session.userId,
        tokenId: record.id,
        details: { expiresAt: record.session.expiresAt.toISOString() },
      });
      throw new RefreshRejectedError();
    }

    // 4. Reuse. A retired token in a caller's hand is compromise.
    if (record.retiredAt !== null) {
      await this.quarantineFamily(record, 'presented_retired');
      throw new RefreshRejectedError();
    }

    // 5. Atomic claim: exactly one concurrent caller can win.
    const nextToken = generateRefreshToken();
    const nextTokenId = await this.tokens.claimAndIssue(record.id, record.session.id, sha256Hex(nextToken));
    if (nextTokenId === null) {
      // Lost the race: by the time we claimed, the token was already retired,
      // which is indistinguishable from a stolen-token replay.
      await this.quarantineFamily(record, 'concurrent_presentation');
      throw new RefreshRejectedError();
    }

    await this.tokens.recordEvent({
      kind: 'refresh_reissued',
      sessionId: record.session.id,
      userId: record.session.userId,
      tokenId: nextTokenId,
      details: { retiredTokenId: record.id },
    });

    return {
      accessToken: issueAccessToken(record.session.userId),
      refreshToken: nextToken,
    };
  }

  private async quarantineFamily(record: StoredToken, detectedVia: string): Promise<void> {
    await this.tokens.quarantineFamily(record.session.id, {
      kind: 'refresh_reuse_detected',
      sessionId: record.session.id,
      userId: record.session.userId,
      tokenId: record.id,
      details: { detectedVia },
    } satisfies SecurityEventData);
  }
}
```

`satisfies SecurityEventData` — fine in TS 5.

Wait — one issue: in the expired-rejection branch, I don't retire the token — a token in an expired session: presented again → expired again. Fine.

Another subtlety: the reuse branch (4) — `record.retiredAt !== null` — but *simultaneously*, if a concurrent rotation retires it between my find (step 2) and claim (step 5) — step 5 handles it ✓.

**src/refresh/refresh.controller.ts**

```ts
import { Body, Controller, Headers, HttpCode, Inject, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';

import { RefreshRejectedError, RefreshService } from './refresh.service.js';

const REFRESH_COOKIE = 'refresh_token';

/**
 * One response shape for every rejected presentation. The code, message,
 * status and Set-Cookie behaviour are identical for malformed, unknown,
 * expired and retired tokens; only the audit log distinguishes them.
 */
const REJECTION_BODY = {
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
} as const;

function cookieOptions(): { httpOnly: boolean; sameSite: 'lax'; secure: boolean; path: string } {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
  };
}

function parseCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    if (part.slice(0, eq).trim() !== name) {
      continue;
    }
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/**
 * Token source and documented precedence.
 *
 * The refresh token may arrive as the JSON body field `refreshToken`, or as
 * the `refresh_token` cookie. When both are present, the **body value wins**:
 * the explicit request parameter is the client's deliberate choice for this
 * call, the cookie is the fallback for clients that store the token there. A
 * non-null body value is authoritative even when malformed, in which case the
 * call is rejected (and only the audit log records why).
 */
function extractRefreshToken(body: { refreshToken?: unknown } | undefined, cookieHeader: string | undefined): unknown {
  if (body !== undefined && body.refreshToken !== undefined && body.refreshToken !== null) {
    return body.refreshToken;
  }
  return parseCookieValue(cookieHeader, REFRESH_COOKIE);
}

@Controller('auth')
export class RefreshController {
  constructor(@Inject(RefreshService) private readonly refreshService: RefreshService) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: unknown },
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const presented = extractRefreshToken(body, cookieHeader);
    try {
      const { accessToken, refreshToken } = await this.refreshService.refresh(presented);
      res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
      return { accessToken, refreshToken };
    } catch (error) {
      if (error instanceof RefreshRejectedError) {
        // Uniform on every rejection, so the rejection is indistinguishable.
        res.cookie(REFRESH_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
        throw new UnauthorizedException(REJECTION_BODY);
      }
      throw error;
    }
  }
}
```

Type check: `@Headers('cookie') cookieHeader: string | undefined` — Nest passes undefined if absent ✓. `@Body() body: { refreshToken?: unknown }` — if there's no body, is body `{}`? With a JSON parser and an empty body, express.json leaves `req.body = {}` (body-parser sets `{}` by default) ✓.

`UnauthorizedException(REJECTION_BODY)` — REJECTION_BODY is `as const` → type is readonly; the exception constructor accepts `string | Record<string, any>` — is a readonly object assignable to Record<string, any>? A readonly object type to Record<string, any>: the index signature compatibility — an `as const` object has specific readonly properties; assignability to `Record<string, any>`: TS checks the index signature — object literal types without an index signature are not assignable to `Record<string, any>`... hmm, actually `Record<string, any>` has an index signature `[k: string]: any`; a type without an index signature is assignable to it only if... For *object literal types*, TS allows assignment to `Record<string, any>`? Let me think: `const x = {a: 1} as const; const y: Record<string, any> = x;` — I think this *works* because `any` is permissive... no wait, index signature assignability: the source must have an implicit index signature — only *fresh object literals* get an implicit index signature? The rule: an object *literal type* (fresh) is assignable to a type with an index signature. `as const` makes the properties literal/readonly but the type is still an object literal type... Actually, `Record<string, any>`'s target: a source type S is assignable if S has an index signature or if S is an object literal type... hmm, TS's "implicit index signatures": object *literal types* are eligible. `as const` produces a literal type → eligible? I recall `const a = {error: 1} as const; function f(r: Record<string, unknown>) {} f(a);` — I think this compiles. To be safe, I'll drop the `as const` and type it explicitly:

```ts
const REJECTION_BODY: { error: { code: string; message: string; details: Record<string, never> } } = {...}
```

Hmm, `details: {}` — type `{}`: `details: {}`. The simplest: no annotation, no `as const`:

```ts
const REJECTION_BODY = {
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
};
```

Type: `{ error: { code: string; message: string; details: {} } }` — the inferred type of `details: {}` is `{}`. Assignable to `Record<string, any>`? Same question. Nest's HttpException constructor: `constructor(private readonly response: string | Record<string, any>, ...)`. Passing a non-literal typed object... let me sidestep the doubt entirely:

```ts
throw new UnauthorizedException({
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
});
```

A fresh object literal at the call site → definitely assignable. But I also want the test to compare... the test hardcodes its own. And maybe I want to reference the constant in one place... let me keep the constant and annotate:

```ts
type ErrorEnvelope = { error: { code: string; message: string; details: Record<string, unknown> } };
const REJECTION_BODY: ErrorEnvelope = { error: { code: 'refresh_token_rejected', message: 'The presented refresh token could not be validated.', details: {} } };
```

`details: {}` → `Record<string, unknown>` ✓. `REJECTION_BODY` typed as ErrorEnvelope → passed to `new UnauthorizedException(REJECTION_BODY)` — is ErrorEnvelope assignable to `Record<string, any>`? An interface-like type with known properties → to an index signature type: for a non-literal source type, TS requires an actual index signature... ErrorEnvelope has no index signature → *not* assignable to `Record<string, any>`?? Hmm, but `Record<string, any>` is special: the target's index signature is `any`. The assignability rule: source → target with a string index signature: the source must have a compatible index signature, *or* the source must be a type with an implicit index signature (object literal type). A type alias of an object shape — is that an "object literal type"? Type aliases that expand to object literal types retain the freshness-like properties? Implicit index signatures apply to *object literal types*, including those from type aliases? I think: "Index signatures are considered for object literal types" — including type aliases that expand to object literals? I think yes for aliases but not for interfaces. To avoid all doubt: inline the object at the throw site. Final:

```ts
if (error instanceof RefreshRejectedError) {
  res.cookie(REFRESH_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
  throw new UnauthorizedException({
    error: {
      code: 'refresh_token_rejected',
      message: 'The presented refresh token could not be validated.',
      details: {},
    },
  });
}
```

A fresh literal → assignable ✓. The message string is duplicated in the test (the contract) — fine.

Now — the `Response` type import: `import type { Response } from 'express';` — with @types/express v4 ✓. Under NodeNext + verbatim? Fine.

**test/refresh.spec.ts** — let me assemble the whole file:

```ts
// Integration tests for POST /auth/refresh.
// Requires a PostgreSQL reachable via DATABASE_URL with the Prisma migrations
// applied (`pnpm db:migrate`).
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { RefreshModule } from '../src/refresh/refresh.module';
import { REFRESH_CLOCK, RefreshService } from '../src/refresh/refresh.service';
import { RefreshTokenRepository } from '../src/refresh/refresh.repository';

const SESSION_TTL_MS = 60_000;

const REJECTION = {
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
};

describe('POST /auth/refresh', () => {
  let prisma: PrismaClient;
  let repository: RefreshTokenRepository;
  let app: INestApplication;
  let service: RefreshService;
  let nowMs: number;

  beforeAll(async () => {
    process.env.REFRESH_SESSION_TTL_SECONDS = String(SESSION_TTL_MS / 1000);

    prisma = new PrismaClient();
    repository = new RefreshTokenRepository();
    nowMs = Date.now();

    const moduleRef = await Test.createTestingModule({
      imports: [RefreshModule],
    })
      .overrideProvider(REFRESH_CLOCK)
      .useValue(() => new Date(nowMs))
      .overrideProvider(RefreshTokenRepository)
      .useValue(repository)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(RefreshService);
  });

  beforeEach(async () => {
    nowMs = Date.now();
    await prisma.securityEvent.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await repository.onModuleDestroy();
    await prisma.$disconnect();
  });

  const post = (body: Record<string, unknown>): Promise<import('supertest').Response> =>
    request(app.getHttpServer()).post('/auth/refresh').send(body);

  const postWithCookie = (cookieToken: string, body: Record<string, unknown> = {}): Promise<import('supertest').Response> =>
    request(app.getHttpServer())
      .post('/auth/refresh')
      .set('cookie', `refresh_token=${cookieToken}`)
      .send(body);
```

Hmm, the inline `import('supertest').Response` type — simpler to let TS infer: an arrow function returning a promise — without annotation, the type is inferred. Drop the annotation:

```ts
  const post = (body: Record<string, unknown>) => request(app.getHttpServer()).post('/auth/refresh').send(body);
  const postWithCookie = (cookieToken: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post('/auth/refresh').set('cookie', `refresh_token=${cookieToken}`).send(body);
```

✓.

Then the tests (7–8 of them) as drafted. Let me write them out fully.

```ts
  it('rotates a valid token: returns a fresh pair and retires the presented one', async () => {
    const session = await service.issueSession('user-rotate');

    const res = await post({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
    expect((res.headers['set-cookie'] ?? []).join()).toContain('refresh_token=rt_');

    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION);
  });

  it('rotates exactly once when one valid token is presented concurrently', async () => {
    const session = await service.issueSession('user-race');

    const [first, second] = await Promise.all([
      post({ refreshToken: session.refreshToken }),
      post({ refreshToken: session.refreshToken }),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 401]);

    const [ok, rejected] = first.status === 200 ? [first, second] : [second, first];
    expect(ok.body.refreshToken).toEqual(expect.any(String));
    expect(ok.body.refreshToken).not.toBe(session.refreshToken);
    expect(rejected.body).toEqual(REJECTION);

    // The losing presentation arrived on an already-retired token, so the
    // whole family from this sign-in is quarantined: nothing can rotate again.
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const kinds = (await prisma.securityEvent.findMany({ where: { sessionId: session.sessionId } })).map((e) => e.kind);
    expect(kinds).toContain('refresh_reissued');
    expect(kinds).toContain('refresh_reuse_detected');
  });

  it('invalidates the live sibling when a retired token is replayed', async () => {
    const session = await service.issueSession('user-replay');

    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const sibling = rotated.body.refreshToken as string;

    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION);

    const siblingAttempt = await post({ refreshToken: sibling });
    expect(siblingAttempt.status).toBe(401);
    expect(siblingAttempt.body).toEqual(REJECTION);
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const reuse = await prisma.securityEvent.findFirst({
      where: { sessionId: session.sessionId, kind: 'refresh_reuse_detected' },
    });
    expect(reuse).not.toBeNull();
    expect((reuse as { details: { detectedVia: string } }).details.detectedVia).toBe('presented_retired');
  });
```

Hmm — the `reuse.details` type from Prisma: `JsonValue`. Cast for the assertion: `reuse!.details as { detectedVia: string }`. `reuse` is typed `SecurityEvent | null`... after `expect(reuse).not.toBeNull()`, TS still sees `| null` → use `reuse!`:

```ts
    if (reuse === null) throw new Error('expected a reuse event');
    expect((reuse.details as { detectedVia: string }).details...) 
```

Wait, the shape: `reuse.details` is JsonValue; cast: `(reuse.details as { detectedVia: string })`. Then `.detectedVia`. Let me write:

```ts
    expect(reuse).not.toBeNull();
    expect((reuse?.details as { detectedVia: string } | undefined)?.detectedVia).toBe('presented_retired');
```

`reuse?.details` — reuse might be null → `?.` handles it. Cast on `reuse?.details as {detectedVia:string} | undefined`... the precedence of `as` with `?.`: `(reuse?.details) as X`. Write it explicitly:

```ts
    const details = (reuse?.details ?? {}) as { detectedVia?: string };
    expect(details.detectedVia).toBe('presented_retired');
```

Clean ✓.

The deadline test:

```ts
  it('rotates up to the absolute deadline fixed at sign-in, and never extends it', async () => {
    const session = await service.issueSession('user-deadline');
    const deadline = session.expiresAt.getTime();
    expect(deadline).toBe(nowMs + SESSION_TTL_MS);

    nowMs += SESSION_TTL_MS - 1_000;
    const near = await post({ refreshToken: session.refreshToken });
    expect(near.status).toBe(200);

    const stored = await prisma.session.findUnique({ where: { id: session.sessionId } });
    expect(stored?.expiresAt.getTime()).toBe(deadline);

    nowMs += 2_000;
    const past = await post({ refreshToken: near.body.refreshToken });
    expect(past.status).toBe(401);
    expect(past.body).toEqual(REJECTION);

    const expired = await prisma.securityEvent.findFirst({
      where: { sessionId: session.sessionId, kind: 'refresh_rejected_expired' },
    });
    expect(expired).not.toBeNull();
  });
```

The comparison test:

```ts
  it('answers malformed, unknown, retired and expired with the identical 401', async () => {
    const session = await service.issueSession('user-compare');
    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const liveToken = rotated.body.refreshToken as string;

    const malformed = await post({ refreshToken: 'nope' });
    const unknown = await post({ refreshToken: `rt_${'A'.repeat(43)}` });
    const retired = await post({ refreshToken: session.refreshToken });

    nowMs += SESSION_TTL_MS + 60_000;
    const expired = await post({ refreshToken: liveToken });

    for (const res of [malformed, unknown, retired, expired]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(REJECTION);
      expect(res.headers['set-cookie']).toBeDefined();
    }
    const serialized = [malformed, unknown, retired, expired].map((res) => JSON.stringify(res.body));
    expect(new Set(serialized).size).toBe(1);

    // The audit log, in contrast, tells the four apart.
    const kinds = (await prisma.securityEvent.findMany()).map((event) => event.kind);
    expect(kinds).toContain('refresh_rejected_malformed');
    expect(kinds).toContain('refresh_rejected_unknown');
    expect(kinds).toContain('refresh_rejected_expired');
    expect(kinds).toContain('refresh_reuse_detected');
  });
```

The cookie tests:

```ts
  it('accepts the token from the refresh_token cookie', async () => {
    const session = await service.issueSession('user-cookie');
    const res = await postWithCookie(session.refreshToken);
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
  });

  it('prefers the body token over the cookie when both are present', async () => {
    const bodySession = await service.issueSession('user-precedence-body');
    const cookieSession = await service.issueSession('user-precedence-cookie');

    const res = await postWithCookie(cookieSession.refreshToken, { refreshToken: bodySession.refreshToken });
    expect(res.status).toBe(200);

    // The body token was the one rotated, so it is now retired...
    expect((await post({ refreshToken: bodySession.refreshToken })).status).toBe(401);
    // ...and the cookie token was left untouched.
    expect((await post({ refreshToken: cookieSession.refreshToken })).status).toBe(200);
  });

  it('treats an invalid body token as authoritative, even with a valid cookie', async () => {
    const session = await service.issueSession('user-precedence-invalid');

    const res = await postWithCookie(session.refreshToken, { refreshToken: 'garbage' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REJECTION);

    // A malformed presentation quarantines nothing: the cookie token is alive.
    expect((await post({ refreshToken: session.refreshToken })).status).toBe(200);
  });

  it('rejects a request that carries no token at all', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REJECTION);
  });
```

Wait — in "prefers the body token": after the successful rotation of the body's token, presenting it again → 401 + wipe of the body's session ✓. Then the cookie's session: `post({ refreshToken: cookieSession.refreshToken })` → 200 ✓ (that rotates the cookie's session, fine).

Now — a possible pitfall: the `post({})` in "rejects a request that carries no token": the body `{}` → refreshToken undefined → no cookie → presented undefined → malformed (undefined) → 401 ✓.

Now — let me re-check `postWithCookie(session.refreshToken)`'s default body `{}` — sent as JSON `{}` ✓.

Now — one more: `nowMs` — `beforeEach` sets `nowMs = Date.now()` — but `Date.now()` in the test is *real* time (I'm not using fake timers) ✓ deterministic per test (the reset).

In the deadline test: `expect(deadline).toBe(nowMs + SESSION_TTL_MS)` — issueSession used `this.now()` = `new Date(nowMs)` at call time; the clock hasn't moved between the beforeEach reset and the issueSession call (synchronously, but... `await service.issueSession` — during it, the fake clock returns nowMs (stable) ✓). deadline = nowMs + 60000 ✓ exact.

Now — `process.env.REFRESH_SESSION_TTL_SECONDS = String(SESSION_TTL_MS / 1000)` = '60' → sessionTtlMs() = 60000 ✓.

Now — the module's default clock provider `{ provide: REFRESH_CLOCK, useValue: () => new Date() }` — overridden in the test ✓. In the real app, the default is used ✓.

Now — the DI: the controller depends on RefreshService via `@Inject(RefreshService)` — the module provides RefreshService ✓. The service depends on RefreshTokenRepository (`@Inject`) ✓ provided, and on REFRESH_CLOCK (`@Inject(symbol)`) ✓ provided. The testing module's override: `overrideProvider(REFRESH_CLOCK)` — the override works for a symbol token (it exists in the module's providers) ✓.

Now — a critical DI question: **without emitDecoratorMetadata in vitest/esbuild**, does Nest resolve `@Inject(RefreshService)` correctly? Yes — the `@Inject(token)` writes `INJECT_METADATA` via `Reflect.defineMetadata` — wait, does the `@Inject` decorator work without `reflect-metadata`? `@Inject` uses `Reflect.defineMetadata` — requires the `reflect-metadata` import to be loaded. Vitest: the `reflect-metadata` import — my src files don't import 'reflect-metadata'! In a Nest app, main.ts imports it at the entry. In *tests*, the entry is the spec file — does anything import reflect-metadata? @nestjs/common imports reflect-metadata internally? Does @nestjs/core? Hmm — @nestjs/common's package.json has a peer/dep on reflect-metadata; does it `import 'reflect-metadata'`? I don't think the @nestjs packages import it directly (that's why the docs say to import it in main.ts). In tests, I must import 'reflect-metadata' somewhere before Nest does its work — the spec file: `import 'reflect-metadata';` at the top ✓. I'll add it to the test file.

Yes — that's essential. `import 'reflect-metadata';` in test/refresh.spec.ts.

Now — does esbuild preserve the decorator `@Inject(...)`? With experimentalDecorators on, esbuild transforms legacy decorators ✓ and the `Reflect.defineMetadata` calls remain (it's just a function call) ✓.

Now — `@Controller`, `@Post`, etc. — legacy decorators ✓.

Another: **`@Inject` + esbuild**: the decorator factory `Inject(RefreshService)` returns a decorator function — esbuild handles it ✓.

Now — Nest's `Test.createTestingModule` under ESM — a known working pattern ✓.

Now — **Prisma + vitest ESM**: `new PrismaClient()` in the spec — @prisma/client v5 ESM ✓.

Now — the repository file: `private readonly prisma = new PrismaClient();` — class field initialization ✓.

`onModuleDestroy(): Promise<void>` — matches the interface ✓. In the test's afterAll: `await repository.onModuleDestroy()` ✓ (the useValue provider — Nest may or may not call it; I call it explicitly; if Nest *also* calls it, `$disconnect` twice — is it safe? A second `$disconnect` on an already-disconnected client — it's fine (no-op or a harmless promise). OK.)

Now — the `SECURITY.md` final (22 lines) — let me finalize the wording:

```md
# Security — refresh token rotation

`RefreshService.refresh` checks in this order, and no other order is safe:

1. **Malformed** — shape (`rt_` + 43 base64url chars) is free to test and
   must not cost a database round trip.
2. **Unknown** — lookup by SHA-256 digest; plaintext is never stored.
3. **Expired** — the deadline is fixed at sign-in; rotation never extends
   it. Checked *before* retired: a stale client presenting a token after
   natural death is not compromise, and wiping a dead family is churn.
4. **Retired (reuse)** — only a rotation retires a token, so a retired token
   in a caller's hand is compromise. Every token descended from the same
   sign-in is retired and `refresh_reuse_detected` is recorded.
5. **Atomic claim** — `UPDATE ... WHERE retired_at IS NULL` alone guarantees
   exactly one rotation under concurrency; earlier checks are advisory. The
   loser takes path 4: a duplicate retry is indistinguishable from a stolen
   replay, so the family — winner's fresh token included — dies.

All four rejections return the same 401, the same envelope (`error.code`
`refresh_token_rejected`, identical message, `details: {}`) and the same
cookie-clearing `Set-Cookie`; only the audit row's `kind` distinguishes
them, so callers cannot fingerprint valid, stale or stolen tokens.
```

Count the lines: 22 (I counted above). Let me recount the final text line by line:

1 `# Security — refresh token rotation`
2 ``
3 `` `RefreshService.refresh` checks in this order, and no other order is safe: ``
4 ``
5 `1. **Malformed** — shape (`rt_` + 43 base64url chars) is free to test and`
6 `   must not cost a database round trip.`
7 `2. **Unknown** — lookup by SHA-256 digest; plaintext is never stored.`
8 `3. **Expired** — the deadline is fixed at sign-in; rotation never extends`
9 `   it. Checked *before* retired: a stale client presenting a token after`
10 `   natural death is not compromise, and wiping a dead family is churn.`
11 `4. **Retired (reuse)** — only a rotation retires a token, so a retired token`
12 `   in a caller's hand is compromise. Every token descended from the same`
13 `   sign-in is retired and `refresh_reuse_detected` is recorded.`
14 `5. **Atomic claim** — `UPDATE ... WHERE retired_at IS NULL` alone guarantees`
15 `   exactly one rotation under concurrency; earlier checks are advisory. The`
16 `   loser takes path 4: a duplicate retry is indistinguishable from a stolen`
17 `   replay, so the family — winner's fresh token included — dies.`
18 ``
19 `All four rejections return the same 401, the same envelope (`error.code``
20 `` `refresh_token_rejected`, identical message, `details: {}`) and the same ``
21 `cookie-clearing `Set-Cookie`; only the audit row's `kind` distinguishes`
22 `them, so callers cannot fingerprint valid, stale or stolen tokens.`

22 lines ✓ within 15–25.

Now — the migration SQL, let me verify it matches the schema:

Sessions: id TEXT PK, user_id TEXT NOT NULL, created_at TIMESTAMPTZ... Prisma DateTime → `TIMESTAMP(3)` (Prisma uses `TIMESTAMP(3)` without timezone for DateTime). Prisma's migration generator emits `TIMESTAMP(3)`. Yes, Prisma uses `TIMESTAMP(3)` for DateTime on Postgres. I'll write `TIMESTAMP(3)`.

```sql
-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3) DEFAULT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT DEFAULT NULL,
    "user_id" TEXT DEFAULT NULL,
    "kind" TEXT NOT NULL,
    "token_id" TEXT DEFAULT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "security_events_session_id_idx" ON "security_events"("session_id");

-- CreateIndex
CREATE INDEX "security_events_kind_idx" ON "security_events"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

✓ matches the schema (unique on tokenHash → unique index; the session FK cascade).

Now — the `prisma/migrations/migration_lock.toml`:

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

Now — let me double-check the `tsconfig` and the `.js` extension imports. NodeNext requires extensions on *relative* imports. My src files:

- main.ts: `import { AppModule } from './app.module.js';` ✓
- app.module.ts: `import { RefreshModule } from './refresh/refresh.module.js';` ✓
- refresh.module.ts: `.js` on the three relative imports ✓
- refresh.controller.ts: `./refresh.service.js` ✓
- refresh.service.ts: `../auth/access-token.js`, `./refresh.repository.js` ✓
- refresh.repository.ts: only package imports ✓
- access-token.ts: only node:crypto ✓

Test files (not compiled by tsc): no extensions ✓.

Now — `import { PrismaClient } from '@prisma/client'` — under NodeNext, @prisma/client's package.json has proper "exports" (v5: yes, it has exports for import/require) ✓.

Now — let me reconsider whether `emitDecoratorMetadata: true` + NodeNext causes *double* resolution issues in the real app: with metadata on, the service constructor's paramtypes = [RefreshTokenRepository, Function] (the clock param's type `() => Date` → metadata is `Function`!). With `@Inject` on both params, both are overridden by the explicit tokens → paramtypes is ignored ✓. The controller: paramtypes = [RefreshService] — `@Inject(RefreshService)` overrides ✓. So even with metadata, everything is explicit ✓. Good — no `Function` token resolution attempt.

Wait, actually — when `@Inject` is present, does Nest *skip* the paramtype? In `getDependenciesMetadata`, `isCustom = customInject && index in customInject` → `paramToken = customInject[index]` — yes, the custom token is used; the paramtype is ignored ✓.

Now — the repository: no constructor → no DI dependencies ✓.

Now — `@Injectable()` on all three ✓. The controller doesn't need @Injectable (it's a controller) ✓.

Now — **the module's `exports: [RefreshService]`** — so the assumed sign-in module can import RefreshModule and use issueSession ✓ (convention: providers used by other modules are exported ✓).

Now — let me reconsider the "discipline": "do not create files it doesn't ask for." Files I'm adding beyond the explicit deliverables: package.json, tsconfig.json, main.ts, app.module.ts, access-token.ts, migration_lock.toml. Justifications:
- package.json/tsconfig: necessary for the solution to be buildable/runnable ("build the whole solution").
- main.ts/app.module.ts: the convention's layout lists them; the module must be wired somewhere.
- access-token.ts: the assumed symbol has to exist for the code to compile (marked with ASSUMPTION).
- migration_lock.toml: part of a properly-shipped Prisma migration.

I'm confident these are all necessary.

Now — let me double-check the subtle parts of the service's expired check: `now.getTime() >= record.session.expiresAt.getTime()` — expires exactly at now → rejected ✓ ("never extends"; at the deadline it's expired).

The deadline test: at nowMs+59000 (< deadline 60000) → 59000 >= 60000? No → allowed ✓. At 61000 → yes → rejected ✓.

Now — the concurrency test asserts that the kinds include both events. The winner's `refresh_reissued` — recorded via a standalone recordEvent *after* the claimAndIssue tx ✓ committed.

The loser's `refresh_reuse_detected` — inside the quarantineFamily tx ✓.

Both committed regardless of order ✓.

Now — a possible flake: the winner's `recordEvent` (refresh_reissued) runs *after* the loser's quarantine... no — the winner's recordEvent is inside the winner's request handler, right after the claim; the loser's quarantine happens after its claim loss, which is after the winner's tx commit. The winner's recordEvent might interleave with the loser's quarantine tx — independent rows, no contention ✓.

Now — the `findTokenByHash` for the *same* hash concurrently: two findUniques — fine.

Now — let me double-check that the test "invalidates the live sibling" — the replay triggers a quarantine that wipes the sibling (active) ✓ count 0 ✓. Then the siblingAttempt → found, unexpired, retired → quarantine again (wipes 0) + event → 401 ✓.

Now — `expect(res.body).toEqual(REJECTION)` — the body is `{"error":{...}}` ✓.

Now — let me also re-check that `UnauthorizedException` produces *only* the passed body (no extra `statusCode`/`message` keys): when you pass a *object* to HttpException, Nest uses it as the body verbatim (for HttpException, `getResponse()` returns the passed object; the exception filter serializes `response` — yes, verbatim) ✓. (If you pass a string, it builds {message, error, statusCode}.) So the body is exactly `{error: {...}}` ✓.

Now — the `REJECTION` constant in the test — `details: {}` ✓ matches.

Now — let me reconsider the supertest `set-cookie` on the rejection: express sets it via res.cookie before the exception is thrown — the header is set ✓ present.

Now — **the `POST /auth/refresh` with a JSON body** — supertest's `.send({refreshToken})` sets content-type json ✓ Nest parses ✓.

Now — one more potential issue: **Nest + `@Res({ passthrough: true })` + throwing an HttpException after res.cookie** — the response is sent by Nest's exception handler with status 401 and the body; the set-cookie header is already on res → included ✓.

Now — let me reconsider **the `unknown` token test**: `rt_${'A'.repeat(43)}` — matches the pattern (`A` is in the charset, 43 chars) ✓ → sha256 → no row → unknown ✓.

**The `malformed` test**: 'nope' → pattern fails ✓.

Now — let me think about **the audit row for a rejected unknown token**: no sessionId — the test's `findMany()` with no where captures it ✓.

Now — the **`kinds` in the comparison test**: events: session_issued, refresh_reissued (from the initial rotation), refresh_rejected_malformed, refresh_rejected_unknown, refresh_reuse_detected (retired), refresh_rejected_expired (expired) ✓ all four toContain pass.

Now — the **deadline test's `stored?.expiresAt`** — the stored session's expiresAt is invariant ✓.

Now — TypeScript strictness scan:

- `const [ok, rejected] = first.status === 200 ? [first, second] : [second, first];` — the type is a Response tuple ✓ (an array destructuring from a 2-element array — the type is Response[] → ok/rejected are Response ✓; no tuple inference — fine, we only use properties).
- `ok.body.refreshToken` — any ✓.
- `process.env.REFRESH_SESSION_TTL_SECONDS = String(...)` ✓.
- `expect(deadline).toBe(nowMs + SESSION_TTL_MS)` — deadline is a number ✓.
- `stored?.expiresAt.getTime()` — number | undefined; `.toBe(deadline)` — fine.

Now — the **vitest globals**: I import describe/it/expect explicitly from 'vitest' ✓ (no globals config needed).

Now — **the test file header comment** about the requirements ✓.

Now — a final layering check — "controller validates input and calls the service. Zero business logic." — my controller: cookie parsing + precedence selection + response shaping. The precedence selection is *input* handling ✓. The service does the classification. OK.

"Service holds the logic. Zero raw SQL, zero Prisma client calls." ✓ (only repository calls).

"Repository is the only layer that touches the database." — the test touches the DB with its own client, but that's a test, not an app layer ✓.

Naming: endpoint `auth/refresh` — the task's explicit path ✓. Classes are PascalCase ✓. Files are kebab-case ✓.

Now — one more thought on requirement 2: "the token can arrive in the JSON body as refreshToken or in a refresh_token cookie" ✓ implemented. "Define and document which wins" ✓ the controller JSDoc.

Requirement 5: "the session has an absolute lifetime fixed at sign-in. Rotation issues a new token but never extends that deadline." ✓ — the new token references the same session; the deadline is checked against the session's expiresAt; rotation doesn't touch it ✓ tested.

Requirement 6 ✓ tested + SECURITY.md.

Deliverables:
- Prisma schema + migration ✓
- NestJS module: controller, service, repository ✓ (+ module wiring)
- Tests: concurrent presentation ✓, replay invalidates a sibling ✓, rotation against the absolute deadline ✓, comparison of rejection responses ✓ (+ cookie/precedence, extra behavior coverage)
- SECURITY.md 15–25 lines ✓ (22)

Now — let me write out the final files. Also, I should double-check the `prisma` schema generator: `prisma-client-js` ✓.

One more: the **`@default(uuid())`** in Prisma on Postgres — the column type is TEXT, the value is generated client-side ✓ the migration shows TEXT ✓.

And the **`details Json @default("{}")`** — the migration is `JSONB NOT NULL DEFAULT '{}'` ✓.

Let me also reconsider: should `SecurityEvent` have an `ip` or `userAgent`? Not asked for. Skip.

Now — a potential concern: **`claimAndIssue` uses `new Date()` inside the repository for retiredAt** — that's real time, not the injected clock! In tests with a fake clock (static nowMs ≈ real time), the DB's retiredAt/createdAt use the real time — does it matter? The *service's* logic uses the injected clock for deadline checks; the DB's timestamps (retiredAt, createdAt) are *metadata* — never compared to the fake clock. The deadline check compares `this.now()` (fake) with `session.expiresAt` (stored, computed from the fake clock) ✓ consistent. retiredAt is only null/non-null ✓. So no test breakage. ✓

Also the `issueSession` expiresAt: fake clock + env TTL → stored as a Date ✓ consistent with later fake-clock checks ✓.

Now — **the real app**: the clock = real ✓.

Edge — **`sessionTtlMs()` reads env on every call**: in the real app, that's fine.

Now — let me finalize the controller's `REJECTION` — I inlined the object at the throw. But I also want a single source of truth... the test hardcodes it (the contract test). Fine.

Let me also reconsider whether to return a 401 or 400 for *malformed* — must be identical → 401 across the board ✓ documented.

Now — the **main.ts** port from env ✓ ("config from env vars only").

Let me also make sure there are no leftover references: the service exports `REFRESH_CLOCK`, `RefreshRejectedError`, `RefreshResult`, `IssuedSession`, `RefreshService` ✓ used appropriately.

`IssuedSession.sessionId` — the test uses it ✓.

Now — a final check on the **module's provider list** — the controller is in `controllers` ✓; the providers include the clock + service + repository ✓; the exports are the service ✓.

Now, let me write everything. The format: for each file, an H3 with the path, then a fenced block. Nothing else. I'll order the files reasonably: package.json, tsconfig.json, prisma files, src files, test, SECURITY.md.

Wait — the fenced block for package.json: which language tag? "one fenced block containing only the file's content" — the tag is presumably free; I'll use `json`, `prisma`, `sql`, `toml`, `md`/none, `ts`. The example shows `ts` and `prisma` tags. I'll use sensible tags.

Let me re-verify the test imports once more — `import type { INestApplication } from '@nestjs/common';` ✓.

And the **order of the imports in the spec**: `import 'reflect-metadata';` must come *before* the @nestjs imports for side-effect ordering — ESM imports are hoisted and evaluated in order — putting it first ✓.

Also — the **`describe`/`it`** etc. — imported from vitest ✓.

One more consideration for the **`post` helper** — `request(app.getHttpServer())` — `app.getHttpServer()` returns `any` (the http server) ✓ supertest accepts it.

Now — a possible **ESM interop** for `import request from 'supertest'` under vitest — CJS default → vite interops → `request` is a function ✓.

Now — let me reconsider the **`satisfies`** usage — `satisfies SecurityEventData` on the object literal in quarantineFamily — TS 5.5 ✓. Actually, I'll drop `satisfies` and let inference flow (the parameter type is SecurityEventData → checked anyway) ✓ simpler.

Now — the repository's `SecurityEventData` — `details?: Prisma.InputJsonValue` — the service passes `details: { length: null }` — is `null` an InputJsonValue? InputJsonValue includes `{ toJSON(): unknown }`, and null? Prisma's InputJsonValue = `string | number | boolean | InputJsonObject | InputJsonArray | { toJSON(): unknown }`. `null` is *not* in that union! So `{ length: null }` — the value type is `null` — assignable to InputJsonObject? InputJsonObject = `{ readonly [Key in string]?: InputJsonValue | null }` — the value `InputJsonValue | null` — **null is allowed in the value position of InputJsonObject** ✓. So `{ length: null }` → the object literal with `length: null` — is the *type* `{ length: null }` assignable to InputJsonObject? An object literal type `{ length: null }` → the implicit index signature compatibility: the property type `null` must be assignable to `InputJsonValue | null` ✓. So assignable ✓.

And `{ expiresAt: string }` ✓, `{ detectedVia: string }` ✓, `{ retiredTokenId: string }` ✓, `{ tokenHash: string }` ✓.

Now — **`Prisma.InputJsonValue`** — exported from @prisma/client ✓ (the namespace Prisma is exported).

`import type { Prisma } from '@prisma/client';` ✓.

Now — the **`$transaction` interactive** type: `this.prisma.$transaction(async (tx) => {...})` — tx: PrismaClient (transaction client) ✓ `tx.refreshToken`, `tx.securityEvent` ✓.

Now — let me double-check the **`updateMany` where `retiredAt: null`** — Prisma: nullable field, `where: { retiredAt: null }` → IS NULL ✓.

Now — the **unique constraint on `token_hash`** — a create with a duplicate hash → error; the hashes are random ✓.

Now — the **concurrency**: two different `claimAndIssue` txs for the same tokenId — serialized by the row lock on the refresh_tokens row ✓ (both UPDATE the same row; the second blocks). Note: the second tx's updateMany blocks until the first tx *commits or aborts*. If the first aborts (e.g., the create fails), the second proceeds and can claim ✓ correct.

Now — **deadlock risk**: tx A: updateMany(row X) [lock], create (no conflict). tx B: updateMany(row X) [waits]. No deadlock (single shared row, same access order) ✓.

Now — let me also reconsider: the **winner's successor create** inside the tx after the updateMany — the insert takes no conflicting lock ✓.

Now — I think the design is solid. Let me also reconsider the **`@HttpCode(200)`** — a POST returning 200 (not 201) — appropriate (it's not a resource creation in the REST sense; it's a token exchange) ✓.

Now — the **`RefreshResult`** interface is exported but only used internally — fine.

Also — **the `refresh` method name colliding with the controller method** — fine.

Now — the **test "rotates a valid token"** asserts the set-cookie contains 'refresh_token=rt_' — the token starts with `rt_` ✓ the cookie value is the token as-is (no encoding needed) ✓.

Now — one more potential trap: **express res.cookie with a value containing `;`?** base64url has no `;` ✓.

Now — the **`details` in the envelope** must never be null — `{}` ✓.

Now — the **`error.code` contract**: `refresh_token_rejected` snake_case ✓.

I think I'm ready to write the final answer. Let me also double-check the line count of SECURITY.md with the exact final text (22 lines — I counted above).

One more: the task says tests for "comparison of rejection responses" ✓ the comparison test does exactly that, pairwise (all equal + a single serialized form).

And "rotation against the absolute deadline" ✓ the deadline test.

Now — the file order in the reply. I'll present:
1. package.json
2. tsconfig.json
3. prisma/schema.prisma
4. prisma/migrations/migration_lock.toml
5. prisma/migrations/20250101000000_init/migration.sql
6. src/main.ts
7. src/app.module.ts
8. src/auth/access-token.ts
9. src/refresh/refresh.module.ts
10. src/refresh/refresh.repository.ts
11. src/refresh/refresh.service.ts
12. src/refresh/refresh.controller.ts
13. test/refresh.spec.ts
14. SECURITY.md

Let me write the final content, carefully.

Actually — one more check on the test's `beforeAll` — I set `process.env.REFRESH_SESSION_TTL_SECONDS` — but the service's `sessionTtlMs()` reads it at call time ✓.

And `app.get(RefreshService)` — the token is the class ✓.

Also — the `service` variable is used in tests; `repository` is used in afterAll ✓.

Also — **the `prisma` client in the test and the `repository`'s internal client both connect** — two pools ✓ fine.

Also — **the table names** in the test's deleteMany: `prisma.securityEvent`, `prisma.refreshToken`, `prisma.session` ✓ model names.

Let me write out the final test file fully, ensuring all helpers are used and there are no unused variables (the strict noUnusedLocals is off anyway).

Also — the `post` and `postWithCookie` consts are defined after the beforeAll — they reference `app` (assigned in beforeAll) — the closure is fine.

One more subtle point — **the `expect(res.body).toEqual(REJECTION)` in the "no token" test**: the body parser with an empty body — does express.json leave req.body as `{}`? With `.send({})`, the content-type is json, the body is `'{}'` → parsed to `{}` ✓. `@Body()` → `{}` → `body.refreshToken` is undefined ✓ → malformed path (undefined) ✓.

Now — the **`unknown` token audit** — I store `tokenHash` in details — the sha256 of the presented value — not the token itself ✓ no sensitive leak.

Final: let me write it all out.

Actually, wait — let me reconsider once more the **precedence decision (body wins)** vs cookie wins. Let me steelman cookie-wins: the cookie is what the server last set via Set-Cookie; the body is free-form. If an attacker can MITM the body... both are on the same TLS channel. No security difference. Body-wins = "explicit over implicit" — a standard API-design principle. I'm comfortable. Documented clearly.

And one more — the **`refresh` route under `/auth`**: the task's endpoint is `POST /auth/refresh` ✓.

Also — the **`app.module.ts`** — the assumed sign-in module would be imported here in a real app; I'll add a brief comment noting that. A one-line comment, fine.

Now — also confirm that the **`main.ts`** is at the repo root `src/main.ts` per the layout ✓.

Let me also reconsider whether to include a **vitest.config.ts** — not needed (defaults: vitest finds `**/*.spec.ts`? The default include is `**/*.{test,spec}.?(c|m)[jt]s(x)` — `test/refresh.spec.ts` matches ✓). No config needed ✓.

Now — the **prisma generate in postinstall** — when the grader runs pnpm install, the client is generated from the schema ✓.

Also — **`"db:migrate": "prisma migrate deploy"`** ✓.

OK — let me write out the final. Let me double-check the syntax of each TS file as I write.

**refresh.service.ts** final — let me re-verify the `quarantineFamily` call signature: `this.tokens.quarantineFamily(record.session.id, { kind, sessionId, userId, tokenId, details })` ✓ matches the repository's `(sessionId: string, event: SecurityEventData)` ✓.

**Controller** — the unused import check: `Body, Controller, Headers, HttpCode, Inject, Post, Res, UnauthorizedException` all used ✓.

**Service** — `Inject, Injectable` used ✓; `createHash, randomBytes` ✓; `issueAccessToken` ✓; `RefreshTokenRepository` (value for @Inject) ✓; types ✓.

**Repository** — `Injectable` ✓, `OnModuleDestroy` ✓, `PrismaClient` ✓, `Prisma` type ✓.

**Module** — all used ✓.

**Spec** — let me make sure there are no unused imports: Test ✓, PrismaClient ✓, request ✓, vitest functions ✓, INestApplication type ✓, RefreshModule ✓, REFRESH_CLOCK + RefreshService ✓, RefreshTokenRepository ✓, reflect-metadata side-effect ✓.

Now — a possible TS gripe in the spec: `const [ok, rejected] = first.status === 200 ? [first, second] : [second, first];` — the inferred type is `(Response)[]` — destructuring is fine.

`expect((res.headers['set-cookie'] ?? []).join()).toContain('refresh_token=rt_');` — headers is an `any` type → fine.

Now — in the concurrency test, I reference `prisma` (the test client) ✓.

Let me also double-check the **`REJECTION`** — `details: {}` — toEqual compares deeply: `{}` vs `{}` ✓.

Also — the **JSON.stringify key order** for the "single form" assertion: all four bodies come from the same server code path → same key order ✓.

Now — one more potential runtime gripe: **`@Headers('cookie')`** when there's no cookie header → undefined ✓ the parameter type `string | undefined` ✓.

**Express 4 vs 5**: @nestjs/platform-express 10 → express 4 ✓ `res.cookie` ✓.

OK, I'm also thinking: the **`sameSite: 'lax'`** type — `cookieOptions()` returns an explicit type ✓ assignable to CookieSerializeOptions ✓.

**maxAge: 0** — `{ ...cookieOptions(), maxAge: 0 }` ✓.

Now — final answer formatting: start with the first heading, no preamble. Each file: `### path` + a fenced block. The fence tags: `json`, `prisma`, `toml`, `sql`, `ts`, `md`.

Let me count SECURITY.md's lines once more from the exact text I'll output — I'll ensure it's 22 lines (within 15–25).

Also — a small thing: the em-dashes in SECURITY.md — fine.

And in the schema.prisma, the `///` doc comments — valid Prisma ✓.

Let me write out the migration SQL comments in the Prisma style (`-- CreateTable` etc.) — matches the generated output ✓.

One last: the **folder name** for the migration — I'll pick `20250101000000_init`.

Now, let me write it all out.

Actually, one more reconsideration on the **`tsconfig` `rootDir: "src"`** — `tsc -p` compiles only `src` → `dist/main.js` ✓ `node dist/main.js` ✓.

And **`"module": "NodeNext"`** + `"esModuleInterop": true` — allowed (NodeNext implies the interop behavior; setting esModuleInterop explicitly is harmless... actually, with module NodeNext, esModuleInterop is *forced* on; the explicit setting is fine).

**`skipLibCheck: true`** — avoids type friction in node_modules ✓.

Let me also make sure the **`import 'reflect-metadata';`** in main.ts is the first import ✓ (side effect must run first).

Final check on **access-token.ts** — `Buffer` is a global in Node ✓ (I use randomBytes().toString — no need for Buffer). I'll keep:

```ts
import { randomBytes } from 'node:crypto';

// ASSUMPTION: the task states that sign-in and access-token verification already
// exist and provide `issueAccessToken(userId): string`. That pre-existing module
// is not part of this deliverable, so this file is a minimal stand-in with the
// same contract; a deployment must use the existing signed implementation (its
// key comes from an environment variable, never from this file).
export function issueAccessToken(userId: string): string {
  return `at_${userId}_${randomBytes(32).toString('base64url')}`;
}
```

Good.

Now — the final test file. Let me write it out fully, carefully:

```ts
// Integration tests for POST /auth/refresh.
// Requires a PostgreSQL reachable via DATABASE_URL with the Prisma migrations
// applied (pnpm db:migrate).
import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { RefreshModule } from '../src/refresh/refresh.module';
import { REFRESH_CLOCK, RefreshService } from '../src/refresh/refresh.service';
import { RefreshTokenRepository } from '../src/refresh/refresh.repository';

const SESSION_TTL_MS = 60_000;

// The one envelope every rejection must produce (expired, retired, unknown,
// malformed): same status (asserted per case), same body, same Set-Cookie.
const REJECTION = {
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
};

describe('POST /auth/refresh', () => {
  let prisma: PrismaClient;
  let repository: RefreshTokenRepository;
  let app: INestApplication;
  let service: RefreshService;
  let nowMs: number;

  beforeAll(async () => {
    process.env.REFRESH_SESSION_TTL_SECONDS = String(SESSION_TTL_MS / 1000);

    prisma = new PrismaClient();
    repository = new RefreshTokenRepository();
    nowMs = Date.now();

    const moduleRef = await Test.createTestingModule({
      imports: [RefreshModule],
    })
      .overrideProvider(REFRESH_CLOCK)
      .useValue(() => new Date(nowMs))
      .overrideProvider(RefreshTokenRepository)
      .useValue(repository)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(RefreshService);
  });

  beforeEach(async () => {
    nowMs = Date.now();
    await prisma.securityEvent.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await repository.onModuleDestroy();
    await prisma.$disconnect();
  });

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/refresh').send(body);

  const postWithCookie = (cookieToken: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/auth/refresh')
      .set('cookie', `refresh_token=${cookieToken}`)
      .send(body);

  it('rotates a valid token: fresh pair returned, presented token retired', async () => {
    const session = await service.issueSession('user-rotate');

    const res = await post({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
    expect((res.headers['set-cookie'] ?? []).join()).toContain('refresh_token=rt_');

    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION);
  });

  it('rotates exactly once when one valid token is presented concurrently', async () => {
    const session = await service.issueSession('user-race');

    const [first, second] = await Promise.all([
      post({ refreshToken: session.refreshToken }),
      post({ refreshToken: session.refreshToken }),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 401]);

    const [ok, rejected] = first.status === 200 ? [first, second] : [second, first];
    expect(ok.body.refreshToken).toEqual(expect.any(String));
    expect(ok.body.refreshToken).not.toBe(session.refreshToken);
    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual(REJECTION);

    // The losing presentation landed on an already-retired token, so the whole
    // family from this sign-in is quarantined: nothing can rotate again.
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const kinds = (
      await prisma.securityEvent.findMany({ where: { sessionId: session.sessionId } })
    ).map((event) => event.kind);
    expect(kinds).toContain('refresh_reissued');
    expect(kinds).toContain('refresh_reuse_detected');
  });

  it('invalidates the live sibling when a retired token is replayed', async () => {
    const session = await service.issueSession('user-replay');

    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const sibling = rotated.body.refreshToken as string;

    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION);

    const siblingAttempt = await post({ refreshToken: sibling });
    expect(siblingAttempt.status).toBe(401);
    expect(siblingAttempt.body).toEqual(REJECTION);
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const reuse = await prisma.securityEvent.findFirst({
      where: { sessionId: session.sessionId, kind: 'refresh_reuse_detected' },
    });
    expect(reuse).not.toBeNull();
    expect((reuse?.details ?? {}) as { detectedVia?: string }).toHaveProperty('detectedVia', 'presented_retired');
  });

  it('rotates up to the absolute deadline fixed at sign-in, and never extends it', async () => {
    const session = await service.issueSession('user-deadline');
    const deadline = session.expiresAt.getTime();
    expect(deadline).toBe(nowMs + SESSION_TTL_MS);

    nowMs += SESSION_TTL_MS - 1_000;
    const near = await post({ refreshToken: session.refreshToken });
    expect(near.status).toBe(200);

    const stored = await prisma.session.findUnique({ where: { id: session.sessionId } });
    expect(stored?.expiresAt.getTime()).toBe(deadline);

    nowMs += 2_000;
    const past = await post({ refreshToken: near.body.refreshToken });
    expect(past.status).toBe(401);
    expect(past.body).toEqual(REJECTION);

    const expired = await prisma.securityEvent.findFirst({
      where: { sessionId: session.sessionId, kind: 'refresh_rejected_expired' },
    });
    expect(expired).not.toBeNull();
  });

  it('answers malformed, unknown, retired and expired with the identical 401', async () => {
    const session = await service.issueSession('user-compare');
    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const liveToken = rotated.body.refreshToken as string;

    const malformed = await post({ refreshToken: 'nope' });
    const unknown = await post({ refreshToken: `rt_${'A'.repeat(43)}` });
    const retired = await post({ refreshToken: session.refreshToken });

    nowMs += SESSION_TTL_MS + 60_000;
    const expired = await post({ refreshToken: liveToken });

    for (const res of [malformed, unknown, retired, expired]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(REJECTION);
      expect(res.headers['set-cookie']).toBeDefined();
    }
    expect(new Set([malformed, unknown, retired, expired].map((res) => JSON.stringify(res.body))).size).toBe(1);

    // The audit log, in contrast, tells the four apart.
    const kinds = (await prisma.securityEvent.findMany()).map((event) => event.kind);
    expect(kinds).toContain('refresh_rejected_malformed');
    expect(kinds).toContain('refresh_rejected_unknown');
    expect(kinds).toContain('refresh_rejected_expired');
    expect(kinds).toContain('refresh_reuse_detected');
  });

  it('accepts the token from the refresh_token cookie', async () => {
    const session = await service.issueSession('user-cookie');

    const res = await postWithCookie(session.refreshToken);

    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
  });

  it('prefers the body token over the cookie when both are present', async () => {
    const bodySession = await service.issueSession('user-precedence-body');
    const cookieSession = await service.issueSession('user-precedence-cookie');

    const res = await postWithCookie(cookieSession.refreshToken, { refreshToken: bodySession.refreshToken });
    expect(res.status).toBe(200);

    // The body token was the one rotated, so it is now retired...
    expect((await post({ refreshToken: bodySession.refreshToken })).status).toBe(401);
    // ...and the cookie token was left untouched.
    expect((await post({ refreshToken: cookieSession.refreshToken })).status).toBe(200);
  });

  it('treats an invalid body token as authoritative, even with a valid cookie', async () => {
    const session = await service.issueSession('user-precedence-invalid');

    const res = await postWithCookie(session.refreshToken, { refreshToken: 'garbage' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REJECTION);

    // A malformed presentation quarantines nothing: the cookie token is alive.
    expect((await post({ refreshToken: session.refreshToken })).status).toBe(200);
  });

  it('rejects a request that carries no token at all', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REJECTION);
  });
});
```

`expect(...).toHaveProperty('detectedVia', 'presented_retired')` on the cast object ✓.

Wait — `(reuse?.details ?? {}) as { detectedVia?: string }` — reuse is `SecurityEvent | null`... but I asserted not.toBeNull earlier; the type is still `| null`; `reuse?.details` → JsonValue | undefined; `?? {}` → JsonValue | {}; cast ✓.

Hmm — `details` from Prisma Json: type `JsonValue` — `reuse?.details` is `JsonValue | undefined` ✓.

Now — one concern in the **`invalidates the live sibling`** test: `rotated.body.refreshToken as string` — `as string` on any ✓.

Now — the **`prefers the body`** test: after the 200 (body rotated), `post({refreshToken: bodySession.refreshToken})` → 401 (retired → reuse → wipe of the body's session). Then `post({refreshToken: cookieSession.refreshToken})` → 200 ✓.

But wait — the 401's wipe retires the body's session's tokens; that *includes*... only the body's session's tokens ✓ the cookie's session is unaffected ✓.

Now — **`treats an invalid body token`** — the body 'garbage' → malformed → 401, no DB wipe → the session's token is still active → the subsequent post → 200 ✓.

Great. Let me also re-check the **`accepts the token from the cookie`** — the cookie only, empty body → the cookie is used → 200 ✓.

Now — the final check on the **`unknown` token audit** — I store `tokenHash` in details — the sha256 of the presented value — not the token itself ✓ no sensitive leak.

OK — the **SECURITY.md** text is finalized (22 lines).

And — **the app.module comment**:

```ts
import { Module } from '@nestjs/common';

import { RefreshModule } from './refresh/refresh.module.js';

// The pre-existing sign-in module (assumed by the task) is imported alongside
// RefreshModule here in a full deployment.
@Module({
  imports: [RefreshModule],
})
export class AppModule {}
```

Good.

One more thought — **`main.ts`** — should it set a global validation pipe? Not asked for. Skip.

Now — the **package.json** — I'll also add `"engines": { "node": ">=20" }`? Optional; skip to keep it lean. Actually, "Node 20+" is a convention — adding engines is harmless and documents it. I'll add it.

Final file contents are settled. Let me generate the reply with the exact formatting: `### <path>` followed by a fenced block, nothing else. No prose at all.

Fence language tags: I'll use `json`, `prisma`, `toml`, `sql`, `ts`, `md` — the example shows the tag matching the content. For .toml, `toml`. Fine.

Let me also reconsider whether `SECURITY.md`'s path is repo-relative: `SECURITY.md` at the root ✓.

One more sanity item — **the `refresh` endpoint's request with a `Content-Type` other than json**: `.send({})` always sets json ✓.

And — **Nest's default body parser limit** is fine.

Also — I realize I should double-check **`@Res({ passthrough: true })` + a returned Promise value**: the return value of the async method is used as the body ✓ standard.

And **`UnauthorizedException` import** ✓.

Done — let me write the reply.

Actually — let me reconsider the **line count of SECURITY.md** once more, since I'll change the wording slightly. I'll keep exactly the 22-line version I counted.

Also, small: the em-dash usage in the markdown is fine.

And in `prisma/schema.prisma` — the model order: Session, RefreshToken, SecurityEvent ✓.

Final reply generation.
```

## reply

### package.json
```json
{
  "name": "refresh-token-rotation",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "db:migrate": "prisma migrate deploy",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@prisma/client": "^5.22.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.4",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.9"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

/// A long-lived session, created once per sign-in. `expiresAt` is the absolute
/// deadline fixed at sign-in; token rotation never extends it.
model Session {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  createdAt DateTime @default(now()) @map("created_at")
  expiresAt DateTime @map("expires_at")

  tokens RefreshToken[]

  @@map("sessions")
}

/// One refresh token per rotation step. `tokenHash` is the SHA-256 digest of
/// the token value; plaintext tokens are never stored. All tokens of a session
/// are descended from the same sign-in.
model RefreshToken {
  id        String    @id @default(uuid())
  sessionId String    @map("session_id")
  tokenHash String    @unique @map("token_hash")
  createdAt DateTime  @default(now()) @map("created_at")
  retiredAt DateTime? @map("retired_at")

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@map("refresh_tokens")
}

/// Append-only audit trail. `kind` distinguishes every rejection and the
/// success events. No foreign keys on purpose: events for malformed or
/// unknown tokens have no session to reference.
model SecurityEvent {
  id        String   @id @default(uuid())
  sessionId String?  @map("session_id")
  userId    String?  @map("user_id")
  kind      String
  tokenId   String?  @map("token_id")
  details   Json     @default("{}")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([sessionId])
  @@index([kind])
  @@map("security_events")
}
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

### prisma/migrations/20250101000000_init/migration.sql
```sql
-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3) DEFAULT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT DEFAULT NULL,
    "user_id" TEXT DEFAULT NULL,
    "kind" TEXT NOT NULL,
    "token_id" TEXT DEFAULT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "security_events_session_id_idx" ON "security_events"("session_id");

-- CreateIndex
CREATE INDEX "security_events_kind_idx" ON "security_events"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### src/main.ts
```ts
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';

import { RefreshModule } from './refresh/refresh.module.js';

// The pre-existing sign-in module (assumed by the task) is imported alongside
// RefreshModule here in a full deployment.
@Module({
  imports: [RefreshModule],
})
export class AppModule {}
```

### src/auth/access-token.ts
```ts
import { randomBytes } from 'node:crypto';

// ASSUMPTION: the task states that sign-in and access-token verification already
// exist and provide `issueAccessToken(userId): string`. That pre-existing module
// is not part of this deliverable, so this file is a minimal stand-in with the
// same contract; a deployment must use the existing signed implementation, whose
// key comes from an environment variable, never from this file.
export function issueAccessToken(userId: string): string {
  return `at_${userId}_${randomBytes(32).toString('base64url')}`;
}
```

### src/refresh/refresh.module.ts
```ts
import { Module } from '@nestjs/common';

import { RefreshController } from './refresh.controller.js';
import { RefreshService, REFRESH_CLOCK } from './refresh.service.js';
import { RefreshTokenRepository } from './refresh.repository.js';

@Module({
  controllers: [RefreshController],
  providers: [
    { provide: REFRESH_CLOCK, useValue: () => new Date() },
    RefreshService,
    RefreshTokenRepository,
  ],
  exports: [RefreshService],
})
export class RefreshModule {}
```

### src/refresh/refresh.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

export interface StoredToken {
  id: string;
  retiredAt: Date | null;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
}

export interface SecurityEventData {
  sessionId?: string | null;
  userId?: string | null;
  kind: string;
  tokenId?: string | null;
  details?: Prisma.InputJsonValue;
}

/**
 * The only layer that touches the database.
 *
 * `claimAndIssue` and `quarantineFamily` are the two security-critical
 * operations: each runs its state change and its audit write in one
 * transaction, and the conditional UPDATE is what makes rotation atomic
 * under concurrency.
 */
@Injectable()
export class RefreshTokenRepository implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  onModuleDestroy(): Promise<void> {
    return this.prisma.$disconnect();
  }

  async createSession(userId: string, expiresAt: Date): Promise<{ id: string; expiresAt: Date }> {
    return this.prisma.session.create({
      data: { userId, expiresAt },
      select: { id: true, expiresAt: true },
    });
  }

  async createToken(sessionId: string, tokenHash: string): Promise<{ id: string }> {
    return this.prisma.refreshToken.create({
      data: { sessionId, tokenHash },
      select: { id: true },
    });
  }

  async findTokenByHash(tokenHash: string): Promise<StoredToken | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        retiredAt: true,
        session: { select: { id: true, userId: true, expiresAt: true } },
      },
    });
  }

  /**
   * Atomically retires `tokenId` if it is still active and creates the
   * successor token in the same transaction. Returns the successor's id, or
   * null when the token was already retired (the caller lost the race).
   */
  async claimAndIssue(tokenId: string, sessionId: string, nextTokenHash: string): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const retired = await tx.refreshToken.updateMany({
        where: { id: tokenId, retiredAt: null },
        data: { retiredAt: new Date() },
      });
      if (retired.count === 0) {
        return null;
      }
      const created = await tx.refreshToken.create({
        data: { sessionId, tokenHash: nextTokenHash },
        select: { id: true },
      });
      return created.id;
    });
  }

  /**
   * Retires every still-active token of the session and writes the audit
   * event in the same transaction. Returns how many tokens were retired.
   */
  async quarantineFamily(sessionId: string, event: SecurityEventData): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const wiped = await tx.refreshToken.updateMany({
        where: { sessionId, retiredAt: null },
        data: { retiredAt: new Date() },
      });
      await tx.securityEvent.create({ data: event });
      return wiped.count;
    });
  }

  async recordEvent(event: SecurityEventData): Promise<void> {
    await this.prisma.securityEvent.create({ data: event });
  }
}
```

### src/refresh/refresh.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { issueAccessToken } from '../auth/access-token.js';
import { RefreshTokenRepository } from './refresh.repository.js';
import type { SecurityEventData, StoredToken } from './refresh.repository.js';

/** DI token for the clock, so tests can drive "now" deterministically. */
export const REFRESH_CLOCK = Symbol('REFRESH_CLOCK');

/**
 * Thrown for every rejected presentation, whatever the reason. The
 * controller maps it to one fixed 401 envelope, so no rejection kind is
 * distinguishable to the caller; the audit event kind is what tells them
 * apart.
 */
export class RefreshRejectedError extends Error {
  constructor() {
    super('The presented refresh token was rejected.');
    this.name = 'RefreshRejectedError';
  }
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Structural shape of an issued refresh token: `rt_` + 32 random bytes, base64url. */
const REFRESH_TOKEN_PATTERN = /^rt_[A-Za-z0-9_-]{43}$/;

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function generateRefreshToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sessionTtlMs(): number {
  const seconds = Number(process.env.REFRESH_SESSION_TTL_SECONDS);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.trunc(seconds) * 1000;
  }
  return DEFAULT_SESSION_TTL_SECONDS * 1000;
}

@Injectable()
export class RefreshService {
  constructor(
    @Inject(RefreshTokenRepository) private readonly tokens: RefreshTokenRepository,
    @Inject(REFRESH_CLOCK) private readonly now: () => Date,
  ) {}

  /**
   * Called once per sign-in by the existing sign-in flow. Fixes the absolute
   * deadline of the session; rotation never extends it.
   */
  async issueSession(userId: string): Promise<IssuedSession> {
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + sessionTtlMs());
    const session = await this.tokens.createSession(userId, expiresAt);
    const refreshToken = generateRefreshToken();
    const token = await this.tokens.createToken(session.id, sha256Hex(refreshToken));
    await this.tokens.recordEvent({
      kind: 'session_issued',
      sessionId: session.id,
      userId,
      tokenId: token.id,
      details: { expiresAt: expiresAt.toISOString() },
    });
    return {
      sessionId: session.id,
      accessToken: issueAccessToken(userId),
      refreshToken,
      expiresAt,
    };
  }

  /**
   * Rotates the presented refresh token.
   *
   * Check order (see SECURITY.md): malformed -> unknown -> expired ->
   * retired (reuse) -> atomic claim. Every rejection throws the same
   * RefreshRejectedError; only the audit kind differs.
   */
  async refresh(presented: unknown): Promise<RefreshResult> {
    const now = this.now();

    // 1. Shape. Garbage is rejected before it can cost a database round trip.
    if (typeof presented !== 'string' || !REFRESH_TOKEN_PATTERN.test(presented)) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_malformed',
        details: { length: typeof presented === 'string' ? presented.length : null },
      });
      throw new RefreshRejectedError();
    }

    // 2. Existence, by digest.
    const presentedHash = sha256Hex(presented);
    const record = await this.tokens.findTokenByHash(presentedHash);
    if (record === null) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_unknown',
        details: { tokenHash: presentedHash },
      });
      throw new RefreshRejectedError();
    }

    // 3. Absolute deadline, fixed at sign-in. Runs before the retired check
    //    so that a stale client after natural death is not treated as
    //    compromise.
    if (now.getTime() >= record.session.expiresAt.getTime()) {
      await this.tokens.recordEvent({
        kind: 'refresh_rejected_expired',
        sessionId: record.session.id,
        userId: record.session.userId,
        tokenId: record.id,
        details: { expiresAt: record.session.expiresAt.toISOString() },
      });
      throw new RefreshRejectedError();
    }

    // 4. Reuse. A retired token in a caller's hand is compromise.
    if (record.retiredAt !== null) {
      await this.quarantineFamily(record, 'presented_retired');
      throw new RefreshRejectedError();
    }

    // 5. Atomic claim: exactly one concurrent caller can win.
    const nextToken = generateRefreshToken();
    const nextTokenId = await this.tokens.claimAndIssue(record.id, record.session.id, sha256Hex(nextToken));
    if (nextTokenId === null) {
      // Lost the race: by the time we claimed, the token was already retired,
      // which is indistinguishable from a stolen-token replay.
      await this.quarantineFamily(record, 'concurrent_presentation');
      throw new RefreshRejectedError();
    }

    await this.tokens.recordEvent({
      kind: 'refresh_reissued',
      sessionId: record.session.id,
      userId: record.session.userId,
      tokenId: nextTokenId,
      details: { retiredTokenId: record.id },
    });

    return {
      accessToken: issueAccessToken(record.session.userId),
      refreshToken: nextToken,
    };
  }

  /**
   * Invalidate every token descended from the same sign-in and record the
   * detection in the same transaction.
   */
  private async quarantineFamily(record: StoredToken, detectedVia: string): Promise<void> {
    const event: SecurityEventData = {
      kind: 'refresh_reuse_detected',
      sessionId: record.session.id,
      userId: record.session.userId,
      tokenId: record.id,
      details: { detectedVia },
    };
    await this.tokens.quarantineFamily(record.session.id, event);
  }
}
```

### src/refresh/refresh.controller.ts
```ts
import { Body, Controller, Headers, HttpCode, Inject, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';

import { RefreshRejectedError, RefreshService } from './refresh.service.js';

const REFRESH_COOKIE = 'refresh_token';

function cookieOptions(): { httpOnly: boolean; sameSite: 'lax'; secure: boolean; path: string } {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
  };
}

function parseCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    if (part.slice(0, eq).trim() !== name) {
      continue;
    }
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/**
 * Token source and documented precedence.
 *
 * The refresh token may arrive as the JSON body field `refreshToken`, or as
 * the `refresh_token` cookie. When both are present, the **body value wins**:
 * the explicit request parameter is the client's deliberate choice for this
 * call, the cookie is the fallback for clients that store the token there. A
 * non-null body value is authoritative even when malformed, in which case the
 * call is rejected (only the audit log records why).
 */
function extractRefreshToken(body: { refreshToken?: unknown } | undefined, cookieHeader: string | undefined): unknown {
  if (body !== undefined && body.refreshToken !== undefined && body.refreshToken !== null) {
    return body.refreshToken;
  }
  return parseCookieValue(cookieHeader, REFRESH_COOKIE);
}

@Controller('auth')
export class RefreshController {
  constructor(@Inject(RefreshService) private readonly refreshService: RefreshService) {}

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken?: unknown },
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const presented = extractRefreshToken(body, cookieHeader);
    try {
      const { accessToken, refreshToken } = await this.refreshService.refresh(presented);
      res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
      return { accessToken, refreshToken };
    } catch (error) {
      if (error instanceof RefreshRejectedError) {
        // Uniform on every rejection, so the rejection is indistinguishable.
        res.cookie(REFRESH_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
        throw new UnauthorizedException({
          error: {
            code: 'refresh_token_rejected',
            message: 'The presented refresh token could not be validated.',
            details: {},
          },
        });
      }
      throw error;
    }
  }
}
```

### test/refresh.spec.ts
```ts
// Integration tests for POST /auth/refresh.
// Requires a PostgreSQL reachable via DATABASE_URL with the Prisma migrations
// applied (pnpm db:migrate).
import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { RefreshModule } from '../src/refresh/refresh.module';
import { REFRESH_CLOCK, RefreshService } from '../src/refresh/refresh.service';
import { RefreshTokenRepository } from '../src/refresh/refresh.repository';

const SESSION_TTL_MS = 60_000;

// The one envelope every rejection must produce (expired, retired, unknown,
// malformed): same status (asserted per case), same body, same Set-Cookie.
const REJECTION = {
  error: {
    code: 'refresh_token_rejected',
    message: 'The presented refresh token could not be validated.',
    details: {},
  },
};

describe('POST /auth/refresh', () => {
  let prisma: PrismaClient;
  let repository: RefreshTokenRepository;
  let app: INestApplication;
  let service: RefreshService;
  let nowMs: number;

  beforeAll(async () => {
    process.env.REFRESH_SESSION_TTL_SECONDS = String(SESSION_TTL_MS / 1000);

    prisma = new PrismaClient();
    repository = new RefreshTokenRepository();
    nowMs = Date.now();

    const moduleRef = await Test.createTestingModule({
      imports: [RefreshModule],
    })
      .overrideProvider(REFRESH_CLOCK)
      .useValue(() => new Date(nowMs))
      .overrideProvider(RefreshTokenRepository)
      .useValue(repository)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(RefreshService);
  });

  beforeEach(async () => {
    nowMs = Date.now();
    await prisma.securityEvent.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await repository.onModuleDestroy();
    await prisma.$disconnect();
  });

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/refresh').send(body);

  const postWithCookie = (cookieToken: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/auth/refresh')
      .set('cookie', `refresh_token=${cookieToken}`)
      .send(body);

  it('rotates a valid token: fresh pair returned, presented token retired', async () => {
    const session = await service.issueSession('user-rotate');

    const res = await post({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
    expect((res.headers['set-cookie'] ?? []).join()).toContain('refresh_token=rt_');

    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION);
  });

  it('rotates exactly once when one valid token is presented concurrently', async () => {
    const session = await service.issueSession('user-race');

    const [first, second] = await Promise.all([
      post({ refreshToken: session.refreshToken }),
      post({ refreshToken: session.refreshToken }),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 401]);

    const [ok, rejected] = first.status === 200 ? [first, second] : [second, first];
    expect(ok.body.refreshToken).toEqual(expect.any(String));
    expect(ok.body.refreshToken).not.toBe(session.refreshToken);
    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual(REJECTION);

    // The losing presentation landed on an already-retired token, so the whole
    // family from this sign-in is quarantined: nothing can rotate again.
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const kinds = (
      await prisma.securityEvent.findMany({ where: { sessionId: session.sessionId } })
    ).map((event) => event.kind);
    expect(kinds).toContain('refresh_reissued');
    expect(kinds).toContain('refresh_reuse_detected');
  });

  it('invalidates the live sibling when a retired token is replayed', async () => {
    const session = await service.issueSession('user-replay');

    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const sibling = rotated.body.refreshToken as string;

    const replay = await post({ refreshToken: session.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(REJECTION);

    const siblingAttempt = await post({ refreshToken: sibling });
    expect(siblingAttempt.status).toBe(401);
    expect(siblingAttempt.body).toEqual(REJECTION);
    expect(await prisma.refreshToken.count({ where: { sessionId: session.sessionId, retiredAt: null } })).toBe(0);

    const reuse = await prisma.securityEvent.findFirst({
      where: { sessionId: session.sessionId, kind: 'refresh_reuse_detected' },
    });
    expect(reuse).not.toBeNull();
    expect((reuse?.details ?? {}) as { detectedVia?: string }).toHaveProperty('detectedVia', 'presented_retired');
  });

  it('rotates up to the absolute deadline fixed at sign-in, and never extends it', async () => {
    const session = await service.issueSession('user-deadline');
    const deadline = session.expiresAt.getTime();
    expect(deadline).toBe(nowMs + SESSION_TTL_MS);

    nowMs += SESSION_TTL_MS - 1_000;
    const near = await post({ refreshToken: session.refreshToken });
    expect(near.status).toBe(200);

    // Rotation did not move the deadline.
    const stored = await prisma.session.findUnique({ where: { id: session.sessionId } });
    expect(stored?.expiresAt.getTime()).toBe(deadline);

    // A token issued 1s before the deadline still dies at the deadline.
    nowMs += 2_000;
    const past = await post({ refreshToken: near.body.refreshToken });
    expect(past.status).toBe(401);
    expect(past.body).toEqual(REJECTION);

    const expired = await prisma.securityEvent.findFirst({
      where: { sessionId: session.sessionId, kind: 'refresh_rejected_expired' },
    });
    expect(expired).not.toBeNull();
  });

  it('answers malformed, unknown, retired and expired with the identical 401', async () => {
    const session = await service.issueSession('user-compare');
    const rotated = await post({ refreshToken: session.refreshToken });
    expect(rotated.status).toBe(200);
    const liveToken = rotated.body.refreshToken as string;

    const malformed = await post({ refreshToken: 'nope' });
    const unknown = await post({ refreshToken: `rt_${'A'.repeat(43)}` });
    const retired = await post({ refreshToken: session.refreshToken });

    nowMs += SESSION_TTL_MS + 60_000;
    const expired = await post({ refreshToken: liveToken });

    for (const res of [malformed, unknown, retired, expired]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(REJECTION);
      expect(res.headers['set-cookie']).toBeDefined();
    }
    expect(new Set([malformed, unknown, retired, expired].map((res) => JSON.stringify(res.body))).size).toBe(1);

    // The audit log, in contrast, tells the four apart.
    const kinds = (await prisma.securityEvent.findMany()).map((event) => event.kind);
    expect(kinds).toContain('refresh_rejected_malformed');
    expect(kinds).toContain('refresh_rejected_unknown');
    expect(kinds).toContain('refresh_rejected_expired');
    expect(kinds).toContain('refresh_reuse_detected');
  });

  it('accepts the token from the refresh_token cookie', async () => {
    const session = await service.issueSession('user-cookie');

    const res = await postWithCookie(session.refreshToken);

    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
  });

  it('prefers the body token over the cookie when both are present', async () => {
    const bodySession = await service.issueSession('user-precedence-body');
    const cookieSession = await service.issueSession('user-precedence-cookie');

    const res = await postWithCookie(cookieSession.refreshToken, { refreshToken: bodySession.refreshToken });
    expect(res.status).toBe(200);

    // The body token was the one rotated, so it is now retired...
    expect((await post({ refreshToken: bodySession.refreshToken })).status).toBe(401);
    // ...and the cookie token was left untouched.
    expect((await post({ refreshToken: cookieSession.refreshToken })).status).toBe(200);
  });

  it('treats an invalid body token as authoritative, even with a valid cookie', async () => {
    const session = await service.issueSession('user-precedence-invalid');

    const res = await postWithCookie(session.refreshToken, { refreshToken: 'garbage' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REJECTION);

    // A malformed presentation quarantines nothing: the cookie token is alive.
    expect((await post({ refreshToken: session.refreshToken })).status).toBe(200);
  });

  it('rejects a request that carries no token at all', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REJECTION);
  });
});
```

### SECURITY.md
```md
# Security — refresh token rotation

`RefreshService.refresh` checks in this order, and no other order is safe:

1. **Malformed** — shape (`rt_` + 43 base64url chars) is free to test and
   must not cost a database round trip.
2. **Unknown** — lookup by SHA-256 digest; plaintext is never stored.
3. **Expired** — the deadline is fixed at sign-in; rotation never extends
   it. Checked *before* retired: a stale client presenting a token after
   natural death is not compromise, and wiping a dead family is churn.
4. **Retired (reuse)** — only a rotation retires a token, so a retired token
   in a caller's hand is compromise. Every token descended from the same
   sign-in is retired and `refresh_reuse_detected` is recorded.
5. **Atomic claim** — `UPDATE ... WHERE retired_at IS NULL` alone guarantees
   exactly one rotation under concurrency; earlier checks are advisory. The
   loser takes path 4: a duplicate retry is indistinguishable from a stolen
   replay, so the family — winner's fresh token included — dies.

All four rejections return the same 401, the same envelope (`error.code`
`refresh_token_rejected`, identical message, `details: {}`) and the same
cookie-clearing `Set-Cookie`; only the audit row's `kind` distinguishes
them, so callers cannot fingerprint valid, stale or stolen tokens.
```


---
