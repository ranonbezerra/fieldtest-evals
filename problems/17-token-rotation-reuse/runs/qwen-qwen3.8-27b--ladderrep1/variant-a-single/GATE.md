$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 46, reused 46, downloaded 0, added 0
Progress: resolved 280, reused 233, downloaded 0, added 0
Packages: +235
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 282, reused 235, downloaded 0, added 235, done

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
+ vitest 1.6.1 (5.0.0 is available)

Done in 3.2s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 78ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to react to database changes in your app as they happen? Discover how with Pulse: https://pris.ly/tip-1-pulse



$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

 RUN  v1.6.1 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/17-token-rotation-reuse/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace

 ❯ test/auth.spec.ts  (7 tests) 5ms

 Test Files  1 failed (1)
      Tests   (7)
   Start at  01:54:56
   Duration  674ms (transform 29ms, setup 0ms, collect 218ms, tests 5ms, environment 0ms, prepare 36ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/auth.spec.ts [ test/auth.spec.ts ]
PrismaClientInitializationError: error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:7
   | 
 6 |   provider = "postgresql"
 7 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
 ❯ t node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/runtime/library.js:112:2488
 ❯ test/auth.spec.ts:27:3
     25| 
     26| beforeAll(async () => {
     27|   await prisma.$connect();
       |   ^
     28|   const moduleRef = await Test.createTestingModule({ imports: [AuthMod…
     29|   app = moduleRef.createNestApplication();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { clientVersion: '5.22.0', errorCode: 'P1012' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


