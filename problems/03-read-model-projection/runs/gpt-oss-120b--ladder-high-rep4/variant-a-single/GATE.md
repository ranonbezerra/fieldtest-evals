$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 9, reused 9, downloaded 0, added 0
Progress: resolved 131, reused 84, downloaded 0, added 0
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

Done in 2.9s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 13ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 29ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Need your database queries to be 1000x faster? Accelerate offers you that and more: https://pris.ly/tip-2-accelerate



$ tsc --noEmit (attempt 0) -> 2
ations.
src/company-totals/company-totals.module.ts(4,38): error TS2307: Cannot find module './company-totals.service' or its corresponding type declarations.
src/company-totals/company-totals.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/company-totals/company-totals.service.ts(2,41): error TS2307: Cannot find module './company-totals.repository' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/operations/operations.controller.ts(2,35): error TS2307: Cannot find module './operations.service' or its corresponding type declarations.
src/operations/operations.module.ts(2,38): error TS2307: Cannot find module './operations.controller' or its corresponding type declarations.
src/operations/operations.module.ts(3,35): error TS2307: Cannot find module './operations.service' or its corresponding type declarations.
src/operations/operations.module.ts(4,38): error TS2307: Cannot find module './operations.repository' or its corresponding type declarations.
src/operations/operations.module.ts(5,30): error TS2307: Cannot find module '../prisma.module' or its corresponding type declarations.
src/operations/operations.module.ts(6,41): error TS2307: Cannot find module '../company-totals/company-totals.repository' or its corresponding type declarations.
src/operations/operations.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/operations/operations.service.ts(2,38): error TS2307: Cannot find module './operations.repository' or its corresponding type declarations.
src/operations/operations.service.ts(3,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/operations/operations.service.ts(4,41): error TS2307: Cannot find module '../company-totals/company-totals.repository' or its corresponding type declarations.
src/operations/operations.service.ts(9,19): error TS2694: Namespace '"/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/index".Prisma' has no exported member 'OrderStatus'.
src/operations/operations.service.ts(60,43): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payment-order/payment-order.module.ts(2,37): error TS2307: Cannot find module './payment-order.service' or its corresponding type declarations.
src/payment-order/payment-order.module.ts(3,40): error TS2307: Cannot find module './payment-order.repository' or its corresponding type declarations.
src/payment-order/payment-order.module.ts(4,30): error TS2307: Cannot find module '../prisma.module' or its corresponding type declarations.
src/payment-order/payment-order.module.ts(5,38): error TS2307: Cannot find module '../operations/operations.repository' or its corresponding type declarations.
src/payment-order/payment-order.module.ts(6,41): error TS2307: Cannot find module '../company-totals/company-totals.repository' or its corresponding type declarations.
src/payment-order/payment-order.repository.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/payment-order/payment-order.service.ts(2,31): error TS2307: Cannot find module '../prisma.service' or its corresponding type declarations.
src/payment-order/payment-order.service.ts(3,31): error TS2305: Module '"@prisma/client"' has no exported member 'Decimal'.
src/payment-order/payment-order.service.ts(4,40): error TS2307: Cannot find module './payment-order.repository' or its corresponding type declarations.
src/payment-order/payment-order.service.ts(5,38): error TS2307: Cannot find module '../operations/operations.repository' or its corresponding type declarations.
src/payment-order/payment-order.service.ts(6,41): error TS2307: Cannot find module '../company-totals/company-totals.repository' or its corresponding type declarations.
src/payment-order/payment-order.service.ts(22,50): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payment-order/payment-order.service.ts(50,43): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/prisma.module.ts(2,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.
src/scheduler/repair.scheduler.ts(2,38): error TS2307: Cannot find module '@nestjs/schedule' or its corresponding type declarations.
src/scheduler/repair.scheduler.ts(3,35): error TS2307: Cannot find module '../operations/operations.service' or its corresponding type declarations.
test/operations.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/operations.spec.ts(2,31): error TS2307: Cannot find module '../src/prisma.service' or its corresponding type declarations.
test/operations.spec.ts(3,36): error TS2307: Cannot find module '../src/payment-order/payment-order.module' or its corresponding type declarations.
test/operations.spec.ts(4,34): error TS2307: Cannot find module '../src/operations/operations.module' or its corresponding type declarations.
test/operations.spec.ts(5,37): error TS2307: Cannot find module '../src/company-totals/company-totals.module' or its corresponding type declarations.
test/operations.spec.ts(6,37): error TS2307: Cannot find module '../src/payment-order/payment-order.service' or its corresponding type declarations.
test/operations.spec.ts(7,35): error TS2307: Cannot find module '../src/operations/operations.service' or its corresponding type declarations.
test/operations.spec.ts(8,41): error TS2307: Cannot find module '../src/company-totals/company-totals.repository' or its corresponding type declarations.
test/operations.spec.ts(9,18): error TS2305: Module '"@prisma/client"' has no exported member 'Decimal'.


$ tsc --noEmit (attempt 1) -> 2
src/app.module.ts(2,32): error TS2307: Cannot find module '@nestjs/schedule' or its corresponding type declarations.
src/operations/operations.service.ts(9,19): error TS2694: Namespace '"/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/index".Prisma' has no exported member 'OrderStatus'.
src/payment-order/payment-order.service.ts(7,30): error TS2307: Cannot find module '@prisma/client/runtime' or its corresponding type declarations.
src/scheduler/repair.scheduler.ts(2,38): error TS2307: Cannot find module '@nestjs/schedule' or its corresponding type declarations.
test/operations.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/operations.spec.ts(2,31): error TS2307: Cannot find module '../src/prisma.service' or its corresponding type declarations.
test/operations.spec.ts(3,36): error TS2307: Cannot find module '../src/payment-order/payment-order.module' or its corresponding type declarations.
test/operations.spec.ts(4,34): error TS2307: Cannot find module '../src/operations/operations.module' or its corresponding type declarations.
test/operations.spec.ts(5,37): error TS2307: Cannot find module '../src/company-totals/company-totals.module' or its corresponding type declarations.
test/operations.spec.ts(6,37): error TS2307: Cannot find module '../src/payment-order/payment-order.service' or its corresponding type declarations.
test/operations.spec.ts(7,35): error TS2307: Cannot find module '../src/operations/operations.service' or its corresponding type declarations.
test/operations.spec.ts(8,41): error TS2307: Cannot find module '../src/company-totals/company-totals.repository' or its corresponding type declarations.
test/operations.spec.ts(9,18): error TS2305: Module '"@prisma/client"' has no exported member 'Decimal'.


$ tsc --noEmit (attempt 2) -> 2
src/app.module.ts(2,32): error TS2307: Cannot find module '../nestjs-schedule.js' or its corresponding type declarations.
src/payment-order/payment-order.service.ts(7,15): error TS2305: Module '"@prisma/client"' has no exported member 'Decimal'.
test/operations.spec.ts(1,22): error TS2307: Cannot find module '../nestjs-testing.js' or its corresponding type declarations.
test/operations.spec.ts(9,18): error TS2305: Module '"@prisma/client"' has no exported member 'Decimal'.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace

 ❯ test/operations.spec.ts (0 test)

 Test Files  1 failed (1)
      Tests  no tests
   Start at  21:14:36
   Duration  529ms (transform 374ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 36ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/operations.spec.ts [ test/operations.spec.ts ]
Error: Failed to load url ../nestjs-testing.js (resolved id: ../nestjs-testing.js) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace/test/operations.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.2/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


