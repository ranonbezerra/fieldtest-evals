$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 23, reused 23, downloaded 0, added 0
Packages: +45
+++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 92, reused 45, downloaded 0, added 45, done

devDependencies:
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.1s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 2
src/orders/orders.status.ts(2,10): error TS2440: Import declaration conflicts with local declaration of 'mapProviderStatus'.
src/orders/orders.status.ts(13,34): error TS2554: Expected 1 arguments, but got 2.
src/payouts/payouts.status.ts(3,10): error TS2440: Import declaration conflicts with local declaration of 'mapProviderStatus'.
src/payouts/payouts.status.ts(15,34): error TS2554: Expected 1 arguments, but got 2.


$ tsc --noEmit (attempt 1) -> 0


$ vitest run -> 0

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/11-behavior-preserving-refactor/runs/inclusionai-ling-3.0-flash--ladder/variant-a-single/workspace

 ✓ test/payouts.status.spec.ts (2 tests) 1ms
 ✓ test/orders.status.spec.ts (3 tests) 2ms
 ✓ test/reporting.status.spec.ts (9 tests) 2ms

 Test Files  3 passed (3)
      Tests  14 passed (14)
   Start at  02:38:58
   Duration  522ms (transform 1.10s, setup 0ms, collect 1.12s, tests 5ms, environment 0ms, prepare 80ms)


