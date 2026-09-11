$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +45
+++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 92, reused 45, downloaded 0, added 22
Progress: resolved 92, reused 45, downloaded 0, added 45, done

devDependencies:
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 1.6s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/11-behavior-preserving-refactor/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace

 ✓ test/payouts.status.spec.ts (2 tests) 1ms
 ✓ test/orders.status.spec.ts (3 tests) 1ms
 ❯ test/reporting.spec.ts (6 tests | 2 failed) 7ms
   × reporting provider-status mapping (characterization, pre-extraction) > returns null for codes it does not know, including the payout-only codes 3ms
     → expected 'paid' to be null
   × reporting provider-status mapping (characterization, pre-extraction) > buildRows skips the rows it cannot map 2ms
     → expected [ { reference: 'r1', …(2) }, …(1) ] to deeply equal [ { reference: 'r1', …(2) } ]

 Test Files  1 failed | 2 passed (3)
      Tests  2 failed | 9 passed (11)
   Start at  00:32:03
   Duration  588ms (transform 1.26s, setup 0ms, collect 1.28s, tests 9ms, environment 0ms, prepare 115ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/reporting.spec.ts > reporting provider-status mapping (characterization, pre-extraction) > returns null for codes it does not know, including the payout-only codes
AssertionError: expected 'paid' to be null

- Expected: 
null

+ Received: 
"paid"

 ❯ test/reporting.spec.ts:37:49
     35|     // The reporting copy predates the payout codes and never learned …
     36|     // That drift is preserved on purpose, not unified.
     37|     expect(mapProviderStatus('PAYOUT_SETTLED')).toBeNull();
       |                                                 ^
     38|     expect(mapProviderStatus('PAYOUT_REVERSED')).toBeNull();
     39|     expect(mapProviderStatus('NOT_A_PROVIDER_CODE')).toBeNull();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  test/reporting.spec.ts > reporting provider-status mapping (characterization, pre-extraction) > buildRows skips the rows it cannot map
AssertionError: expected [ { reference: 'r1', …(2) }, …(1) ] to deeply equal [ { reference: 'r1', …(2) } ]

- Expected
+ Received

  Array [
    Object {
      "amountMinor": 1000,
      "reference": "r1",
      "status": "paid",
    },
+   Object {
+     "amountMinor": 2000,
+     "reference": "r2",
+     "status": "paid",
+   },
  ]

 ❯ test/reporting.spec.ts:61:18
     59|       { reference: 'r3', providerStatus: 'NOT_A_PROVIDER_CODE', amount…
     60|     ]);
     61|     expect(rows).toEqual([{ reference: 'r1', status: 'paid', amountMin…
       |                  ^
     62|   });
     63| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


