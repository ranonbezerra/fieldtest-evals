$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 13, reused 11, downloaded 1, added 0
Progress: resolved 140, reused 135, downloaded 2, added 0
Progress: resolved 218, reused 163, downloaded 6, added 0
Packages: +184
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 231, reused 175, downloaded 9, added 183
Progress: resolved 231, reused 175, downloaded 9, added 184, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ class-transformer 0.5.1
+ class-validator 0.14.4 (0.15.1 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/express 4.17.25 (5.0.6 is available)
+ @types/node 20.19.43 (22.20.2 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 4.7s

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 118ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Easily identify and fix slow SQL queries in your app. Optimize helps you enhance your visibility: https://pris.ly/--optimize



$ tsc --noEmit (attempt 0) -> 2
src/operations/operation-totals.controller.ts(11,31): error TS1239: Unable to resolve signature of parameter decorator when called as an expression.
  The runtime will invoke the decorator with 3 arguments, but the decorator expects 2.
src/operations/operation-totals.controller.ts(11,40): error TS1239: Unable to resolve signature of parameter decorator when called as an expression.
  The runtime will invoke the decorator with 3 arguments, but the decorator expects 2.
src/operations/operations.repository.ts(35,29): error TS2724: '"/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen-qwen3.8-27b/variant-a-single/workspace/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/index".Prisma' has no exported member named 'OperationReadModel$createdAtFilters'. Did you mean 'OperationReadModelCreateArgs'?


$ tsc --noEmit (attempt 1) -> 0


$ vitest run -> 1
kipped) 7ms
 ❯ test/concurrent-totals.spec.ts (1 test | 1 skipped) 7ms

 Test Files  3 failed (3)
      Tests  5 skipped (5)
   Start at  19:31:34
   Duration  879ms (transform 37ms, setup 0ms, collect 253ms, tests 335ms, environment 0ms, prepare 71ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/concurrent-totals.spec.ts > concurrent updates to one company totals
PrismaClientInitializationError: error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
 ❯ t node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/runtime/library.js:112:2488
 ❯ test/concurrent-totals.spec.ts:11:5
      9|   beforeAll(async () => {
     10|     prisma = new PrismaService();
     11|     await prisma.$connect();
       |     ^
     12|     ctx = buildContext(prisma);
     13|     await cleanTables(prisma);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  test/concurrent-totals.spec.ts > concurrent updates to one company totals
PrismaClientInitializationError: 
Invalid `prisma.$executeRawUnsafe()` invocation:


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
 ❯ Module.cleanTables test/helpers.ts:47:3
     45| 
     46| export async function cleanTables(prisma: PrismaClient): Promise<void>…
     47|   await prisma.$executeRawUnsafe(
       |   ^
     48|     'TRUNCATE "operation_read_models", "company_operation_totals", "pa…
     49|   );
 ❯ test/concurrent-totals.spec.ts:21:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  test/drift-repair.spec.ts > drift repair
PrismaClientInitializationError: error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
 ❯ t node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/runtime/library.js:112:2488
 ❯ test/drift-repair.spec.ts:12:5
     10|   beforeAll(async () => {
     11|     prisma = new PrismaService();
     12|     await prisma.$connect();
       |     ^
     13|     ctx = buildContext(prisma);
     14|     await cleanTables(prisma);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  test/drift-repair.spec.ts > drift repair
PrismaClientInitializationError: 
Invalid `prisma.$executeRawUnsafe()` invocation:


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
 ❯ Module.cleanTables test/helpers.ts:47:3
     45| 
     46| export async function cleanTables(prisma: PrismaClient): Promise<void>…
     47|   await prisma.$executeRawUnsafe(
       |   ^
     48|     'TRUNCATE "operation_read_models", "company_operation_totals", "pa…
     49|   );
 ❯ test/drift-repair.spec.ts:22:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  test/read-your-own-writes.spec.ts > read-your-own-writes (operations dashboard)
PrismaClientInitializationError: error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
 ❯ t node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/runtime/library.js:112:2488
 ❯ test/read-your-own-writes.spec.ts:11:5
      9|   beforeAll(async () => {
     10|     prisma = new PrismaService();
     11|     await prisma.$connect();
       |     ^
     12|     ctx = buildContext(prisma);
     13|     await cleanTables(prisma);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

 FAIL  test/read-your-own-writes.spec.ts > read-your-own-writes (operations dashboard)
PrismaClientInitializationError: 
Invalid `prisma.$executeRawUnsafe()` invocation:


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
 ❯ Module.cleanTables test/helpers.ts:47:3
     45| 
     46| export async function cleanTables(prisma: PrismaClient): Promise<void>…
     47|   await prisma.$executeRawUnsafe(
       |   ^
     48|     'TRUNCATE "operation_read_models", "company_operation_totals", "pa…
     49|   );
 ❯ test/read-your-own-writes.spec.ts:21:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/6]⎯


