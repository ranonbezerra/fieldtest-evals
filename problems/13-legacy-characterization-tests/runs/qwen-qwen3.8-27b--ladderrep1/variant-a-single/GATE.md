$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 38, reused 38, downloaded 0, added 0
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
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.4s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/13-legacy-characterization-tests/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace

 ❯ test/fee-calculator.spec.ts (142 tests | 3 failed) 10ms
   × case type x complexity band, full matrix, urgent (deadline 2023-03-08) and expedited > pins total 93024 for 'COMMERCIAL' band 4 on the '2021' table (opened '2021-06-15', deadline 2023-03-08, expedited) 4ms
     → expected { table: '2021', bandFee: 73000, …(3) } to deeply equal { table: '2021', bandFee: 73000, …(3) }
   × case type x complexity band, full matrix, urgent (deadline 2023-03-08) and expedited > pins total 70336 for 'COMMERCIAL' band 3 on the '2022' table (opened '2023-06-15', deadline 2023-03-08, expedited) 0ms
     → expected { table: '2022', bandFee: 53500, …(3) } to deeply equal { table: '2022', bandFee: 53500, …(3) }
   × rounding at each step (pctOf uses Math.round) > pins F7: non-.5 fractions round to nearest - 2022 APPEAL band 4 (12% of 128620 = 15434.4 -> 15434) and COMMERCIAL band 3 (12% of 63130 = 7575.6 -> 7576) 0ms
     → expected { table: '2022', bandFee: 53500, …(3) } to deeply equal { table: '2022', bandFee: 53500, …(3) }

 Test Files  1 failed (1)
      Tests  3 failed | 139 passed (142)
   Start at  01:09:50
   Duration  599ms (transform 431ms, setup 0ms, collect 432ms, tests 10ms, environment 0ms, prepare 38ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/fee-calculator.spec.ts > case type x complexity band, full matrix, urgent (deadline 2023-03-08) and expedited > pins total 93024 for 'COMMERCIAL' band 4 on the '2021' table (opened '2021-06-15', deadline 2023-03-08, expedited)
AssertionError: expected { table: '2021', bandFee: 73000, …(3) } to deeply equal { table: '2021', bandFee: 73000, …(3) }

- Expected
+ Received

  Object {
    "bandFee": 73000,
    "expeditedFee": 10074,
    "table": "2021",
-   "total": 93024,
+   "total": 94024,
    "urgencyFee": 10950,
  }

 ❯ test/fee-calculator.spec.ts:225:9
    223|           expedited: true,
    224|         }),
    225|       ).toEqual({
       |         ^
    226|         table: m.table,
    227|         bandFee: m.bandFee,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  test/fee-calculator.spec.ts > case type x complexity band, full matrix, urgent (deadline 2023-03-08) and expedited > pins total 70336 for 'COMMERCIAL' band 3 on the '2022' table (opened '2023-06-15', deadline 2023-03-08, expedited)
AssertionError: expected { table: '2022', bandFee: 53500, …(3) } to deeply equal { table: '2022', bandFee: 53500, …(3) }

- Expected
+ Received

  Object {
    "bandFee": 53500,
    "expeditedFee": 7576,
    "table": "2022",
-   "total": 70336,
+   "total": 70706,
    "urgencyFee": 9630,
  }

 ❯ test/fee-calculator.spec.ts:225:9
    223|           expedited: true,
    224|         }),
    225|       ).toEqual({
       |         ^
    226|         table: m.table,
    227|         bandFee: m.bandFee,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  test/fee-calculator.spec.ts > rounding at each step (pctOf uses Math.round) > pins F7: non-.5 fractions round to nearest - 2022 APPEAL band 4 (12% of 128620 = 15434.4 -> 15434) and COMMERCIAL band 3 (12% of 63130 = 7575.6 -> 7576)
AssertionError: expected { table: '2022', bandFee: 53500, …(3) } to deeply equal { table: '2022', bandFee: 53500, …(3) }

- Expected
+ Received

  Object {
    "bandFee": 53500,
    "expeditedFee": 7576,
    "table": "2022",
-   "total": 70336,
+   "total": 70706,
    "urgencyFee": 9630,
  }

 ❯ test/fee-calculator.spec.ts:433:7
    431|     expect(
    432|       calc({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-06-15'…
    433|     ).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, exped…
       |       ^
    434|   });
    435| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


