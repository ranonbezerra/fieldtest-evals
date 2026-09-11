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

Done in 671ms using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 0

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/15-wiring-boot-failure/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace

 ✓ test/users.service.spec.ts (2 tests) 1ms
 ✓ test/wiring.spec.ts (1 test) 733ms
   ✓ application wiring (real boot of the compiled entry) > boots to the listening state and serves the real export route 733ms

 Test Files  2 passed (2)
      Tests  3 passed (3)
   Start at  05:31:58
   Duration  1.26s (transform 719ms, setup 0ms, collect 808ms, tests 734ms, environment 0ms, prepare 59ms)


