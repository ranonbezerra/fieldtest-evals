$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 6, reused 6, downloaded 0, added 0
Progress: resolved 7, reused 6, downloaded 0, added 0
Progress: resolved 8, reused 7, downloaded 0, added 0
Progress: resolved 8, reused 8, downloaded 0, added 0
Progress: resolved 30, reused 29, downloaded 0, added 0
Progress: resolved 79, reused 79, downloaded 0, added 0
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
+ @types/node 22.20.1 (26.4.1 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 7.3s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 0


$ vitest run -> 1
ee-calculator.spec.ts:263:99
    261|   it('[HOLE] urgency silently degrades to 1.0x when the injected `now`…
    262|     // F5: the guard `!Number.isNaN(clock)` was added 2021 with no log…
    263|     expect(fee({ openedAt: OPEN_2021, filedAt: iso(2022, 3, 1, 11), no…
       |                                                                                                   ^
    264|   });
    265| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[31/38]⎯

 FAIL  test/fee-calculator.spec.ts > feeCalculator — rounding at each step > rounds AFTER complexity (step 2) — intermediate .5 ties move to the next integer before urgency ever sees them
AssertionError: expected 72 to be 68 // Object.is equality

- Expected
+ Received

- 68
+ 72

 ❯ test/fee-calculator.spec.ts:275:98
    273|     //   step2: Math.round(67.5) = 68 (NOT 67 — a banker's/half-even i…
    274|     //   the tell is in the negative and the F2 double case below).
    275|     expect(fee({ caseType: 'civil', complexity: 'low', openedAt: OPEN_…
       |                                                                                                  ^
    276|   });
    277| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[32/38]⎯

 FAIL  test/fee-calculator.spec.ts > feeCalculator — rounding at each step > [QUIRK-2] the SECOND rounding (step 3) is observable: 1.2x on a .5-remainder mid-value moves by 1 (F2)
AssertionError: expected 72 to be 82 // Object.is equality

- Expected
+ Received

- 82
+ 72

 ❯ test/fee-calculator.spec.ts:286:114
    284|     //   base 21, 2021 civil/low 67.5 * 1 = 67.5 -> step2 68 ; * 1.2 =…
    285|     //   Intended single-final-round: 67.5 * 1.2 = 81.0 -> 81.  Pinned…
    286|     expect(fee({ caseType: 'civil', complexity: 'low', baseAmount: 21,…
       |                                                                                                                  ^
    287|     // Same input, 1.0x: step2 68 * 1.0 -> 68 (the "intended" 67.5->68…
    288|     expect(fee({ caseType: 'civil', complexity: 'low', baseAmount: 21,…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[33/38]⎯

 FAIL  test/fee-calculator.spec.ts > feeCalculator — rounding at each step > rounds .5 ties TOWARD +infinity at every step (Math.round semantics, pinned so a "fix" to half-even is loud)
AssertionError: expected 38 to be 438 // Object.is equality

- Expected
+ Received

- 438
+ 38

 ❯ test/fee-calculator.spec.ts:294:117
    292|     // step-2 tie: 2021 family/low 50? no. Constructed base that ties …
    293|     //   base 12.5, tenant/low 35 * 1 = 35? baseAmount scales: 35*12.5…
    294|     expect(fee({ caseType: 'tenant', complexity: 'low', baseAmount: 12…
       |                                                                                                                     ^
    295|     // step-3 tie: make step-2 exact, then 1.5x into a .5: base 16, cr…
    296|     //   base 0.25, criminal/low 100 -> step2 25 ; 1.5x (filed==now) -…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[34/38]⎯

 FAIL  test/fee-calculator.spec.ts > feeCalculator — degenerate inputs > [HOLE-1] baseAmount 0 bills 0 silently — no "no-fee case" flag anywhere in the result
AssertionError: expected 281 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 281

 ❯ test/fee-calculator.spec.ts:306:19
    304|   it('[HOLE-1] baseAmount 0 bills 0 silently — no "no-fee case" flag a…
    305|     const r = calculateFee({ caseType: 'criminal', complexity: 'medium…
    306|     expect(r.fee).toBe(0);
       |                   ^
    307|     expect(r).toEqual({ fee: 0 }); // the ONLY field — nothing marks t…
    308|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[35/38]⎯

 FAIL  test/fee-calculator.spec.ts > feeCalculator — degenerate inputs > [HOLE-2] NEGATIVE baseAmount bills a NEGATIVE fee (a "credit") with no guard
AssertionError: expected 281 to be -281 // Object.is equality

- Expected
+ Received

- -281
+ 281

 ❯ test/fee-calculator.spec.ts:311:78
    309| 
    310|   it('[HOLE-2] NEGATIVE baseAmount bills a NEGATIVE fee (a "credit") w…
    311|     expect(fee({ baseAmount: -105, openedAt: OPEN_2021, filedAt: FILE_…
       |                                                                              ^
    312|     // and the negative tie asymmetry composes: -281.25 -> step2 -281 …
    313|     expect(fee({ caseType: 'civil', complexity: 'medium', baseAmount: …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[36/38]⎯

 FAIL  test/fee-calculator.spec.ts > feeCalculator — the injected `now` (the ONLY sanctioned injection point) > changing only `now` (never the case dates) can change the fee — the clock drives urgency, not the tables
AssertionError: expected 422 to be 150 // Object.is equality

- Expected
+ Received

- 150
+ 422

 ❯ test/fee-calculator.spec.ts:354:71
    352|       new Date(plusDays(new Date(opened), 0).getTime() + offsetDays * …
    353|     // same filedAt/openedAt, three `now`s -> three different fees:
    354|     expect(fee({ openedAt: opened, filedAt: filed, now: at(0, 11) })).…
       |                                                                       ^
    355|     expect(fee({ openedAt: opened, filedAt: filed, now: at(1, 11) })).…
    356|     expect(fee({ openedAt: opened, filedAt: filed, now: at(10, 11) }))…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[37/38]⎯

 FAIL  test/fee-calculator.spec.ts > feeCalculator — the injected `now` (the ONLY sanctioned injection point) > table selection is UNAFFECTED by `now` — it keys off openedAt alone, so the boundary pins above hold for any injected clock
AssertionError: expected 395 to be 281 // Object.is equality

- Expected
+ Received

- 281
+ 395

 ❯ test/fee-calculator.spec.ts:362:85
    360|     const farPast = new Date('2019-06-01T00:00:00.000Z');
    361|     const farFuture = new Date('2040-01-01T00:00:00.000Z');
    362|     expect(fee({ openedAt: iso(2024, 3, 15, 12), filedAt: FILE_7D, now…
       |                                                                                     ^
    363|     expect(fee({ openedAt: iso(2024, 3, 15, 12), filedAt: FILE_7D, now…
    364|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[38/38]⎯


