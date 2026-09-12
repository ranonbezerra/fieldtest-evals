$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 33, reused 22, downloaded 0, added 0
Progress: resolved 250, reused 203, downloaded 0, added 0
Packages: +204
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 251, reused 204, downloaded 0, added 204, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 10.4.22 (12.0.1 is available)
+ @types/express 4.17.25 (5.0.6 is available)
+ @types/node 20.19.43 (22.20.2 is available)
+ @types/supertest 6.0.3 (7.2.1 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ supertest 7.2.2
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 3.1s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 24ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Interested in query caching in just a few lines of code? Try Accelerate today! https://pris.ly/tip-3-accelerate

┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 8.0.0-rc.13                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1
55 
  56 beforeEach(async () => {
  57   nowMs = Date.now();
→ 58   await prisma.securityEvent.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
   × POST /auth/refresh > answers malformed, unknown, retired and expired with the identical 401 0ms
     → 
Invalid `prisma.securityEvent.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/17-token-rotation-reuse/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/refresh.spec.ts:58:32

  55 
  56 beforeEach(async () => {
  57   nowMs = Date.now();
→ 58   await prisma.securityEvent.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
   × POST /auth/refresh > accepts the token from the refresh_token cookie 0ms
     → 
Invalid `prisma.securityEvent.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/17-token-rotation-reuse/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/refresh.spec.ts:58:32

  55 
  56 beforeEach(async () => {
  57   nowMs = Date.now();
→ 58   await prisma.securityEvent.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
   × POST /auth/refresh > prefers the body token over the cookie when both are present 0ms
     → 
Invalid `prisma.securityEvent.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/17-token-rotation-reuse/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/refresh.spec.ts:58:32

  55 
  56 beforeEach(async () => {
  57   nowMs = Date.now();
→ 58   await prisma.securityEvent.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
   × POST /auth/refresh > treats an invalid body token as authoritative, even with a valid cookie 0ms
     → 
Invalid `prisma.securityEvent.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/17-token-rotation-reuse/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/refresh.spec.ts:58:32

  55 
  56 beforeEach(async () => {
  57   nowMs = Date.now();
→ 58   await prisma.securityEvent.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
   × POST /auth/refresh > rejects a request that carries no token at all 0ms
     → 
Invalid `prisma.securityEvent.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/17-token-rotation-reuse/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/refresh.spec.ts:58:32

  55 
  56 beforeEach(async () => {
  57   nowMs = Date.now();
→ 58   await prisma.securityEvent.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1

 Test Files  1 failed (1)
      Tests  9 failed (9)
   Start at  02:56:10
   Duration  1.11s (transform 383ms, setup 0ms, collect 552ms, tests 412ms, environment 0ms, prepare 36ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/refresh.spec.ts > POST /auth/refresh > rotates a valid token: fresh pair returned, presented token retired
 FAIL  test/refresh.spec.ts > POST /auth/refresh > rotates exactly once when one valid token is presented concurrently
 FAIL  test/refresh.spec.ts > POST /auth/refresh > invalidates the live sibling when a retired token is replayed
 FAIL  test/refresh.spec.ts > POST /auth/refresh > rotates up to the absolute deadline fixed at sign-in, and never extends it
 FAIL  test/refresh.spec.ts > POST /auth/refresh > answers malformed, unknown, retired and expired with the identical 401
 FAIL  test/refresh.spec.ts > POST /auth/refresh > accepts the token from the refresh_token cookie
 FAIL  test/refresh.spec.ts > POST /auth/refresh > prefers the body token over the cookie when both are present
 FAIL  test/refresh.spec.ts > POST /auth/refresh > treats an invalid body token as authoritative, even with a valid cookie
 FAIL  test/refresh.spec.ts > POST /auth/refresh > rejects a request that carries no token at all
PrismaClientInitializationError: 
Invalid `prisma.securityEvent.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/17-token-rotation-reuse/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/refresh.spec.ts:58:32

  55 
  56 beforeEach(async () => {
  57   nowMs = Date.now();
→ 58   await prisma.securityEvent.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
 ❯ $n.handleRequestError node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/runtime/library.js:121:7615
 ❯ $n.handleAndLogRequestError node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/runtime/library.js:121:6623
 ❯ $n.request node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/runtime/library.js:121:6307
 ❯ l node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/runtime/library.js:130:9633
 ❯ test/refresh.spec.ts:58:5
     56|   beforeEach(async () => {
     57|     nowMs = Date.now();
     58|     await prisma.securityEvent.deleteMany();
       |     ^
     59|     await prisma.refreshToken.deleteMany();
     60|     await prisma.session.deleteMany();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/9]⎯


