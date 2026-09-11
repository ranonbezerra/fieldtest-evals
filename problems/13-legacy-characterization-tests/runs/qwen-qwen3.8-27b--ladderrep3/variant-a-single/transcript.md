# Transcript — 13-legacy-characterization-tests / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me analyze the task carefully.

This is a characterization-test task for the `feeCalculator.ts` module. What's being asked:

1. A characterization test suite pinning down current behavior:
   - Full matrix of every case type × every complexity band
   - Urgency multiplier, including boundaries that determine urgency
   - Rate-table date boundaries (both transition points, inclusive/exclusive edges)
   - Rounding at each step
   - Degenerate inputs (zero, negative, unknown case types)

2. No changes to production code. The fake clock is injected only via the existing optional `now` parameter.

3. Pin down the quirks and at least one real bug AS-IS, with test names that flag them, documented in FINDINGS.md along with the reproduction input, blast radius, and proposed fix (not applied).

4. Deterministic suite, no real dates, no randomness.

Let me carefully analyze `feeCalculator.ts`:

```ts
export type CaseType = 'STANDARD' | 'COMMERCIAL' | 'ESTATE' | 'APPEAL';

export interface CaseInput {
  type: string;
  complexity: number | null;
  openedAt: string;
  deadline?: string;
  expedited?: boolean;
}

interface RateTable {
  base: Record<string, number[]>;
  urgencyPct: number;
  expeditedPct: number;
}

const RATE_TABLE_2019: RateTable = {
  base: {
    STANDARD: [12000, 18500, 27000, 41000],
    COMMERCIAL: [22000, 31500, 45000, 68000],
    ESTATE: [18000, 26000, 39500, 60000],
    APPEAL: [30000, 42000, 61000, 92000],
  },
  urgencyPct: 15,
  expeditedPct: 10,
};

const RATE_TABLE_2021: RateTable = {
  base: {
    STANDARD: [13500, 20500, 29500, 44500],
    COMMERCIAL: [24000, 34000, 48500, 73000],
    ESTATE: [19500, 28000, 42500, 64500],
    APPEAL: [32500, 45500, 66000, 99000],
  },
  urgencyPct: 15,
  expeditedPct: 12,
};

const RATE_TABLE_2022: RateTable = {
  base: {
    STANDARD: [15000, 22500, 32500, 49000],
    COMMERCIAL: [26500, 37500, 53500, 80500],
    ESTATE: [21500, 31000, 47000, 71000],
    APPEAL: [36000, 50000, 72500, 109000],
  },
  urgencyPct: 18,
  expeditedPct: 12,
};

const REVISION_2021 = '2021-01-01';
const REVISION_2022 = '2022-07-01';

function tableFor(openedAt: string): RateTable {
  if (openedAt >= REVISION_2021) {
    if (openedAt > REVISION_2022) {
      return RATE_TABLE_2022;
    }
    return RATE_TABLE_2021;
  }
  return RATE_TABLE_2019;
}
```

**Finding #1 (asymmetry in boundary handling):** `tableFor` uses `>=` for REVISION_2021 but `>` for REVISION_2022. That means:
- `openedAt = '2021-01-01'` → table 2021 (inclusive)
- `openedAt = '2022-07-01'` → table 2021 (NOT 2022! Because `openedAt > '2022-07-01'` is false for equality). So a case opened exactly on the 2022 revision date gets the 2021 rates. This is a real quirk/bug — asymmetric boundary: the 2021 boundary is inclusive (`>=`) while the 2022 boundary is exclusive (`>`). A case opened exactly on 2022-07-01 gets the 2021 table. The comment says "2022-07: rate revision" — the likely intent was that both boundaries are inclusive at the revision date. So a case opened exactly on 2022-07-01 gets the old rates. This is a genuine bug/quirk.

Also note: `openedAt` is compared as a string. ISO dates compare lexicographically and match chronologically, no problem. But what about `openedAt = '2022-07-01T00:00:00'`? Lexicographically, '2022-07-01T00:00:00' > '2022-07-01' (because the string is longer and the prefix is equal) so it goes to 2022. And '2021-01-01T00:00:00' >= '2021-01-01' → 2021. Hmm, interesting: for the 2021 revision, a datetime '2021-01-01T...' is >= REVISION_2021 → 2021 table. For 2022, '2022-07-01T00:00:00' > '2022-07-01' → 2022 table. So the datetime form lands in the later table, while the plain date form for 2022-07-01 lands in the 2021 table. This is another facet of the string-comparison quirk, but might be going too deep. Let me consider whether to pin it. This is a defensible finding: the comparison is lexicographic string comparison, not date parsing. Cases where `openedAt` contains a time component behave differently at the boundary. But is it worth a finding? The spec says "at least one real bug" — the 2022-07-01 boundary is clearly the real bug. The string-comparison issue is a quirk worth documenting as an open question/finding.

**Finding #2 (urgency uses `now` rather than openedAt for deadline proximity):** `ref = now ? now : new Date().toISOString().slice(0, 10)`. So urgency is determined by the distance from "now" (or the actual clock when now is omitted) to the deadline, not from the case's opening date. That means urgency depends on the point in time at which billing runs. Determinism for historical stored fees: if billing calls without `now`, the actual clock is used — non-deterministic across re-runs. But for the suite, we always pass `now`. Quirk: urgency is evaluated relative to the call date, not the case date. That means re-running fee calculation for a case (e.g., regeneration) produces a different urgency fee than the originally stored one. This is a genuine design quirk / potential bug: historical outputs depend on when billing ran. Document it.

Also: `daysBetween(ref, deadline) <= 7` — urgency triggers when daysBetween <= 7, including negative (deadline in the past) or zero. So a deadline already past makes it urgent. Also `daysBetween` uses `Math.floor(ms / 86400000)` — for a deadline before ref, ms is negative, and Math.floor of a negative fraction truncates downward. Example: ref = '2022-07-05', deadline = '2022-06-28T12:00:00Z' — but we use date-only strings, so the difference is an exact number of days. For date-only strings at UTC midnight, ms is a multiple of 86400000 (except around DST… `new Date('2022-07-05')` is parsed as UTC midnight (date-only ISO strings are UTC per spec), so the difference is always an exact multiple of 86400000 — no DST issues since both are UTC). So daysBetween is exact in day units for date-only strings. Good — deterministic, no timezone issues. Because date-only ISO strings parse as UTC. Wait — is that right? `new Date('2021-05-10')` → parsed as UTC midnight. Yes, date-only ISO 8601 is UTC per ES spec. So daysBetween is timezone-independent. Good, the suite is deterministic.

But wait — the "urgency boundary": `daysBetween(ref, c.deadline) <= 7`. So the deadline within 7 days of now (inclusive) → urgent. Boundary test: deadline = ref + 7 days → urgent (daysBetween = 7 → urgent). deadline = ref + 8 days → not urgent. deadline = ref (0 days) → urgent. Deadline in the past → urgent. That's the boundary.

**Finding #3 (band normalization):**
```ts
let band = c.complexity;
if (!band || band < 1) {
  band = 1;
}
if (band > 4) {
  band = 4;
}
```
- `complexity = 0` → `!band` is true → band = 1. So zero complexity is treated as band 1, not an error.
- Negative → band = 1.
- > 4 → 4 (clamped).
- Non-integer like 2.5? `band - 1 = 1.5` → `bands[1.5]` → undefined → bandFee = undefined. Then `bandFee + urgencyFee` = NaN etc. Actually `pctOf(undefined * pct / 100)` = NaN; Math.round(NaN) = NaN. Total NaN. Interesting degenerate case: fractional complexity produces undefined/NaN. Is this worth pinning? "Degenerate inputs: zero, negative, unknown case types, missing complexity" — fractional isn't explicitly requested, but it's a real behavior worth pinning (or at least documenting as an open question). Hmm. `bands[1.5]` — TS strict: `bands[band-1]` with a number index… indexing `number[]` with a number, fine. Returns `number` (noUncheckedIndexedAccess is off — not in tsconfig), so TS thinks it's number. At runtime: undefined. So the result: bandFee: undefined (in the object it's actually `undefined`), total NaN… Let me compute: bandFee = undefined. urgencyFee: if urgent, pctOf(undefined, pct) = Math.round(NaN) = NaN. total = undefined + urgencyFee + expeditedFee = NaN. If not urgent: urgencyFee = 0, total = undefined + 0 + 0 = NaN? undefined + 0 = NaN. Yes NaN. So fractional complexity → { bandFee: undefined, urgencyFee: 0 or NaN, total: NaN }.

Should I pin this in a test? The spec asks for degenerate inputs: zero, negative, unknown case types, missing complexity. Fractional is a bonus. I can pin it with `Number.isNaN` assertions. It's real behavior. Include a test that pins it — e.g. "pins: fractional complexity 2.5 yields undefined bandFee and NaN total (no band validation)". And document in FINDINGS.md. Good, this shows depth. But careful: is it "behavioral"? Asserting bandFee is undefined and total is NaN is a real assertion.

Hmm, but also: complexity = null → throws 'complexity is required'. Also `complexity: undefined` → throws (the check is `=== null || === undefined`). Pin both.

Also note: `if (!band || band < 1)` — NaN complexity: `!NaN` is true → band = 1. So NaN complexity → band 1. Also a quirk: NaN is treated as band 1, not an error. Might be worth pinning too… I can add to findings. Don't overdo. Let me consider which tests to write.

**Finding #4 (unknown case type falls back to STANDARD):**
```ts
let bands = table.base[c.type];
if (!bands) {
  bands = table.base['STANDARD'];
}
```
Unknown type → silently charged at the STANDARD rate. Quirk: a billing error (typo in type) produces a plausible fee rather than an error. Document it. Test names like "pins (QUIRK): unknown case type 'COMMRCIAL' is silently charged at STANDARD rates".

**Finding #5 (expedited is compounded on top of urgency):**
```ts
expeditedFee = pctOf(bandFee + urgencyFee, table.expeditedPct);
```
Expedited pct is applied to (bandFee + urgencyFee) — compounded, not on bandFee alone. And pctOf rounds at each step (the comment says "rounded at each step since 2019; billing reconciles against these"). So rounding: urgencyFee is rounded from bandFee*pct/100; expeditedFee is rounded from (bandFee+urgencyFee)*pct/100 — note that the base for expedited includes the *rounded* urgencyFee. The total is the sum of the rounded parts (no final rounding needed since all are integers). Rounding pin: find values where rounding matters, e.g., urgencyPct 15 with a bandFee that produces a fraction: 15% of X. 13500 * 0.15 = 2025 exact. 20500*0.15 = 3075 exact. Hmm many are exact. 12%: 29500*0.12 = 3540 exact. Hmm. Let me find cases with fractions: pct 15 → x*15/100 = x*0.15. If x ends in something that makes a fraction: 18500*0.15=2775 exact. All values × 15%: need x*3/20 — x must be a multiple of 20 for it to be an integer… 12000/20=600 → 1800. Actually x*15/100 = 3x/20. If x is a multiple of 20 → integer. All base values: 12000 (mult of 20), 18500 (mult of 20 → 18500/20=925, ×3=2775), 27000, 41000, 22000, 31500, 45000, 68000, 18000, 26000, 39500, 60000, 30000, 42000, 61000, 92000. All are multiples of 50, so 15% is exact. 18%: 9x/50 — if x is a multiple of 50 → integer. 21500*0.18 = 3870 exact. 12%: 3x/25 — if x is a multiple of 25 → integer. All are multiples of 50 → exact. So urgency on bandFee is always exact for the standard bands. But expedited is applied to bandFee + urgencyFee — the sum may not be a multiple of 25. Example: 2021 STANDARD band 1: bandFee 13500, urgency 2025 (15%), sum 15525, ×12% = 1863 exact (15525*3/25: 15525/25=621 → 1863). Hmm. Find a fraction: need (bandFee + urgency) * 12/100 with sum not divisible by 25. Example: 2019 ESTATE band 4: 60000, urgency 15% = 9000, sum 69000, ×10% (2019 expeditedPct is 10) = 6900 exact. 2022 APPEAL band 4: 109000, urgency 18% = 19620, sum 128620, ×12% = 15434.4 → rounds to 15434. There we go! 2022 APPEAL band 4 urgent expedited: bandFee=109000, urgencyFee=19620, expeditedFee=15434 (from 15434.4, Math.round → 15434). Total = 109000+19620+15434 = 144054. A good rounding test: the fraction .4 rounds down.

