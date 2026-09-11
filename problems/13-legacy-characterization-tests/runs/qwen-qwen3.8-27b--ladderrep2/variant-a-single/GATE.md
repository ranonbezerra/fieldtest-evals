$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 36, reused 35, downloaded 0, added 0
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
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 3s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/13-legacy-characterization-tests/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace

 ❯ test/fee-calculator.spec.ts (224 tests | 3 failed) 16ms
   × unknown / malformed case type, pinned as-is (FINDINGS.md F5) > [PINNED QUIRK] unknown type "PROBATE" silently falls back to STANDARD band 2 fees, table 2019 3ms
     → expected [ 'bandFee', 'expeditedFee', …(3) ] to deeply equal [ 'bandFee', 'expeditedFee', …(2) ]
   × unknown / malformed case type, pinned as-is (FINDINGS.md F5) > [PINNED QUIRK] unknown type "PROBATE" silently falls back to STANDARD band 2 fees, table 2021 0ms
     → expected [ 'bandFee', 'expeditedFee', …(3) ] to deeply equal [ 'bandFee', 'expeditedFee', …(2) ]
   × unknown / malformed case type, pinned as-is (FINDINGS.md F5) > [PINNED QUIRK] unknown type "PROBATE" silently falls back to STANDARD band 2 fees, table 2022 0ms
     → expected [ 'bandFee', 'expeditedFee', …(3) ] to deeply equal [ 'bandFee', 'expeditedFee', …(2) ]

 Test Files  1 failed (1)
      Tests  3 failed | 221 passed (224)
   Start at  05:15:34
   Duration  555ms (transform 375ms, setup 0ms, collect 376ms, tests 16ms, environment 0ms, prepare 33ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/fee-calculator.spec.ts > unknown / malformed case type, pinned as-is (FINDINGS.md F5) > [PINNED QUIRK] unknown type "PROBATE" silently falls back to STANDARD band 2 fees, table 2019
 FAIL  test/fee-calculator.spec.ts > unknown / malformed case type, pinned as-is (FINDINGS.md F5) > [PINNED QUIRK] unknown type "PROBATE" silently falls back to STANDARD band 2 fees, table 2021
 FAIL  test/fee-calculator.spec.ts > unknown / malformed case type, pinned as-is (FINDINGS.md F5) > [PINNED QUIRK] unknown type "PROBATE" silently falls back to STANDARD band 2 fees, table 2022
AssertionError: expected [ 'bandFee', 'expeditedFee', …(3) ] to deeply equal [ 'bandFee', 'expeditedFee', …(2) ]

- Expected
+ Received

  Array [
    "bandFee",
    "expeditedFee",
    "table",
    "total",
+   "urgencyFee",
  ]

 ❯ test/fee-calculator.spec.ts:362:35
    360|     expect(r).toEqual({ table: name, bandFee: base, urgencyFee: 0, exp…
    361|     // no fallback marker: the breakdown shape is identical to a genui…
    362|     expect(Object.keys(r).sort()).toEqual(['bandFee', 'expeditedFee', …
       |                                   ^
    363|   });
    364| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯


