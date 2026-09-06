$ pnpm install -> 0
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +172
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 172, reused 172, downloaded 0, added 172, done

dependencies:
+ @nestjs/common 10.4.22
+ @nestjs/core 10.4.22
+ @nestjs/platform-express 10.4.22
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/express 4.17.25
+ @types/node 22.20.1
+ typescript 5.9.3
+ vitest 2.1.9

Done in 664ms using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,37): error TS2307: Cannot find module './notifications/notifications.module' or its corresponding type declarations.
src/app.module.ts(3,29): error TS2307: Cannot find module './users/users.module' or its corresponding type declarations.
src/app.module.ts(4,30): error TS2307: Cannot find module './export/export.module' or its corresponding type declarations.
src/app.module.ts(5,29): error TS2307: Cannot find module './retry/retry.module' or its corresponding type declarations.
src/export/export.module.ts(2,31): error TS2307: Cannot find module './export.service' or its corresponding type declarations.
src/jobs/retry.processor.ts(17,32): error TS2551: Property 'resend' does not exist on type 'NotificationsService'. Did you mean 'send'?
src/notifications/notifications.module.ts(2,38): error TS2307: Cannot find module './notifications.service' or its corresponding type declarations.
src/notifications/notifications.module.ts(3,29): error TS2307: Cannot find module '../retry/retry.module' or its corresponding type declarations.
src/retry/retry.module.ts(2,32): error TS2307: Cannot find module './retry.processor' or its corresponding type declarations.
src/users/users.module.ts(2,30): error TS2307: Cannot find module './users.service' or its corresponding type declarations.
src/users/users.module.ts(3,33): error TS2307: Cannot find module './users.repository' or its corresponding type declarations.
src/users/users.module.ts(4,30): error TS2307: Cannot find module '../export/export.module' or its corresponding type declarations.
test/wiring.spec.ts(1,42): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/wiring.spec.ts(8,31): error TS2307: Cannot find module '../src/export/export.service.js' or its corresponding type declarations.
test/wiring.spec.ts(100,21): error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'typeof import("/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/15-wiring-boot-failure/runs/qwen3.8-27b-mlx-6bit/variant-a/workspace/src/common/queues", { with: { "resolution-mode": "import" } })'.
  No index signature with a parameter of type 'string' was found on type 'typeof import("/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/15-wiring-boot-failure/runs/qwen3.8-27b-mlx-6bit/variant-a/workspace/src/common/queues", { with: { "resolution-mode": "import" } })'.


$ tsc --noEmit (attempt 1) -> 2
src/export/export.module.ts(2,31): error TS2307: Cannot find module './export.service.js' or its corresponding type declarations.
src/users/users.module.ts(3,33): error TS2307: Cannot find module './users.repository.js' or its corresponding type declarations.
test/wiring.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/wiring.spec.ts(6,31): error TS2307: Cannot find module '../src/export/export.service.js' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
src/export/export.module.ts(2,31): error TS2307: Cannot find module './export.service.js' or its corresponding type declarations.
test/wiring.spec.ts(5,39): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/wiring.spec.ts(9,31): error TS2307: Cannot find module '../src/export/export.service.js' or its corresponding type declarations.
test/wiring.spec.ts(46,20): error TS2339: Property 'toBeFrozen' does not exist on type 'Assertion<{ readonly notifications: "notifications"; readonly retries: "retries"; }>'.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/15-wiring-boot-failure/runs/qwen3.8-27b-mlx-6bit/variant-a/workspace

 ❯ test/wiring.spec.ts (0 test)
 ✓ test/users.service.spec.ts (2 tests) 1ms

 Test Files  1 failed | 1 passed (2)
      Tests  2 passed (2)
   Start at  07:33:34
   Duration  642ms (transform 748ms, setup 0ms, collect 472ms, tests 1ms, environment 0ms, prepare 69ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/wiring.spec.ts [ test/wiring.spec.ts ]
Error: Failed to load url @nestjs/testing (resolved id: @nestjs/testing) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/15-wiring-boot-failure/runs/qwen3.8-27b-mlx-6bit/variant-a/workspace/test/wiring.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.1/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