Also find a .5 case where Math.round rounds up: need (bandFee+urgencyFee)*pct/100 = x.5. 2022 COMMERCIAL band 3: 53500, urgency 18% = 9630, sum 63130, ×12% = 7575.6 → 7576. Not .5. 2022 STANDARD band 3: 32500 × .18 = 5850, sum 38350 × .12 = 4602 exact. 2022 ESTATE band 4: 71000 × .18 = 12780, sum 83780 × .12 = 10053.6 → 10054. 2022 APPEAL band 2: 50000 × .18=9000, sum 59000 × .12 = 7080 exact. 2022 STANDARD band 4: 49000×.18=8820, sum 57820 ×.12=6938.4 → 6938. 2022 COMMERCIAL band 4: 80500×.18=14490, sum 94990 ×.12=11398.8 → 11399. Hmm, .5 case: need sum*3/25 = k+0.5 → sum*3 = 25k+12.5 — sum*3 must be an integer so it's not possible… wait 12% = 3/25, sum*3/25. For a .5 remainder we need sum*3 ≡ 12.5 mod 25 — impossible, integer. So 12% never produces .5 (sum*3 is integer; /25 gives quarters: .0, .25… wait 1/25 = 0.04 so the fractional parts are multiples of 0.04; 15/25=0.6, 20/25=0.8, so .5 can't arise from 12%. 18% = 9/50 → fractional parts are multiples of .02 → .5 possible? .5 = 25/50, need sum*9 ≡ 25 mod 50 → sum*9 odd? 25 mod 50: 9*sum ≡ 25 (mod 50). Since gcd(9,50)=1, sum ≡ 9^{-1}*25 mod 50. 9*11=99≡ -1 mod 50? 99-100=-1 yes so 9^{-1} ≡ -11 ≡ 39. 39*25 = 975 ≡ 975-950=25 mod 50. So sum ≡ 25 mod 50 → sum ends in 25 or 75. 2022 sum where bandFee+urgency ends in 25/75: APPEAL band 4: 128620 no. STANDARD band 1: 15000×.18=2700 sum 17700 no. COMMERCIAL band 1: 26500×.18=4770 sum 31270 no. ESTATE band 1: 21500×.18=3870 sum 25370 no. STANDARD band 2: 22500×.18=4050 sum 26550. COMMERCIAL band 2: 37500×.18=6750 sum 44250. ESTATE band 2: 31000×.18=5580 sum 36580. APPEAL band 3: 72500×.18=13050 sum 85550. STANDARD band 3: 32500×.18=5850 sum 38350. COMMERCIAL band 3: 53500×.18=9630 sum 63130. ESTATE band 3: 47000×.18=8460 sum 55460. APPEAL band 2: 50000×.18=9000 sum 59000. 2019 15% = 3/20 → fractional parts in quarters of .25: .5 possible: need sum*3 ≡ 10 mod 20 → 3sum ≡ 10 mod 20 → sum ≡ 10*3^{-1} mod 20; 3^{-1} mod 20 = 7 (21≡1) → sum ≡ 70 ≡ 10 mod 20 → sum ends in 10/30/50/70/90. 2019 sums: STANDARD b1 12000×.15=1800 sum 13800. COMMERCIAL b1 22000→3300 sum 25300. ESTATE b1 18000→2700 sum 20700. APPEAL b1 30000→4500 sum 34500. STANDARD b2 18500→2775 sum 21275. COMMERCIAL b2 31500→4725 sum 36225. ESTATE b2 26000→3900 sum 29900. APPEAL b2 42000→6300 sum 48300. STANDARD b3 27000→4050 sum 31050. COMMERCIAL b3 45000→6750 sum 51750. ESTATE b3 39500→5925 sum 45425. APPEAL b3 61000→9150 sum 70150. 2021 12% same as 2022 analysis (no .5). 2021 sums: STANDARD b1 13500→2025 sum 15525. Hmm 15525 ends in 25 → but 12% can't give .5 (need 25 mod 25? wait 12% = 3/25, sum ≡ ?; earlier: 12% never gives .5). 2022 18%: sum ≡ 25 mod 50 → ends in 25 or 75: check 2022 sums: 17700, 26550, 38350, 57820 (STANDARD), 31270, 44250, 63130, 94990 (COMMERCIAL), 25370, 36580, 55460, 83780 (ESTATE), 23200? APPEAL b1: 36000×.18=6480 sum 42480. 59000, 85550, 128620. No 25/75 endings. So there is no case where .5 rounding occurs in the expedited step for standard bands. That's fine — Math.round's half-up behavior isn't exercised by any standard band; I can note this in FINDINGS.md as an observation, or test rounding with the values that actually arise. Actually wait — urgency fee itself: 15% of a band fee — always exact as shown. 18%: bandFee*9/50, bandFee multiple of 50 → exact. 12%: bandFee*3/25, bandFee multiple of 25 → exact. So urgency rounding never actually rounds a fraction on standard bands — "rounding at each step" is mostly a no-op except for expedited on top of the sum. Still, the requirement says "rounding at each step — where it happens, and whether it happens more than once." So the test should:
1. Pin expedited fee = round((bandFee + urgencyFee) * pct / 100) on cases where a fraction arises (2022 APPEAL b4: 15434.4 → 15434; 2022 COMMERCIAL b4: 11398.8 → 11399; 2022 ESTATE b4: 10053.6 → 10054; 2022 STANDARD b4: 6938.4 → 6938; 2021? 12% of sums — check 2021: STANDARD b4: 44500×.15=6675 sum 51175 ×.12 = 6141 exact (51175/25=2047×3). COMMERCIAL b4: 73000×.15=10950 sum 83950 ×.12=10074 exact. ESTATE b4: 64500×.15=9675 sum 74175 ×.12=8901 exact. APPEAL b4: 99000×.15=14850 sum 113850 ×.12=13662 exact. 2019 10%: sums × 1/10: need fractional .x: STANDARD b2 21275×.10=2127.5 → Math.round → 2128! Found a .5 → rounds up (half-up). 2019 STANDARD band 2, urgent, expedited: bandFee 18500, urgency 2775 (15% of 18500 = 2775 exact), sum 21275, expedited 10% = 2127.5 → 2128 (Math.round is half away from zero). Total = 18500+2775+2128 = 23403. This pins Math.round's half-up at the expedited step.

Also 2019: other .5 cases? 10% of sums with sum ending in 5: COMMERCIAL b2: 31500→4725 sum 36225 ×.1 = 3622.5 → 3623! ESTATE b1: 20700×.1=2070 exact. APPEAL b3: 70150 → 7015 exact. STANDARD b3: 31050 → 3105. COMMERCIAL b3: 51750 → 5175. ESTATE b3: 45425 → 4542.5 → 4543! APPEAL b1: 34500→3450. ESTATE b2: 29900→2990. APPEAL b2: 48300→4830. STANDARD b1: 13800→1380. COMMERCIAL b1: 25300→2530. APPEAL b4: 92000×.15=13800 sum 105800 → 10580. ESTATE b4: 60000→9000 sum 69000→6900. COMMERCIAL b4: 68000→10200 sum 78200→7820. So 2019: (STANDARD,2): 2127.5→2128, (COMMERCIAL,2): 3622.5→3623, (ESTATE,3): 4542.5→4543. Great, these pin the half-up rounding.

2. Also pin that expedited is compounded (on bandFee + urgencyFee, not on bandFee alone). Example: if it were on bandFee alone it would be different. The test name should say "pins (QUIRK): expedited pct is applied to bandFee + urgencyFee (compounded)".

**Finding #6 (urgency deadline semantics):** `daysBetween(ref, deadline) <= 7` — inclusive on both sides; past deadlines are urgent (negative days). Also `deadline` exactly 7 days out → urgent; 8 days → not. Pin all. Also: the reference is `now` (billing time), not openedAt — this is the big quirk: the stored fee for a case depends on when billing was run. E.g. a case opened in 2021 with a deadline; run billing in 2024, daysBetween is large → not urgent, but if it had been run in 2021 it would have been. So historical stored fees are not reproducible from case data alone — they depend on the execution time. This is a real finding for "blast radius — stored historical fees".

Also `now` defaults to `new Date().toISOString().slice(0, 10)` — real clock. We must always pass `now` in the suite to be deterministic. Also note: when deadline is missing, `daysBetween` isn't called — fine.

Wait, one more subtle: `if (c.deadline && daysBetween(ref, c.deadline) <= 7)`. If deadline is '' (empty string) → falsy → no urgency. Edge: empty-string deadline is silently ignored. Minor; could mention in findings as a degenerate case.

**Also `new Date(b).getTime()` for an invalid date string** → NaN; NaN <= 7 is false → no urgency. Example: deadline 'garbage' → daysBetween = floor(NaN) = NaN, NaN <= 7 → false → no urgency. Silently ignored. Could pin. Hmm, maybe overkill; mention as an open question in findings? I can pin: invalid deadline string → urgencyFee 0. Actually that's testable behavior: `daysBetween` returns NaN, NaN <= 7 is false. Pin it — degenerate input coverage. OK, include a small test.

**Table selection by string comparison:** `tableFor` compares ISO date strings lexicographically. '2020-12-31' < '2021-01-01' → 2019. '2021-01-01' >= → 2021 (inclusive edge). '2020-12-31' → 2019. '2022-06-30' → 2021. '2022-07-01' → 2021 (exclusive edge — the bug). '2022-07-02' → 2022.

Also what about malformed openedAt like '' (empty string)? '' >= '2021-01-01' is false → 2019 table. Silently 2019. Malformed 'garbage' → lexicographic: 'garbage' >= '2021-01-01'? 'g' > '2' → true; then 'garbage' > '2022-07-01' → true → 2022 table! Interesting: non-date strings sort above digits so they land in the 2022 table. That's a quirk of string comparison. Worth a finding? It shows that tableFor is string comparison, not date parsing. Pin: openedAt 'garbage' → table '2022'. Hmm, is it worth? It demonstrates the mechanism. Let me document it in FINDINGS as part of the string-comparison finding and pin one case. I think this is good depth, but I want to keep the suite focused. Let me include one test for it (pins: malformed openedAt 'garbage' selects the 2022 table via lexicographic comparison). Good.

Now, the full matrix requirement: "every case type × every complexity band — the full matrix". Case types: 4 known. Bands: 1..4. Across which tables? The matrix should presumably be asserted for each rate table too (otherwise it's a sample). Spec: "every case type × every complexity band — the full matrix, not a sample" plus "both rate-table transitions, especially inclusive/exclusive edges". Safest: assert the full 4×4 matrix for each of the three tables (48 assertions) — that fully pins all base fees. Generate the matrix in a loop using an expected-value table in the test (hardcoded expected values = pinning). But careful: "coverage is judged behaviorally — a high-percentage suite with hollow assertions fails." Using data-driven tests with explicit expected numbers is fine as long as the expected values are hardcoded literals (that's what pinning is). Hardcode an expected-value matrix per table in the test file.

Also for bands 0, negative, >4 (clamping) and null/undefined (throwing) — degenerate complexity.

Urgency: boundary 7/8 days, 0 days, past deadline, no deadline.

Now, determinism: all tests pass `now` explicitly. Use fixed strings like '2024-03-01'… but wait — "no real dates" — I think that means no `new Date()` with no arguments / no wall-clock. Fixed ISO strings are fine and necessary.

Timezone: date-only ISO strings parse as UTC everywhere, so `daysBetween` is deterministic regardless of machine timezone. Good — I can note this in FINDINGS (why the suite is TZ-safe).

Now: "the fake clock can only be injected via the module's existing optional now parameter". So we never mock Date, never use vi.useFakeTimers. Just pass the now string.

Now, environment: the task says build the entire solution in one reply, with files as level-3 headings. Workspace has `feeCalculator.ts`, `statusResolver.ts` (wait — statusResolver.ts is in the workspace but is this part of variant A? The variant is about feeCalculator. statusResolver seems to be from a different variant (probably a distractor / shared fixture in the runs workspace). The task variant A only asks for feeCalculator suite + FINDINGS.md. The system prompt convention mentions NestJS/Prisma layout, but that's a general codebase convention; this task is a standalone fixture workspace with its own tsconfig (no NestJS, no Prisma, no package.json shown). Hmm. The convention block describes a NestJS app, but the given workspace has only feeCalculator.ts, statusResolver.ts, and tsconfig.json. The task is "deliver: the suite + FINDINGS.md". So I should only deliver:

- `test/fee-calculator.spec.ts` (convention: `test/<feature>.spec.ts` — the feature here is feeCalculator; convention says kebab-case: `test/fee-calculator.spec.ts`)
- `FINDINGS.md`

Where should the spec import from? The module is at the workspace root: `feeCalculator.ts`. So import from `'../feeCalculator'`? If the test file is `test/fee-calculator.spec.ts`, the relative import is `'../feeCalculator.js'`? Under ESM with "type": "module"… but the tsconfig is moduleResolution bundler, module ESNext, noEmit — Vitest handles TS imports; under bundler resolution, extensionless imports work. The convention is ESM type module. In Vitest, importing `'../feeCalculator'` works (Vite resolves .ts). To be safe with ESM semantics under Vitest, extensionless is standard in Vitest projects. Use `'../feeCalculator'`.

Wait — do I need a vitest.config? The workspace has no package.json at all. The instructions say "don't create files that aren't asked for". The task says to deliver the suite + FINDINGS.md. But without a package.json/vitest config the suite can't run… still, the workspace is clearly a fixture and the harness likely has its own runner. The instructions: "deliver every file the solution needs". Hmm. The safest reading: deliver only the spec + FINDINGS.md. Creating package.json might clash with the harness. The L2 spec says "TypeScript, vitest." — I can assume the environment provides vitest. Don't create package.json or vitest.config. Just the two files. Actually wait, let me reconsider: "deliver every file the solution needs, complete, first line to last." The solution = the suite + FINDINGS.md per the variant's "deliver: the suite + FINDINGS.md". So two files.

Now the spec content. Let me plan the test structure.

Constants: define in the test file:

```ts
import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';
```

Wait — the module exports `CaseInput`, `FeeBreakdown`, `CaseType`, `calculateFee`. Good.

Helper to build inputs:

```ts
const base = (over: Partial<CaseInput>): CaseInput => ({
  type: 'STANDARD',
  complexity: 1,
  openedAt: '2019-06-01',
  now: '2019-06-01',
  ...over,
});
```

Hmm, `now` is the second argument to calculateFee, not part of CaseInput. So:

```ts
const NOW = '2024-01-15'; // fixed reference day used across the suite
```

Wait — note: for urgency tests, the `now` relative to deadline matters. For matrix tests, urgency should be off: omit deadline (or deadline far from now). Omit deadline and expedited for matrix tests.

Structure:

```ts
import { describe, it, expect } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';

// Every date in this file is a fixed literal. The module's only clock
// seam is the optional `now` parameter; we pass it on every call.

const REF_NOW = '2024-01-15';

function input(over: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2019-06-01',
    ...over,
  };
}

function calc(c: CaseInput, now: string = REF_NOW): FeeBreakdown {
  return calculateFee(c, now);
}
```

Hmm wait, "the fake clock can only be injected via the module's existing optional `now` parameter" — a local helper `calc` that forwards now is fine (it's not a new seam in the module).

**1. Full matrix per table.**

Hardcode expected values (in cents):

TABLES:
- 2019: openedAt before 2021-01-01, e.g. '2019-06-01'. urgencyPct 15, expeditedPct 10.
  - STANDARD: [12000, 18500, 27000, 41000]
  - COMMERCIAL: [22000, 31500, 45000, 68000]
  - ESTATE: [18000, 26000, 39500, 60000]
  - APPEAL: [30000, 42000, 61000, 92000]
- 2021: openedAt in ['2021-01-01', '2022-07-01'] inclusive of both ends (because of the quirk, 2022-07-01 is also 2021). Use '2021-05-10'.
  - STANDARD: [13500, 20500, 29500, 44500]
  - COMMERCIAL: [24000, 34000, 48500, 73000]
  - ESTATE: [19500, 28000, 42500, 64500]
  - APPEAL: [32500, 45500, 66000, 99000]
- 2022: openedAt after '2022-07-01', e.g. '2022-07-02' or '2023-03-15'.
  - STANDARD: [15000, 22500, 32500, 49000]
  - COMMERCIAL: [26500, 37500, 53500, 80500]
  - ESTATE: [21500, 31000, 47000, 71000]
  - APPEAL: [36000, 50000, 72500, 109000]

For each table: 16 cases. Expected breakdown without urgency/expedited: { table, bandFee, urgencyFee: 0, expeditedFee: 0, total: bandFee }.

To make the assertion "not hollow", assert the full object with toEqual:

```ts
expect(calc(input({ type: 'STANDARD', complexity: 1, openedAt: '2019-06-01' }))).toEqual({
  table: '2019',
  bandFee: 12000,
  urgencyFee: 0,
  expeditedFee: 0,
  total: 12000,
});
```

Data-driven:

```ts
const MATRIX: Record<'2019'|'2021'|'2022', { openedAt: string; base: Record<string, number[]> }> = {...}
```

But wait — hardcoding expected values equal to the source constants is the nature of characterization (pin the current behavior). Fine. Use describe.each or nested loops. Let me do it explicitly but compactly:

```ts
const CASE_TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
const BANDS = [1, 2, 3, 4] as const;

describe.each(Object.entries(BASE_FEES))(...)
```

Let me write it out:

```ts
const BASE_FEES: Record<TableName, Record<(typeof CASE_TYPES)[number], readonly [number, number, number, number]>> = {
  '2019': {
    STANDARD: [12000, 18500, 27000, 41000],
    ...
  },
  ...
};
```

And for each table a representative openedAt: '2019-06-01', '2021-05-10', '2022-08-01'. Then:

```ts
for (const [tableName, fees] of Object.entries(BASE_FEES) as ...) {
  describe(`rate table ${tableName} (opened ${OPENED_AT_FOR[tableName]})`, () => {
    for (const type of CASE_TYPES) {
      for (const band of BANDS) {
        const expected = fees[type][band - 1];
        it(`${type} band ${band} -> bandFee ${expected}, total ${expected}`, () => {
          expect(calc(input({ type, complexity: band, openedAt: OPENED_AT_FOR[tableName] }))).toEqual({
            table: tableName,
            bandFee: expected,
            urgencyFee: 0,
            expeditedFee: 0,
            total: expected,
          });
        });
      }
    }
  });
}
```

48 tests. Good.

**2. Rate-table boundaries.**

- '2020-12-31' → 2019
- '2021-01-01' → 2021 (inclusive edge on the 2021 revision)
- '2022-06-30' → 2021
- '2022-07-01' → **2021** ← pin the quirk (BUG-1): opened exactly on the 2022 revision date gets the 2021 table
- '2022-07-02' → 2022

Assert the `table` field and also a known bandFee for specificity. E.g.:

```ts
it('pins (BUG): a case opened exactly on 2022-07-01 is billed from the 2021 table', () => {
  expect(calc(input({ openedAt: '2022-07-01' })).table).toBe('2021');
});
```

Better: assert the full breakdown: STANDARD band 1 on '2022-07-01' → bandFee 13500 (2021) not 15000 (2022). A strong pin.

Also a sanity check that the edges differ: '2021-01-01' → 2021 (13500) vs '2020-12-31' → 2019 (12000). '2022-07-02' → 2022 (15000).

Also, the string-comparison quirk: openedAt with a time part: '2022-07-01T00:00:00' → lexicographic greater than '2022-07-01' → 2022 table. Pin: datetime form crosses the boundary differently than the date form. This is a facet of BUG-1. Include:

```ts
it('pins (QUIRK): openedAt with a time component sorts past the 2022 boundary string', () => {
  expect(calc(input({ openedAt: '2022-07-01T00:00:00' })).table).toBe('2022');
});
```

Hmm, is `new Date` involved? No — tableFor is pure string comparison. Deterministic. Good. And malformed: 'garbage' → 2022 (lexicographic: 'g' > '2'). Include one. And empty '' → 2019 ('' >= '2021-01-01' is false). Two small tests or one. Let me do a "pins (QUIRK): tableFor compares openedAt as a plain string" group with 'garbage' → '2022' and '' → '2019'.

**3. Urgency.**

Reference: `now` is passed. Boundaries:
- deadline = now → days 0 → urgent
- now + 1 day → urgent
- now + 7 days → urgent (inclusive edge)
- now + 8 days → not urgent
- past deadline (now - 1 day, and now - 30 days) → urgent (pins: overdue deadlines are treated as urgent)
- no deadline → not urgent
- empty deadline '' → not urgent (falsy) — pin the quirk
- malformed deadline 'garbage' → daysBetween NaN → NaN <= 7 is false → not urgent — pin

Urgency values: which table/pct? Use 2022 (urgencyPct 18) and 2019 (15) to pin both pct values. Example: now = '2024-01-15'.

- 2022 APPEAL band 4, openedAt '2023-01-01', now '2024-01-15', deadline '2024-01-22' (7 days): bandFee 109000, urgencyFee = round(109000*18/100) = 19620, total 128620.
- Same case with deadline '2024-01-23' (8 days): urgency 0, total 109000.
- deadline '2024-01-15' (0): urgent 19620.
- deadline '2024-01-14' (−1): urgent 19620.
- deadline '2023-12-16' (−30): urgent 19620.

Also pin urgency pct per table: 2019 15%, 2021 15%, 2022 18%. E.g., same case (STANDARD b1) opened in each era, with deadline = now → urgencyFee 1800 (2019: 12000*.15), 2025 (2021: 13500*.15), 2700 (2022: 15000*.18).

**4. Urgency depends on `now` (the billing-time quirk) — important finding.**

Test: same case, two different `now` values, different urgency:
- Case opened '2021-05-10', deadline '2021-05-15'. now '2021-05-10' → 5 days → urgent (2021 table, STANDARD b1 13500 → 2025). now '2021-05-16' → 0? daysBetween('2021-05-16','2021-05-15') = −1 → urgent. now '2021-05-22' → −7 → urgent (−7 <= 7). now '2021-05-23' → −8 → not urgent. So even after the deadline passes, for 7 days after it remains "urgent", then flips off. Interesting: daysBetween <= 7 includes −8..7? No: −8 <= 7 is TRUE! Wait: −8 <= 7 → true! Wait a moment. daysBetween <= 7 — every negative number is <= 7! So a deadline more than 8 days in the past → e.g. −30 → −30 <= 7 → true → urgent. So any past deadline is urgent, no matter how old. Right, I said that. So once the deadline has passed, the case is urgent forever. The flip I described doesn't happen: urgency turns on when the deadline is within 7 days in the future or now, and stays on forever once the deadline passes. So the "window" is: deadline − now ∈ (−∞, +7]. Let me re-verify: deadline '2021-05-15', now '2021-05-23' → daysBetween = 15−23 = −8 → −8 <= 7 → urgent. Yes, permanent. So the boundary: deadline in future: urgent until 8 days out. Past: urgent forever. Good — pin: deadline 30 days in the past → still urgent. That's a strong, surprising pin.

Test names: "pins (QUIRK): urgency is measured from the billing call time (now), not the opening date — the same case is urgent when billed on 2021-05-10 and not urgent when billed on 2021-05-25". For "not urgent": deadline '2021-05-15', now '2021-05-25' → days = −10 → ≤7 → urgent! Oops. I need deadline − now > 7 i.e. deadline still in the future by more than 7 days. So to show a flip from urgent → not urgent, compare now before the deadline window vs. a now more than 7 days before the deadline:
- Case opened '2021-05-10', deadline '2021-05-20' (future relative to opening).
- now '2021-05-13' → days = 7 → urgent.
- now '2021-05-10' → days = 10 → not urgent.
So the same case: billed on 2021-05-10 → no urgency; billed on 2021-05-13 → urgent. And once now ≥ deadline… it stays urgent. The key quirk: the urgency flag is a function of the call time, so re-running billing on a stored case produces different numbers → the stored historical fees aren't reproducible from case data. That's the blast radius.

**5. Rounding tests.**

- 2019 STANDARD b2 urgent expedited: bandFee 18500, urgency 2775, expedited = round(21275*10/100)=round(2127.5)=2128, total 23403. Pin Math.round's half-up.
- 2019 COMMERCIAL b2 urgent expedited: 31500, 4725, round(3622.5)=3623, total 39848.
- 2019 ESTATE b3 urgent expedited: 39500, 5925, round(4542.5)=4543, total 49968.
- 2022 APPEAL b4 urgent expedited: 109000, 19620, round(128620*12/100)=round(15434.4)=15434, total 144054.
- 2022 COMMERCIAL b4 urgent expedited: 80500, 14490, round(94990*.12)=round(11398.8)=11399, total 106489.
- Also pin that urgency itself is rounded per step (though exact on standard bands — note in findings).
- Also pin that expedited is compounded on top of the rounded urgencyFee: the input to expedited = bandFee + urgencyFee (rounded), and the result is rounded again → "rounded more than once". Test name: "pins (QUIRK): the expedited surcharge is compounded on (bandFee + urgencyFee) and rounded again — the .5 in 2019 STANDARD band 2 rounds up".

Let me verify 2019 COMMERCIAL b2: urgency = round(31500*15/100) = round(4725) = 4725. Sum 36225. Expedited 10% = 3622.5 → 3623. Total 31500+4725+3623 = 39848. ✓
2019 ESTATE b3: urgency = 39500*0.15 = 5925. Sum 45425. 10% = 4542.5 → 4543. Total 39500+5925+4543 = 49968. ✓
2019 STANDARD b2: 18500*.15=2775. Sum 21275. →2127.5→2128. Total 18500+2775+2128=23403. ✓
2022 APPEAL b4: 109000*.18 = 19620. Sum 128620. *.12 = 15434.4 → 15434. Total 109000+19620+15434 = 144054. ✓
2022 COMMERCIAL b4: 80500*.18 = 14490. Sum 94990. *.12 = 11398.8 → 11399. Total 80500+14490+11399 = 106489. ✓

Also a non-urgent expedited: round(bandFee * pct/100): 2022 APPEAL b4 non-urgent expedited: 109000*.12 = 13080 exact. Hmm. Fractional non-urgent expedited: 10% (2019): 18500*.1=1850 exact; need bandFee*1/10 with a .5 → bandFee ends in 5 — all are multiples of 50 → no. 12%: bandFee*3/25 — multiple of 50 → 50k*3/25 = 6k exact. So non-urgent expedited is always exact. Note in findings: the only step that actually produces fractions on the current table is the compounded expedited step.

Also "whether it happens more than once": the expedited step rounds after the urgency step has rounded — but since the urgency step is exact on the current bands, the second rounding operates on bandFee + urgency (which may be fractional when % applied). Fine, findings will explain.

**6. Degenerate inputs.**

- complexity null → throws 'complexity is required'. Pin the exact message.
- complexity undefined → throws same.
- complexity 0 → treated as band 1 (pins QUIRK: falsy complexity is coerced to band 1). 2022 STANDARD b0 → bandFee 15000.
- complexity −5 → band 1.
- complexity 4.7 or 5 → clamped to 4. (band > 4 → 4; 4.7 > 4 → 4.) Pin: complexity 5 → band 4; complexity 100 → band 4.
- complexity 2.5 → bands[1.5] → undefined → bandFee undefined, total NaN. Pin:

```ts
const r = calc(input({ complexity: 2.5, openedAt: '2023-01-01' }));
expect(r.bandFee).toBeUndefined();
expect(Number.isNaN(r.total)).toBe(true);
```

Also urgencyFee: no deadline → 0. Total = undefined + 0 + 0 = NaN. ✓ With deadline → urgencyFee NaN (pctOf(undefined*...)). Just pin the no-deadline variant and mention.

Actually wait, `total: bandFee + urgencyFee + expeditedFee` = undefined + 0 + 0 → NaN. ✓. And `bandFee` is undefined in the object. ✓

- complexity NaN → `!band` (NaN is falsy… actually `!NaN` is true) → band 1. Pin? NaN as input is odd; can fold into findings as an open question. Maybe skip in tests; mention in findings? Keep tests focused; mention briefly.

- Unknown case type: 'COMMRCIAL' (typo) → falls back to STANDARD rate. Pin with a full breakdown: openedAt '2021-05-10', type 'COMMRCIAL', complexity 2 → bandFee 20500 (2021 STANDARD band 2). Test name: "pins (QUIRK): unknown case types are silently billed at STANDARD rates (no validation, no error)".
- Also lower-case 'standard' → also unknown → STANDARD fallback (string keys are case-sensitive). Nice pin: 'standard' → bandFee 13500 (2021 STANDARD b1). Show that case-sensitivity is not normalized.

**7. `now` default / determinism**: I can't test the default without touching the real clock (non-deterministic). Note in FINDINGS as an open question: the default now uses the real clock; the suite avoids it. Not testable deterministically — an honest gap. Good, the spec says "if it can't be determined safely, say so as an open question".

Also daysBetween timezone: date-only strings → UTC → deterministic across TZs. State in findings.

Now, "test names that flag them" for quirks/bugs — use a prefix convention in names: `pins (BUG): ...` and `pins (QUIRK): ...`. And a top-of-file comment explaining the convention and pointing to FINDINGS.md.

Now, FINDINGS.md content. Structure:

```md
# FINDINGS — feeCalculator.ts characterization

Summary of what the suite pins, and what looks wrong. Fixes are proposed, not applied. Production code is unmodified.

## How to read this
...

## F-1 (BUG) The 2022-07-01 boundary is exclusive: cases opened on the revision date are billed at 2021 rates
- Reproduction: calculateFee({type:'STANDARD', complexity:1, openedAt:'2022-07-01'}, '2023-01-01') → { table:'2021', bandFee:13500, ... }
- What the code does: tableFor uses >= for 2021-01-01 but > for 2022-07-01.
- Likely intent: both revisions inclusive at the revision date.
- Blast radius: every case opened exactly on 2022-07-01 (and any datetime form of that day) has been billed 1.5× lower… actually at 2021 rates since 2022-07-01. Those stored fees are part of the audit. A fix would change the output of future re-runs for those cases; the stored record already reflects the old values.
- Facet: the comparison is lexicographic on strings — a datetime '2022-07-01T00:00:00' sorts after the boundary → 2022 table; malformed openedAt ('garbage') sorts into 2022; '' sorts into 2019.
- Proposed fix (not applied): change the inner test to `openedAt >= REVISION_2022`, and consider parsing to Date for robustness. After applying, run the suite — the test named "pins (BUG)" will fail exactly on 2022-07-01, signaling the behavior change.

## F-2 (QUIRK) Urgency is a function of the billing call time (`now`), not the case's dates
- Reproduction: same case with deadline '2021-05-20', opened '2021-05-10': now '2021-05-10' → urgencyFee 0; now '2021-05-13' → 2025.
- What the code does: ref = now ?? real clock; urgent if deadline − ref <= 7 days, including negative.
- Likely intent: urgency probably meant "the deadline is near" relative to the case timeline.
- Blast radius: stored historical fees depend on when billing ran; re-running fee generation for an old case produces a different (and usually urgent) number. Overdue deadlines are urgent forever.
- Proposed fix (not applied): define urgency against the case dates (e.g., days from openedAt, or a fixed as-of), and decide the semantics for past deadlines.

## F-3 (QUIRK) The expedited surcharge is compounded on (bandFee + urgencyFee) and rounded twice
- Reproduction: 2019 STANDARD band 2 urgent expedited: 18500 + 2775 = 21275; round(21275*10/100)=2128 (half-up).
- Likely intent: surcharge on the base band fee.
- Blast radius: every urgent+expedited fee since 2019 includes the compounding; the audit trail has it.
- Proposed fix (not applied): apply expeditedPct to bandFee only if compounding isn't the intended business rule; keep the per-step rounding because reconciliation depends on it.

## F-4 (QUIRK) Unknown / unrecognized case types fall back to STANDARD silently
- Reproduction: type 'COMMRCIAL' → charged as STANDARD; 'standard' (lowercase) also.
- Blast radius: typoed types from the "old system import" have been billed at STANDARD for years; no signal.
- Fix: validate the type and throw/flag on unknown; backfill audit of imported cases.

## F-5 (QUIRK) Falsy complexity (0, and NaN) is coerced to band 1; >4 is clamped to 4
- Reproduction: complexity 0 → band 1; −3 → band 1; 5 → band 4.
- Fix: explicit domain validation (integer 1..4) and reject out-of-range.

## F-6 (QUIRK) Fractional complexity (e.g. 2.5) falls through the clamps and indexes bands[1.5] → undefined bandFee, NaN total
- Reproduction: complexity 2.5, any other valid → { bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }.
- Fix: integer validation.

## Open questions (cannot be determined safely from the code)
- The default `now` (real clock) behavior is deliberately not pinned; the suite always passes `now`. Whether billing ever calls without now is not knowable from the code.
- Whether any historical case actually opened on 2022-07-01 (the F-1 population) — needs a data query; the code doesn't tell us.
- Whether '2019' rates apply to pre-2019 openedAt (the table is labeled 2019 but the code has no lower bound — any openedAt < 2021-01-01, e.g. '2015-03-03', gets the 2019 table). Pin: yes, no lower bound — should I pin this in a test? Yes: openedAt '2015-03-03' → table '2019'. That's deterministic and safe. Include it.
```

Also note: the rate table is labeled 2019, but the code has no lower bound — any openedAt < 2021-01-01, e.g. '2015-03-03', gets the 2019 table. Pin: yes, no lower bound — should I pin this in a test? Yes: openedAt '2015-03-03' → table '2019'. That's deterministic and safe. Include it.

Now, about the suite: the spec asks for "the suite passes, twice, no clock or randomness". Our suite: no Date.now, no new Date() without a fixed argument, all fixed strings. Vitest itself is fine.

One more check: `daysBetween` uses `new Date(b) - new Date(a)` — for '2024-01-15' and '2024-01-22' → 7 days exactly (both UTC midnight) → 7*86400000 / 86400000 = 7 → floor 7 → ≤7 urgent. ✓ '2024-01-23' → 8 → not. ✓

Now, the matrix test using `toEqual` on the whole object — the FeeBreakdown has exactly 4 keys. toEqual ignores undefined properties… the fractional-complexity case needs an explicit toBeUndefined (toEqual({bandFee: undefined,...}) actually passes with toEqual because it treats undefined props as equal to missing — but it's safer to assert explicitly). For the fractional test, I'll use explicit expect calls.

Now let me write the test file. Also need to think about TS strictness: the tsconfig is strict. In the test file, types:

```ts
const CASE_TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
type KnownCaseType = (typeof CASE_TYPES)[number];

const BASE_FEES: Record<string, Record<KnownCaseType, readonly [number, number, number, number]>> = {...}
```

Hmm, simpler:

```ts
const RATES: { table: '2019' | '2021' | '2022'; openedAt: string; base: Record<KnownCaseType, readonly number[]> }[] = [
  { table: '2019', openedAt: '2019-06-01', base: { STANDARD: [...], ... } },
  ...
];
```

And:

```ts
for (const { table, openedAt, base } of RATES) {
  describe(`rate table ${table} (openedAt ${openedAt})`, () => {
    for (const type of CASE_TYPES) {
      for (let band = 1; band <= 4; band++) {
        const expected = base[type][band - 1];
        it(`${type} band ${band}: bandFee ${expected} cents, no surcharges`, () => {
          expect(calc(input({ type, complexity: band, openedAt }))).toEqual({
            table,
            bandFee: expected,
            urgencyFee: 0,
            expeditedFee: 0,
            total: expected,
          });
        });
      }
    }
  });
}
```

TS: base[type] — Record<KnownCaseType, readonly number[]> → indexing with type (KnownCaseType) is OK. base[type][band-1] → number (no noUncheckedIndexedAccess). ✓

`input` helper: CaseInput requires type, complexity, openedAt.

```ts
function input(over: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2019-06-01',
    ...over,
  };
}

const REF_NOW = '2024-01-15';
function calc(c: CaseInput, now: string = REF_NOW): FeeBreakdown {
  return calculateFee(c, now);
}
```

Wait, one subtlety: for tests where the urgency boundary matters, `now` must relate to deadline. For the matrix, no deadline → urgency 0 regardless of now. Good.

For "urgency pct differs by table" tests, pick now such that the deadline is within 7 days: deadline = '2024-01-16', now = '2024-01-15' → 1 day → urgent.

- 2019: openedAt '2019-06-01', STANDARD b1 12000 → urgency round(1800)=1800 → total 13800.
- 2021: openedAt '2021-05-10', STANDARD b1 13500 → 2025 → total 15525.
- 2022: openedAt '2022-08-01', STANDARD b1 15000 → round(2700)=2700 → total 17700.

These double as "urgency pct pinned per table".

Boundary tests (now '2024-01-15', openedAt '2022-08-01', APPEAL b4 109000, 2022 table, urgency 18% = 19620):
- deadline '2024-01-22' → 7 days → urgent: urgencyFee 19620, total 128620.
- deadline '2024-01-23' → 8 days → not urgent: 0, total 109000.
- deadline '2024-01-15' → 0 → urgent.
- deadline '2024-01-14' → −1 → urgent.
- deadline '2023-12-16' → −30 → urgent (pins: overdue stays urgent forever).

Hmm wait — for the '2024-01-15' now and openedAt '2022-08-01', the 2022 table. OK.

Now F-2 tests (now dependence):
- Case: openedAt '2021-05-10', type STANDARD, complexity 1, deadline '2021-05-20'.
  - now '2021-05-10': days 10 → not urgent → total 13500.
  - now '2021-05-13': days 7 → urgent → 13500+2025=15525.
  - now '2021-05-19': days 1 → urgent 15525.
  - now '2021-05-20': 0 → urgent.
  - now '2021-05-31': −11 → urgent (pins permanence).
Name: "pins (QUIRK): the same stored case flips between urgent and not depending on the `now` the caller passes (billing-time)".

Also pin that `now` is not used for table selection: table comes from openedAt only. E.g., openedAt '2019-06-01' with now '2024-01-15' still '2019' table. Already implicit in matrix tests (default REF_NOW 2024 with openedAt 2019 → table 2019). Good — that's covered; add an explicit comment maybe.

Missing complexity: `complexity: null` → throws. Also a note: complexity undefined — CaseInput says `number | null`; passing undefined is TS-legal? `complexity: number | null` — passing undefined violates the type… I can cast: `input({ complexity: undefined as unknown as number })`? Hmm, the interface is `complexity: number | null`. To test the undefined branch I'd have to bypass the type. Is it worth it? The code checks `=== null || === undefined`. The undefined branch is reachable at runtime (e.g. a caller built without that key, JSON parse). I can construct the object literal without the key:

```ts
const missing: CaseInput = { type: 'STANDARD', openedAt: '2019-06-01' } as CaseInput;
expect(() => calculateFee(missing, REF_NOW)).toThrow('complexity is required');
```

Hmm, `{ type, openedAt }` missing complexity — TS error: property 'complexity' is required (not optional). So `as CaseInput` won't work directly on a literal missing the prop (insufficient properties in the conversion… actually `as` on an object literal missing a required prop: does TS allow the assertion if the type is a "supertype"? The rule: an assertion is allowed if one type is assignable to the other; {type, openedAt} is not assignable to CaseInput and CaseInput is not assignable to {type, openedAt}… the target of the assertion CaseInput vs source {type: string, openedAt: string}: CaseInput has all props of the source → source is a subtype? No: source lacks complexity → source is not assignable to target; target is not assignable to source? Target requires complexity: number|null; source type doesn't have it → not assignable. Neither direction → error 2352). Simpler:

```ts
const missing = { type: 'STANDARD', openedAt: '2019-06-01' } as unknown as CaseInput;
```

Fine, and the test: "pins: a case with no complexity key at all throws 'complexity is required' (the undefined branch)". OK.

Test exact throw message: `.toThrow('complexity is required')` (substring match). Could also check the exact message:

```ts
let msg: string | undefined;
try { calculateFee(...) } catch (e) { msg = e instanceof Error ? e.message : undefined }
expect(msg).toBe('complexity is required');
```

Simpler: `expect(() => ...).toThrowError('complexity is required')`. Sufficient, plus one exact-message test for rigor? The code does `throw new Error('complexity is required')` — pin the exact message. One test with exact message, another for the undefined branch with toThrow. Fine.

Unknown-type tests:
- 'COMMRCIAL' openedAt '2021-05-10', complexity 2 → 2021 STANDARD b2 = 20500.
- 'standard' (lowercase) openedAt '2019-06-01' complexity 1 → 12000.
- Also unknown type + deadline within window: falls back to STANDARD base and urgency on it. One is enough; keep the two above and note the fallback uses the table of openedAt (i.e. the fallback row is era-specific): 'COMMRCIAL' openedAt '2023-01-01' complexity 1 → 15000 (2022 STANDARD b1) — shows the fallback respects the era table. Good: include.

Clamping tests:
- complexity 0 → band 1: openedAt '2022-08-01' → 15000.
- complexity −2 → band 1 → 15000.
- complexity 5 → band 4: 2022 STANDARD b4 49000.
- complexity 42 → 49000.
- complexity 2.5 → undefined/NaN pin.
- Also note: complexity 0 is falsy → 1; but what about complexity = 0.5? `!0.5` false, 0.5 < 1 true → band 1. Same as 0 path. Not needed separately.

Boundary/transition tests (group "rate-table boundaries"):
- '2020-12-31' → 2019 (STANDARD b1 12000)
- '2021-01-01' → 2021 (13500) [inclusive]
- '2021-01-02' → 2021
- '2022-06-30' → 2021 (13500)
- '2022-07-01' → 2021 (13500) ← pin the BUG
- '2022-07-02' → 2022 (15000)
- '2015-03-03' → 2019 (no lower bound)
- 'garbage' → '2022' (lexicographic)
- '' → '2019'
- '2022-07-01T00:00:00' → '2022' (datetime form crosses)

For each, assert the `table` field + a specific bandFee for concreteness. The BUG one asserts the full breakdown.

Now, naming convention: use `pins (BUG):` / `pins (QUIRK):` prefix. The spec says test names should let a reader know it's deliberately pinned. Also add a describe-level comment at the top of the file:

```ts
// Characterization suite for feeCalculator.ts — pins current behavior,
// including known quirks and at least one suspected bug. It does NOT
// assert intended behavior. Tests prefixed "pins (QUIRK)" or "pins (BUG)"
// are deliberately pinning surprising/incorrect outputs; see FINDINGS.md.
// Every call passes an explicit `now`; the module's only clock seam is
// that parameter. No new Date() call, no timers, no randomness anywhere
// in this file, so the suite is timezone- and wall-clock-independent.
```

Wait — "no real dates" — I think it means no `new Date()` with no arguments / no wall-clock. Fixed ISO strings are fine and necessary.

Now, the matrix: 3 tables × 4 types × 4 bands = 48 tests. Plus boundaries ~10, urgency ~8, now-dependence ~5, rounding ~6, degenerate ~12. Total ~90 tests. Good.

Now, double-check the urgency boundary with the 2021 table: urgencyPct 15: 13500*0.15=2025 exact ✓.

Verify 2022 APPEAL b4: urgency 109000*18/100 = 19620 ✓. Sum 128620. Expedited 12% = 15434.4 → 15434 ✓.

Verify 2022 COMMERCIAL b4 expedited: 80500*18/100 = 14490 ✓ (805*18 = 14490). Sum 94990. 94990*12/100 = 11398.8 → 11399 ✓.

Verify 2022 ESTATE b4 expedited (optional): 71000*.18=12780; sum 83780; *.12 = 10053.6 → 10054. Could include as an additional rounding pin. Include 4-5 rounding tests.

Also include a non-fractional expedited pin to show the exact path: 2021 STANDARD b1 urgent expedited: 13500 + 2025 = 15525 * 12% = 1863 exact → total 15525+1863 = 17388. ✓ (15525*12 = 186300 /100 = 1863). Good.

Now — determinism check for `daysBetween('2024-01-15', '2024-01-22')`: new Date('2024-01-22') - new Date('2024-01-15') = 7*86400000 ms → 7 → floor → 7 ≤ 7 ✓.

Now for '2021-05-10' vs '2021-05-20': 10 days. now '2021-05-13' → 7 ✓ urgent. now '2021-05-10' → 10 → not.

For F-2 I also want a "re-run an old case" pin: case opened '2021-05-10', deadline '2021-05-15'; billed on '2021-05-12' (3 days → urgent, total 15525) vs. billed on '2024-01-15' (−611 days? → still ≤ 7 → urgent!). Hmm — permanence makes both urgent. To show a difference I need a case where the deadline is in the future: opened '2021-05-10', deadline '2021-06-30'. now '2021-05-10' → 51 → not urgent (13500). now '2021-06-23' → 7 → urgent (15525). now '2021-07-01' → −1 → urgent. So billed at opening → not urgent; billed later → urgent. The stored fee depends on when billing ran.

Edge: deadline exactly now+7 for 2021 table: '2021-06-23' − '2021-06-16' = 7. Use now '2021-06-16', deadline '2021-06-23' → urgent 2025. now '2021-06-15' → 8 → not.

Now let me also think about: should I assert the `table` field of the breakdown in the matrix tests? Yes — toEqual includes it.

One more consideration: the suite must pass under TS strict. The loop `for (let band = 1; band <= 4; band++)` fine. `base[type][band - 1]` → number. `expected` is number.

In the rounding tests, hardcode expected breakdown literals — good, no recomputation (characterization = independent literal). All my literals come from hand computation; re-verify each:

R1: 2019 STANDARD b2 urgent+expedited, now '2019-07-01', deadline '2019-07-03' (2 days → urgent):
- bandFee 18500
- urgency round(18500*15/100)=round(2775)=2775
- expedited round((18500+2775)*10/100)=round(2127.5)=2128
- total 23403 ✓

R2: 2019 COMMERCIAL b2: 31500; urg round(4725)=4725; exp round(3622.5)=3623; total 31500+4725+3623=39848 ✓
R3: 2019 ESTATE b3: 39500; urg round(5925)=5925; exp round(4542.5)=4543; total 39500+5925+4543=49968 ✓
R4: 2022 APPEAL b4: 109000; urg 19620; exp round(15434.4)=15434; total 144054 ✓
R5: 2022 COMMERCIAL b4: 80500; urg 14490; exp round(11398.8)=11399; total 106489 ✓
R6 (exact, no rounding change): 2021 STANDARD b1 urgent+expedited: 13500; urg 2025; exp round(1863)=1863; total 17388 ✓
R7 (urgency rounding is a no-op but present): the 2022 table urgency 18%: 21500*18/100 = 3870 exact. Hmm, I want to show the urgency step rounds even when exact — not observable. Instead note in findings. Skip.

Also a test: expedited without urgency: 2022 APPEAL b4 expedited only: exp round(109000*12/100)=round(13080)=13080; total 122080. Pins that without urgency, expedited applies to bandFee alone. Include.

Now — "urgency multiplier including the boundary that determines urgency": covered (7/8 days).

Now FINDINGS.md — write it well-structured. What to include: reproduction input (exact object + now), what the code does (with exact output), likely intent, blast radius, proposed fix (not applied), and cross-reference test names. Also "honest gaps" section.

Also mention: I deliberately did NOT pin the wall-clock default `now` (can't be made deterministic); the suite always passes now.

Let me also re-verify the `tableFor` boundary logic once more:

```ts
if (openedAt >= REVISION_2021) {          // '2021-01-01'
  if (openedAt > REVISION_2022) {         // '2022-07-01'
    return RATE_TABLE_2022;
  }
  return RATE_TABLE_2021;
}
return RATE_TABLE_2019;
```

- '2022-07-01' >= '2021-01-01' ✓ → inner: '2022-07-01' > '2022-07-01' ✗ → 2021. ✓ (bug: the revision-date case gets the pre-revision rate).
- 'garbage' >= '2021-01-01': 'g'(0x67) > '2'(0x32) → true. 'garbage' > '2022-07-01' → true → 2022 ✓.
- '' >= '2021-01-01' → false → 2019 ✓.
- '2022-07-01T00:00:00' > '2022-07-01' → prefix equal, longer string → true → 2022 ✓. And >= 2021 ✓.
- '2022-06-30' → >= 2021 ✓; > 2022-07-01? '2022-06-30' < '2022-07-01' → 2021 ✓.

Also '2022-07-01 ' (trailing space)? Skip.

Another potential quirk: `daysBetween` with a datetime deadline: '2024-01-21T12:00:00Z' − '2024-01-15' = 6.5 days → floor 6 → urgent (≤7). Whereas a date-only '2024-01-21' → 6. Both urgent. '2024-01-22T12:00:00Z' → 7.5 → floor 7 → urgent; date-only 2024-01-22 → 7 → urgent. Same. '2024-01-23T00:00:00Z' → 8 → not. So the floor makes a mid-day deadline behave as the previous day's boundary. Example: deadline '2024-01-23T00:00:00Z' is not urgent but '2024-01-22T23:59:59Z' → 7.999 → 7 → urgent. Is it worth a pin? It's the "floor" behavior of the day math. Might include one test: deadline with a time component '2024-01-22T23:00:00' — hmm, '2024-01-22T23:00:00' without Z is parsed as local time! Timezone-dependent! Note: ISO strings with a time but no timezone are parsed as local time in JS. That would make the test TZ-dependent → violates determinism. So any datetime string I use must include 'Z' (UTC). '2024-01-22T23:59:59Z' − '2024-01-15T00:00:00Z'… now is date-only '2024-01-15' → UTC midnight. diff = 7 days + 23:59:59 → ms/86400000 = 7.9999... → floor 7 → urgent. Deterministic (both UTC). And '2024-01-23T00:00:00Z' → 8.0 → not. This pins the Math.floor day math. Include one pair of tests:
- deadline '2024-01-22T23:59:59Z' → urgent (floor 7.999→7)
- deadline '2024-01-23T00:00:00Z' → not (8)
This is a nice edge pin: "days are floored; a deadline late on the 8th day still counts as 7". Good, TZ-safe because Z.

Wait — but for `openedAt` with 'T...Z' in the tableFor string comparison: '2022-07-01T00:00:00Z' vs '2022-07-01' → longer → greater → 2022. Same as without Z. I used '2022-07-01T00:00:00' (no Z) in that test — it's just a string compared, no Date parsing, so no TZ issue. Either is fine; I'll use the no-Z form as shown in the findings to show pure string comparison. Hmm but someone might argue 'T00:00:00' is a "real" datetime; it's just compared as a string in tableFor — no parsing — deterministic. OK.

Also — daysBetween when now has a time? I only pass date-only now. Fine.

Let me also double-check `pctOf` for the urgency in 2022: urgencyPct 18. APPEAL b4 109000 → 109000*18 = 1962000 /100 = 19620 ✓.

And the matrix values — copy carefully from the source:

2019:
STANDARD [12000, 18500, 27000, 41000]
COMMERCIAL [22000, 31500, 45000, 68000]
ESTATE [18000, 26000, 39500, 60000]
APPEAL [30000, 42000, 61000, 92000]
urgencyPct 15, expeditedPct 10.

2021:
STANDARD [13500, 20500, 29500, 44500]
COMMERCIAL [24000, 34000, 48500, 73000]
ESTATE [19500, 28000, 42500, 64500]
APPEAL [32500, 45500, 66000, 99000]
urgencyPct 15, expeditedPct 12.

2022:
STANDARD [15000, 22500, 32500, 49000]
COMMERCIAL [26500, 37500, 53500, 80500]
ESTATE [21500, 31000, 47000, 71000]
APPEAL [36000, 50000, 72500, 109000]
urgencyPct 18, expeditedPct 12.

Now, the file layout. The convention block says `test/<feature>.spec.ts`. Feature: fee-calculator. So `test/fee-calculator.spec.ts`. Import from `'../feeCalculator'`.

FINDINGS.md at the repo root: `FINDINGS.md`.

Should I also deliver `feeCalculator.ts`? No — "production code byte-identical" means don't deliver it / don't modify it; the instructions say don't restate files I haven't changed. Correct — only the new files.

Now, will `describe`/`it`/`expect` from 'vitest' be available? Assume yes per the spec ("TypeScript, vitest").

Let me now carefully write out the complete spec file.

```ts
// Characterization suite for feeCalculator.ts (in production since 2019, zero
// tests until now). It pins what the code DOES today, not what it should do.
//
// Conventions in this file:
//  - Every test asserts a literal expected breakdown; expected values were
//    derived by hand from the current implementation and are the pin itself.
//  - Tests whose name starts with "pins (BUG):" or "pins (QUIRK):" are
//    deliberately pinning surprising or known-wrong behaviour. They must keep
//    passing until someone intentionally changes the code. Each one has an
//    entry in FINDINGS.md (reproduction, blast radius, proposed-not-applied
//    fix).
//  - Determinism: every call to calculateFee passes an explicit `now` (the
//    module's only clock seam). No new Date(), no Date.now(), no timers, no
//    randomness in this file. All date strings are fixed literals; where a
//    time of day matters it carries a Z suffix so parsing is UTC-anchored.
//  - The production module is imported as-is; nothing is mocked or refactored.

import { describe, expect, it } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';

const REF_NOW = '2024-01-15';

function input(over: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2019-06-01',
    ...over,
  };
}

function calc(c: CaseInput, now: string = REF_NOW): FeeBreakdown {
  return calculateFee(c, now);
}
```

Hmm — `calc`'s default REF_NOW: for tests that rely on urgency being off, no deadline → fine.

Matrix:

```ts
const CASE_TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
type KnownCaseType = (typeof CASE_TYPES)[number];

interface TableSpec {
  table: '2019' | '2021' | '2022';
  // An openedAt that selects this table (not on a boundary)
  openedAt: string;
  base: Record<KnownCaseType, readonly number[]>;
}

const TABLES: TableSpec[] = [
  {
    table: '2019',
    openedAt: '2019-06-01',
    base: {
      STANDARD: [12000, 18500, 27000, 41000],
      COMMERCIAL: [22000, 31500, 45000, 68000],
      ESTATE: [18000, 26000, 39500, 60000],
      APPEAL: [30000, 42000, 61000, 92000],
    },
  },
  {
    table: '2021',
    openedAt: '2021-05-10',
    base: {
      STANDARD: [13500, 20500, 29500, 44500],
      COMMERCIAL: [24000, 34000, 48500, 73000],
      ESTATE: [19500, 28000, 42500, 64500],
      APPEAL: [32500, 45500, 66000, 99000],
    },
  },
  {
    table: '2022',
    openedAt: '2022-08-01',
    base: {
      STANDARD: [15000, 22500, 32500, 49000],
      COMMERCIAL: [26500, 37500, 53500, 80500],
      ESTATE: [21500, 31000, 47000, 71000],
      APPEAL: [36000, 50000, 72500, 109000],
    },
  },
];

for (const spec of TABLES) {
  describe(`rate table ${spec.table} (openedAt ${spec.openedAt})`, () => {
    for (const type of CASE_TYPES) {
      for (let band = 1; band <= 4; band += 1) {
        const expected = spec.base[type][band - 1];
        it(`${type} band ${band}: ${expected} cents, no surcharges`, () => {
          expect(
            calc(input({ type, complexity: band, openedAt: spec.openedAt })),
          ).toEqual({
            table: spec.table,
            bandFee: expected,
            urgencyFee: 0,
            expeditedFee: 0,
            total: expected,
          });
        });
      }
    }
  });
}
```

TS check: `spec.base[type][band - 1]` — readonly number[] indexed by number → number. ✓

Boundary:

```ts
describe('rate-table selection: the 2021-01-01 and 2022-07-01 boundaries', () => {
  const standard = (openedAt: string) =>
    calc(input({ type: 'STANDARD', complexity: 1, openedAt }));

  it('pins: opened 2020-12-31 (day before the 2021 revision) -> 2019 table', () => {
    expect(standard('2020-12-31')).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000 });
  });

  it('pins: opened exactly on 2021-01-01 -> 2021 table (inclusive edge)', () => {
    expect(standard('2021-01-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins: opened 2022-06-30 (day before the 2022 revision) -> 2021 table', () => {
    expect(standard('2022-06-30')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins (BUG): opened exactly on 2022-07-01 -> 2021 table, NOT 2022 (exclusive edge; see FINDINGS F-1)', () => {
    expect(standard('2022-07-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins: opened 2022-07-02 (day after the 2022 revision) -> 2022 table', () => {
    expect(standard('2022-07-02')).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 });
  });

  it('pins: no lower bound -- opened 2015-03-03 (before the system existed?) -> 2019 table', () => {
    ...
  });

  it('pins (QUIRK): openedAt is compared as a raw string -- a datetime on the 2022 boundary sorts into 2022', () => {
    expect(calc(input({ openedAt: '2022-07-01T00:00:00' })).table).toBe('2022');
  });

  it('pins (QUIRK): a non-date openedAt ("garbage") sorts above both revision strings -> 2022 table', () => {
    expect(calc(input({ openedAt: 'garbage' })).table).toBe('2022');
  });

  it('pins (QUIRK): an empty openedAt sorts below both revision strings -> 2019 table', () => {
    expect(calc(input({ openedAt: '' })).table).toBe('2019');
  });
});
```

Urgency:

```ts
describe('urgency (deadline proximity to `now`)', () => {
  const now = '2024-01-15';
  // 2022 APPEAL band 4: bandFee 109000, urgencyPct 18 -> urgencyFee 19620
  const c = (deadline: string | undefined) =>
    calc(input({ type: 'APPEAL', complexity: 4, openedAt: '2022-08-01', deadline }), now);

  it('pins: deadline 7 days out (inclusive edge) -> urgent, fee 19620', ...);
  it('pins: deadline 8 days out (exclusive side) -> not urgent, fee 0', ...);
  it('pins: deadline today (0 days) -> urgent', ...);
  it('pins: deadline yesterday (-1 days) -> still urgent', ...);
  it('pins (QUIRK): deadline 30 days in the PAST -> still urgent; once overdue the flag never clears (FINDINGS F-2)', ...);
  it('pins: no deadline at all -> not urgent', ...);
  it('pins (QUIRK): empty-string deadline is falsy -> silently not urgent', ...);
  it('pins (QUIRK): unparseable deadline makes daysBetween NaN, and NaN <= 7 is false -> silently not urgent', ...);
  it('pins: urgency pct is table-dependent (2019/2021: 15%, 2022: 18%)', () => {
    // Same band shape across eras, deadline 1 day from now
    expect(calc(input({ type: 'STANDARD', complexity: 1, openedAt: '2019-06-01', deadline: '2024-01-16' }), now)).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 0, total: 13800 });
    expect(calc(input({ type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2024-01-16' }), now)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
    expect(calc(input({ type: 'STANDARD', complexity: 1, openedAt: '2022-08-01', deadline: '2024-01-16' }), now)).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 2700, expeditedFee: 0, total: 17700 });
  });
});
```

Wait — one issue: the urgency pct test has openedAt in a past era and deadline '2024-01-16' — that's fine: table from openedAt, urgency from now/deadline. Good, it also demonstrates that the table isn't affected by now/deadline.

Days-flooring:

```ts
it('pins: day math is floored -- deadline late on the 8th day (23:59:59Z) still counts as 7 days -> urgent', () => {
  calc deadline '2024-01-22T23:59:59Z', now '2024-01-15' → floor(7.999988) = 7 → urgent
});
it('pins: deadline at the start of the 9th day (00:00:00Z) is 8 days -> not urgent', () => {
  '2024-01-23T00:00:00Z' → 8 → not
});
```

Verify: '2024-01-22T23:59:59Z' − '2024-01-15' (UTC midnight) = 7 days 23:59:59 = 691199000 ms… let me compute: 7*86400000=604800000; + 86399000 = 691199000. /86400000 = 7.9999884… floor 7 ✓.

now-dependence (F-2):

```ts
describe('pins (QUIRK): urgency is measured from the billing call time, not the case timeline (FINDINGS F-2)', () => {
  // Case opened 2021-05-10 (2021 table, STANDARD band 1 = 13500, urgency 15% = 2025)
  const opened = '2021-05-10';
  const deadline = '2021-06-30';

  it('billed on the opening date (51 days before deadline) -> not urgent', () => {
    expect(calc(input({ openedAt: opened, deadline }), '2021-05-10')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('billed 8 days before the deadline -> not urgent', () => {
    // days = 22? wait '2021-06-22' → 30−22 = 8 days → not urgent
    expect(calc(input({ openedAt: opened, deadline }), '2021-06-22')).toEqual({... urgencyFee: 0 ... total 13500});
  });

  it('billed 7 days before the deadline (inclusive edge) -> urgent', () => {
    now '2021-06-23' → 7 → urgent 2025, total 15525
  });

  it('billed after the deadline has passed -> still urgent (permanence)', () => {
    now '2021-07-01' → −1 → urgent, 15525
  });

  it('the same stored case, re-billed years later with the deadline still future... ' hmm
```

Actually the cleanest pair: same input object, two different nows, different totals — that IS the re-run hazard:

```ts
it('same case object, two billing dates -> two different stored totals (the audit hazard)', () => {
  const case_ = input({ openedAt: opened, deadline });
  const first = calc(case_, '2021-05-10'); // 51 days -> not urgent
  const second = calc(case_, '2021-06-23'); // 7 days -> urgent
  expect(first.total).toBe(13500);
  expect(second.total).toBe(15525);
  expect(second.total - first.total).toBe(2025);
});
```

Verify days: deadline '2021-06-30'; now '2021-05-10' → 51 days (May has 31 days: 10→31 is 21, +30 = 51) → not urgent ✓. now '2021-06-23' → 7 → urgent ✓. now '2021-06-22' → 8 → not ✓. now '2021-07-01' → −1 → urgent ✓.

Rounding:

```ts
describe('rounding (per-step Math.round, cents)', () => {
  it('pins (QUIRK): expedited is compounded on (bandFee + urgencyFee); 2019 STANDARD band 2 urgent+expedited rounds a .5 UP (2127.5 -> 2128)', () => {
    expect(
      calc(input({ type: 'STANDARD', complexity: 2, openedAt: '2019-06-01', deadline: '2019-07-03', expedited: true }), '2019-07-01'),
    ).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 });
  });
  // deadline '2019-07-03' − now '2019-07-01' = 2 days → urgent ✓
  ...
});
```

All rounding tests need deadline within 7 days of the passed now. Let me set now = REF_NOW '2024-01-15' uniformly, and deadlines = '2024-01-16'. But the openedAt must select the right table: 2019 test openedAt '2019-06-01', deadline '2024-01-16' — that's fine (deadline can be any date; urgency just needs days ≤ 7).

Simplify: all urgency/rounding tests use now '2024-01-15', deadline '2024-01-16' (1 day → urgent).

R1 2019 STANDARD b2 expedited: openedAt '2019-06-01' → { 2019, 18500, 2775, 2128, 23403 } ✓
R2 2019 COMMERCIAL b2 expedited: { 2019, 31500, 4725, 3623, 39848 } ✓
R3 2019 ESTATE b3 expedited: { 2019, 39500, 5925, 4543, 49968 } ✓
R4 2022 APPEAL b4 expedited: { 2022, 109000, 19620, 15434, 144054 } ✓
R5 2022 COMMERCIAL b4 expedited: { 2022, 80500, 14490, 11399, 106489 } ✓
R6 2021 STANDARD b1 expedited (exact): { 2021, 13500, 2025, 1863, 17388 } ✓
R7 2022 APPEAL b4 expedited, NOT urgent (no deadline): { 2022, 109000, 0, 13080, 122080 } ✓ — pins that expedited on bandFee alone when not urgent.

Also a "rounding at each step" note: urgency step is exact on all current band fees (all are multiples that divide evenly by 15%/18%/12%), so the only step that currently produces a fraction is the compounded expedited step; the per-step rounding is still pinned by the exact-value tests (e.g. R6). Add as a comment in the findings.

Degenerate:

```ts
describe('degenerate inputs', () => {
  it('pins: complexity null throws "complexity is required" (exact message)', () => {
    let message: string | undefined;
    try { calculateFee(input({ complexity: null }), REF_NOW); } catch (e) { message = e instanceof Error ? e.message : String(e); }
    expect(message).toBe('complexity is required');
  });

  it('pins: a case object without the complexity key (undefined) also throws the same error', () => {
    const noComplexity = { type: 'STANDARD', openedAt: '2019-06-01' } as unknown as CaseInput;
    expect(() => calculateFee(noComplexity, REF_NOW)).toThrow('complexity is required');
  });

  it('pins (QUIRK): complexity 0 is falsy -> coerced to band 1, billed, not rejected', () => {
    expect(calc(input({ complexity: 0, openedAt: '2022-08-01' }))).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 });
  });

  it('pins (QUIRK): negative complexity -> band 1', () => {
    expect(calc(input({ complexity: -3, openedAt: '2022-08-01' })).bandFee).toBe(15000);
  });

  it('pins (QUIRK): complexity above 4 is clamped down to band 4', () => {
    expect(calc(input({ complexity: 5, openedAt: '2022-08-01' }))).toEqual({ table: '2022', bandFee: 49000, urgencyFee: 0, expeditedFee: 0, total: 49000 });
    expect(calc(input({ complexity: 42, openedAt: '2022-08-01' })).bandFee).toBe(49000);
  });

  it('pins (QUIRK): fractional complexity (2.5) slips past both clamps and indexes bands[1.5] -> undefined bandFee, NaN total', () => {
    const r = calc(input({ complexity: 2.5, openedAt: '2022-08-01' }));
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(Number.isNaN(r.total)).toBe(true);
  });

  it('pins (QUIRK): unknown case type is silently billed at STANDARD rates for the era table (no error, no flag)', () => {
    expect(calc(input({ type: 'COMMRCIAL', complexity: 2, openedAt: '2021-05-10' }))).toEqual({ table: '2021', bandFee: 20500, urgencyFee: 0, expeditedFee: 0, total: 20500 });
  });

  it('pins (QUIRK): case sensitivity is not normalized -- "standard" is an unknown type, billed as STANDARD', () => {
    expect(calc(input({ type: 'standard', complexity: 1, openedAt: '2019-06-01' })).bandFee).toBe(12000);
  });

  it('pins (QUIRK): the STANDARD fallback still honors the era -- unknown type opened in 2023 gets 2022 STANDARD band 1', () => {
    expect(calc(input({ type: 'COMMRCIAL', complexity: 1, openedAt: '2023-01-01' })).bandFee).toBe(15000);
  });
});
```

Wait: complexity 0 — `input({complexity: 0})` — CaseInput.complexity: number | null → 0 is fine.

NaN complexity: skip (documented as open question in findings? Actually `!NaN` → true → band 1 — I could add a test… NaN as a "complexity" is an odd input; skip the test, mention in findings F-5 as "NaN also falls into the falsy branch (band 1)" — but "if it can't be determined safely… say so". It can be determined by reading the code: `!band || band < 1` with band NaN → `!NaN` = true → band=1. Deterministic. But testing requires passing NaN — `input({complexity: NaN})` is typed fine (number). Let me add a small pin — it's cheap and real. Hmm, I want to keep the suite tight; but this is genuinely a distinct branch fact. Include it: "pins (QUIRK): NaN complexity is falsy -> band 1 (same coercion as 0)". OK include.

Now — "urgency multiplier, including the boundary that determines urgency from non-urgent": ✓ (7/8-day pair, both tables? The boundary value is the same; pct differs per table which is covered).

One more: "rounding at each step — where it happens, whether it happens more than once" — my rounding group + findings cover. Also add an explicit comment in the rounding describe.

Now, also double-check `toEqual` semantics: it does deep equality; extra undefined keys are ignored, but our objects have all numeric keys. Good.

Potential TS strict issue: `const c = (deadline: string | undefined) => calc(input({... deadline }), now)` — CaseInput.deadline?: string — passing undefined explicitly is OK (optional). ✓

In the "urgency" describe, I define `const now = '2024-01-15'` shadowing? REF_NOW is a module-level const; a local `const now` is fine.

Edge: for the malformed deadline 'garbage' case: daysBetween(ref, 'garbage') = floor(NaN)=NaN; NaN <= 7 → false → no urgency. ✓. And `c.deadline && ...` — 'garbage' is truthy → enters. ✓

Empty deadline '': falsy → skip. ✓

Now the F-1 "blast radius" wording: cases opened exactly on 2022-07-01 (date-only form) have been billed since then at 2021 rates — 1 band value difference. How much? Difference per band: STANDARD: 15000−13500=1500; COMMERCIAL 2500; ESTATE 2000; APPEAL 3500. Also the urgency/expedited pcts differ (18 vs 15, 12 vs 12). So such cases are systematically underbilled relative to the 2022 schedule. Blast radius: every case opened on 2022-07-01 in the audit record; plus anyone re-running fee generation on those cases today will reproduce 2021 rates (the bug is still live). Also the datetime-form cases '2022-07-01T…' got the 2022 table — inconsistent within the same calendar day.

Proposed fix: make both boundaries inclusive: `openedAt >= REVISION_2022` → 2022; and/or parse dates. Note: after fixing, the pinned test "pins (BUG): opened exactly on 2022-07-01" will fail → update it to assert the new value in the follow-up issue.

F-2 blast radius: stored fees depend on the billing execution date; overdue deadlines are urgent forever; the real-clock default means runs without now are non-reproducible. Proposed: base urgency on the case's own timeline or an explicit as-of; define the semantics for overdue.

F-3 (compounding) — is this a bug or a quirk? "at least one real bug" — F-1 is the clearest real bug. Compounding could be an intended design ("percent added on top"). I'll call it a quirk requiring business confirmation.

Also mention in findings: `Math.round` is half-up (away from zero) — pinned by R1-R3 (.5 → up). Note: Math.round(2127.5) = 2128 ✓ (rounds .5 toward +∞).

Also the "open questions" section:
1. The default `now` = wall clock. The suite doesn't pin it (non-deterministic by nature). Whether production calls ever omit `now` cannot be determined from the code; if so, historical fees are wall-clock-dependent (compounds F-2).
2. Whether any real case opened on 2022-07-01 (F-1 population) — needs a data query.
3. Whether the STANDARD fallback for unknown types was a deliberate grace period for "old system imports" (per the comment) — the comment suggests it was intentional for the rare imports; whether it's still acceptable is a business call.
4. Whether expedited compounding on urgency was intended — the comment "percent added when expedited" reads as if it's on the subtotal; confirm with billing.
5. Timezone assumption: date-only ISO strings parse as UTC in JS, so the day math is TZ-independent; datetime strings without Z would be local-time-dependent — the module doesn't guard against that (if a caller ever passes a Z-less datetime to deadline, the day math would depend on the machine TZ). Hmm — is that true? `new Date('2024-01-22T23:59:59')` (no Z) → local time. So if production data ever contains a Z-less datetime deadline, the outcome could differ across TZs. This is an honest open question / risk note, not a test (can't be made deterministic). Good to include in findings.

Also note in findings: the suite's design decisions (always pass now; literal expectations; test-name conventions) and how to use it next month (the red test after a fix = the behavior change).

Now — one more requirement detail: "the full case type × complexity band matrix is asserted" ✓ (48 tests, 3 eras). "Both rate-table boundaries are tested on both sides of the edge" ✓. "Degenerate inputs are covered and the current behavior is pinned" ✓. "Production code byte-identical" ✓ (I don't touch it). "FINDINGS.md exists with reproduction input and proposed-not-applied fixes" ✓. "Suite passes twice, no clock or randomness" ✓.

One more check — the `now` parameter is typed `now?: string` and I pass strings like '2024-01-15'. ✓

Also the interface `FeeBreakdown` is exported — I import the type. ✓

Also re-check R3: 2019 ESTATE b3: base 39500. Urgency 15%: 39500*15/100 = 5925 ✓. Sum 45425. Expedited 10%: 4542.5 → Math.round → 4543 ✓. Total 39500+5925+4543 = 49968 ✓.

R2: 31500+4725 = 36225; 10% = 3622.5 → 3623 ✓; total 31500+4725+3623 = 39848 ✓.

R1: 18500+2775=21275; 10%=2127.5→2128; total 23403 ✓.

R4: 109000+19620=128620; 12% = 15434.4 → 15434; total 144054 ✓.
R5: 80500+14490=94990; 12% = 11398.8 → 11399; total 106489 ✓.
R6: 13500+2025=15525; 12% = 1863; total 17388 ✓.
R7: 109000; expedited 12% of 109000 = 13080; total 122080 ✓.

Urgency 2022 APPEAL b4: 19620; total with urgency only 128620 ✓.

Matrix values — verify a few against source: 2022 ESTATE [21500, 31000, 47000, 71000] ✓ matches source. 2021 APPEAL [32500, 45500, 66000, 99000] ✓. 2019 COMMERCIAL [22000, 31500, 45000, 68000] ✓.

Now, one concern: the harness parses "### path" + fenced block. I must not include anything else. Two files:

### test/fee-calculator.spec.ts
```ts
...
```

### FINDINGS.md
```md
...
```

Order: spec first or findings first — either. Let me do spec first.

Wait — file extension/naming: the convention is `test/<feature>.spec.ts`. I use `test/fee-calculator.spec.ts`. Good.

Also: should the spec be placed next to feeCalculator? The convention wins: test/ directory.

Import path: `../feeCalculator` — with moduleResolution bundler and Vitest, extensionless works.

Let me now write FINDINGS.md in full.

Draft:

```md
# FINDINGS — `feeCalculator.ts`

Companion to `test/fee-calculator.spec.ts`, the characterization suite for
`feeCalculator.ts`. The suite pins **current** behaviour; this file records the
behaviours that are surprising or wrong, what they cost, and how we would fix
them. **No fix has been applied. The production file is untouched.**

Read the suite first: every finding below is pinned by at least one test whose
name starts with `pins (BUG):` or `pins (QUIRK):`. When a fix lands next month,
those specific tests will go red — that redness is the change signal, and the
test should be re-pinned to the new (intended) value in the fix PR, not deleted.

## F-1 — (BUG) The 2022-07-01 boundary is exclusive: cases opened on the revision date bill at 2021 rates

**Reproduction** (also: `test/fee-calculator.spec.ts` → "pins (BUG): opened exactly on 2022-07-01"):

```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2024-01-15')
// -> { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }
// Expected if the 2022 revision applied on its own date: { table: '2022', bandFee: 15000, ... }
```

**What the code does.** `tableFor` selects the schedule with two *different*
comparators:

```ts
if (openedAt >= REVISION_2021) {          // inclusive
  if (openedAt > REVISION_2022) {         // exclusive
    return RATE_TABLE_2022;
  }
  return RATE_TABLE_2021;
}
return RATE_TABLE_2019;
```

A case opened exactly on `2022-07-01` therefore falls into the 2021 schedule,
while a case opened exactly on `2021-01-01` falls into the 2021 schedule. The
2022 schedule only applies from `2022-07-02`.

**Likely intent.** Both revision dates inclusive, i.e. `>=` on both.

**Blast radius.**
- Every case opened on the calendar day 2022-07-01 (date-only `openedAt`) has
  been billed at 2021 rates ever since — underbilled vs. the 2022 schedule by
  1500–3500 cents per band, and also at the 15% urgency rate instead of 18%.
  Those stored numbers are in the annual audit record.
- The bug is still live: re-running fee generation on those cases today
  reproduces the 2021 rates.
- Inconsistent within the same calendar day: `openedAt` is compared as a raw
  string, so `'2022-07-01T00:00:00'` sorts **after** `'2022-07-01'` and takes
  the 2022 table (pinned). Depending on how a case's opening timestamp was
  stored, two cases opened on the same day can be on different schedules.
- The same string comparison sends non-date garbage to the 2022 table and the
  empty string to the 2019 table (both pinned) — `tableFor` never parses a
  date at all.

**Proposed fix (not applied).** Make the second boundary inclusive
(`openedAt >= REVISION_2022`), or better, compare parsed dates. On application,
the pinned test will fail exactly on `2022-07-01`; update it to assert the new
value and file the delta against the stored 2022-07-01 fees with billing.

## F-2 — (QUIRK) Urgency is a function of the billing call time, and overdue deadlines stay urgent forever

**Reproduction** (suite: "pins (QUIRK): urgency is measured from the billing call time"):

```ts
const c = { type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2021-06-30' };
calculateFee(c, '2021-05-10'); // -> total 13500 (51 days out, not urgent)
calculateFee(c, '2021-06-23'); // -> total 15525 (7 days out, urgent: +2025)
calculateFee(c, '2021-07-01'); // -> total 15525 (deadline passed, STILL urgent)
```

**What the code does.** The urgency window is `daysBetween(now, deadline) <= 7`,
where `now` is the argument (or the wall clock when omitted). It is measured
from the *billing moment*, not from anything in the case, and every negative
distance satisfies `<= 7`, so once the deadline passes the urgency fee never
turns off again.

**Likely intent.** "Urgent" probably means "the case's deadline was near at
some business moment" — a property of the case, not of the moment someone
re-runs billing.

**Blast radius.**
- The stored fee for a case is not a pure function of the case: re-generating
  fees for an old case produces a different number (usually higher, once the
  deadline has been and always, in fact).
- Combined with the wall-clock default for `now` (see open questions), a call
  without `now` is literally not reproducible.
- The audit trail mixes urgency as of different billing dates with no
  discriminator.

**Proposed fix (not applied).** Decide the as-of semantics (e.g. urgency
against the case opening date, or against a stored "as of" field) and decide
what an overdue deadline means; then pin the new rule in the suite.

## F-3 — (QUIRK) The expedited surcharge is compounded on (bandFee + urgencyFee) and rounded twice

**Reproduction** (suite: "pins (QUIRK): expedited is compounded ..."):

```ts
// 2019 STANDARD band 2, urgent, expedited
// bandFee 18500; urgency round(18500*15/100) = 2775
// expedited round((18500 + 2775) * 10/100) = round(2127.5) = 2128   <-- .5 rounds UP
// total 23403
```

**What the code does.** `pctOf(bandFee + urgencyFee, expeditedPct)`: the
expedited percentage is applied to the subtotal that already includes the
urgency surcharge, and `pctOf` rounds again. So urgent+expedited fees get
rounded twice, and the second rounding operates on the rounded subtotal.

**Likely intent.** Either surcharges stack additively on the base fee (no
compounding), or compounding is the accepted billing rule and the per-step
rounding is deliberate ("billing reconciles against these"). Only billing can
say which.

**Blast radius.** Every urgent+expedited fee since 2019 embeds the compounding;
the half-up behaviour at the .5 is pinned by three 2019-table tests (2127.5→2128,
3622.5→3623, 4542.5→4543). Note the per-step urgency rounding is currently a
no-op on all shipped band fees (every base fee divides exactly at 15/18/12%),
so today the only step that actually rounds a fraction is the expedited step.

**Proposed fix (not applied).** If non-compounding is intended, apply
`expeditedPct` to `bandFee` alone. Keep per-step rounding in either case —
reconciliation depends on it.

## F-4 — (QUIRK) Unknown case types silently bill at STANDARD rates

**Reproduction** (suite: "pins (QUIRK): unknown case type ..."):

```ts
calculateFee({ type: 'COMMRCIAL', complexity: 2, openedAt: '2021-05-10' }, '2024-01-15')
// -> { table: '2021', bandFee: 20500, ... }  // 2021 STANDARD band 2
calculateFee({ type: 'standard', complexity: 1, openedAt: '2019-06-01' }, '2024-01-15')
// -> bandFee 12000  // case is not normalized; 'standard' is also "unknown"
```

**What the code does.** `table.base[c.type]` miss → fall back to the STANDARD
row of the *same era table*. No error, no flag, no log. The in-code comment
says this covers "rare imports from the old system".

**Blast radius.** Any typo or case-mismatched type has been billed as STANDARD
since 2019, with no signal. A typo of a high-value type (e.g. APPEAL) is
materially underbilled.

**Proposed fix (not applied).** Validate against the known set, throw (or emit
a flag) on unknown types; backfill an audit query for imported/unknown types
before enabling the error, so the fix doesn't change historical outputs
retroactively.

## F-5 — (QUIRK) Falsy complexity (0, NaN) is coerced to band 1; >4 is clamped to 4

**Reproduction** (suite: "degenerate inputs"):

```ts
complexity: 0   -> band 1   (falsy branch, not an error)
complexity: -3  -> band 1
complexity: NaN -> band 1   (NaN is falsy)
complexity: 5   -> band 4   (clamp)
complexity: 42  -> band 4
```

**What the code does.** `if (!band || band < 1) band = 1; if (band > 4) band = 4;`
— silent normalization in both directions, never a rejection.

**Likely intent.** Defensively default bad data to the cheapest/known band.
Whether silently billing band 1 for garbage input is desirable is a business
call.

**Blast radius.** Bad upstream data is billed (at the wrong band) instead of
surfacing; stored fees can be wrong by up to 3 bands.

**Proposed fix (not applied).** Explicit validation: reject non-integer
complexity outside 1..4 with a typed error.

## F-6 — (QUIRK) Fractional complexity produces `undefined` bandFee and `NaN` total

**Reproduction** (suite: "pins (QUIRK): fractional complexity (2.5) ..."):

```ts
calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2022-08-01' }, '2024-01-15')
// -> { table: '2022', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
```

**What the code does.** `2.5` passes `!band` (truthy) and `band < 1` (false)
and `band > 4` (false), then indexes `bands[1.5]` → `undefined`. Every
downstream addition becomes `NaN` (and `urgencyFee`/`expeditedFee` would too
if the deadline were near).

**Blast radius.** A stored `NaN`/null fee for such a case would poison
reconciliation; unlikely to occur (upstream seems to send integers) but
unpinned until now.

**Proposed fix (not applied).** Same as F-5: integer validation.

## Open questions (cannot be determined safely from the code alone)

1. **Wall-clock default.** `calculateFee(c)` without `now` uses
   `new Date().toISOString().slice(0, 10)`. The suite deliberately never
   exercises that path (it is non-deterministic by definition). Whether
   production ever omits `now` — and hence whether any stored fee is
   wall-clock-dependent — cannot be answered from this file.
2. **Population for F-1.** Whether any real case has `openedAt` exactly
   `2022-07-01` (or a datetime form of that day) requires a data query; the
   code doesn't say.
3. **Non-Z datetimes.** `daysBetween` parses with `new Date`; an ISO string
   with a time component but no `Z`/offset is interpreted in the *machine's
   local timezone*, which would make the day math timezone-dependent. The
   suite only uses date-only strings and `Z`-suffixed datetimes (both
   UTC-anchored), so the suite itself is timezone-independent. Whether
   production data ever carries offset-less datetimes is unknown.
4. **Business rule for F-3 compounding** and **F-4 fallback**: see above;
   both are pinned, neither is adjudicated here.

## Suite design notes

- Every call passes an explicit `now`; the module's only clock seam is used
  and nothing is mocked, faked, or refactored.
- All expectations are literals derived by hand from the current
  implementation — that is the pin.
- Date-only ISO strings parse as UTC in JavaScript, so `daysBetween` is
  deterministic across timezones for the inputs this suite uses.
- Run it twice, on any machine, in any timezone: identical results.
```

Hmm wait, in F-1 I should double-check the underbilling deltas: 2022 vs 2021 band differences: STANDARD 1500, COMMERCIAL 2500, ESTATE 2000, APPEAL 3500. And the urgency pct 15→18. ✓

Also note in F-1: cases with a datetime openedAt on that day got 2022 rates — so same-day inconsistency. ✓

Now, reconsider: is F-1 really a "real bug" vs. an intentional exclusive boundary? The asymmetry (>= vs >) between two revisions of the same kind is strong evidence of a bug. The header comment says "2022-07: rate revision" — the revision is dated 2022-07-01; a revision effective on its date should be inclusive. I'll present it as a bug with that reasoning, while noting the only way to be sure is a data/business check. Fine — the spec says "at least one real bug"; I pin it and flag it.

Now, let me write the spec file in full and re-verify TS strictness issues:

- `for (const spec of TABLES)` — TABLES: TableSpec[] ✓
- `spec.base[type]` — type: KnownCaseType ✓
- `spec.base[type][band - 1]` — number ✓ (no noUncheckedIndexedAccess)
- `input()` spread: `{ type: 'STANDARD', complexity: 1, openedAt: '2019-06-01', ...over }` — over: Partial<CaseInput> ✓ result CaseInput ✓.
- `calculateFee(noComplexity, REF_NOW)` ✓
- catch: `catch (e)` — e is unknown in TS strict (useUnknownInCatchVariables, part of strict? Actually useUnknownInCatchVariables is included in strict since TS 4.4). So `e instanceof Error ? e.message : String(e)` ✓.
- `describe.each`? Not used. Fine.
- Vitest globals: I explicitly import { describe, expect, it } — with "types": [] in tsconfig, vitest's types must come from the import. ✓ (types: [] means no global auto-inclusion; the explicit import is correct.)

One subtlety: `import { calculateFee } from '../feeCalculator';` — feeCalculator.ts is at the root. ✓

Let me also confirm that the matrix describe names don't collide: "rate table 2019 (openedAt 2019-06-01)" etc. ✓

Test count: matrix 48, boundary 9, urgency group ~9, now-dependence ~5, rounding 7, degenerate ~11. Total ~89. Good.

Let me now carefully finalize the full test file.

Actually one more consideration: the "urgency" describe uses a helper `const c = (deadline?: string) => ...`. For "no deadline at all" I pass undefined. For empty-string test I pass ''.

Let me write:

```ts
describe('urgency: deadline proximity to the `now` the caller passes', () => {
  const now = '2024-01-15';
  // 2022 APPEAL band 4: bandFee 109000; urgencyPct 18 -> urgencyFee 19620
  const urgentCase = (deadline?: string): CaseInput =>
    input({ type: 'APPEAL', complexity: 4, openedAt: '2022-08-01', deadline });

  it('pins: deadline 7 days out (inclusive edge) -> urgent, urgencyFee 19620', () => {
    expect(calc(urgentCase('2024-01-22'), now)).toEqual({
      table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 0, total: 128620,
    });
  });

  it('pins: deadline 8 days out (exclusive side of the edge) -> not urgent', () => {
    expect(calc(urgentCase('2024-01-23'), now)).toEqual({
      table: '2022', bandFee: 109000, urgencyFee: 0, expeditedFee: 0, total: 109000,
    });
  });

  it('pins: deadline today (0 days) -> urgent', () => {
    expect(calc(urgentCase('2024-01-15'), now).urgencyFee).toBe(19620);
  });

  it('pins: deadline yesterday (-1 day) -> still urgent', () => {
    expect(calc(urgentCase('2024-01-14'), now).urgencyFee).toBe(19620);
  });

  it('pins (QUIRK): deadline 30 days in the PAST -> still urgent; the flag never clears (FINDINGS F-2)', () => {
    expect(calc(urgentCase('2023-12-16'), now).urgencyFee).toBe(19620);
  });

  it('pins: no deadline at all -> not urgent', () => {
    expect(calc(urgentCase(undefined), now).urgencyFee).toBe(0);
  });

  it('pins (QUIRK): empty-string deadline is falsy -> silently not urgent (FINDINGS F-2)', () => {
    expect(calc(urgentCase(''), now).urgencyFee).toBe(0);
  });

  it('pins (QUIRK): unparseable deadline -> daysBetween is NaN, NaN <= 7 is false -> silently not urgent', () => {
    expect(calc(urgentCase('garbage'), now).urgencyFee).toBe(0);
  });

  it('pins: urgency pct is a property of the rate table (15% for 2019/2021, 18% for 2022)', () => {
    const d = '2024-01-16'; // 1 day from now -> urgent in all three
    expect(calc(input({ openedAt: '2019-06-01', deadline: d }), now)).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 0, total: 13800,
    });
    expect(calc(input({ openedAt: '2021-05-10', deadline: d }), now)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
    expect(calc(input({ openedAt: '2022-08-01', deadline: d }), now)).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 2700, expeditedFee: 0, total: 17700,
    });
  });

  it('pins: day math floors -- deadline at 23:59:59Z on the 8th day still counts as 7 days -> urgent', () => {
    expect(calc(urgentCase('2024-01-22T23:59:59Z'), now).urgencyFee).toBe(19620);
  });

  it('pins: deadline at 00:00:00Z on the 9th day is a full 8 days -> not urgent', () => {
    expect(calc(urgentCase('2024-01-23T00:00:00Z'), now).urgencyFee).toBe(0);
  });
});
```

Verify '2023-12-16' vs '2024-01-15': December 16 → January 15 = 15 (rest of December: 16→31 = 15 days) + 15 = 30 days → −30 → ≤7 → urgent ✓.

2019 urgency: 12000*15/100 = 1800 ✓. 2021: 13500*0.15=2025 ✓. 2022: 15000*0.18=2700 ✓.

Now-dependence describe:

```ts
describe('pins (QUIRK): urgency depends on the billing call time, not the case timeline (FINDINGS F-2)', () => {
  const openedAt = '2021-05-10'; // 2021 table, STANDARD band 1 = 13500, urgency 15% = 2025
  const deadline = '2021-06-30';
  const c = input({ type: 'STANDARD', complexity: 1, openedAt, deadline });

  it('billed 51 days before the deadline -> not urgent (total 13500)', () => {
    expect(calc(c, '2021-05-10')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('billed 8 days before the deadline -> not urgent (total 13500)', () => {
    expect(calc(c, '2021-06-22')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('billed 7 days before the deadline (inclusive edge) -> urgent (total 15525)', () => {
    expect(calc(c, '2021-06-23')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
  });

  it('billed the day AFTER the deadline -> still urgent (total 15525)', () => {
    expect(calc(c, '2021-07-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
  });

  it('the same case object billed on two different dates -> two different totals (the audit hazard)', () => {
    const early = calc(c, '2021-05-10');
    const late = calc(c, '2021-06-23');
    expect(early.total).toBe(13500);
    expect(late.total).toBe(15525);
    expect(late.total - early.total).toBe(2025);
  });
});
```

Verify days: '2021-06-30' − '2021-06-22' = 8 ✓; − '2021-06-23' = 7 ✓; '2021-05-10' → 51 (May: 31−10=21; June 30 → 21+30=51) ✓; '2021-07-01' → −1 ✓.

Rounding describe:

```ts
describe('rounding: Math.round per step, in cents (FINDINGS F-3)', () => {
  // All cases below are urgent (deadline 1 day from now) unless stated.
  const now = '2024-01-15';
  const d = '2024-01-16';

  it('pins (QUIRK): expedited is compounded on (bandFee + urgencyFee); 2019 STANDARD band 2 -> round(2127.5) = 2128 (.5 rounds up)', () => {
    expect(calc(input({ type: 'STANDARD', complexity: 2, openedAt: '2019-06-01', deadline: d, expedited: true }), now)).toEqual({
      table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403,
    });
  });

  it('pins: 2019 COMMERCIAL band 2 urgent+expedited -> round(3622.5) = 3623', () => {
    expect(calc(input({ type: 'COMMERCIAL', complexity: 2, openedAt: '2019-06-01', deadline: d, expedited: true }), now)).toEqual({
      table: '2019', bandFee: 31500, urgencyFee: 4725, expeditedFee: 3623, total: 39848,
    });
  });

  it('pins: 2019 ESTATE band 3 urgent+expedited -> round(4542.5) = 4543', () => {
    expect(calc(input({ type: 'ESTATE', complexity: 3, openedAt: '2019-06-01', deadline: d, expedited: true }), now)).toEqual({
      table: '2019', bandFee: 39500, urgencyFee: 5925, expeditedFee: 4543, total: 49968,
    });
  });

  it('pins: 2022 APPEAL band 4 urgent+expedited -> round(15434.4) = 15434 (rounds down)', () => {
    expect(calc(input({ type: 'APPEAL', complexity: 4, openedAt: '2022-08-01', deadline: d, expedited: true }), now)).toEqual({
      table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 15434, total: 144054,
    });
  });

  it('pins: 2022 COMMERCIAL band 4 urgent+expedited -> round(11398.8) = 11399', () => {
    expect(calc(input({ type: 'COMMERCIAL', complexity: 4, openedAt: '2022-08-01', deadline: d, expedited: true }), now)).toEqual({
      table: '2022', bandFee: 80500, urgencyFee: 14490, expeditedFee: 11399, total: 106489,
    });
  });

  it('pins: exact path -- 2021 STANDARD band 1 urgent+expedited -> 1863 exactly (rounding present but a no-op)', () => {
    expect(calc(input({ type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: d, expedited: true }), now)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 1863, total: 17388,
    });
  });

  it('pins: expedited without urgency applies to bandFee alone -- 2022 APPEAL band 4 -> 13080', () => {
    expect(calc(input({ type: 'APPEAL', complexity: 4, openedAt: '2022-08-01', expedited: true }), now)).toEqual({
      table: '2022', bandFee: 109000, urgencyFee: 0, expeditedFee: 13080, total: 122080,
    });
  });
});
```

Boundary describe — let me finalize the list:

```ts
describe('rate-table selection at the revision boundaries', () => {
  const std = (openedAt: string): FeeBreakdown =>
    calc(input({ type: 'STANDARD', complexity: 1, openedAt }));

  it('pins: 2020-12-31 (day before 2021-01-01) -> 2019 table', () => {
    expect(std('2020-12-31')).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000 });
  });

  it('pins: 2021-01-01 exactly -> 2021 table (the 2021 edge is INCLUSIVE)', () => {
    expect(std('2021-01-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins: 2022-06-30 (day before 2022-07-01) -> 2021 table', () => {
    expect(std('2022-06-30')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins (BUG): 2022-07-01 exactly -> 2021 table, not 2022 (the 2022 edge is EXCLUSIVE; FINDINGS F-1)', () => {
    expect(std('2022-07-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins: 2022-07-02 (day after 2022-07-01) -> 2022 table', () => {
    expect(std('2022-07-02')).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 });
  });

  it('pins: no lower bound -- 2015-03-03 (before the module existed) -> 2019 table', () => {
    expect(std('2015-03-03').table).toBe('2019');
  });

  it('pins (QUIRK): openedAt is compared as a raw string -- "2022-07-01T00:00:00" sorts after the boundary -> 2022 table (FINDINGS F-1)', () => {
    expect(std('2022-07-01T00:00:00').table).toBe('2022');
  });

  it('pins (QUIRK): non-date "garbage" sorts above both revision strings -> 2022 table', () => {
    expect(std('garbage').table).toBe('2022');
  });

  it('pins (QUIRK): empty openedAt sorts below both revision strings -> 2019 table', () => {
    expect(std('').table).toBe('2019');
  });
});
```

Verify 'garbage': 'garbage' >= '2021-01-01' → 'g' vs '2': 'g' (103) > '2' (50) → true. 'garbage' > '2022-07-01' → true. → 2022 ✓.

'2022-07-01T00:00:00' > '2022-07-01': common prefix '2022-07-01', then 'T' vs end → longer is greater → true → 2022 ✓.

'2015-03-03' >= '2021-01-01'? '2015' < '2021' → false → 2019 ✓.

Degenerate describe — finalize (as drafted above). Also add the NaN complexity pin:

```ts
it('pins (QUIRK): NaN complexity is falsy -> coerced to band 1, same as 0', () => {
  expect(calc(input({ complexity: NaN, openedAt: '2022-08-01' })).bandFee).toBe(15000);
});
```

And the exact-message test for null:

```ts
it('pins: complexity null -> throws Error("complexity is required") (exact message pinned)', () => {
  let message: string | undefined;
  try {
    calculateFee(input({ complexity: null }), REF_NOW);
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  expect(message).toBe('complexity is required');
});
```

And the undefined branch:

```ts
it('pins: a case object missing the complexity key (undefined) -> same throw (the `=== undefined` branch)', () => {
  const withoutComplexity = { type: 'STANDARD', openedAt: '2019-06-01' } as unknown as CaseInput;
  expect(() => calculateFee(withoutComplexity, REF_NOW)).toThrow('complexity is required');
});
```

Also, a basic "happy path sanity" — the matrix covers that.

Also should I pin that the breakdown has exactly these 4 keys? toEqual ensures the shape (extra keys would fail). ✓

File header comment — mention how to read it and the determinism guarantees.

One more thought on "no real dates": all my date literals are arbitrary fixed values — that's the point of a fake clock. Fine.

Now, does the suite "pass twice"? Yes, pure function.

Potential pitfall: vitest may complain about unused variables under TS strict — noUnusedLocals is not enabled (not in the tsconfig) so fine. But keep it clean anyway.

The `TableSpec` interface is local. `FeeBreakdown` is used in the return type of `calc` and `std`. `CaseInput` is used. Good.

Let me double-check: `const c = (deadline?: string): CaseInput => input({...})` — in the urgency group I named it `urgentCase`. The param is optional; `urgentCase('')` → deadline: '' → `c.deadline && ...` → '' is falsy → skip ✓.

Edge: `input({ type: 'APPEAL', complexity: 4, openedAt: '2022-08-01', deadline: 'garbage' })` ✓.

Now let me assemble the final spec file. I'll also add a top-level describe? The convention for spec files is often a top describe. Not necessary; multiple top-level describes are fine.

Also: the matrix loop generates tests at collection time — fine.

Let me also confirm I'm not asserting anything that would fail. Recheck the matrix for 2021 ESTATE band 4 = 64500 (source: ESTATE: [19500, 28000, 42500, 64500]) ✓. 2021 COMMERCIAL band 4 = 73000 ✓. 2022 COMMERCIAL band 3 = 53500 ✓. 2022 APPEAL band 1 = 36000 ✓. 2019 APPEAL band 4 = 92000 ✓. 2019 ESTATE band 4 = 60000 ✓. 2019 STANDARD band 4 = 41000 ✓. 2021 STANDARD band 4 = 44500 ✓. 2022 STANDARD band 4 = 49000 ✓. 2022 ESTATE band 2 = 31000 ✓. 2021 APPEAL band 3 = 66000 ✓. 2019 COMMERCIAL band 3 = 45000 ✓.

All good.

One more: the file should end with a newline; fine.

FINDINGS.md — the formatting with code fences inside — I'm inside a markdown file which is itself inside a fenced block in the reply. Wait — the reply format: each file's content inside a fenced code block. If FINDINGS.md contains triple-backtick code fences, the outer fence would terminate early! The parser reads "one fenced block containing only that file's content". If the content contains ``` it would break naive parsing.

Hmm. This is a real formatting hazard. The instructions say the fenced block contains only the file's content. If the content itself has triple backticks, the outer fence closes early. To be safe:
1. Use 4-backtick fences for the outer block? The instruction's example uses 3-backtick ts. For the markdown file I could open the outer fence with ```` (4 backticks) so the inner ``` doesn't close it. That's valid CommonMark. The parser is "mechanical" — presumably it finds the fence after the heading and reads until the matching closing fence. A 4-backtick outer fence with 3-backtick inner content is standard and safe.

Alternatively, avoid code fences inside FINDINGS.md — use indented code blocks (4-space indent) instead of triple backticks. That eliminates the nested-fence issue entirely and works with a 3-backtick outer fence. Indented code blocks render fine in markdown.

Safest: use 4-space indented code blocks inside FINDINGS.md, and wrap the file in a standard 3-backtick fence. But nested: the outer fence is ``` — the content must not contain a line that is exactly ``` (or longer). Indented blocks use spaces, no backticks. But do I want to use backticks for inline code like `tableFor`? Inline single backticks are fine (not a fence). Only a line starting with ``` (three or more backticks) would be a problem. Inline `code` is fine.

So: FINDINGS.md will use 4-space indented code blocks for snippets and inline single-backtick code. Outer fence is 3 backticks. Safe.

For the .ts spec file: no backtick lines inside (template literals? I don't use template literals with backticks on their own line — I use them in test names? No, test names are plain strings). No backticks at all in the TS file, maybe none. Fine.

Actually wait, do I use backticks in the TS file? No — plain quotes. Good.

Now, also consider: "a path that appears twice is taken once, at the last occurrence" — I only use each path once.

Also, is `test/fee-calculator.spec.ts` the right path? The convention block: `test/<feature>.spec.ts`. Feature = fee-calculator (kebab). ✓

And `FINDINGS.md` at the root. The variant says "document each in FINDINGS.md" — root-level is the natural reading. ✓

Now, once more on the requirement: "a fake clock can only be injected via the module's existing optional `now` parameter". My `calc` helper wraps `calculateFee(c, now)` — still the existing parameter. No vi.mock, no fake timers. ✓ I should state this explicitly in the header comment.

"Production code untouched" — I deliver only the new files. ✓

Let me also reconsider whether to include the matrix per era or just one era. The spec: "every case type × every complexity band — the full matrix, not a sample". The band fees differ per era; the rate-table section covers the eras. To be thorough and safe against "sample" criticism, I assert the full 4×4 for all three eras (48 tests). That's the strongest reading and directly pins all shipped base fees. ✓

Urgency pct per era is also pinned (15/15/18) ✓.

Expedited pct per era? 10 (2019), 12 (2021), 12 (2022). Pinned implicitly by the rounding tests (2019: 10% cases; 2021: 1863 = 12%; 2022: 12%). R7 shows 12% on 2022 without urgency. I think covered; I can add one explicit non-urgent expedited for 2019 to pin the 10%: 2019 STANDARD b1 expedited non-urgent: 12000*10% = 1200 → total 13200. Add a small test. And 2021 non-urgent expedited: 13500*12% = 1620 → 15120. Add both for completeness of the pct pin. Let me add a test:

```ts
it('pins: expedited pct is a property of the rate table (10% for 2019, 12% for 2021/2022), applied to bandFee when not urgent', () => {
  expect(calc(input({ openedAt: '2019-06-01', expedited: true }), now)).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 1200, total: 13200 });
  expect(calc(input({ openedAt: '2021-05-10', expedited: true }), now)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120 });
  expect(calc(input({ openedAt: '2022-08-01', expedited: true }), now)).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 1800, total: 16800 });
});
```

Verify: 15000*12% = 1800 ✓. Good — this replaces/extends the R7 single. Keep both? R7 (APPEAL b4 13080) is redundant now; remove R7 and keep the three-era pct test. Cleaner.

Total test count ≈ 48 + 9 + 11 + 5 + 7 + 11 ≈ 91.

Let me count the degenerate group: null (1), undefined-key (1), zero (1), negative (1), NaN (1), 5 clamp (1), 42 clamp (1), 2.5 (1), unknown typo (1), lowercase (1), era fallback (1) = 11.

Urgency group: 7d, 8d, 0d, −1d, −30d, none, '', garbage, pct-per-table, floor-late, floor-exact = 11.

Now-dependence: 5.

Rounding: 6 (R1..R6) + expedited-pct-per-table = 7.

Boundary: 9.

Matrix: 48.

Total 91.

FINDINGS should also list the test-name→finding mapping. Done above.

Also add to findings: "how this suite is used next month" — the red test = the behavior change; re-pin in the fix PR.

Now let me write the final files. Also confirm: the spec file must compile under strict. `const std = (openedAt: string): FeeBreakdown => ...` ✓. `catch (e)` unknown ✓ handled.

One: in the exact-message test, `message` could stay undefined if no throw — in which case toBe fails, which is correct behavior for the test.

TS: `try { calculateFee(...) } catch (e) { message = e instanceof Error ? e.message : String(e); }` ✓.

`as unknown as CaseInput` ✓.

Also confirm no unused imports: I import describe, expect, it, calculateFee, CaseInput, FeeBreakdown — all used. ✓

Now let me write FINDINGS.md fully, using indented code blocks (4 spaces). Note: in the final reply the content sits inside a fenced block; leading 4-space indentation is preserved.

Also — the header comment of the TS file: keep it useful but not huge.

One more note on "ASSUMPTION" markers: do I need any? The import path '../feeCalculator' assumes the workspace layout — that's given. The vitest availability is assumed per the spec. No genuine unresolved symbols. I don't think `// ASSUMPTION` comments are needed. The instructions say to mark if I used a symbol genuinely absent. Everything I use is present. OK.

Wait, actually one more: the convention is "TypeScript (strict)... NestJS for the API" — but this workspace has no NestJS; the task is self-contained (fixture + tests). The L2 spec says "TypeScript, vitest". So no NestJS files. Deliver only the 2 files. Good — "don't create files that aren't asked for".

Also double-check the `toEqual` on the object with `table: spec.table`, where spec.table is typed '2019'|'2021'|'2022' — matches FeeBreakdown.table union ✓.

And in the matrix, the test name: `${type} band ${band}: ${expected} cents, no surcharges` — e.g. "STANDARD band 1: 12000 cents, no surcharges". Fine.

Now — one subtle risk: vitest's `toEqual` on `{ table: '2019', bandFee: 12000, ... }` vs the actual object — exact 4 keys, all numbers/strings. ✓

Final reply structure:

### test/fee-calculator.spec.ts
```ts
...
```

### FINDINGS.md
```
# FINDINGS ...
```

Use ``` (3 backticks) for the markdown fence? The example shows language-tagged fences; for md I'd use ```markdown or plain ```. Plain is safest; or ```md. Use ```md — hmm, if the parser strips the info string it's fine either way. Use ```markdown? The instruction example: ```ts. Let me use ```md — no, keep minimal: no info string? "Immediately followed by one fenced block containing only that file's content" — an info string is part of the fence opening, generally acceptable. Use ```ts for the TS file (matching the example) and ```md for markdown. Hmm, risk: a strict parser might compare the fence line exactly? Unlikely; the example itself uses ```ts. Go with ```ts and ```md.

Now, let me finalize the FINDINGS.md text (with indented snippets). Let me write it out.

Also add a short "summary table" at the top? Keep it concise but complete. The length is fine — it's a documentation deliverable.

Let me draft FINDINGS.md fully:

---

# FINDINGS — `feeCalculator.ts`

Companion to `test/fee-calculator.spec.ts`. That suite is a **characterization**
suite: it pins what `feeCalculator.ts` does *today*, including the behaviours
recorded below. **No fix has been applied in this issue; the production file is
byte-identical to before.**

Reading convention used by the suite: a test name beginning with
`pins (BUG):` or `pins (QUIRK):` deliberately asserts a surprising or
known-wrong value. If next month's change intentionally alters any of those
behaviours, exactly those tests will go red — that is the change signal. In the
fix PR, re-pin them to the new intended value (and record the delta); do not
delete them.

## F-1 — (BUG) The 2022-07-01 revision boundary is exclusive: cases opened on the revision date bill at 2021 rates

Reproduction (pinned by "pins (BUG): 2022-07-01 exactly ..."):

    calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2024-01-15')
    // => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }
    //    what a "revision effective on 2022-07-01" would give:
    //    { table: '2022', bandFee: 15000, ... }

What the code does. `tableFor` uses two *different* comparators:

    if (openedAt >= REVISION_2021) {    // '2021-01-01', inclusive
      if (openedAt > REVISION_2022) {   // '2022-07-01', exclusive
        return RATE_TABLE_2022;
      }
      return RATE_TABLE_2021;
    }
    return RATE_TABLE_2019;

So a case opened exactly on `2021-01-01` takes the 2021 table, but a case
opened exactly on `2022-07-01` stays on the 2021 table; the 2022 table only
applies from `2022-07-02`. Two revisions of the same kind are handled
asymmetrically, which is the classic shape of a typo'd comparator.

Likely intent. Both revision dates inclusive (`>=` on both).

Blast radius.
- Every case whose `openedAt` is exactly `2022-07-01` has been billed at 2021
  rates since then — 1500–3500 cents under the 2022 schedule per band, and at
  the 15% urgency rate instead of 18%. Those stored numbers are in the annual
  audit record and would have to be adjusted, not re-derived, if the fix
  changes future behaviour.
- The bug is still live: re-generating fees on those cases today reproduces
  the 2021 rates.
- The comparison is on the raw string, so the same calendar day can fall on
  both sides of the boundary depending on the stored format:
  `'2022-07-01T00:00:00'` sorts *after* `'2022-07-01'` and takes the 2022
  table (pinned). Two cases opened on the same day can be on different
  schedules.
- The same string comparison also sends non-date values to a table
  (`'garbage'` → 2022, `''` → 2019; both pinned). `tableFor` never parses a
  date.

Proposed fix (not applied). Change the inner test to
`openedAt >= REVISION_2022` — or, better, compare parsed dates. On application,
the pinned test fails exactly on `2022-07-01`; re-pin it to the 2022 values and
raise the delta on the stored 2022-07-01 fees with billing.

## F-2 — (QUIRK) Urgency is a function of the billing call time — and an overdue deadline stays urgent forever

Reproduction (pinned by the "pins (QUIRK): urgency depends on the billing call time" group):

    const c = { type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2021-06-30' };
    calculateFee(c, '2021-05-10'); // 51 days out  => total 13500 (not urgent)
    calculateFee(c, '2021-06-23'); // 7 days out    => total 15525 (urgent, +2025)
    calculateFee(c, '2021-07-01'); // deadline passed => total 15525 (STILL urgent)

What the code does. The urgency rule is `daysBetween(now, deadline) <= 7`,
where `now` is the argument the caller passed (or the wall clock when omitted).
It is measured from the *billing moment*, not from anything in the case, and
every negative day count satisfies `<= 7`, so once the deadline passes the
urgency fee never switches off again. Related edges pinned: an empty-string
deadline is silently not urgent (falsy), and an unparseable deadline makes
`daysBetween` return `NaN`, and `NaN <= 7` is false — also silently not
urgent.

Likely intent. "Urgent" probably means "the case's deadline was near at some
business moment" — a property of the case (or of a stored as-of date), not of
the moment someone re-runs billing.

Blast radius.
- A stored fee is not a pure function of the case: re-generating fees for an
  old case yields a different number — and once the deadline has passed, the
  re-run is *guaranteed* to differ (urgency on, permanently).
- Combined with the wall-clock default (open question 1), calls without `now`
  are not reproducible at all.
- The audit trail mixes urgency evaluated at different billing dates with no
  field to tell them apart.

Proposed fix (not applied). Decide the as-of semantics (urgency against
`openedAt`, or against a stored "as of" date) and the overdue-deadline rule,
then pin the new rule in the suite.

## F-3 — (QUIRK) The expedited surcharge is compounded on (bandFee + urgencyFee) and rounded twice

Reproduction (pinned by "pins (QUIRK): expedited is compounded ..."):

    // 2019 table, STANDARD band 2, urgent + expedited
    // bandFee   18500
    // urgency   round(18500 * 15 / 100)          = 2775
    // expedited round((18500 + 2775) * 10 / 100) = round(2127.5) = 2128   // .5 rounds UP
    // total     23403

What the code does. `expeditedFee = pctOf(bandFee + urgencyFee, expeditedPct)`:
the expedited percentage is applied to a subtotal that already contains the
urgency surcharge, and `pctOf` rounds again. So urgent+expedited fees are
rounded twice, the second time on the already-rounded subtotal. `Math.round`
is half-up: the 2019 table pins three `.5` cases rounding up (2127.5 → 2128,
3622.5 → 3623, 4542.5 → 4543) and the 2022 table pins fractional round-downs
(15434.4 → 15434, 11398.8 → 11399). Note the urgency step itself is currently
a rounding no-op on every shipped band fee (each base fee divides exactly at
15%, 18%, and 12%); the only step that today actually rounds a fraction is the
expedited step.

Likely intent. Either surcharges stack additively on the base fee (no
compounding), or compounding is the accepted billing rule and the per-step
rounding is deliberate — the in-code comment says "billing reconciles against
these". Only billing can say which.

Blast radius. Every urgent+expedited fee since 2019 embeds the compounding and
the double rounding; the audit record has it.

Proposed fix (not applied). If non-compounding is intended, apply
`expeditedPct` to `bandFee` alone. Keep per-step rounding in either case —
reconciliation depends on it.

## F-4 — (QUIRK) Unknown case types silently bill at STANDARD rates

Reproduction (pinned by "pins (QUIRK): unknown case type ..."):

    calculateFee({ type: 'COMMRCIAL', complexity: 2, openedAt: '2021-05-10' }, '2024-01-15')
    // => { table: '2021', bandFee: 20500, ... }   // 2021 STANDARD band 2
    calculateFee({ type: 'standard', complexity: 1, openedAt: '2019-06-01' }, '2024-01-15')
    // => bandFee 12000                             // case not normalized; 'standard' is "unknown" too

What the code does. A miss on `table.base[c.type]` falls back to the STANDARD
row *of the same era table*. No error, no flag. The in-code comment says this
covers "rare imports from the old system".

Likely intent. A graceful default for the one-off legacy imports.

Blast radius. Any typo'd or case-mismatched type has been billed as STANDARD
since 2019 with no signal; a typo of a higher-value type (e.g. APPEAL) is
materially underbilled.

Proposed fix (not applied). Validate against the known set and throw/flag on
unknown types; run an audit query for unknown-type cases first so the error
doesn't retroactively change historical outputs.

## F-5 — (QUIRK) Falsy complexity (0, NaN) coerces to band 1; complexity above 4 clamps to 4

Reproduction (pinned by the "degenerate inputs" group):

    complexity: 0    -> band 1   // falsy branch, not an error
    complexity: -3   -> band 1
    complexity: NaN  -> band 1   // NaN is falsy
    complexity: 5    -> band 4   // upper clamp
    complexity: 42   -> band 4

What the code does. `if (!band || band < 1) band = 1; if (band > 4) band = 4;`
— silent normalization in both directions, never a rejection.

Likely intent. Defensively map bad data to a known band rather than failing.
Whether that's desirable is a business call.

Blast radius. Bad upstream data is billed at the wrong band (up to 3 bands off)
instead of surfacing.

Proposed fix (not applied). Explicit validation: reject non-integer complexity
outside 1..4 with a typed error.

## F-6 — (QUIRK) Fractional complexity slips past both clamps → `undefined` bandFee, `NaN` total

Reproduction (pinned by "pins (QUIRK): fractional complexity (2.5) ..."):

    calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2022-08-01' }, '2024-01-15')
    // => { table: '2022', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }

What the code does. `2.5` passes `!band` (truthy), `band < 1` (false), and
`band > 4` (false), then indexes `bands[1.5]` → `undefined`; every subsequent
arithmetic becomes `NaN` (urgencyFee/expeditedFee too, if a deadline were
near). The TypeScript type claims `bandFee` is a number — the gap is invisible
to the compiler.

Likely intent. No intent to read; a hole in the validation.

Blast radius. A stored NaN/null fee would poison reconciliation. Upstream
appears to send integers, so exposure is likely low — but it was unpinned
until now.

Proposed fix (not applied). Same as F-5: integer validation.

## Open questions (not safely determinable from the code alone)

1. Wall-clock default. `calculateFee(c)` without `now` falls back to
   `new Date().toISOString().slice(0, 10)`. The suite never exercises that
   path — it is non-deterministic by definition. Whether production ever omits
   `now`, and hence whether any stored fee is wall-clock-dependent, cannot be
   answered from this file.
2. F-1 population. Whether any real case has `openedAt` exactly
   `2022-07-01` (or a datetime form of that day) requires a data query.
3. Offset-less datetimes. `daysBetween` parses with `new Date`; an ISO string
   with a time but no `Z`/offset is read in the machine's *local* timezone,
   which would make the day math timezone-dependent. The suite only uses
   date-only strings and `Z`-suffixed datetimes (both UTC-anchored in
   JavaScript), so the suite itself is timezone-independent; whether
   production data ever carries offset-less datetimes is unknown.
4. Business adjudication of F-3 (compounding) and F-4 (STANDARD fallback):
   both are pinned; neither is judged right or wrong here.

## Suite design notes

- Every call passes an explicit `now` — the module's existing optional
  parameter is the only clock seam used. Nothing is mocked, faked, or
  refactored; the production file is imported as-is.
- All expected values are literals derived by hand from the current
  implementation. The literals are the pin.
- Date-only ISO strings parse as UTC in JavaScript, so `daysBetween` is
  deterministic across timezones for the inputs the suite uses.
- No `new Date()`, no timers, no randomness anywhere in the suite: run it
  twice, on any machine, in any timezone — identical results.

---

That looks complete. Let me verify the indented blocks: each line needs 4 spaces. In my draft above I wrote them with 4-space indent. I must ensure every line in those blocks is indented 4 spaces, including comment lines.

Now, the final TS spec file — let me write it out in full, carefully.

```ts
// Characterization suite for feeCalculator.ts (in production since 2019,
// zero tests until now). It pins what the module DOES today, not what it
// should do. See FINDINGS.md for the quirks/bugs this suite deliberately
// pins, with reproductions and proposed-not-applied fixes.
//
// Conventions:
// - Expected values are hand-derived literals. The literals are the pin.
// - A test name starting with "pins (BUG):" or "pins (QUIRK):" asserts a
//   surprising or known-wrong value on purpose. When a future change
//   intentionally alters that behaviour, exactly these tests go red: that
//   redness is the change signal. Re-pin them in the fix PR, don't delete.
// - Determinism: every calculateFee call passes an explicit `now` (the
//   module's only clock seam). No new Date(), no Date.now(), no fake timers,
//   no randomness in this file. All date strings are fixed literals; where a
//   time of day matters the string carries a Z suffix so parsing is
//   UTC-anchored and timezone-independent.
// - The production module is imported as-is; nothing is mocked or refactored.

import { describe, expect, it } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';

const REF_NOW = '2024-01-15';

function input(over: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2019-06-01',
    ...over,
  };
}

