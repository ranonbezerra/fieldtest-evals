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

Done in 602ms using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 2
test/app.wiring.spec.ts(2,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/exports/exports.controller.ts(1,10): error TS6133: 'Body' is declared but its value is never read.
src/exports/exports.controller.ts(8,3): error TS1241: Unable to resolve signature of method decorator when called as an expression.
  The runtime will invoke the decorator with 2 arguments, but the decorator expects 3.
src/exports/exports.controller.ts(8,4): error TS1270: Decorator function return type 'void | TypedPropertyDescriptor<unknown>' is not assignable to type 'void | ((body: { requestedBy: string; }) => Promise<ExportJob>)'.
  Type 'TypedPropertyDescriptor<unknown>' is not assignable to type 'void | ((body: { requestedBy: string; }) => Promise<ExportJob>)'.
src/exports/exports.controller.ts(9,16): error TS1206: Decorators are not valid here.
src/jobs/jobs.module.ts(6,18): error TS1205: Re-exporting a type when 'isolatedModules' is enabled requires using 'export type'.
test/app.wiring.spec.ts(2,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
src/exports/exports.controller.ts(1,10): error TS6133: 'Body' is declared but its value is never read.
src/exports/exports.controller.ts(8,3): error TS1241: Unable to resolve signature of method decorator when called as an expression.
  The runtime will invoke the decorator with 2 arguments, but the decorator expects 3.
src/exports/exports.controller.ts(8,4): error TS1270: Decorator function return type 'void | TypedPropertyDescriptor<unknown>' is not assignable to type 'void | ((body: { requestedBy: string; }) => Promise<ExportJob>)'.
  Type 'TypedPropertyDescriptor<unknown>' is not assignable to type 'void | ((body: { requestedBy: string; }) => Promise<ExportJob>)'.
src/exports/exports.controller.ts(9,16): error TS1206: Decorators are not valid here.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/15-wiring-boot-failure/runs/inclusionai-ling-3.0-flash--ladder/variant-a-single/workspace

 ❯ test/app.wiring.spec.ts (0 test)
 ✓ test/users.service.spec.ts (2 tests) 1ms

 Test Files  1 failed | 1 passed (2)
      Tests  2 passed (2)
   Start at  02:59:12
   Duration  611ms (transform 770ms, setup 0ms, collect 466ms, tests 1ms, environment 0ms, prepare 69ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/app.wiring.spec.ts [ test/app.wiring.spec.ts ]
Error: Failed to load url @nestjs/testing (resolved id: @nestjs/testing) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/15-wiring-boot-failure/runs/inclusionai-ling-3.0-flash--ladder/variant-a-single/workspace/test/app.wiring.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.1/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


