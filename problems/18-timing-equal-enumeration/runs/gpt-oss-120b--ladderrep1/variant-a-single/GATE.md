$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 26, reused 25, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 84
Progress: resolved 132, reused 85, downloaded 0, added 85, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/node 22.20.2
+ prisma 5.22.0 (8.0.0-rc.14 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.6s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 12ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 19ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to react to database changes in your app as they happen? Discover how with Pulse: https://pris.ly/tip-1-pulse



$ tsc --noEmit (attempt 0) -> 2
src/auth/auth.service.ts(2,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.
src/auth/dto/sign-in.dto.ts(1,46): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/auth/dto/sign-up.dto.ts(1,46): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
test/auth.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/auth.spec.ts(3,21): error TS2307: Cannot find module 'supertest' or its corresponding type declarations.
test/auth.spec.ts(6,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/auth/dto/sign-in.dto.ts(1,10): error TS2305: Module '"class-validator"' has no exported member 'IsEmail'.
src/auth/dto/sign-in.dto.ts(1,19): error TS2305: Module '"class-validator"' has no exported member 'IsString'.
src/auth/dto/sign-in.dto.ts(1,29): error TS2305: Module '"class-validator"' has no exported member 'MinLength'.
src/auth/dto/sign-up.dto.ts(1,10): error TS2305: Module '"class-validator"' has no exported member 'IsEmail'.
src/auth/dto/sign-up.dto.ts(1,19): error TS2305: Module '"class-validator"' has no exported member 'IsString'.
src/auth/dto/sign-up.dto.ts(1,29): error TS2305: Module '"class-validator"' has no exported member 'MinLength'.
test/auth.spec.ts(1,10): error TS2305: Module '"@nestjs/testing"' has no exported member 'Test'.
test/auth.spec.ts(1,16): error TS2305: Module '"@nestjs/testing"' has no exported member 'TestingModule'.


$ tsc --noEmit (attempt 2) -> 2
test/auth.spec.ts(27,22): error TS2503: Cannot find namespace 'nestTesting'.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/gpt-oss-120b--ladder/variant-a-single/workspace

 ❯ test/auth.spec.ts (0 test)

 Test Files  1 failed (1)
      Tests  no tests
   Start at  12:02:10
   Duration  553ms (transform 397ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 34ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/auth.spec.ts [ test/auth.spec.ts ]
Error: Failed to load url @nestjs/testing (resolved id: @nestjs/testing) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/gpt-oss-120b--ladder/variant-a-single/workspace/test/auth.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.2/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