function calc(c: CaseInput, now: string = REF_NOW): FeeBreakdown {
  return calculateFee(c, now);
}

// ---------------------------------------------------------------------------
// 1. Full matrix: every case type x every complexity band, for all three
//    rate tables (48 assertions). Surcharges off: no deadline, no expedited.
// ---------------------------------------------------------------------------

const CASE_TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
type KnownCaseType = (typeof CASE_TYPES)[number];

interface TableSpec {
  table: '2019' | '2021' | '2022';
  // An openedAt that selects this table, away from any boundary.
  openedAt: string;
  // Fees per band (band 1..4), in cents. Hand-copied from the current code.
  base: Record<KnownCaseType, readonly number[]>;
}

const TABLES: TableSpec[] = [
  {
    table: '2019',
    openedAt: '2019-06-01',
    base: {
      STANDARD: [12000, 18500, 27000, 41000],
      COMMERCIAL: [22000, 31500, 45000, 68000],
      ESTATE: [18000, 26000, 39500, 60000],
      APPEAL: [30000, 42000, 61000, 92000],
    },
  },
  {
    table: '2021',
    openedAt: '2021-05-10',
    base: {
      STANDARD: [13500, 20500, 29500, 44500],
      COMMERCIAL: [24000, 34000, 48500, 73000],
      ESTATE: [19500, 28000, 42500, 64500],
      APPEAL: [32500, 45500, 66000, 99000],
    },
  },
  {
    table: '2022',
    openedAt: '2022-08-01',
    base: {
      STANDARD: [15000, 22500, 32500, 49000],
      COMMERCIAL: [26500, 37500, 53500, 80500],
      ESTATE: [21500, 31000, 47000, 71000],
      APPEAL: [36000, 50000, 72500, 109000],
    },
  },
];

