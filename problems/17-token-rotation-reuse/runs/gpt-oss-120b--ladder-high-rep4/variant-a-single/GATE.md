$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 8, reused 8, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 63
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

Done in 2.7s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 14ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 20ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want real-time updates to your database without manual polling? Discover how with Pulse: https://pris.ly/tip-0-pulse



$ tsc --noEmit (attempt 0) -> 2
src/auth/auth.controller.ts(10,35): error TS2307: Cannot find module 'express' or its corresponding type declarations.
src/auth/auth.controller.ts(11,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.module.ts(2,32): error TS2307: Cannot find module './auth.controller' or its corresponding type declarations.
src/auth/auth.module.ts(3,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.module.ts(4,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.module.ts(5,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/auth/auth.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/auth/auth.service.ts(2,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.service.ts(3,34): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../utils/token.js'?
test/auth.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/auth.spec.ts(2,29): error TS2307: Cannot find module '../src/auth/auth.service' or its corresponding type declarations.
test/auth.spec.ts(3,32): error TS2307: Cannot find module '../src/auth/auth.controller' or its corresponding type declarations.
test/auth.spec.ts(4,32): error TS2307: Cannot find module '../src/auth/auth.repository' or its corresponding type declarations.
test/auth.spec.ts(6,35): error TS2307: Cannot find module 'express' or its corresponding type declarations.
test/auth.spec.ts(7,30): error TS2307: Cannot find module 'uuid' or its corresponding type declarations.
test/auth.spec.ts(52,38): error TS2339: Property 'randomBytes' does not exist on type 'Crypto'.
test/auth.spec.ts(73,42): error TS2339: Property 'randomBytes' does not exist on type 'Crypto'.


$ tsc --noEmit (attempt 1) -> 2
test/auth.spec.ts(1,37): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/auth.spec.ts(229,28): error TS2554: Expected 3 arguments, but got 2.
test/auth.spec.ts(233,58): error TS2339: Property 'body' does not exist on type 'Response<any, Record<string, any>>'.
test/auth.spec.ts(280,21): error TS2352: Conversion of type '{ body: { refreshToken: string; }; cookies: { refresh_token: string; }; }' to type 'Request<any, any, any, ParsedUrlQuery>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ body: { refreshToken: string; }; cookies: { refresh_token: string; }; }' is missing the following properties from type 'Request<any, any, any, ParsedUrlQuery>': aborted, httpVersion, httpVersionMajor, httpVersionMinor, and 66 more.
test/auth.spec.ts(286,26): error TS2554: Expected 3 arguments, but got 2.
test/auth.spec.ts(293,34): error TS2339: Property 'body' does not exist on type 'Response<any, Record<string, any>>'.


$ tsc --noEmit (attempt 2) -> 2
test/auth.spec.ts(133,19): error TS2347: Untyped function calls may not accept type arguments.
test/auth.spec.ts(134,22): error TS2347: Untyped function calls may not accept type arguments.
test/auth.spec.ts(229,28): error TS2554: Expected 3 arguments, but got 2.
test/auth.spec.ts(233,58): error TS2339: Property 'body' does not exist on type 'Response<any, Record<string, any>>'.
test/auth.spec.ts(280,21): error TS2352: Conversion of type '{ body: { refreshToken: string; }; cookies: { refresh_token: string; }; }' to type 'Request<any, any, any, ParsedUrlQuery>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ body: { refreshToken: string; }; cookies: { refresh_token: string; }; }' is missing the following properties from type 'Request<any, any, any, ParsedUrlQuery>': aborted, httpVersion, httpVersionMajor, httpVersionMinor, and 66 more.
test/auth.spec.ts(286,26): error TS2554: Expected 3 arguments, but got 2.
test/auth.spec.ts(293,34): error TS2339: Property 'body' does not exist on type 'Response<any, Record<string, any>>'.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/17-token-rotation-reuse/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace

 ❯ test/auth.spec.ts (0 test)

 Test Files  1 failed (1)
      Tests  no tests
   Start at  22:43:05
   Duration  549ms (transform 407ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 36ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/auth.spec.ts [ test/auth.spec.ts ]
Error: Failed to load url @nestjs/testing (resolved id: @nestjs/testing) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/17-token-rotation-reuse/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace/test/auth.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.2/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


