$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 16, reused 15, downloaded 1, added 0
Progress: resolved 280, reused 232, downloaded 1, added 0
Packages: +243
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 290, reused 242, downloaded 1, added 243, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ argon2 0.40.3 (0.45.1 is available)
+ jsonwebtoken 9.0.3
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 10.4.22 (12.0.1 is available)
+ @types/jsonwebtoken 9.0.10
+ @types/node 20.19.43 (22.20.2 is available)
+ @types/supertest 6.0.3 (7.2.1 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ supertest 7.2.2
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 1.6.1 (5.0.0 is available)

Done in 3.5s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 71ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Curious about the SQL queries Prisma ORM generates? Optimize helps you enhance your visibility: https://pris.ly/tip-2-optimize

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


$ tsc --noEmit (attempt 0) -> 2
src/auth/auth.controller.ts(34,12): error TS2322: Type 'unknown' is not assignable to type 'string'.
src/auth/auth.controller.ts(34,19): error TS2322: Type 'unknown' is not assignable to type 'string'.


$ tsc --noEmit (attempt 1) -> 0


$ vitest run -> 1

 RUN  v1.6.1 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace

 ❯ test/auth.spec.ts  (9 tests | 3 failed) 403ms
   ❯ test/auth.spec.ts > sign-in with the right password still succeeds and issues a token
     → expected 401 to be 200 // Object.is equality
   ❯ test/auth.spec.ts > sign-up: new and existing branches are statistically indistinguishable over repeated samples
     → expected 15.032345142857142 to be greater than or equal to 20
   ❯ test/auth.spec.ts > sign-in: unknown address and wrong password are statistically indistinguishable over repeated samples
     → expected 0.36651814285714285 to be greater than or equal to 20

 Test Files  1 failed (1)
      Tests  3 failed | 6 passed (9)
   Start at  06:17:38
   Duration  1.33s (transform 378ms, setup 0ms, collect 812ms, tests 403ms, environment 0ms, prepare 41ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/auth.spec.ts > sign-in with the right password still succeeds and issues a token
AssertionError: expected 401 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 401

 ❯ test/auth.spec.ts:160:22
    158| 
    159|   const res = await post('/auth/sign-in', { email, password });
    160|   expect(res.status).toBe(200);
       |                      ^
    161|   const body = JSON.parse(res.text) as { token?: unknown };
    162|   expect(typeof body.token).toBe('string');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  test/auth.spec.ts > sign-up: new and existing branches are statistically indistinguishable over repeated samples
AssertionError: expected 15.032345142857142 to be greater than or equal to 20
 ❯ test/auth.spec.ts:190:21
    188|   // Both branches must be slow enough to have actually run a derivati…
    189|   // deleting the hashing must fail this test.
    190|   expect(freshMean).toBeGreaterThanOrEqual(FLOOR_MS);
       |                     ^
    191|   expect(existingMean).toBeGreaterThanOrEqual(FLOOR_MS);
    192|   // Removing the dummy verify on the existing branch must fail this t…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  test/auth.spec.ts > sign-in: unknown address and wrong password are statistically indistinguishable over repeated samples
AssertionError: expected 0.36651814285714285 to be greater than or equal to 20
 ❯ test/auth.spec.ts:216:23
    214|   const unknownMean = mean(unknown);
    215|   const wrongMean = mean(wrong);
    216|   expect(unknownMean).toBeGreaterThanOrEqual(FLOOR_MS);
       |                       ^
    217|   expect(wrongMean).toBeGreaterThanOrEqual(FLOOR_MS);
    218|   expect(Math.abs(unknownMean - wrongMean)).toBeLessThanOrEqual(tolera…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


