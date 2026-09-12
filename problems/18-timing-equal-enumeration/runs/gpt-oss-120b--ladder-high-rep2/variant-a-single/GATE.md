$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 37, reused 35, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
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

Done in 2.4s using pnpm v10.28.2

$ prisma format -> 0
┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 8.0.0-rc.14                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 18ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Easily identify and fix slow SQL queries in your app. Optimize helps you enhance your visibility: https://pris.ly/--optimize



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,28): error TS2307: Cannot find module './auth/auth.module' or its corresponding type declarations.
src/app.module.ts(3,30): error TS2307: Cannot find module './prisma/prisma.module' or its corresponding type declarations.
src/auth/auth.controller.ts(2,46): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/auth/auth.controller.ts(3,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.module.ts(2,32): error TS2307: Cannot find module './auth.controller' or its corresponding type declarations.
src/auth/auth.module.ts(3,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.module.ts(4,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.repository.ts(2,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/auth/auth.service.ts(2,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.
src/auth/auth.service.ts(3,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.service.ts(4,27): error TS2307: Cannot find module '../mail/mail.service' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/prisma/prisma.module.ts(2,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.
test/auth.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/auth.spec.ts(3,21): error TS2307: Cannot find module 'supertest' or its corresponding type declarations.
test/auth.spec.ts(4,28): error TS2307: Cannot find module '../src/auth/auth.module' or its corresponding type declarations.
test/auth.spec.ts(5,30): error TS2307: Cannot find module '../src/prisma/prisma.module' or its corresponding type declarations.
test/auth.spec.ts(6,31): error TS2307: Cannot find module '../src/prisma/prisma.service' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/auth/auth.controller.ts(2,46): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/auth/auth.service.ts(2,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.
test/auth.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/auth.spec.ts(3,21): error TS2307: Cannot find module 'supertest' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
src/auth/auth.service.ts(13,74): error TS2339: Property 'argon2id' does not exist on type 'typeof import("argon2", { with: { "resolution-mode": "import" } })'.
src/auth/auth.service.ts(37,71): error TS2339: Property 'argon2id' does not exist on type 'typeof import("argon2", { with: { "resolution-mode": "import" } })'.
test/auth.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/auth.spec.ts(61,10): error TS2339: Property 'expect' does not exist on type 'Promise<SuperTestResponse>'.
test/auth.spec.ts(68,10): error TS2339: Property 'expect' does not exist on type 'Promise<SuperTestResponse>'.
test/auth.spec.ts(73,10): error TS2339: Property 'expect' does not exist on type 'Promise<SuperTestResponse>'.
test/auth.spec.ts(90,10): error TS2339: Property 'expect' does not exist on type 'Promise<SuperTestResponse>'.
test/auth.spec.ts(142,10): error TS2339: Property 'expect' does not exist on type 'Promise<SuperTestResponse>'.
test/auth.spec.ts(147,10): error TS2339: Property 'expect' does not exist on type 'Promise<SuperTestResponse>'.
test/auth.spec.ts(153,10): error TS2339: Property 'expect' does not exist on type 'Promise<SuperTestResponse>'.
test/auth.spec.ts(171,10): error TS2339: Property 'expect' does not exist on type 'Promise<SuperTestResponse>'.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace

 ❯ test/auth.spec.ts (0 test)

 Test Files  1 failed (1)
      Tests  no tests
   Start at  16:38:19
   Duration  534ms (transform 374ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 39ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/auth.spec.ts [ test/auth.spec.ts ]
Error: Failed to load url @nestjs/testing (resolved id: @nestjs/testing) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace/test/auth.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.2/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


