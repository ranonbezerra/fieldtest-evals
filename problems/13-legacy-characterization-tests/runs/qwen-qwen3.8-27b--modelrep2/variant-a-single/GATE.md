$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 37, reused 37, downloaded 0, added 0
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
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.5s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/13-legacy-characterization-tests/runs/qwen-qwen3.8-27b--modelrep/variant-a-single/workspace

 ❯ test/fee-calculator.spec.ts (238 tests | 3 failed) 18ms
   × urgent + expedited: full type x band matrix per table (48 pins) > '2019' 'COMMERCIAL' band 3 -> 6750 + 5175, 57925 total 4ms
     → expected { table: '2019', bandFee: 45000, …(3) } to deeply equal { table: '2019', bandFee: 45000, …(3) }
   × urgent + expedited: full type x band matrix per table (48 pins) > '2019' 'ESTATE' band 4 -> 9000 + 6900, 77900 total 0ms
     → expected { table: '2019', bandFee: 60000, …(3) } to deeply equal { table: '2019', bandFee: 60000, …(3) }
   × urgent + expedited: full type x band matrix per table (48 pins) > '2019' 'APPEAL' band 4 -> 13800 + 10580, 119380 total 0ms
     → expected { table: '2019', bandFee: 92000, …(3) } to deeply equal { table: '2019', bandFee: 92000, …(3) }

 Test Files  1 failed (1)
      Tests  3 failed | 235 passed (238)
   Start at  02:38:54
   Duration  535ms (transform 358ms, setup 0ms, collect 361ms, tests 18ms, environment 0ms, prepare 42ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/fee-calculator.spec.ts > urgent + expedited: full type x band matrix per table (48 pins) > '2019' 'COMMERCIAL' band 3 -> 6750 + 5175, 57925 total
AssertionError: expected { table: '2019', bandFee: 45000, …(3) } to deeply equal { table: '2019', bandFee: 45000, …(3) }

- Expected
+ Received

  Object {
    "bandFee": 45000,
    "expeditedFee": 5175,
    "table": "2019",
-   "total": 57925,
+   "total": 56925,
    "urgencyFee": 6750,
  }

 ❯ test/fee-calculator.spec.ts:579:7
    577|     expect(
    578|       fee({ openedAt: c.openedAt, type: c.type, complexity: c.band, de…
    579|     ).toEqual({
       |       ^
    580|       table: c.table,
    581|       bandFee: BASE_FEES[c.table][c.type][c.band - 1],

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  test/fee-calculator.spec.ts > urgent + expedited: full type x band matrix per table (48 pins) > '2019' 'ESTATE' band 4 -> 9000 + 6900, 77900 total
AssertionError: expected { table: '2019', bandFee: 60000, …(3) } to deeply equal { table: '2019', bandFee: 60000, …(3) }

- Expected
+ Received

  Object {
    "bandFee": 60000,
    "expeditedFee": 6900,
    "table": "2019",
-   "total": 77900,
+   "total": 75900,
    "urgencyFee": 9000,
  }

 ❯ test/fee-calculator.spec.ts:579:7
    577|     expect(
    578|       fee({ openedAt: c.openedAt, type: c.type, complexity: c.band, de…
    579|     ).toEqual({
       |       ^
    580|       table: c.table,
    581|       bandFee: BASE_FEES[c.table][c.type][c.band - 1],

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  test/fee-calculator.spec.ts > urgent + expedited: full type x band matrix per table (48 pins) > '2019' 'APPEAL' band 4 -> 13800 + 10580, 119380 total
AssertionError: expected { table: '2019', bandFee: 92000, …(3) } to deeply equal { table: '2019', bandFee: 92000, …(3) }

- Expected
+ Received

  Object {
    "bandFee": 92000,
    "expeditedFee": 10580,
    "table": "2019",
-   "total": 119380,
+   "total": 116380,
    "urgencyFee": 13800,
  }

 ❯ test/fee-calculator.spec.ts:579:7
    577|     expect(
    578|       fee({ openedAt: c.openedAt, type: c.type, complexity: c.band, de…
    579|     ).toEqual({
       |       ^
    580|       table: c.table,
    581|       bandFee: BASE_FEES[c.table][c.type][c.band - 1],

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


