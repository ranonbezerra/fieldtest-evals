$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 9, reused 9, downloaded 0, added 0
Progress: resolved 78, reused 78, downloaded 0, added 0
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

Done in 3.1s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/13-legacy-characterization-tests/runs/gpt-oss-120b--ladder--effort-high/variant-a-single/workspace

 ❯ test/feeCalculator.spec.ts (64 tests | 4 failed) 9ms
   × urgency fee determination > applies urgency fee when deadline is exactly 7 days away (inclusive) 4ms
     → expected 2025 to be 1800 // Object.is equality
   × urgency fee determination > does NOT apply urgency fee when deadline is more than 7 days away 0ms
     → expected 13500 to be 12000 // Object.is equality
   × urgency fee determination > applies urgency fee even when deadline is in the past (quirk: <= 7 includes negatives) 0ms
     → expected 2025 to be 1800 // Object.is equality
   × urgency fee determination > applies urgency fee when deadline is 7.5 days ahead due to floor behaviour (quirk) 0ms
     → expected 2025 to be 1800 // Object.is equality

 Test Files  1 failed (1)
      Tests  4 failed | 60 passed (64)
   Start at  14:19:44
   Duration  529ms (transform 342ms, setup 0ms, collect 343ms, tests 9ms, environment 0ms, prepare 36ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/feeCalculator.spec.ts > urgency fee determination > applies urgency fee when deadline is exactly 7 days away (inclusive)
AssertionError: expected 2025 to be 1800 // Object.is equality

- Expected
+ Received

- 1800
+ 2025

 ❯ test/feeCalculator.spec.ts:167:31
    165|       now,
    166|     );
    167|     expect(result.urgencyFee).toBe(expectedUrgency);
       |                               ^
    168|     expect(result.total).toBe(bandFee + expectedUrgency);
    169|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  test/feeCalculator.spec.ts > urgency fee determination > does NOT apply urgency fee when deadline is more than 7 days away
AssertionError: expected 13500 to be 12000 // Object.is equality

- Expected
+ Received

- 12000
+ 13500

 ❯ test/feeCalculator.spec.ts:182:26
    180|     );
    181|     expect(result.urgencyFee).toBe(0);
    182|     expect(result.total).toBe(bandFee);
       |                          ^
    183|   });
    184| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  test/feeCalculator.spec.ts > urgency fee determination > applies urgency fee even when deadline is in the past (quirk: <= 7 includes negatives)
AssertionError: expected 2025 to be 1800 // Object.is equality

- Expected
+ Received

- 1800
+ 2025

 ❯ test/feeCalculator.spec.ts:195:31
    193|       now,
    194|     );
    195|     expect(result.urgencyFee).toBe(expectedUrgency);
       |                               ^
    196|     expect(result.total).toBe(bandFee + expectedUrgency);
    197|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  test/feeCalculator.spec.ts > urgency fee determination > applies urgency fee when deadline is 7.5 days ahead due to floor behaviour (quirk)
AssertionError: expected 2025 to be 1800 // Object.is equality

- Expected
+ Received

- 1800
+ 2025

 ❯ test/feeCalculator.spec.ts:209:31
    207|       now,
    208|     );
    209|     expect(result.urgencyFee).toBe(expectedUrgency);
       |                               ^
    210|     expect(result.total).toBe(bandFee + expectedUrgency);
    211|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


