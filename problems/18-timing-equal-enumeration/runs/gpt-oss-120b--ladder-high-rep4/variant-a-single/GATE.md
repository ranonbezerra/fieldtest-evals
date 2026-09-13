$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 9, reused 9, downloaded 0, added 0
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

Done in 2.5s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 12ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 18ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to turn off tips and other hints? https://pris.ly/tip-4-nohints



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,28): error TS2307: Cannot find module './auth/auth.module' or its corresponding type declarations.
src/app.module.ts(3,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.
src/auth/auth.controller.ts(8,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.controller.ts(9,46): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/auth/auth.module.ts(2,32): error TS2307: Cannot find module './auth.controller' or its corresponding type declarations.
src/auth/auth.module.ts(3,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.module.ts(4,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.module.ts(5,33): error TS2307: Cannot find module './password.service' or its corresponding type declarations.
src/auth/auth.module.ts(6,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/auth/auth.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/auth/auth.service.ts(2,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.service.ts(3,33): error TS2307: Cannot find module './password.service' or its corresponding type declarations.
src/auth/auth.service.ts(4,45): error TS2307: Cannot find module './invalid-credentials.exception' or its corresponding type declarations.
src/auth/auth.service.ts(5,27): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../mail.js'?
src/auth/password.service.ts(2,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
test/auth.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/auth.spec.ts(3,26): error TS2307: Cannot find module 'supertest' or its corresponding type declarations.
test/auth.spec.ts(4,27): error TS2307: Cannot find module '../src/app.module' or its corresponding type declarations.
test/auth.spec.ts(5,31): error TS2307: Cannot find module '../src/prisma.service' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/auth/auth.controller.ts(9,46): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/auth/password.service.ts(2,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.
test/auth.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/auth.spec.ts(3,26): error TS2307: Cannot find module 'supertest' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
src/auth/auth.controller.ts(12,4): error TS2554: Expected 2 arguments, but got 0.
src/auth/auth.controller.ts(12,4): error TS1240: Unable to resolve signature of property decorator when called as an expression.
  This expression is not callable.
    Type 'void' has no call signatures.
src/auth/auth.controller.ts(15,4): error TS2554: Expected 2 arguments, but got 0.
src/auth/auth.controller.ts(15,4): error TS1240: Unable to resolve signature of property decorator when called as an expression.
  This expression is not callable.
    Type 'void' has no call signatures.
src/auth/auth.controller.ts(21,4): error TS2554: Expected 2 arguments, but got 0.
src/auth/auth.controller.ts(21,4): error TS1240: Unable to resolve signature of property decorator when called as an expression.
  This expression is not callable.
    Type 'void' has no call signatures.
src/auth/auth.controller.ts(24,4): error TS2554: Expected 2 arguments, but got 0.
src/auth/auth.controller.ts(24,4): error TS1240: Unable to resolve signature of property decorator when called as an expression.
  This expression is not callable.
    Type 'void' has no call signatures.
test/auth.spec.ts(1,16): error TS2459: Module '"@nestjs/testing"' declares 'TestingModule' locally, but it is not exported.
test/auth.spec.ts(33,26): error TS2349: This expression is not callable.
  Type 'typeof import("supertest", { with: { "resolution-mode": "import" } })' has no call signatures.
test/auth.spec.ts(38,28): error TS2349: This expression is not callable.
  Type 'typeof import("supertest", { with: { "resolution-mode": "import" } })' has no call signatures.
test/auth.spec.ts(52,11): error TS2349: This expression is not callable.
  Type 'typeof import("supertest", { with: { "resolution-mode": "import" } })' has no call signatures.
test/auth.spec.ts(57,28): error TS2349: This expression is not callable.
  Type 'typeof import("supertest", { with: { "resolution-mode": "import" } })' has no call signatures.
test/auth.spec.ts(63,30): error TS2349: This expression is not callable.
  Type 'typeof import("supertest", { with: { "resolution-mode": "import" } })' has no call signatures.
test/auth.spec.ts(77,11): error TS2349: This expression is not callable.
  Type 'typeof import("supertest", { with: { "resolution-mode": "import" } })' has no call signatures.
test/auth.spec.ts(92,13): error TS2349: This expression is not callable.
  Type 'typeof import("supertest", { with: { "resolution-mode": "import" } })' has no call signatures.
test/auth.spec.ts(103,13): error TS2349: This expression is not callable.
  Type 'typeof import("supertest", { with: { "resolution-mode": "import" } })' has no call signatures.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace

 ❯ test/auth.spec.ts (0 test)

 Test Files  1 failed (1)
      Tests  no tests
   Start at  22:47:57
   Duration  519ms (transform 333ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 35ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/auth.spec.ts [ test/auth.spec.ts ]
Error: Failed to load url @nestjs/testing (resolved id: @nestjs/testing) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/18-timing-equal-enumeration/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace/test/auth.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.2/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