for (const spec of TABLES) {
  describe(`rate table ${spec.table} (openedAt ${spec.openedAt})`, () => {
    for (const type of CASE_TYPES) {
      for (let band = 1; band <= 4; band += 1) {
        const expected = spec.base[type][band - 1];
        it(`${type} band ${band}: ${expected} cents, no surcharges`, () => {
          expect(calc(input({ type, complexity: band, openedAt: spec.openedAt }))).toEqual({
            table: spec.table,
            bandFee: expected,
            urgencyFee: 0,
            expeditedFee: 0,
            total: expected,
          });
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Rate-table selection: both revision boundaries, both sides of each edge.
// ---------------------------------------------------------------------------

describe('rate-table selection at the revision boundaries', () => {
  const std = (openedAt: string): FeeBreakdown =>
    calc(input({ type: 'STANDARD', complexity: 1, openedAt }));

  it('pins: 2020-12-31 (day before 2021-01-01) -> 2019 table', () => {
    expect(std('2020-12-31')).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000 });
  });

  it('pins: 2021-01-01 exactly -> 2021 table (the 2021 edge is INCLUSIVE)', () => {
    expect(std('2021-01-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins: 2022-06-30 (day before 2022-07-01) -> 2021 table', () => {
    expect(std('2022-06-30')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins (BUG): 2022-07-01 exactly -> 2021 table, NOT 2022 (the 2022 edge is EXCLUSIVE; FINDINGS F-1)', () => {
    expect(std('2022-07-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins: 2022-07-02 (day after 2022-07-01) -> 2022 table', () => {
    expect(std('2022-07-02')).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 });
  });

  it('pins: no lower bound -- 2015-03-03 (before the module existed) -> 2019 table', () => {
    expect(std('2015-03-03').table).toBe('2019');
  });

  it('pins (QUIRK): openedAt is compared as a raw string -- "2022-07-01T00:00:00" sorts after the boundary -> 2022 table (FINDINGS F-1)', () => {
    expect(std('2022-07-01T00:00:00').table).toBe('2022');
  });

  it('pins (QUIRK): non-date "garbage" sorts above both revision strings -> 2022 table', () => {
    expect(std('garbage').table).toBe('2022');
  });

  it('pins (QUIRK): empty openedAt sorts below both revision strings -> 2019 table', () => {
    expect(std('').table).toBe('2019');
  });
});

// ---------------------------------------------------------------------------
// 3. Urgency: the 7-day boundary, both sides, and its odd edges.
// ---------------------------------------------------------------------------

describe('urgency: deadline proximity to the `now` the caller passes', () => {
  const now = '2024-01-15';
  // 2022 APPEAL band 4: bandFee 109000; urgencyPct 18 -> urgencyFee 19620.
  const urgentCase = (deadline?: string): CaseInput =>
    input({ type: 'APPEAL', complexity: 4, openedAt: '2022-08-01', deadline });

  it('pins: deadline 7 days out (inclusive edge) -> urgent, urgencyFee 19620', () => {
    expect(calc(urgentCase('2024-01-22'), now)).toEqual({ table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 0, total: 128620 });
  });

  it('pins: deadline 8 days out (exclusive side of the edge) -> not urgent', () => {
    expect(calc(urgentCase('2024-01-23'), now)).toEqual({ table: '2022', bandFee: 109000, urgencyFee: 0, expeditedFee: 0, total: 109000 });
  });

  it('pins: deadline today (0 days) -> urgent', () => {
    expect(calc(urgentCase('2024-01-15'), now).urgencyFee).toBe(19620);
  });

  it('pins: deadline yesterday (-1 day) -> still urgent', () => {
    expect(calc(urgentCase('2024-01-14'), now).urgencyFee).toBe(19620);
  });

  it('pins (QUIRK): deadline 30 days in the PAST -> still urgent; the flag never clears (FINDINGS F-2)', () => {
    expect(calc(urgentCase('2023-12-16'), now).urgencyFee).toBe(19620);
  });

  it('pins: no deadline at all -> not urgent', () => {
    expect(calc(urgentCase(undefined), now).urgencyFee).toBe(0);
  });

  it('pins (QUIRK): empty-string deadline is falsy -> silently not urgent', () => {
    expect(calc(urgentCase(''), now).urgencyFee).toBe(0);
  });

  it('pins (QUIRK): unparseable deadline -> daysBetween is NaN and NaN <= 7 is false -> silently not urgent', () => {
    expect(calc(urgentCase('garbage'), now).urgencyFee).toBe(0);
  });

  it('pins: urgency pct is a property of the rate table (15% for 2019/2021, 18% for 2022)', () => {
    const d = '2024-01-16'; // 1 day from now -> urgent in all three
    expect(calc(input({ openedAt: '2019-06-01', deadline: d }), now)).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 0, total: 13800 });
    expect(calc(input({ openedAt: '2021-05-10', deadline: d }), now)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
    expect(calc(input({ openedAt: '2022-08-01', deadline: d }), now)).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 2700, expeditedFee: 0, total: 17700 });
  });

  it('pins: day math floors -- deadline at 23:59:59Z on the 8th day still counts as 7 days -> urgent', () => {
    expect(calc(urgentCase('2024-01-22T23:59:59Z'), now).urgencyFee).toBe(19620);
  });

  it('pins: deadline at 00:00:00Z on the 9th day is a full 8 days -> not urgent', () => {
    expect(calc(urgentCase('2024-01-23T00:00:00Z'), now).urgencyFee).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. pins (QUIRK): urgency depends on the billing call time (FINDINGS F-2).
// ---------------------------------------------------------------------------

describe('pins (QUIRK): urgency depends on the billing call time, not the case timeline (FINDINGS F-2)', () => {
  // 2021 table, STANDARD band 1 = 13500; urgency 15% = 2025.
  const c = input({ type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2021-06-30' });

  it('billed 51 days before the deadline -> not urgent (total 13500)', () => {
    expect(calc(c, '2021-05-10')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('billed 8 days before the deadline -> not urgent (total 13500)', () => {
    expect(calc(c, '2021-06-22')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('billed 7 days before the deadline (inclusive edge) -> urgent (total 15525)', () => {
    expect(calc(c, '2021-06-23')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
  });

  it('billed the day after the deadline -> still urgent (total 15525)', () => {
    expect(calc(c, '2021-07-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
  });

  it('the same case object billed on two different dates -> two different totals (the audit hazard)', () => {
    const early = calc(c, '2021-05-10');
    const late = calc(c, '2021-06-23');
    expect(early.total).toBe(13500);
    expect(late.total).toBe(15525);
    expect(late.total - early.total).toBe(2025);
  });
});

// ---------------------------------------------------------------------------
// 5. Rounding: Math.round per step, in cents (FINDINGS F-3).
// ---------------------------------------------------------------------------

describe('rounding: Math.round per step, in cents (FINDINGS F-3)', () => {
  const now = '2024-01-15';
  const d = '2024-01-16'; // 1 day from now -> urgent

  it('pins (QUIRK): expedited is compounded on (bandFee + urgencyFee); 2019 STANDARD band 2 -> round(2127.5) = 2128 (.5 rounds up)', () => {
    expect(
      calc(input({ type: 'STANDARD', complexity: 2, openedAt: '2019-06-01', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 });
  });

  it('pins: 2019 COMMERCIAL band 2 urgent+expedited -> round(3622.5) = 3623', () => {
    expect(
      calc(input({ type: 'COMMERCIAL', complexity: 2, openedAt: '2019-06-01', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2019', bandFee: 31500, urgencyFee: 4725, expeditedFee: 3623, total: 39848 });
  });

  it('pins: 2019 ESTATE band 3 urgent+expedited -> round(4542.5) = 4543', () => {
    expect(
      calc(input({ type: 'ESTATE', complexity: 3, openedAt: '2019-06-01', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2019', bandFee: 39500, urgencyFee: 5925, expeditedFee: 4543, total: 49968 });
  });

  it('pins: 2022 APPEAL band 4 urgent+expedited -> round(15434.4) = 15434 (rounds down)', () => {
    expect(
      calc(input({ type: 'APPEAL', complexity: 4, openedAt: '2022-08-01', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 15434, total: 144054 });
  });

  it('pins: 2022 COMMERCIAL band 4 urgent+expedited -> round(11398.8) = 11399', () => {
    expect(
      calc(input({ type: 'COMMERCIAL', complexity: 4, openedAt: '2022-08-01', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2022', bandFee: 80500, urgencyFee: 14490, expeditedFee: 11399, total: 106489 });
  });

  it('pins: exact path -- 2021 STANDARD band 1 urgent+expedited -> 1863 exactly (rounding present but a no-op)', () => {
    expect(
      calc(input({ type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 1863, total: 17388 });
  });

  it('pins: expedited pct is a property of the rate table (10% for 2019, 12% for 2021/2022), applied to bandFee when not urgent', () => {
    expect(calc(input({ openedAt: '2019-06-01', expedited: true }), now)).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 1200, total: 13200 });
    expect(calc(input({ openedAt: '2021-05-10', expedited: true }), now)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120 });
    expect(calc(input({ openedAt: '2022-08-01', expedited: true }), now)).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 1800, total: 16800 });
  });
});

// ---------------------------------------------------------------------------
// 6. Degenerate inputs: zero, negative, unknown type, missing complexity, ...
// ---------------------------------------------------------------------------

describe('degenerate inputs', () => {
  it('pins: complexity null -> throws Error("complexity is required") (exact message pinned)', () => {
    let message: string | undefined;
    try {
      calculateFee(input({ complexity: null }), REF_NOW);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toBe('complexity is required');
  });

  it('pins: a case object missing the complexity key (undefined) -> same throw (the `=== undefined` branch)', () => {
    const withoutComplexity = { type: 'STANDARD', openedAt: '2019-06-01' } as unknown as CaseInput;
    expect(() => calculateFee(withoutComplexity, REF_NOW)).toThrow('complexity is required');
  });

  it('pins (QUIRK): complexity 0 is falsy -> coerced to band 1 and billed, not rejected', () => {
    expect(calc(input({ complexity: 0, openedAt: '2022-08-01' }))).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 });
  });

  it('pins (QUIRK): negative complexity -> band 1', () => {
    expect(calc(input({ complexity: -3, openedAt: '2022-08-01' })).bandFee).toBe(15000);
  });

  it('pins (QUIRK): NaN complexity is falsy -> band 1, same coercion as 0', () => {
    expect(calc(input({ complexity: NaN, openedAt: '2022-08-01' })).bandFee).toBe(15000);
  });

  it('pins (QUIRK): complexity above 4 is clamped down to band 4', () => {
    expect(calc(input({ complexity: 5, openedAt: '2022-08-01' }))).toEqual({ table: '2022', bandFee: 49000, urgencyFee: 0, expeditedFee: 0, total: 49000 });
    expect(calc(input({ complexity: 42, openedAt: '2022-08-01' })).bandFee).toBe(49000);
  });

  it('pins (QUIRK): fractional complexity (2.5) slips past both clamps and indexes bands[1.5] -> undefined bandFee, NaN total', () => {
    const r = calc(input({ complexity: 2.5, openedAt: '2022-08-01' }));
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(Number.isNaN(r.total)).toBe(true);
  });

  it('pins (QUIRK): unknown case type is silently billed at STANDARD rates for the era table (no error, no flag)', () => {
    expect(calc(input({ type: 'COMMRCIAL', complexity: 2, openedAt: '2021-05-10' }))).toEqual({ table: '2021', bandFee: 20500, urgencyFee: 0, expeditedFee: 0, total: 20500 });
  });

  it('pins (QUIRK): case sensitivity is not normalized -- "standard" is an unknown type, billed as STANDARD', () => {
    expect(calc(input({ type: 'standard', complexity: 1, openedAt: '2019-06-01' })).bandFee).toBe(12000);
  });

  it('pins (QUIRK): the STANDARD fallback still honors the era -- unknown type opened in 2023 gets 2022 STANDARD band 1', () => {
    expect(calc(input({ type: 'COMMRCIAL', complexity: 1, openedAt: '2023-01-01' })).bandFee).toBe(15000);
  });
});
```

Wait — let me verify the fractional test: complexity 2.5, openedAt '2022-08-01', no deadline → urgencyFee 0, expeditedFee 0, total = undefined + 0 + 0 = NaN ✓. bandFee undefined ✓.

Hmm — `expect(r.urgencyFee).toBe(0)` — urgencyFee is 0 because no deadline ✓.

One concern: `toEqual` with the matrix — the `table: spec.table` where spec.table: '2019'|'2021'|'2022' — fine.

Now, `describe`/`it` inside a top-level for loop: vitest supports it (dynamic describe). ✓

Also, potential lint: `const c` shadows nothing. In section 4 I use `const c = input(...)` — earlier in section 3 I used `urgentCase`. No clash (different scopes).

Verify section 4's "billed 51 days before": deadline '2021-06-30', now '2021-05-10' → days = 51 → 51 <= 7 false → not urgent ✓.

All confirmed.

One more check — the import of `FeeBreakdown` used in the return type of `calc` and `std`. ✓ `CaseInput` used. ✓

Now, `REF_NOW` used in the degenerate null test and in the default of calc. ✓

I think the spec is solid. Also let me confirm no template-literal backtick issues in the reply: test names use template literals with backticks in the source (for section 1 matrix: `` `${type} band ${band}...` ``) — that's fine, they're inside the fenced block, not a fence.

Now let me finalize the FINDINGS.md with proper 4-space indented blocks. I need to be careful that every line inside each indented block has 4 leading spaces. Let me write it.

Also, the top-level heading of FINDINGS.md: the file's content starts with `# FINDINGS — feeCalculator.ts`. Good.

Re-verify the requirement "document each in FINDINGS.md with the reproduction input, likely blast radius, and the fix you would propose — not applied" ✓ for F-1..F-6.

"Pin them AS THEY ARE, with test names that flag them" ✓.

The deliverable is complete: 2 files.

Also, sanity check on the "statusResolver.ts" file — it's in the workspace but belongs to a different variant; the task (variant A) only concerns feeCalculator. I don't touch it. Correct.

One more consideration on file naming: should the spec be `test/fee-calculator.spec.ts` or `test/feeCalculator.spec.ts`? The convention: "TS file: kebab-case.role.ts" → kebab: fee-calculator.spec.ts ✓.

Now — the em dash "—" in FINDINGS.md and test names: fine (English, code in English; em dash is OK). Actually the convention says "code and comments in English" — em dash is fine. In test names I mostly used "->". OK.

Final reply format: start with the first heading, nothing before. Two sections.

Actually, wait — let me reconsider whether the mechanical parser can handle the ```ts fence containing backticks (template literals) in the content. The fence closes on a line that is exactly ``` (or the info-string fence's closing). My TS content has backticks mid-line (template literals), but no line that is just ```. Template literals like `` `${type} band ${band}: ${expected} cents, no surcharges` `` are inside a longer line. Safe.

FINDINGS.md content: no triple backticks anywhere (I use indented blocks). Inline single backticks are fine.

Let me write out the final reply now.
```

## reply

### test/fee-calculator.spec.ts
```ts
// Characterization suite for feeCalculator.ts (in production since 2019,
// zero tests until now). It pins what the module DOES today, not what it
// should do. See FINDINGS.md for the quirks/bugs this suite deliberately
// pins, with reproductions and proposed-not-applied fixes.
//
// Conventions:
// - Expected values are hand-derived literals. The literals are the pin.
// - A test name starting with "pins (BUG):" or "pins (QUIRK):" asserts a
//   surprising or known-wrong value on purpose. When a future change
//   intentionally alters that behaviour, exactly these tests go red: that
//   redness is the change signal. Re-pin them in the fix PR, do not delete.
// - Determinism: every calculateFee call passes an explicit `now` (the
//   module's only clock seam). No new Date(), no Date.now(), no fake timers,
//   no randomness in this file. All date strings are fixed literals; where a
//   time of day matters the string carries a Z suffix so parsing is
//   UTC-anchored and timezone-independent.
// - The production module is imported as-is; nothing is mocked or refactored.

import { describe, expect, it } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';

const REF_NOW = '2024-01-15';

function input(over: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2019-06-01',
    ...over,
  };
}

function calc(c: CaseInput, now: string = REF_NOW): FeeBreakdown {
  return calculateFee(c, now);
}

// ---------------------------------------------------------------------------
// 1. Full matrix: every case type x every complexity band, for all three
//    rate tables (48 assertions). Surcharges off: no deadline, no expedited.
// ---------------------------------------------------------------------------

const CASE_TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
type KnownCaseType = (typeof CASE_TYPES)[number];

interface TableSpec {
  table: '2019' | '2021' | '2022';
  // An openedAt that selects this table, away from any boundary.
  openedAt: string;
  // Fee per band (band 1..4), in cents. Hand-copied from the current code.
  base: Record<KnownCaseType, readonly number[]>;
}

const TABLES: TableSpec[] = [
  {
    table: '2019',
    openedAt: '2019-06-01',
    base: {
      STANDARD: [12000, 18500, 27000, 41000],
      COMMERCIAL: [22000, 31500, 45000, 68000],
      ESTATE: [18000, 26000, 39500, 60000],
      APPEAL: [30000, 42000, 61000, 92000],
    },
  },
  {
    table: '2021',
    openedAt: '2021-05-10',
    base: {
      STANDARD: [13500, 20500, 29500, 44500],
      COMMERCIAL: [24000, 34000, 48500, 73000],
      ESTATE: [19500, 28000, 42500, 64500],
      APPEAL: [32500, 45500, 66000, 99000],
    },
  },
  {
    table: '2022',
    openedAt: '2022-08-01',
    base: {
      STANDARD: [15000, 22500, 32500, 49000],
      COMMERCIAL: [26500, 37500, 53500, 80500],
      ESTATE: [21500, 31000, 47000, 71000],
      APPEAL: [36000, 50000, 72500, 109000],
    },
  },
];

for (const spec of TABLES) {
  describe(`rate table ${spec.table} (openedAt ${spec.openedAt})`, () => {
    for (const type of CASE_TYPES) {
      for (let band = 1; band <= 4; band += 1) {
        const expected = spec.base[type][band - 1];
        it(`${type} band ${band}: ${expected} cents, no surcharges`, () => {
          expect(calc(input({ type, complexity: band, openedAt: spec.openedAt }))).toEqual({
            table: spec.table,
            bandFee: expected,
            urgencyFee: 0,
            expeditedFee: 0,
            total: expected,
          });
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Rate-table selection: both revision boundaries, both sides of each edge.
// ---------------------------------------------------------------------------

describe('rate-table selection at the revision boundaries', () => {
  const std = (openedAt: string): FeeBreakdown =>
    calc(input({ type: 'STANDARD', complexity: 1, openedAt }));

  it('pins: 2020-12-31 (day before 2021-01-01) -> 2019 table', () => {
    expect(std('2020-12-31')).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000 });
  });

  it('pins: 2021-01-01 exactly -> 2021 table (the 2021 edge is INCLUSIVE)', () => {
    expect(std('2021-01-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins: 2022-06-30 (day before 2022-07-01) -> 2021 table', () => {
    expect(std('2022-06-30')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins (BUG): 2022-07-01 exactly -> 2021 table, NOT 2022 (the 2022 edge is EXCLUSIVE; FINDINGS F-1)', () => {
    expect(std('2022-07-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('pins: 2022-07-02 (day after 2022-07-01) -> 2022 table', () => {
    expect(std('2022-07-02')).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 });
  });

  it('pins: no lower bound -- 2015-03-03 (before the module existed) -> 2019 table', () => {
    expect(std('2015-03-03').table).toBe('2019');
  });

  it('pins (QUIRK): openedAt is compared as a raw string -- "2022-07-01T00:00:00" sorts after the boundary -> 2022 table (FINDINGS F-1)', () => {
    expect(std('2022-07-01T00:00:00').table).toBe('2022');
  });

  it('pins (QUIRK): non-date "garbage" sorts above both revision strings -> 2022 table', () => {
    expect(std('garbage').table).toBe('2022');
  });

  it('pins (QUIRK): empty openedAt sorts below both revision strings -> 2019 table', () => {
    expect(std('').table).toBe('2019');
  });
});

// ---------------------------------------------------------------------------
// 3. Urgency: the 7-day boundary, both sides of the edge, and its odd edges.
// ---------------------------------------------------------------------------

describe('urgency: deadline proximity to the `now` the caller passes', () => {
  const now = '2024-01-15';
  // 2022 APPEAL band 4: bandFee 109000; urgencyPct 18 -> urgencyFee 19620.
  const urgentCase = (deadline?: string): CaseInput =>
    input({ type: 'APPEAL', complexity: 4, openedAt: '2022-08-01', deadline });

  it('pins: deadline 7 days out (inclusive edge) -> urgent, urgencyFee 19620', () => {
    expect(calc(urgentCase('2024-01-22'), now)).toEqual({ table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 0, total: 128620 });
  });

  it('pins: deadline 8 days out (exclusive side of the edge) -> not urgent', () => {
    expect(calc(urgentCase('2024-01-23'), now)).toEqual({ table: '2022', bandFee: 109000, urgencyFee: 0, expeditedFee: 0, total: 109000 });
  });

  it('pins: deadline today (0 days) -> urgent', () => {
    expect(calc(urgentCase('2024-01-15'), now).urgencyFee).toBe(19620);
  });

  it('pins: deadline yesterday (-1 day) -> still urgent', () => {
    expect(calc(urgentCase('2024-01-14'), now).urgencyFee).toBe(19620);
  });

  it('pins (QUIRK): deadline 30 days in the PAST -> still urgent; the flag never clears (FINDINGS F-2)', () => {
    expect(calc(urgentCase('2023-12-16'), now).urgencyFee).toBe(19620);
  });

  it('pins: no deadline at all -> not urgent', () => {
    expect(calc(urgentCase(undefined), now).urgencyFee).toBe(0);
  });

  it('pins (QUIRK): empty-string deadline is falsy -> silently not urgent', () => {
    expect(calc(urgentCase(''), now).urgencyFee).toBe(0);
  });

  it('pins (QUIRK): unparseable deadline -> daysBetween is NaN and NaN <= 7 is false -> silently not urgent', () => {
    expect(calc(urgentCase('garbage'), now).urgencyFee).toBe(0);
  });

  it('pins: urgency pct is a property of the rate table (15% for 2019/2021, 18% for 2022)', () => {
    const d = '2024-01-16'; // 1 day from now -> urgent in all three
    expect(calc(input({ openedAt: '2019-06-01', deadline: d }), now)).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 0, total: 13800 });
    expect(calc(input({ openedAt: '2021-05-10', deadline: d }), now)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
    expect(calc(input({ openedAt: '2022-08-01', deadline: d }), now)).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 2700, expeditedFee: 0, total: 17700 });
  });

  it('pins: day math floors -- deadline at 23:59:59Z on the 8th day still counts as 7 days -> urgent', () => {
    expect(calc(urgentCase('2024-01-22T23:59:59Z'), now).urgencyFee).toBe(19620);
  });

  it('pins: deadline at 00:00:00Z on the 9th day is a full 8 days -> not urgent', () => {
    expect(calc(urgentCase('2024-01-23T00:00:00Z'), now).urgencyFee).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. pins (QUIRK): urgency depends on the billing call time (FINDINGS F-2).
// ---------------------------------------------------------------------------

describe('pins (QUIRK): urgency depends on the billing call time, not the case timeline (FINDINGS F-2)', () => {
  // 2021 table, STANDARD band 1 = 13500; urgency 15% = 2025.
  const c = input({ type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2021-06-30' });

  it('billed 51 days before the deadline -> not urgent (total 13500)', () => {
    expect(calc(c, '2021-05-10')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('billed 8 days before the deadline -> not urgent (total 13500)', () => {
    expect(calc(c, '2021-06-22')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });

  it('billed 7 days before the deadline (inclusive edge) -> urgent (total 15525)', () => {
    expect(calc(c, '2021-06-23')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
  });

  it('billed the day after the deadline -> still urgent (total 15525)', () => {
    expect(calc(c, '2021-07-01')).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
  });

  it('the same case object billed on two different dates -> two different totals (the audit hazard)', () => {
    const early = calc(c, '2021-05-10');
    const late = calc(c, '2021-06-23');
    expect(early.total).toBe(13500);
    expect(late.total).toBe(15525);
    expect(late.total - early.total).toBe(2025);
  });
});

// ---------------------------------------------------------------------------
// 5. Rounding: Math.round per step, in cents (FINDINGS F-3).
// ---------------------------------------------------------------------------

describe('rounding: Math.round per step, in cents (FINDINGS F-3)', () => {
  const now = '2024-01-15';
  const d = '2024-01-16'; // 1 day from now -> urgent

  it('pins (QUIRK): expedited is compounded on (bandFee + urgencyFee); 2019 STANDARD band 2 -> round(2127.5) = 2128 (.5 rounds up)', () => {
    expect(
      calc(input({ type: 'STANDARD', complexity: 2, openedAt: '2019-06-01', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 });
  });

  it('pins: 2019 COMMERCIAL band 2 urgent+expedited -> round(3622.5) = 3623', () => {
    expect(
      calc(input({ type: 'COMMERCIAL', complexity: 2, openedAt: '2019-06-01', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2019', bandFee: 31500, urgencyFee: 4725, expeditedFee: 3623, total: 39848 });
  });

  it('pins: 2019 ESTATE band 3 urgent+expedited -> round(4542.5) = 4543', () => {
    expect(
      calc(input({ type: 'ESTATE', complexity: 3, openedAt: '2019-06-01', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2019', bandFee: 39500, urgencyFee: 5925, expeditedFee: 4543, total: 49968 });
  });

  it('pins: 2022 APPEAL band 4 urgent+expedited -> round(15434.4) = 15434 (rounds down)', () => {
    expect(
      calc(input({ type: 'APPEAL', complexity: 4, openedAt: '2022-08-01', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 15434, total: 144054 });
  });

  it('pins: 2022 COMMERCIAL band 4 urgent+expedited -> round(11398.8) = 11399', () => {
    expect(
      calc(input({ type: 'COMMERCIAL', complexity: 4, openedAt: '2022-08-01', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2022', bandFee: 80500, urgencyFee: 14490, expeditedFee: 11399, total: 106489 });
  });

  it('pins: exact path -- 2021 STANDARD band 1 urgent+expedited -> 1863 exactly (rounding present but a no-op)', () => {
    expect(
      calc(input({ type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: d, expedited: true }), now),
    ).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 1863, total: 17388 });
  });

  it('pins: expedited pct is a property of the rate table (10% for 2019, 12% for 2021/2022), applied to bandFee when not urgent', () => {
    expect(calc(input({ openedAt: '2019-06-01', expedited: true }), now)).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 1200, total: 13200 });
    expect(calc(input({ openedAt: '2021-05-10', expedited: true }), now)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120 });
    expect(calc(input({ openedAt: '2022-08-01', expedited: true }), now)).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 1800, total: 16800 });
  });
});

// ---------------------------------------------------------------------------
// 6. Degenerate inputs: zero, negative, unknown type, missing complexity, ...
// ---------------------------------------------------------------------------

describe('degenerate inputs', () => {
  it('pins: complexity null -> throws Error("complexity is required") (exact message pinned)', () => {
    let message: string | undefined;
    try {
      calculateFee(input({ complexity: null }), REF_NOW);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toBe('complexity is required');
  });

  it('pins: a case object missing the complexity key (undefined) -> same throw (the `=== undefined` branch)', () => {
    const withoutComplexity = { type: 'STANDARD', openedAt: '2019-06-01' } as unknown as CaseInput;
    expect(() => calculateFee(withoutComplexity, REF_NOW)).toThrow('complexity is required');
  });

  it('pins (QUIRK): complexity 0 is falsy -> coerced to band 1 and billed, not rejected', () => {
    expect(calc(input({ complexity: 0, openedAt: '2022-08-01' }))).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 });
  });

  it('pins (QUIRK): negative complexity -> band 1', () => {
    expect(calc(input({ complexity: -3, openedAt: '2022-08-01' })).bandFee).toBe(15000);
  });

  it('pins (QUIRK): NaN complexity is falsy -> band 1, same coercion as 0', () => {
    expect(calc(input({ complexity: NaN, openedAt: '2022-08-01' })).bandFee).toBe(15000);
  });

  it('pins (QUIRK): complexity above 4 is clamped down to band 4', () => {
    expect(calc(input({ complexity: 5, openedAt: '2022-08-01' }))).toEqual({ table: '2022', bandFee: 49000, urgencyFee: 0, expeditedFee: 0, total: 49000 });
    expect(calc(input({ complexity: 42, openedAt: '2022-08-01' })).bandFee).toBe(49000);
  });

  it('pins (QUIRK): fractional complexity (2.5) slips past both clamps and indexes bands[1.5] -> undefined bandFee, NaN total', () => {
    const r = calc(input({ complexity: 2.5, openedAt: '2022-08-01' }));
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(Number.isNaN(r.total)).toBe(true);
  });

  it('pins (QUIRK): unknown case type is silently billed at STANDARD rates for the era table (no error, no flag)', () => {
    expect(calc(input({ type: 'COMMRCIAL', complexity: 2, openedAt: '2021-05-10' }))).toEqual({ table: '2021', bandFee: 20500, urgencyFee: 0, expeditedFee: 0, total: 20500 });
  });

  it('pins (QUIRK): case sensitivity is not normalized -- "standard" is an unknown type, billed as STANDARD', () => {
    expect(calc(input({ type: 'standard', complexity: 1, openedAt: '2019-06-01' })).bandFee).toBe(12000);
  });

  it('pins (QUIRK): the STANDARD fallback still honors the era -- unknown type opened in 2023 gets 2022 STANDARD band 1', () => {
    expect(calc(input({ type: 'COMMRCIAL', complexity: 1, openedAt: '2023-01-01' })).bandFee).toBe(15000);
  });
});
```

### FINDINGS.md
```md
# FINDINGS — feeCalculator.ts

Companion to `test/fee-calculator.spec.ts`. That suite is a **characterization**
suite: it pins what `feeCalculator.ts` does *today*, including the behaviours
recorded below. **No fix has been applied in this issue; the production file
is untouched.**

Reading convention used by the suite: a test name beginning with
`pins (BUG):` or `pins (QUIRK):` deliberately asserts a surprising or
known-wrong value. When next month's change intentionally alters one of those
behaviours, exactly those tests go red — that redness is the change signal.
In the fix PR, re-pin them to the new intended value (and record the delta);
do not delete them.

## F-1 — (BUG) The 2022-07-01 revision boundary is exclusive: cases opened on the revision date bill at 2021 rates

Reproduction (pinned by "pins (BUG): 2022-07-01 exactly ..."):

    calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2024-01-15')
    // => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }
    //    what "revision effective on 2022-07-01" would give:
    //    { table: '2022', bandFee: 15000, ... }

What the code does. `tableFor` uses two *different* comparators:

    if (openedAt >= REVISION_2021) {    // '2021-01-01', inclusive
      if (openedAt > REVISION_2022) {   // '2022-07-01', exclusive
        return RATE_TABLE_2022;
      }
      return RATE_TABLE_2021;
    }
    return RATE_TABLE_2019;

So a case opened exactly on `2021-01-01` takes the 2021 table, but a case
opened exactly on `2022-07-01` stays on the 2021 table; the 2022 table only
applies from `2022-07-02`. Two revisions of the same kind are handled
asymmetrically — the classic shape of a typo'd comparator.

Likely intent. Both revision dates inclusive (`>=` on both).

Blast radius.
- Every case whose `openedAt` is exactly `2022-07-01` has been billed at 2021
  rates since then — 1500–3500 cents under the 2022 schedule per band, and at
  the 15% urgency rate instead of 18%. Those stored numbers are in the annual
  audit record and would have to be adjusted as a data correction, not
  re-derived, if the fix changes future behaviour.
- The bug is still live: re-generating fees on those cases today reproduces
  the 2021 rates.
- The comparison is on the raw string, so the same calendar day can fall on
  both sides of the boundary depending on the stored format:
  `'2022-07-01T00:00:00'` sorts *after* `'2022-07-01'` and takes the 2022
  table (pinned). Two cases opened on the same day can be on different
  schedules.
- The same string comparison also sends non-date values to a table
  (`'garbage'` → 2022, `''` → 2019; both pinned). `tableFor` never parses a
  date at all.

Proposed fix (not applied). Change the inner test to
`openedAt >= REVISION_2022` — or, better, compare parsed dates. On
application, the pinned test fails exactly on `2022-07-01`; re-pin it to the
2022 values and raise the delta on the stored 2022-07-01 fees with billing.

## F-2 — (QUIRK) Urgency is a function of the billing call time — and an overdue deadline stays urgent forever

Reproduction (pinned by the "pins (QUIRK): urgency depends on the billing
call time" group):

    const c = { type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2021-06-30' };
    calculateFee(c, '2021-05-10'); // 51 days out   => total 13500 (not urgent)
    calculateFee(c, '2021-06-23'); // 7 days out     => total 15525 (urgent, +2025)
    calculateFee(c, '2021-07-01'); // deadline passed => total 15525 (STILL urgent)

What the code does. The urgency rule is `daysBetween(now, deadline) <= 7`,
where `now` is the argument the caller passes (or the wall clock when
omitted). It is measured from the *billing moment*, not from anything in the
case, and every negative day count satisfies `<= 7`, so once the deadline
passes the urgency fee never switches off again. Related edges pinned: an
empty-string deadline is silently not urgent (falsy), and an unparseable
deadline makes `daysBetween` return `NaN`, and `NaN <= 7` is false — also
silently not urgent.

Likely intent. "Urgent" probably means "the case's deadline was near at some
business moment" — a property of the case (or of a stored as-of date), not of
the moment someone re-runs billing.

Blast radius.
- A stored fee is not a pure function of the case: re-generating fees for an
  old case yields a different number — and once the deadline has passed, the
  re-run is *guaranteed* to differ (urgency on, permanently).
- Combined with the wall-clock default (open question 1), calls without `now`
  are not reproducible at all.
- The audit trail mixes urgency evaluated at different billing dates with no
  field to tell them apart.

Proposed fix (not applied). Decide the as-of semantics (urgency against
`openedAt`, or against a stored "as of" date) and the overdue-deadline rule,
then pin the new rule in the suite.

## F-3 — (QUIRK) The expedited surcharge is compounded on (bandFee + urgencyFee) and rounded twice

Reproduction (pinned by "pins (QUIRK): expedited is compounded ..."):

    // 2019 table, STANDARD band 2, urgent + expedited
    // bandFee   18500
    // urgency   round(18500 * 15 / 100)          = 2775
    // expedited round((18500 + 2775) * 10 / 100) = round(2127.5) = 2128   // .5 rounds UP
    // total     23403

What the code does. `expeditedFee = pctOf(bandFee + urgencyFee,
expeditedPct)`: the expedited percentage is applied to a subtotal that
already contains the urgency surcharge, and `pctOf` rounds again. So
urgent+expedited fees are rounded twice, the second time on the already
rounded subtotal. `Math.round` is half-up: the 2019 table pins three `.5`
cases rounding up (2127.5 → 2128, 3622.5 → 3623, 4542.5 → 4543) and the 2022
table pins fractional round-downs (15434.4 → 15434, 11398.8 → 11399). Note
the urgency step itself is currently a rounding no-op on every shipped band
fee (each base fee divides exactly at 15%, 18%, and 12%); the only step that
today actually rounds a fraction is the expedited step.

Likely intent. Either surcharges stack additively on the base fee (no
compounding), or compounding is the accepted billing rule and the per-step
rounding is deliberate — the in-code comment says "billing reconciles
against these". Only billing can say which.

Blast radius. Every urgent+expedited fee since 2019 embeds the compounding
and the double rounding; the audit record has it.

Proposed fix (not applied). If non-compounding is intended, apply
`expeditedPct` to `bandFee` alone. Keep per-step rounding in either case —
reconciliation depends on it.

## F-4 — (QUIRK) Unknown case types silently bill at STANDARD rates

Reproduction (pinned by "pins (QUIRK): unknown case type ..."):

    calculateFee({ type: 'COMMRCIAL', complexity: 2, openedAt: '2021-05-10' }, '2024-01-15')
    // => { table: '2021', bandFee: 20500, ... }   // 2021 STANDARD band 2
    calculateFee({ type: 'standard', complexity: 1, openedAt: '2019-06-01' }, '2024-01-15')
    // => bandFee 12000                             // case not normalized; 'standard' is "unknown" too

What the code does. A miss on `table.base[c.type]` falls back to the
STANDARD row *of the same era table*. No error, no flag. The in-code comment
says this covers "rare imports from the old system".

Likely intent. A graceful default for the one-off legacy imports.

Blast radius. Any typo'd or case-mismatched type has been billed as STANDARD
since 2019 with no signal; a typo of a higher-value type (e.g. APPEAL) is
materially underbilled.

Proposed fix (not applied). Validate against the known set and throw/flag on
unknown types; run an audit query for unknown-type cases first so the error
does not retroactively change historical outputs.

## F-5 — (QUIRK) Falsy complexity (0, NaN) coerces to band 1; complexity above 4 clamps to 4

Reproduction (pinned by the "degenerate inputs" group):

    complexity: 0    -> band 1   // falsy branch, not an error
    complexity: -3   -> band 1
    complexity: NaN  -> band 1   // NaN is falsy
    complexity: 5    -> band 4   // upper clamp
    complexity: 42   -> band 4

What the code does. `if (!band || band < 1) band = 1; if (band > 4) band = 4;`
— silent normalization in both directions, never a rejection.

Likely intent. Defensively map bad data to a known band rather than failing.
Whether that is desirable is a business call.

Blast radius. Bad upstream data is billed at the wrong band (up to 3 bands
off) instead of surfacing.

Proposed fix (not applied). Explicit validation: reject non-integer
complexity outside 1..4 with a typed error.

## F-6 — (QUIRK) Fractional complexity slips past both clamps → `undefined` bandFee, `NaN` total

Reproduction (pinned by "pins (QUIRK): fractional complexity (2.5) ..."):

    calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2022-08-01' }, '2024-01-15')
    // => { table: '2022', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }

What the code does. `2.5` passes `!band` (truthy), `band < 1` (false), and
`band > 4` (false), then indexes `bands[1.5]` → `undefined`; every subsequent
arithmetic becomes `NaN` (urgencyFee/expeditedFee too, if a deadline were
near). The TypeScript type claims `bandFee` is a number — the gap is
invisible to the compiler.

Likely intent. None to read; a hole in the validation.

Blast radius. A stored NaN/null fee would poison reconciliation. Upstream
appears to send integers, so exposure is likely low — but it was unpinned
until now.

Proposed fix (not applied). Same as F-5: integer validation.

## Open questions (not safely determinable from the code alone)

1. Wall-clock default. `calculateFee(c)` without `now` falls back to
   `new Date().toISOString().slice(0, 10)`. The suite never exercises that
   path — it is non-deterministic by definition. Whether production ever
   omits `now`, and hence whether any stored fee is wall-clock-dependent,
   cannot be answered from this file.
2. F-1 population. Whether any real case has `openedAt` exactly
   `2022-07-01` (or a datetime form of that day) requires a data query.
3. Offset-less datetimes. `daysBetween` parses with `new Date`; an ISO string
   with a time but no `Z`/offset is read in the machine's *local* timezone,
   which would make the day math timezone-dependent. The suite only uses
   date-only strings and `Z`-suffixed datetimes (both UTC-anchored in
   JavaScript), so the suite itself is timezone-independent; whether
   production data ever carries offset-less datetimes is unknown.
4. Business adjudication of F-3 (compounding) and F-4 (STANDARD fallback):
   both are pinned; neither is judged right or wrong here.

## Suite design notes

- Every call passes an explicit `now` — the module's existing optional
  parameter is the only clock seam used. Nothing is mocked, faked, or
  refactored; the production file is imported as-is.
- All expected values are literals derived by hand from the current
  implementation. The literals are the pin.
- Date-only ISO strings parse as UTC in JavaScript, so `daysBetween` is
  deterministic across timezones for the inputs the suite uses.
- No `new Date()`, no timers, no randomness anywhere in the suite: run it
  twice, on any machine, in any timezone — identical results.
```


---
