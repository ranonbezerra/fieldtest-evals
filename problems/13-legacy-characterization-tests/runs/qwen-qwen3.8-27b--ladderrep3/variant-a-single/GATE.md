$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 9, reused 9, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 0
Progress: resolved 132, reused 85, downloaded 0, added 85, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/node 22.20.2
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.9s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/13-legacy-characterization-tests/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace

 ❯ test/fee-calculator.spec.ts (90 tests | 1 failed) 9ms
   × rounding: Math.round per step, in cents (FINDINGS F-3) > pins: 2022 COMMERCIAL band 4 urgent+expedited -> round(11398.8) = 11399 3ms
     → expected { table: '2022', bandFee: 80500, …(3) } to deeply equal { table: '2022', bandFee: 80500, …(3) }

 Test Files  1 failed (1)
      Tests  1 failed | 89 passed (90)
   Start at  08:44:37
   Duration  547ms (transform 377ms, setup 0ms, collect 376ms, tests 9ms, environment 0ms, prepare 40ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/fee-calculator.spec.ts > rounding: Math.round per step, in cents (FINDINGS F-3) > pins: 2022 COMMERCIAL band 4 urgent+expedited -> round(11398.8) = 11399
AssertionError: expected { table: '2022', bandFee: 80500, …(3) } to deeply equal { table: '2022', bandFee: 80500, …(3) }

- Expected
+ Received

  Object {
    "bandFee": 80500,
    "expeditedFee": 11399,
    "table": "2022",
-   "total": 106489,
+   "total": 106389,
    "urgencyFee": 14490,
  }

 ❯ test/fee-calculator.spec.ts:277:7
    275|     expect(
    276|       calc(input({ type: 'COMMERCIAL', complexity: 4, openedAt: '2022-…
    277|     ).toEqual({ table: '2022', bandFee: 80500, urgencyFee: 14490, expe…
       |       ^
    278|   });
    279| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


