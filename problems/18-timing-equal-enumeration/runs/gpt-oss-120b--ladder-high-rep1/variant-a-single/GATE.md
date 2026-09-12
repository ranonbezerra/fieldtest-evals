$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 27, reused 26, downloaded 0, added 0
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
Formatted prisma/schema.prisma in 14ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 20ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Need your database queries to be 1000x faster? Accelerate offers you that and more: https://pris.ly/tip-2-accelerate



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,28): error TS2307: Cannot find module './auth/auth.module' or its corresponding type declarations.
src/auth/auth.controller.ts(2,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.controller.ts(3,27): error TS2307: Cannot find module './dto/sign-up.dto' or its corresponding type declarations.
src/auth/auth.controller.ts(4,27): error TS2307: Cannot find module './dto/sign-in.dto' or its corresponding type declarations.
src/auth/auth.module.ts(2,32): error TS2307: Cannot find module './auth.controller' or its corresponding type declarations.
src/auth/auth.module.ts(3,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.module.ts(4,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.module.ts(5,29): error TS2307: Cannot find module '../mail/mail.service' or its corresponding type declarations.
src/auth/auth.module.ts(6,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/auth/auth.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/auth/auth.service.ts(2,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.
src/auth/auth.service.ts(3,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.service.ts(4,29): error TS2307: Cannot find module '../mail/mail.service' or its corresponding type declarations.
src/auth/dto/sign-in.dto.ts(1,35): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/auth/dto/sign-up.dto.ts(1,46): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
test/auth.e2e.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/auth.e2e.spec.ts(3,21): error TS2307: Cannot find module 'supertest' or its corresponding type declarations.
test/auth.e2e.spec.ts(4,28): error TS2307: Cannot find module '../src/auth/auth.module' or its corresponding type declarations.
test/auth.e2e.spec.ts(5,31): error TS2307: Cannot find module '../src/prisma.service' or its corresponding type declarations.
test/auth.e2e.spec.ts(6,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
test/auth.e2e.spec.ts(15,22): error TS2709: Cannot use namespace 'TestingModule' as a type.


$ tsc --noEmit (attempt 2) -> 2
test/auth.e2e.spec.ts(16,22): error TS2709: Cannot use namespace 'TestingModule' as a type.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace

 ❯ test/auth.e2e.spec.ts (0 test)

 Test Files  1 failed (1)
      Tests  no tests
   Start at  14:34:44
   Duration  584ms (transform 424ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 36ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/auth.e2e.spec.ts [ test/auth.e2e.spec.ts ]
Error: Failed to load url @nestjs/testing (resolved id: @nestjs/testing) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace/test/auth.e2e.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.2/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


