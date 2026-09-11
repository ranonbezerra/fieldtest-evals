$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 11, reused 11, downloaded 0, added 0
Progress: resolved 270, reused 198, downloaded 0, added 0
Packages: +213
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 285, reused 213, downloaded 0, added 212
Progress: resolved 285, reused 213, downloaded 0, added 213, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/express 4.17.25 (5.0.6 is available)
+ @types/node 20.19.43 (22.20.2 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ tsx 4.23.13
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 1.6.1 (5.0.0 is available)

Done in 3.5s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 29ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to react to database changes in your app as they happen? Discover how with Pulse: https://pris.ly/tip-1-pulse



$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
   ❯ test/payout.spec.ts > concurrent creation against one account > rejects an unknown account
     → 
Invalid `prisma.ledgerEntry.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/payout.spec.ts:48:24

  45 process.env.PAYOUT_MAX_ATTEMPTS = '3';
  46 process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
  47 await prisma.$transaction([
→ 48   prisma.ledgerEntry.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
   ❯ test/payout.spec.ts > duplicate message delivery (at-least-once) > redelivering a processed message does not call the provider again
     → 
Invalid `prisma.ledgerEntry.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/payout.spec.ts:48:24

  45 process.env.PAYOUT_MAX_ATTEMPTS = '3';
  46 process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
  47 await prisma.$transaction([
→ 48   prisma.ledgerEntry.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
   ❯ test/payout.spec.ts > duplicate message delivery (at-least-once) > redelivering an in-flight message never triggers a second transfer
     → 
Invalid `prisma.ledgerEntry.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/payout.spec.ts:48:24

  45 process.env.PAYOUT_MAX_ATTEMPTS = '3';
  46 process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
  47 await prisma.$transaction([
→ 48   prisma.ledgerEntry.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
   ❯ test/payout.spec.ts > retry exhaustion > stops after the bounded number of attempts, keeps funds held, and flags needs-review
     → 
Invalid `prisma.ledgerEntry.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/payout.spec.ts:48:24

  45 process.env.PAYOUT_MAX_ATTEMPTS = '3';
  46 process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
  47 await prisma.$transaction([
→ 48   prisma.ledgerEntry.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
   ❯ test/payout.spec.ts > definitive provider failure > marks the payout failed and releases the hold
     → 
Invalid `prisma.ledgerEntry.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/payout.spec.ts:48:24

  45 process.env.PAYOUT_MAX_ATTEMPTS = '3';
  46 process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
  47 await prisma.$transaction([
→ 48   prisma.ledgerEntry.deleteMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1

 Test Files  1 failed (1)
      Tests  7 failed (7)
   Start at  20:19:10
   Duration  906ms (transform 30ms, setup 0ms, collect 763ms, tests 19ms, environment 0ms, prepare 36ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/payout.spec.ts > concurrent creation against one account > never overdraws when requests race
 FAIL  test/payout.spec.ts > concurrent creation against one account > retries with the same idempotencyKey create no second payout and reserve nothing extra
 FAIL  test/payout.spec.ts > concurrent creation against one account > rejects an unknown account
 FAIL  test/payout.spec.ts > duplicate message delivery (at-least-once) > redelivering a processed message does not call the provider again
 FAIL  test/payout.spec.ts > duplicate message delivery (at-least-once) > redelivering an in-flight message never triggers a second transfer
 FAIL  test/payout.spec.ts > retry exhaustion > stops after the bounded number of attempts, keeps funds held, and flags needs-review
 FAIL  test/payout.spec.ts > definitive provider failure > marks the payout failed and releases the hold
PrismaClientInitializationError: 
Invalid `prisma.ledgerEntry.deleteMany()` invocation in
/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/01-payout-outbox/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace/test/payout.spec.ts:48:24

  45 process.env.PAYOUT_MAX_ATTEMPTS = '3';
  46 process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
  47 await prisma.$transaction([
→ 48   prisma.ledgerEntry.deleteMany(
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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { clientVersion: '5.22.0', errorCode: undefined }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/7]⎯


