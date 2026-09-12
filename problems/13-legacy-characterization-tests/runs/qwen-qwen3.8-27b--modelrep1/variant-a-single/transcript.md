# Transcript — 13-legacy-characterization-tests / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me analyze the task carefully.

The task is Variant A — a case fee calculator (in production since 2019). What needs to be done:
1. A characterization test suite that pins down the current behavior:
   - All combinations of case type × complexity band
   - Urgency multipliers
   - Date boundaries of the rate table (inclusive/exclusive edges of both transitions)
   - Rounding at each step
   - Degenerate inputs (zero, negative, unknown case type)
2. Do not touch the production code. The fake clock may be injected only via the module's existing optional `now` parameter.
3. The module contains quirks and at least one genuine bug. Pin them as they are with test names that make them stand out, and document each in FINDINGS.md with a reproduction input, likely blast radius (saved past fees!), and a proposed fix (not applied).
4. A deterministic suite; no real dates, no randomness.

Deliverables: the test suite + FINDINGS.md.

Wait — there's a twist. The workspace has `feeCalculator.ts` (the target) and `statusResolver.ts` (seemingly irrelevant? or is it a trap?). The task is about the fee calculator. The statusResolver is probably just another file in the workspace and — should not be touched. The task says "do not create files not asked for." The task only asks for the test suite + FINDINGS.md.

Hmm, but statusResolver.ts exists in the workspace. Is it part of the task? The variant text only mentions `feeCalculator.ts`. So I should only write tests for feeCalculator.ts. Should I also test statusResolver? No — "do exactly what the task asks." The task is about the case fee calculator. So only the feeCalculator test suite + FINDINGS.md.

Now, following the codebase conventions:
- TypeScript (strict), Node 20+. NestJS for the API. Prisma ORM, PostgreSQL. Vitest for tests. pnpm. ESM, `"type": "module"`.
- Layout: `test/<feature>.spec.ts` for tests.

So the test file should be at `test/fee-calculator.spec.ts`? The layout says `test/<feature>.spec.ts`. The feature here is the fee calculator. The source file is `feeCalculator.ts` (camelCase) in the workspace root. The layout convention says TS files should be `kebab-case.role.ts`, but the existing file is `feeCalculator.ts` and I must not modify it ("production code untouched"). So the test file is… `test/feeCalculator.spec.ts` or `test/fee-calculator.spec.ts`? The existing production file is `feeCalculator.ts`. In the layout convention, tests are `test/<feature>.spec.ts`. The feature name is… hmm. For safety, either match the source file name: `test/feeCalculator.spec.ts`? Or kebab-case `test/fee-calculator.spec.ts`?

The convention says "TS files: `kebab-case.role.ts`". The existing file `feeCalculator.ts` violates that, but it's production code I can't touch. For my new test file, I should follow the convention: kebab-case. So `test/fee-calculator.spec.ts`. Hmm, but "feature" is the module name… the module is `feeCalculator`. Actually, I think `test/fee-calculator.spec.ts` follows the stated convention best. Either is defensible. I'll go with `test/fee-calculator.spec.ts`.

Also, I need a vitest config? The workspace has `tsconfig.json` with `"types": []`. There's no package.json shown. The task says "build the whole solution in one reply" and "deliver every file the solution needs." What the solution needs: the test suite file + FINDINGS.md. Does it need a vitest config? The existing workspace doesn't show a package.json, but in the convention the project uses Vitest. For safety I could include a `vitest.config.ts` — but "do not create files not asked for." A vitest config might be considered needed to make the test suite run… hmm. The instructions say "deliver every file the solution needs, completely from first line to last." The test suite needs to be able to run with vitest. A minimal vitest config isn't strictly needed — vitest works without a config file. I think I should only deliver `test/fee-calculator.spec.ts` and `FINDINGS.md`. That's the cleanest interpretation: the deliverables are "the test suite + FINDINGS.md."

Hmm wait, but should the tests also test statusResolver? Let me re-read the variant: "the fixture is `feeCalculator.ts` from a case management system: about 250 lines, zero tests, computing procedural fees…". Only feeCalculator. statusResolver.ts is probably a distractor, or just another file in the workspace that exists for another variant. Don't test it. Actually wait — is it possible that the task intends both files? "The team wants to change this module next month" — singular, and "the module" refers to feeCalculator. The task bullets all reference this module. So only feeCalculator.

Okay let me carefully analyze feeCalculator.ts and find all quirks and bugs.

```ts
export type CaseType = 'STANDARD' | 'COMMERCIAL' | 'ESTATE' | 'APPEAL';

export interface CaseInput {
  type: string;
  complexity: number | null;
  openedAt: string;
  deadline?: string;
  expedited?: boolean;
}
```

Rate tables: 2019, 2021, 2022. Base fee per band in cents.

```ts
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

**Quirk 1 (genuine bug?):** Asymmetric boundary handling. A case opened exactly on `2021-01-01` gets the 2021 table (>=), but a case opened exactly on `2022-07-01` gets the 2021 table (because `>`, not `>=`). So the 2022 revision is effectively only in force from `2022-07-02` onward. The comment header says "2022-07: rate revision (see RATE_TABLE_2022)". The intended boundary is presumably 2022-07-01 inclusive. So a case opened on 2022-07-01 is being charged the old (2021) rates — likely a genuine bug. This is "the" bug to pin. The 2021-01-01 edge is inclusive; the 2022-07-01 edge is exclusive (a day late). This is an inconsistency: the first revision applied inclusive, the second one one day late. A case opened on 2022-07-01 is billed 2021 rates. Since past outputs are saved and audited, the fix will change those outputs; the fix needs billing approval.

Also, string comparison for dates: `openedAt >= '2021-01-01'` is lexicographic comparison — only works correctly for ISO-formatted `YYYY-MM-DD` strings. If `openedAt` is a full ISO datetime like `2021-01-01T14:30:00Z`… `'2021-01-01T14:30:00Z' >= '2021-01-01'` is true, no problem. But a case opened on `2020-12-31` is fine. What about non-padded dates? Not worth pinning deeply, but it's a quirk worth mentioning: the comparison is lexicographic over strings, so malformed/non-ISO dates get mis-bucketed. Also `daysBetween` uses `new Date(...)`.

```ts
function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / 86400000);
}
```

**Quirk 2:** `daysBetween` is computed with `new Date(openedAt)` — timezone-dependent! In a UTC environment, `new Date('2021-05-10')` parses as UTC midnight; in a negative-offset timezone (e.g. America/New_York), `new Date('2021-05-10')` is local midnight, and the difference is still an integer number of days (both parsed as local midnight) — actually if both are date-only strings, both are parsed in the same way (UTC midnight per the ISO date-only spec: date-only ISO strings are parsed as UTC). Let me recall: `new Date('2021-05-10')` — per the ES spec, date-only ISO format is interpreted as UTC. So `new Date('2021-05-10').getTime()` is always UTC midnight, timezone-independent. So `daysBetween('2021-05-10', '2021-05-17')` = 7 days, deterministic. OK.

But `now` defaults to `new Date().toISOString().slice(0, 10)` — date-only UTC string, no problem. And the `now` parameter, if provided, is expected to be a date string. `daysBetween(ref, c.deadline)` — ref is date-only, deadline is date-only. Both UTC midnight. Deterministic. Good.

But there's a subtle issue: **the "urgent if deadline within 7 days" logic uses `now`, not `openedAt`.** So urgency is based on the deadline relative to *now* (when the fee is calculated), not when the case was opened. This is actually probably intended ("urgency multiplier" — a case with a deadline in ≤7 days is urgent). The comment "2020-03: added URGENT tier after the Silva case." Quirk: the `now` default is the actual wall clock, making the output non-deterministic unless `now` is injected. The task allows fake clock injection only via `now`. So all tests should pass `now` explicitly.

**Quirk 3 (genuine bug?):** The `!band` check:

```ts
let band = c.complexity;
if (!band || band < 1) {
  band = 1;
}
if (band > 4) {
  band = 4;
}
```

Since null/undefined complexity already throws earlier (`if (c.complexity === null || c.complexity === undefined) throw`), the `!band` check catches `band === 0` (and NaN, negative? no — negative is caught by `band < 1`; but `!band` catches 0). So `complexity: 0` → band 1 (silent clamping). `complexity: -3` → band 1. `complexity: 5, 99` → band 4. `complexity: 2.5`? Non-integer band! `bands[2.5 - 1] = bands[1.5]` = undefined → `bandFee = undefined` → arithmetic with undefined → NaN → total NaN. This is a genuine bug: fractional complexity produces NaN fees (and `Math.round(NaN)` → NaN). Let me confirm: `c.complexity = 2.5`, `!band` is false, `band < 1` is false, `band > 4` is false, so `bandFee = bands[1.5]` → `undefined`. `urgencyFee`: if deadline present, `pctOf(undefined, pct)` → `Math.round(NaN)` → NaN. Even without deadline, `expeditedFee` if expedited → NaN. And `total: undefined + 0 + 0` → NaN. So yes: fractional complexity → NaN bandFee/total. A genuine bug to pin.

Also note: `complexity: 0` silently maps to band 1 — a quirk (a zero/negative degenerate input doesn't throw but clamps to band 1). The task explicitly says to pin "degenerate inputs (zero, negative, unknown case type)."

**Quirk 4:** Unknown case type silently falls back to STANDARD rates:

```ts
let bands = table.base[c.type];
if (!bands) {
  bands = table.base['STANDARD'];
}
```

So `type: 'MARITIME'` or `type: 'standard'` (lowercase) or `type: ''` → STANDARD fees. This is a documented quirk ("unrecognized types were rare imports from the old system; defaulted"). Pin it.

**Quirk 5:** Rounding at each step: `pctOf` rounds each percentage: `urgencyFee = round(bandFee * pct / 100)`, `expeditedFee = round((bandFee + urgencyFee) * pct / 100)`. So expedited is computed on the rounded urgency sum — compounding rounding. "Rounded at each step since 2019; billing reconciles to these." Pin: e.g. find a case where the rounding matters. Let me compute examples.

Also `expeditedFee` is computed from `bandFee + urgencyFee` — expedited percent applies to base+urgency. Not a bug per se, but worth pinning the order (percent on top of percent).

**Quirk 6:** The `table` field of the breakdown is a string '2019' | '2021' | '2022' — identity comparison of the object. No problem.

**Quirk 7:** `daysBetween(ref, deadline) <= 7` — so if deadline is exactly 7 days ahead, urgent; 8 days, not urgent. What if deadline is in the past (negative days)? `daysBetween` is negative → `<= 7` is true → a past deadline is urgent! This is a quirk/genuine bug: an expired deadline (deadline < now) still triggers the urgency surcharge. Example: now = 2021-05-10, deadline = 2021-05-01 → daysBetween = -9 → -9 <= 7 → urgent. Hmm, is this a "genuine bug"? It's at least a quirk — a case past its deadline is still urgent. Billing keeps charging the urgency fee for past deadlines. Definitely worth pinning and documenting. The task says "at least one genuine bug" — the 2022 boundary off-by-one is the most clearly "genuine bug" (2022-07-01 uses 2021 rates despite the constant name REVISION_2022 = '2022-07-01' implying the revision is in force that day). The NaN for fractional complexity is also a genuine bug. The past-deadline urgency is a quirk (or maybe intended? "urgent" is defined as within 7 days, and a past deadline is within 7 days in the signed sense… no, "within 7 days" should mean 0..7 or ≤7 in the future sense; a past deadline triggering is definitely unintended). I'll present it as a quirk with a note that it may be a bug.

Also: if `deadline` is present but `now` is default — non-deterministic. But tests always pass `now`.

**Quirk 8:** `openedAt` is used only for the table selection via string comparison; not parsed with `new Date`. So if `openedAt` is a malformed string (e.g. '2021/01/01' or 'garbage'), lexicographic comparison mis-buckets: 'garbage' >= '2021-01-01'? 'g' > '2' yes → then 'garbage' > '2022-07-01' also true → 2022 table! So `openedAt: 'nonsense'` gets the 2022 table. And `daysBetween` is not affected by openedAt. This is a quirk: non-ISO openedAt silently picks a table by lexicographic accident. Worth pinning a test + FINDINGS note.

Also `now` parameter: if `now` is provided, `ref = now`. `daysBetween(now, deadline)`. If `now` is after the deadline → negative → still urgent (as above).

**Quirk 9:** The throw for `complexity === null || undefined` — the message is 'complexity is required'. But `complexity: NaN`? `NaN === null` is false, so it passes; then `!band` → true (NaN is falsy) → band = 1. So NaN complexity → band 1 silently. Pin it.

Also `expedited?: boolean` — if `expedited` is truthy. If `expedited: 0` (non-boolean)? The `if (c.expedited)` is truthy check; but the type says boolean. Don't test out-of-type inputs other than the explicitly typed ones… actually, the type is `boolean | undefined`. Pin `expedited: true/false`. Also `expedited: true` but no urgency — expedited applies to bandFee alone: `expeditedFee = pctOf(bandFee + 0, pct)`.

Order: urgency first, then expedited on top of (band + urgency). Pin this composition.

**Rounding edges:** `pctOf` uses `Math.round((amount * pct) / 100)`. Let me compute values for pinning.

2019 table:
- STANDARD: [12000, 18500, 27000, 41000], urgency 15%, expedited 10%
- COMMERCIAL: [22000, 31500, 45000, 68000]
- ESTATE: [18000, 26000, 39500, 60000]
- APPEAL: [30000, 42000, 61000, 92000]

2021 table:
- STANDARD: [13500, 20500, 29500, 44500], urgency 15%, expedited 12%
- COMMERCIAL: [24000, 34000, 48500, 73000]
- ESTATE: [19500, 28000, 42500, 64500]
- APPEAL: [32500, 45500, 66000, 99000]

2022 table:
- STANDARD: [15000, 22500, 32500, 49000], urgency 18%, expedited 12%
- COMMERCIAL: [26500, 37500, 53500, 80500]
- ESTATE: [21500, 31000, 47000, 71000]
- APPEAL: [36000, 50000, 72500, 109000]

Let me compute the all-cases matrix (16 combos per table, 48 base fees total). I'll pin bandFee for every type × band × table. This satisfies "all case type × complexity band."

Urgency multiplier pinning:
- 2019/2021 urgency = 15%: STANDARD band1 2019: 12000 * 15 / 100 = 1800 exactly. Let me find a value where rounding matters: 18500 * 0.15 = 2775 exact. 27000*.15 = 4050. 41000*.15=6150. 22000*.15=3300. 31500*.15=4725. 45000*.15=6750. 68000*.15=10200. 18000*.15=2700. 26000*.15=3900. 39500*.15=5925. 60000*.15=9000. 30000*.15=4500. 42000*.15=6300. 61000*.15=9150. 92000*.15=13800. All exact — because these amounts are multiples of 100, so 15% of them… 18500*15=277500/100=2775 exact. Yes, all base fees are multiples of 100 → 15% is exact (x*15/100 = x*3/20; x multiple of 100 → x=100k → 15k… wait 100k*15/100 = 15k exact). So 15% never rounds.

- 2022 urgency = 18%: 18% of 100k = 18k exact. Also all exact! Since all band fees are multiples of 100, any integer percent gives an integer exactly. So `pctOf` rounding for urgency on these tables never actually kicks in. Hmm.

But expedited is applied to `bandFee + urgencyFee`. bandFee is a multiple of 100; urgencyFee is a multiple of 15/18 → also a multiple of… 15% of 100k = 15k (integer, in fact a multiple of 5: 100k*0.15 = 15k, integer; if k integer then 15k integer → multiple of 5? 15k is a multiple of 5, yes). 18% of 100k = 18k, a multiple of… 18k.

Then 10% or 12% of (bandFee + urgencyFee): if the sum is a multiple of 100, exact. bandFee multiple of 100; urgencyFee: 15% of 100k = 15k — if k is a multiple of 20, then 15k is a multiple of 300… Let me just check specific sums:

2019 STANDARD band1: 12000 + 1800 = 13800; 10% = 1380 exact.
2019 STANDARD band2: 18500 + 2775 = 21275; 10% = 2127.5 → Math.round → 2128! Rounding kicks in (half up via Math.round).
So this is my rounding pin: table 2019, STANDARD, band 2, urgent + expedited → urgencyFee 2775, expeditedFee 2128 (from 2127.5, rounded up), total 18500+2775+2128 = 23403.

Let me also verify Math.round(2127.5) = 2128. Yes, .5 rounds toward +∞.

More rounding cases:
2019 STANDARD band3: 27000 + 4050 = 31050; 10% = 3105 exact.
2019 STANDARD band4: 41000 + 6150 = 47150; 10% = 4715 exact.
2019 COMMERCIAL band1: 22000 + 3300 = 25300; 10% = 2530.
band2: 31500 + 4725 = 36225; 10% = 3622.5 → 3623.
band3: 45000+6750=51750; 10% = 5175.
band4: 68000+10200=78200; 10% = 7820.
2019 ESTATE band1: 18000+2700=20700 → 2070.
band2: 26000+3900=29900 → 2990.
band3: 39500+5925=45425 → 4542.5 → 4543.
band4: 60000+9000=69000 → 6900.
2019 APPEAL band1: 30000+4500=34500 → 3450.
band2: 42000+6300=48300 → 4830.
band3: 61000+9150=70150 → 7015.
band4: 92000+13800=105800 → 10580.

2021 expedited 12%:
STANDARD band1: 13500 + 2025 = 15525; 12% = 1863 exact.
band2: 20500 + 3075 = 23575; 12% = 2829 exact.
band3: 29500 + 4425 = 33925; 12% = 4071 exact.
band4: 44500 + 6675 = 51175; 12% = 6141 exact.
COMMERCIAL band1: 24000 + 3600 = 27600; 12% = 3312.
band2: 34000 + 5100 = 39100; 12% = 4692.
band3: 48500 + 7275 = 55775; 12% = 6693.
band4: 73000 + 10950 = 83950; 12% = 10074.
ESTATE band1: 19500 + 2925 = 22425; 12% = 2691.
band2: 28000 + 4200 = 32200; 12% = 3864.
band3: 42500 + 6375 = 48875; 12% = 5865.
band4: 64500 + 9675 = 74175; 12% = 8901.
APPEAL band1: 32500 + 4875 = 37375; 12% = 4485.
band2: 45500 + 6825 = 52325; 12% = 6279.
band3: 66000 + 9900 = 75900; 12% = 9108.
band4: 99000 + 14850 = 113850; 12% = 13662.

2022 expedited 12%, urgency 18%:
STANDARD: 15000 + 2700 = 17700 → 12% = 2124.
22500 + 4050 = 26550 → 3186.
32500 + 5850 = 38350 → 4602.
49000 + 8820 = 57820 → 6938.4 → Math.round → 6938. Here's a rounding case! 57820 * 0.12 = 6938.4 → 6938.
COMMERCIAL: 26500 + 4770 = 31270 → 3752.4 → 3752. Another rounding.
37500 + 6750 = 44250 → 5310.
53500 + 9630 = 63130 → 7575.6 → 7576. Rounding (round up… 7575.6 → 7576).
80500 + 14490 = 94990 → 11398.8 → 11399.
ESTATE: 21500 + 3870 = 25370 → 3044.4 → 3044.
31000 + 5580 = 36580 → 4389.6 → 4390.
47000 + 8460 = 55460 → 6655.2 → 6655.
71000 + 12780 = 83780 → 10053.6 → 10054.
APPEAL: 36000 + 6480 = 42480 → 5097.6 → 5098.
50000 + 9000 = 59000 → 7080.
72500 + 13050 = 85550 → 10266.
109000 + 19620 = 128620 → 15434.4 → 15434.

Great, plenty of rounding pins.

Also "rounding at each step" — the first step is urgency (always exact on these tables, so the stepwise rounding only manifests in the expedited step — I should document that in FINDINGS, and pin that the urgency step is exact on all current tables).

Now the date boundaries:
- 2020-12-31 → 2019 table.
- 2021-01-01 → 2021 table (inclusive).
- 2022-06-30 → 2021 table.
- 2022-07-01 → 2021 table (!) — off-by-one bug.
- 2022-07-02 → 2022 table.
- 2019-01-01 → 2019 table.

Also string comparison quirk: `openedAt: '2021-01-01T00:00:00Z'` — is that '2021-01-01T00:00:00Z' >= '2021-01-01'? Lexicographic: '2021-01-01' is a prefix of the longer string → the longer is greater → true. OK 2021. And '2022-07-01T...' > '2022-07-01' is also true → so 2022 table! Interesting: a datetime on 2022-07-01 gets the 2022 table (because the string is lexicographically greater than the bare date), whereas bare '2022-07-01' gets the 2021 table. That's an additional manifestation of the lexicographic comparison bug — great pin! Let me include it as a quirk test: same instant, different format, different table. That's a strong finding.

Wait, let me verify: '2022-07-01T00:00:00Z' > '2022-07-01'? Compare char by char: '2022-07-01' matches for 10 chars, then the first string has 'T' and the second ends. In JS, when one string is a prefix of the other, the shorter is "less than" the longer (like dictionary order). So `'2022-07-01T00:00:00Z' > '2022-07-01'` → true. So the 2022 table. Yes! So the same case, opened 2022-07-01, if the stored date has a time component, is billed 2022 rates, and without one, 2021 rates. A great quirk to pin.

Similarly '2021-01-01T00:00:00Z' >= '2021-01-01' is true → 2021 (same as bare date). Consistent.

Also, a malformed 'garbage' → 2022 table. '0000-00-00'? Less than '2021-01-01' → 2019.

Now degenerate inputs:
- `complexity: null` → throws Error('complexity is required').
- `complexity: undefined` → throws. (The interface says number | null, but the code also checks undefined.)
- `complexity: 0` → band 1 (silently).
- `complexity: -2` → band 1.
- `complexity: 5`, `complexity: 100` → band 4.
- `complexity: NaN` → band 1 (NaN is falsy → `!band` true). Let me verify: `!NaN` is true → band=1. Yes.
- `complexity: 2.5` → NaN bandFee (bands[1.5] is undefined) → total NaN.
- `type: 'UNKNOWN'` → STANDARD fallback.
- `type: ''` → STANDARD fallback.
- `type: 'standard'` (lowercase) → fallback.

Also, what if `openedAt` is empty string ''? `'' >= '2021-01-01'` is false → 2019 table. No problem, could pin but maybe not necessary. Stay focused.

Urgency edges (with fixed now):
- now = '2021-05-10'; deadline exactly 7 days ahead: '2021-05-17' → 7 <= 7 → urgent.
- 8 days: '2021-05-18' → not urgent.
- Same day: deadline = now → 0 → urgent.
- Past deadline: '2021-05-03' → -7 → urgent (quirk).
- No deadline → no urgency even if expedited.
- deadline present, no urgency (8 days) + expedited → expedited on bandFee alone.

Also interaction: urgency is based on `now`, not openedAt. Pin: case opened 2021-05-10, now = '2021-05-10' vs now = '2021-06-01' with deadline '2021-05-17' → in the former, urgent; in the latter, -15 → wait, past → urgent per quirk! Let me pick: now='2021-05-10', deadline='2021-05-17' → 7 → urgent. now='2021-05-18', deadline='2021-05-17' → -1 → urgent (past). To show that now matters and that it's not openedAt: deadline '2021-05-18': now '2021-05-10' → 8 → not urgent; now '2021-05-16' → 2 → urgent. Same case, different now → different fees. That pins the `now` dependency.

`now` defaults to actual clock — can't test deterministically without injecting now. Note in FINDINGS: `now` must be injected for deterministic billing; the default uses wall clock.

Also: the `now` parameter — the task says fake clock may be injected only via the existing optional `now` parameter. Good.

Now the structure of the test file. Layout convention: `test/<feature>.spec.ts`. The test is for `feeCalculator` at the repo root (workspace root). Import: `import { calculateFee } from '../feeCalculator.js'`? Since ESM with `"type": "module"`… but the tsconfig is module ESNext, moduleResolution bundler, noEmit. Vitest handles TS imports; for ESM + TS, typically `import { calculateFee } from '../feeCalculator.js'`? With Vitest's bundler resolution, `../feeCalculator` also works. The source file is `feeCalculator.ts` in the root. The test is in `test/`. The import path: `../feeCalculator.ts`? Does Vitest allow .ts extension imports? With `allowImportingTsExtensions`? Not set in tsconfig. Safest: `import { calculateFee, type CaseInput, type FeeBreakdown } from '../feeCalculator';` — Vitest/vite resolves extensionless TS imports fine. With moduleResolution bundler, extensionless is fine. Let's go with that.

Test file structure (Vitest):

```ts
import { describe, it, expect } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';
```

Write helpers:

```ts
const NOW = '2021-05-10'; // fixed fake clock for the whole suite
```

Actually different groups might need different `now` values. Provide a base input factory:

```ts
function makeCase(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2021-05-10',
    ...overrides,
  };
}
```

And a caller that always passes `now`:

```ts
function fee(c: CaseInput, now = NOW): FeeBreakdown {
  return calculateFee(c, now);
}
```

Wait — but some tests will verify the default `now` behavior? Non-deterministic; skip. All tests pass now explicitly (or the helper does so). This satisfies "deterministic suite; no real dates."

Hmm, but "no real dates" — I'm using dates like '2021-05-10'. Those are fixture dates, not "real" (i.e. not `new Date()`). The intent is: don't use the actual current time. Fixed strings are fine.

Now let me enumerate the test groups:

1. **Rate table selection — boundaries**
   - '2019-01-01' → '2019'
   - '2020-12-31' → '2019'
   - '2021-01-01' → '2021' (first revision inclusive)
   - '2021-12-31' → '2021'
   - '2022-06-30' → '2021'
   - '2022-07-01' → '2021' ⚠️ BUG: second revision one day late (test name flags it)
   - '2022-07-02' → '2022'
   - '2024-02-29' (valid) → '2022'. Maybe use '2023-03-15'.
   - Quirk: '2022-07-01T00:00:00Z' → '2022' (string lexicographic accident — the same instant as the bare date above is billed a different table)
   - Quirk: 'garbage' → '2022'; '2021/05/10' → ? '2021/05/10' >= '2021-01-01'? Compare: '2021' equal, then '/' (0x2F) vs '-' (0x2D): '/' > '-' → so '2021/05/10' > '2021-01-01' → true; then > '2022-07-01'? '2021/...' vs '2022-...': at index 3 '1' vs '2' → '1' < '2' → false → 2021 table. Could pin this too, but maybe just the 'garbage' and datetime ones are enough. I'll pin 'garbage' → 2022 and the datetime one. Maybe include '2021/05/10' → 2021 as well. I'll include as a quirk group with 3 cases.

2. **Base fees: all type × band × table (48 cases)** — table-driven test using `it.each` or nested describes. Pin exact bandFee and total (no urgency/expedited → total = bandFee, urgencyFee 0, expeditedFee 0).

Let me list all 48:

2019:
STANDARD: 12000, 18500, 27000, 41000
COMMERCIAL: 22000, 31500, 45000, 68000
ESTATE: 18000, 26000, 39500, 60000
APPEAL: 30000, 42000, 61000, 92000

2021:
STANDARD: 13500, 20500, 29500, 44500
COMMERCIAL: 24000, 34000, 48500, 73000
ESTATE: 19500, 28000, 42500, 64500
APPEAL: 32500, 45500, 66000, 99000

2022:
STANDARD: 15000, 22500, 32500, 49000
COMMERCIAL: 26500, 37500, 53500, 80500
ESTATE: 21500, 31000, 47000, 71000
APPEAL: 36000, 50000, 72500, 109000

Use `it.each` with rows [openedAt that picks the table, type, complexity, expected bandFee]. Example rows:

```ts
const BASE_FEE_CASES: Array<[string, string, number, string, number]> = [
  // [openedAt, type, complexity, table, expectedBandFee]
  ['2020-06-15', 'STANDARD', 1, '2019', 12000],
  ...
];
it.each(BASE_FEE_CASES)('table %s: %s complexity %s -> bandFee %i cents', (openedAt, type, complexity, table, bandFee) => { ... });
```

Better: 3 sub-groups, one per table, each with its own openedAt representative. I'll do one `it.each` with 48 rows; test name: `%#` or a template. Use template: `('%s opened %s -> table %s, bandFee %i')`.

Also assert the full breakdown shape in one of them? In each row, assert the whole object:

```ts
expect(fee(makeCase({ openedAt, type, complexity }))).toEqual({
  table, bandFee, urgencyFee: 0, expeditedFee: 0, total: bandFee,
});
```

That pins table selection + base fee + zeroed surcharges + total composition. 48 rows.

3. **Urgency multiplier**
   - Trigger: deadline within 7 days (inclusive). For each table: urgencyPct 15/15/18.
   - Edges with fixed now '2021-05-10' (pick table per openedAt — wait, urgency depends on now, not openedAt; so pick now relative to deadline; openedAt only affects the table. For a table-agnostic urgency pin, I can use the same now and vary openedAt to select the table. Example: now = '2021-05-10', deadline = '2021-05-17' (7 days):
     - 2019 table (openedAt '2019-06-01'): STANDARD b1: 12000, urgency 1800, total 13800.
     - 2021 (openedAt '2021-05-10'): 13500 + 2025 = 15525.
     - 2022 (openedAt '2022-07-02'): now must be ≥ deadline… wait, now is fixed '2021-05-10' but openedAt is '2022-07-02' — that's a case opened in the future relative to now. The code doesn't care; table selection is only by openedAt. That's fine but semantically weird. Alternative: for the 2022 urgency pin, use now = '2023-03-01', deadline '2023-03-08' (7 days), openedAt '2022-07-02'. That's cleaner.
   - Edge: exactly 7 days → urgent; 8 days → not urgent.
     - now '2021-05-10': deadline '2021-05-17' → urgent (7); '2021-05-18' → not (8).
   - Same day: deadline '2021-05-10' → 0 → urgent.
   - **QUirk: past deadline still urgent**: deadline '2021-05-03' → -7 → urgent. Test name flags it.
   - Urgency pct per table: 15, 15, 18 — pin with different amounts:
     - 2019: STANDARD b1 12000 → 1800 (15%).
     - 2021: STANDARD b1 13500 → 2025 (15%).
     - 2022: STANDARD b1 15000 → 2700 (18%).
   - **Quirk: urgency measured at `now` (calculation time), not at `openedAt`**: same case openedAt '2021-05-10', deadline '2021-05-18'; now '2021-05-10' → 8 days → not urgent; now '2021-05-16' → 2 days → urgent. Different totals (2021 table STANDARD b1: 13500 vs 15525).
   - No deadline → never urgent even if expedited.

4. **Expedited fee**
   - Applies when `expedited: true`; percent per table: 10/12/12.
   - Without urgency: STANDARD b1 2019: 12000, exp = 1200, total 13200.
   - With urgency: applied on bandFee + urgencyFee (compound).
   - `expedited: false` or absent → 0.
   - Pin for each table:
     - 2019 STANDARD b1: exp 1200 (10% of 12000).
     - 2021 STANDARD b1: 1620 (12% of 13500).
     - 2022 STANDARD b1: 1800 (12% of 15000).

5. **Rounding at each step**
   - Urgency step: pin that on the current tables, 15%/18% of all band fees land on integers (no rounding loss) — maybe 1 representative: the half-cent case only arises in expedited.
   - Half-up: 2019 STANDARD b2 urgent+expedited: urgency 2775, base+urgency 21275, 10% = 2127.5 → 2128 (Math.round rounds .5 up). total = 18500 + 2775 + 2128 = 23403.
   - Down-rounding: 2022 STANDARD b4 urgent+expedited: urgency 8820, sum 57820, 12% = 6938.4 → 6938. total 49000+8820+6938 = 64758.
   - Another down: 2022 COMMERCIAL b1: 26500+4770=31270, 12% = 3752.4 → 3752; total 26500+4770+3752 = 35022.
   - Round-up non-half: 2022 COMMERCIAL b3: 53500+9630=63130 → 7575.6 → 7576; total 70706.
   - And 2022 APPEAL b2: 50000+9000=59000 → 7080 exact; skip.
   - Also pin that rounding happens before expedited composition (i.e. expedited is on rounded urgency sum): in all these urgency is exact so we can't distinguish; to distinguish, we'd need a table where urgency rounds — none in current tables. So I'll document in FINDINGS that the first rounding step never fires on the current tables (all band fees multiples of 100, integer pcts) — the observable rounding is only in the expedited step. Good.

   Let me double check 2022 STANDARD b2: 22500, urgency 18% = 4050, sum 26550, 12% = 3186 exact. b3: 32500 + 5850 = 38350 → 4602 exact. b4: 49000 + 8820 = 57820 → 6938.4 → 6938. ✓.
   
   2022 COMMERCIAL b4: 80500 + 14490 = 94990 → 11398.8 → 11399; total 80500+14490+11399 = 106389. Include.
   2022 ESTATE b2: 31000+5580=36580 → 4389.6 → 4390; total 40970. Include.
   2022 APPEAL b1: 36000+6480=42480 → 5097.6 → 5098; total 47578. Include.
   2022 ESTATE b4: 71000+12780=83780 → 10053.6 → 10054; total 93834.
   2022 ESTATE b3: 47000+8460=55460 → 6655.2 → 6655; total 62115.
   2022 APPEAL b4: 109000+19620=128620 → 15434.4 → 15434; total 144054.

   I don't need to pin every rounded case, but "rounding at each step" is a required coverage area; ~6 rounding cases spanning up-round, half-up, and down-round is solid. Also pin the exact (no rounding) compound case to show the formula: 2021 APPEAL b4 urgent+expedited: 99000 + 14850 = 113850 → 12% = 13662; total 127512.

6. **Degenerate inputs**
   - `complexity: null` → throws 'complexity is required'.
   - `complexity: undefined` → throws. (The field is typed number | null; pass undefined via override — in TS, `makeCase({ complexity: undefined })` — the type is `number | null`, `Partial<CaseInput>` allows `complexity?: number | null`; assigning explicit undefined is OK under exactOptionalPropertyTypes? Not enabled. No problem.)
   - `complexity: 0` → band 1 fee (quirk: silent clamp). 2021 STANDARD: 13500.
   - `complexity: -2` → band 1.
   - `complexity: NaN` → band 1 (falsy path).
   - `complexity: 5` → band 4.
   - `complexity: 99` → band 4.
   - `complexity: 2.5` → **BUG**: NaN bandFee/total. Verify: `bands[1.5]` undefined → bandFee undefined. No deadline, no expedited: urgencyFee 0, expeditedFee 0, total: `undefined + 0 + 0` = NaN. table is still '2021'. So expect: bandFee undefined? Hmm — the object has `bandFee: undefined`. toEqual with `bandFee: undefined` — in vitest, does `toEqual` ignore undefined properties? Careful: `expect({a: undefined, b: 1}).toEqual({b: 1})` passes with toEqual (undefined props are treated as absent). Safer to assert with individual expectations: `expect(r.bandFee).toBe(undefined); expect(Number.isNaN(r.total)).toBe(true);` and `expect(r.urgencyFee).toBe(0)`. Also with expedited: true → expeditedFee is NaN (pctOf(undefined,12) → Math.round(NaN) → NaN). Pin both variants? One is enough + mention. I'll pin the plain one, plus note the total NaN.
   - Unknown type: 'UNKNOWN_TYPE' → STANDARD band fee. '' → STANDARD. 'standard' (lowercase) → STANDARD.

7. **Quirks to pin in the suite (test names flag)**:
   - "QUIRK: openedAt is compared as a string; '2022-07-01T00:00:00Z' selects the 2022 table, same instant as '2022-07-01' which selects 2021"
   - "QUIRK: non-ISO openedAt 'garbage' selects the 2022 table"
   - "QUIRK: a past deadline still earns the urgency fee"
   - "QUIRK: unknown/empty/lowercase case type silently falls back to STANDARD"
   - "QUIRK: zero, negative and NaN complexity silently clamp to band 1"
   - "BUG: case opened exactly 2022-07-01 is billed on the 2021 rates (off-by-one; REVISION_2022 applied with > instead of >=)"
   - "BUG: fractional complexity (2.5) produces NaN fees"

8. Also pin the shape of the returned object: `table` string, all 4 fields numeric, total = band + urgency + expedited (already covered by toEqual everywhere).

Now FINDINGS.md: document each finding with reproduction input, blast radius, proposed fix (not applied).

Findings list:
1. **BUG — 2022 revision off-by-one (exclusive boundary).** Reproduction: `calculateFee({type:'STANDARD', complexity:1, openedAt:'2022-07-01'}, '2022-07-01')` → table '2021', bandFee 13500 (expected 15000). The comparison `openedAt > REVISION_2022` excludes the revision date itself, while the 2021 transition uses `>=`. All cases opened 2022-07-01 (and 2022-07-01 with time, see #2, with the opposite accident) were billed old rates. Blast radius: all fees opened on 2022-07-01 in stored/audited history — understated relative to the intended 2022 schedule; e.g. STANDARD b1: 13500 vs 15000 (−1500), plus downstream urgency/expedited differ (15% vs 18%). The fix (change `>` to `>=`) would retroactively change those stored fees; requires billing sign-off and a data-reconciliation for every fee with opened_at = '2022-07-01'.

2. **QUIRK — table selection is lexicographic string comparison on `openedAt`.** Reproduction: `openedAt: '2022-07-01T00:00:00Z'` → table '2022'; same instant as '2022-07-01' → '2021'. Also 'garbage' → '2022' (any string starting with chars ≥ '2'), '2021/05/10' → '2021'. Blast radius: any row with non-ISO date format (full datetime, slashes) is bucketed by string accident; combined with #1, the "buggy day" 2022-07-01 has *both* fee schedules in history depending on stored format. Proposed fix: parse to a date (or normalize to YYYY-MM-DD) before comparison; validate input format.

3. **BUG — fractional complexity produces NaN.** Reproduction: `complexity: 2.5` → `bandFee` is `undefined` (array index 1.5), `total` is `NaN`. If expedited/urgent, the surcharges are NaN too. `!band` and `band < 1` don't catch non-integers in [1,4). Blast radius: any fee computed with a fractional complexity is NaN — if persisted, it poisons billing/reports (NaN in SUM, JSON `null`). Proposed fix: `band = Math.min(4, Math.max(1, Math.round(c.complexity)))` or reject non-integers explicitly.

Wait, actually — `bands[band - 1]` where band = 2.5 → index 1.5 → undefined. Yes.

Also `complexity: NaN` → clamps to band 1 via falsy. That's a quirk (#4).

4. **QUIRK — degenerate complexity silently clamps instead of throwing.** 0, negative, NaN → band 1; >4 → band 4. Only null/undefined throws. Blast radius: data-entry errors (0 typed) silently billed as band 1; can't distinguish "band 1" from "bad data" in history. Proposed fix: validate 1..4 integers, throw a typed error (or return a breakdown flag).

5. **QUIRK — unknown case type silently falls back to STANDARD.** `type: 'MARITIME'`, `''`, `'standard'` → STANDARD rates. Blast radius: imports from the old system with unknown types were silently billed as STANDARD — over- or under-billing relative to true type; can't be detected from stored breakdown (no marker for fallback). Proposed fix: throw or return an explicit `fellBack: true` marker; upstream validation (the `CaseType` union exists but the input accepts `string`).

6. **QUIRK — urgency is measured against `now` (calculation time), not `openedAt`.** Reproduction: same case, deadline 8 days from opening; now=opening → no urgency; now=opening+6d → urgency 15%. Blast radius: fees recomputed on different days (re-bills, audits, retries) produce different urgency — historical outputs depend on when they were computed, not when the case was opened. Also makes the default (wall clock) non-deterministic. Proposed fix: define urgency against a documented reference (e.g. openedAt or a snapshot at first computation) and persist `now` alongside the fee.

7. **QUIRK — past deadlines still earn urgency.** Reproduction: now '2021-05-10', deadline '2021-05-03' → daysBetween -7 ≤ 7 → urgency. Blast radius: overdue cases keep the surcharge forever (per recomputation). Proposed fix: `0 <= days <= 7` (or `days >= 0 && days <= 7`).

8. **QUIRK — rounding at each step (Math.round, half up) with expedited compounding on rounded urgency.** Pin: 2019 STANDARD b2 urgent+expedited → expedited 2127.5 → 2128. Blast radius: deterministic but not "business-obvious": a future change to round only the total will change many historical fees (e.g. the 2127.5 case). Also the first step (urgency) never rounds on current tables (all band fees multiples of 100; pcts 15/18 integer), so any fix that "simplifies" pctOf must preserve the expedited-step rounding. Proposed fix (if a change is ever needed): document the stepwise rounding as the contract; only change with billing reconciliation.

Maybe also mention: `table` is derived by object identity — no problem, not a finding.

Also: `daysBetween` uses date-only UTC parsing — deterministic across timezones for ISO date-only strings (ES spec: date-only → UTC). Not a finding, or a minor note. Skip or brief note under #2? I'll skip; keep findings focused. Maybe one line in the suite's header comment.

Now, "at least one genuine bug" — I have #1 (boundary off-by-one) and #3 (NaN). Good, and the task says "quirks and at least one genuine bug. Pin as-is with test names that flag them."

Test names: use prefixes `BUG:` and `QUIRK:` in test titles.

Now, let me write the test file carefully with exact expected values. Let me recompute every number I'll use.

Constants:
- NOW_2021 = '2021-05-10'
- For 2022 tests, NOW_2022 = '2023-03-15'; deadline '2023-03-22' (7 days), '2023-03-23' (8 days).

Let me verify day counts: 2021-05-10 → 2021-05-17 = 7 days ✓ (May has 31; 10+7=17). 2021-05-18 = 8 ✓. 2021-05-03 = −7 ✓.
2023-03-15 → 2023-03-22 = 7 ✓. 2023-03-23 = 8 ✓.

**Group: base fees (48 rows).** Representative openedAt: 2019 → '2020-06-15'; 2021 → '2021-06-15'; 2022 → '2023-03-15'. now = any fixed value, e.g. '2021-05-10' (no deadline → urgency irrelevant). Actually since no deadline, now value is irrelevant; still pass for discipline. Use one shared NOW = '2021-05-10'. Hmm, but for the 2022 table with now 2021-05-10 and openedAt '2023-03-15' (future opening) — the code doesn't care; fine, but slightly weird. It's a unit pin of table selection, acceptable. Or give each row its own now? The `now` parameter defaults… I could make the helper not pass now when the test doesn't care — no, discipline: always pass. The weirdness is harmless; I'll add a comment.

Actually cleaner: for base fee rows, no deadline and no expedited → urgency/expedited are structurally 0. The now value doesn't matter. Use NOW for all. Fine.

it.each row format: `[openedAt, type, complexity, expected]` where expected = bandFee. And table is derived from openedAt — I'll include the table name in the row for a clearer test name.

Let me write all 48 rows:

2019 (openedAt '2020-06-15'):
- STANDARD b1 12000, b2 18500, b3 27000, b4 41000
- COMMERCIAL b1 22000, b2 31500, b3 45000, b4 68000
- ESTATE b1 18000, b2 26000, b3 39500, b4 60000
- APPEAL b1 30000, b2 42000, b3 61000, b4 92000

2021 (openedAt '2021-06-15'):
- STANDARD 13500, 20500, 29500, 44500
- COMMERCIAL 24000, 34000, 48500, 73000
- ESTATE 19500, 28000, 42500, 64500
- APPEAL 32500, 45500, 66000, 99000

2022 (openedAt '2023-03-15'):
- STANDARD 15000, 22500, 32500, 49000
- COMMERCIAL 26500, 37500, 53500, 80500
- ESTATE 21500, 31000, 47000, 71000
- APPEAL 36000, 50000, 72500, 109000

**Group: rate-table boundaries.**

```ts
it('opened 2020-12-31 -> 2019 table', ...)  // expect r.table === '2019'
it('opened 2021-01-01 -> 2021 table (first revision is inclusive)', ...)
it('opened 2022-06-30 -> 2021 table', ...)
it('BUG: opened 2022-07-01 -> 2021 table (second revision skips its own effective date)', ...) // bandFee 13500 STANDARD b1
it('opened 2022-07-02 -> 2022 table', ...)
```

Use STANDARD b1 so the bandFee also pins the rate diff: 2021→13500, 2022→15000.

**Group: lexicographic openedAt quirk.**

```ts
it('QUIRK: openedAt "2022-07-01T00:00:00Z" -> 2022 table, although the same instant as "2022-07-01" -> 2021', ...)
it('QUIRK: non-ISO openedAt "garbage" sorts after both revisions -> 2022 table', ...)
```

Verify 'garbage': 'garbage' >= '2021-01-01'? 'g'(103) vs '2'(50) → true. 'garbage' > '2022-07-01' → true → 2022 ✓.
'2022-07-01T00:00:00Z' > '2022-07-01' → prefix → longer is greater → true → 2022 ✓. bandFee 15000.

**Group: urgency.**

Fixed now = '2021-05-10' (for 2019/2021 tables), '2023-03-15' (for 2022).

- Edges:
  - deadline = '2021-05-17' (7 days) → urgency on. 2021 STANDARD b1: urgency 2025, total 15525.
  - deadline = '2021-05-18' (8 days) → urgency off. total 13500.
  - deadline = '2021-05-10' (0 days) → urgency on.
  - deadline = '2021-05-03' (−7 days) → **QUIRK** urgency on. total 15525.
- pct pin per table:
  - 2019 (opened '2020-06-15', now '2021-05-10', deadline '2021-05-17'): 12000 → 1800, total 13800.
  - 2022 (opened '2023-03-15', now '2023-03-15', deadline '2023-03-22'): 15000 → 2700, total 17700.
- now-dependence quirk:
  - Case: opened '2021-05-10', deadline '2021-05-18'. now '2021-05-10' → 8 → off (13500). now '2021-05-16' → 2 → on (15525).
- No deadline:
  - opened '2021-05-10', now '2021-05-10', expedited false → 0 urgency. (Covered by base rows anyway.)

**Group: expedited.**

- 2019 STANDARD b1, no urgency: exp 10% → 1200, total 13200. (opened '2020-06-15', now arbitrary '2021-05-10', no deadline)
- 2021 STANDARD b1, no urgency: 12% → 1620, total 15120.
- 2022 STANDARD b1, no urgency: 12% → 1800, total 16800. (now '2023-03-15')
- With urgency (compound):
  - 2019 STANDARD b1: 12000 + 1800 = 13800 → 10% 1380 → total 15180.
  - 2021 STANDARD b1: 15525 → 12% = 1863 → total 17388. Verify 15525*0.12 = 1863.0 ✓.
  - 2022 STANDARD b1: 17700 → 12% = 2124 → total 19824. ✓
- expedited: false → 0 (covered by base + urgency groups).

**Group: rounding.**

Rows (type, band, table, openedAt, now, deadline) → expected urgencyFee, expeditedFee, total:

1. Half-up: 2019 STANDARD b2: opened '2020-06-15', now '2021-05-10', deadline '2021-05-17', expedited true.
   urgency = 18500*0.15 = 2775. sum = 21275. exp = 2127.5 → 2128. total = 18500+2775+2128 = 23403.
2. Down-round .4: 2022 STANDARD b4: opened '2023-03-15', now '2023-03-15', deadline '2023-03-22'.
   urgency = 49000*0.18 = 8820. sum = 57820. exp = 6938.4 → 6938. total = 49000+8820+6938 = 64758.
3. Down-round .4: 2022 COMMERCIAL b1: 26500, urgency 4770, sum 31270, exp 3752.4 → 3752, total 35022.
4. Up-round .6: 2022 COMMERCIAL b3: 53500, urgency 9630, sum 63130, exp 7575.6 → 7576, total 70706.
5. Up-round .8: 2022 COMMERCIAL b4: 80500, urgency 14490, sum 94990, exp 11398.8 → 11399, total 106389.
6. Exact (no rounding): 2021 APPEAL b4: opened '2021-06-15', now '2021-05-10', deadline '2021-05-17': 99000, urgency 14850, sum 113850, exp 13662, total 127512.
7. Or 2022 ESTATE b2: 31000, 5580, 36580, 4389.6→4390, total 40970.

Also pin that the urgency step itself is exact (no rounding loss) on current tables — one assertion: for 2022 APPEAL b4: urgency 19620 exactly (109000*18% = 19620). It's included in the base matrix anyway. I'll add a test: "urgency step is exact on every current band fee (all multiples of 100, integer pcts)" — can I assert via a loop over all 48? I can compute the expectation inside the test: `expect(r.urgencyFee).toBe(Math.floor(r.bandFee * pct))`… that's re-deriving from the formula, not pinning. Better: the 48 base rows + explicit urgency rows pin the values; plus a table-driven assertion that every bandFee is a multiple of 100? I can assert in the base group: `expect(bandFee % 100).toBe(0)` as a sanity on the pinned data. That's fine and deterministic.

**Group: degenerate inputs.**

- null complexity → `expect(() => fee(makeCase({complexity: null}))).toThrow('complexity is required')`.
- undefined → same.
- 0 → 2021 STANDARD b1 13500.
- -2 → 13500.
- NaN → 13500.
- 5 → band 4: 44500 (2021 STANDARD b4).
- 99 → 44500.
- 2.5 → BUG: NaN. Assert: `r.table === '2021'`, `r.bandFee` undefined, `Number.isNaN(r.total)`. Hmm, also with expedited: true → expeditedFee NaN. Second test with expedited: `Number.isNaN(r.expeditedFee)` and total NaN.
- Unknown type: 'MARITIME' → 13500 (2021 STANDARD b1). '' → 13500. 'standard' → 13500.
- Also: unknown type + band interaction — skip.

Also, `deadline` present but empty string? `c.deadline` is falsy → no urgency. Could pin: deadline '' → no urgency. Type is `string | undefined`; '' is a string. Quirky? `if (c.deadline && ...)` — empty string is falsy → skipped. Pin as a quirk? Minor. I'll add a small test "deadline '' is treated as absent" — actually that's just normal falsy handling; the task asks for degenerate inputs (zero, negative, unknown type) — I have those. I'll keep the '' deadline pin as a bonus quirk… I want to keep the suite focused; but more pins = more safe. I'll include it briefly.

Now — should I also assert the shape keys of the breakdown? `toEqual` on the full object in most tests already pins the shape (exactly 4 keys). Good — toEqual is strict on extra keys.

**Test names that flag quirks/bugs:** I'll use `BUG:` / `QUIRK:` prefixes.

Now let me also think: the test file needs `FeeBreakdown`/`CaseInput` types imported. Yes, type-only imports.

Now, let me double check a few computed values I'll assert:

- 2021 STANDARD b1: 13500. 15% = 2025 ✓ (13500*0.15: 13500/20*3 = 675*3=2025 ✓).
- 2021 b1 urgent+expedited: 15525 * 0.12: 15525*12 = 186300 /100 = 1863 ✓. total 13500+2025+1863 = 17388 ✓.
- 2019 b1: 1800; 13800*0.10 = 1380 ✓; total 12000+1800+1380=15180 ✓.
- 2022 b1: 2700; 17700*0.12 = 2124 ✓; total 15000+2700+2124=19824 ✓.
- 2022 COMM b1: 26500*0.18 = 4770 ✓. 31270*0.12 = 3752.4 → 3752 ✓. total 26500+4770+3752 = 35022 ✓.
- 2022 COMM b3: 53500*0.18 = 9630 ✓ (53500*18=963000/100=9630 ✓). 63130*0.12=7575.6→7576 ✓. total 53500+9630+7576 = 70706 ✓.
- 2022 COMM b4: 80500*0.18 = 14490 ✓. 94990*0.12 = 11398.8 → 11399 ✓. total 80500+14490+11399 = 106389 ✓.
- 2022 STD b4: 49000*0.18 = 8820 ✓. 57820*0.12 = 6938.4 → 6938 ✓. total 64758 ✓.
- 2021 APPEAL b4: 99000*0.15 = 14850 ✓. 113850*0.12 = 13662 ✓. total 99000+14850+13662 = 127512 ✓.
- 2022 ESTATE b2: 31000*0.18 = 5580 ✓. 36580*0.12 = 4389.6 → 4390 ✓. total 31000+5580+4390 = 40970 ✓.

Boundary pins (STANDARD b1):
- '2020-12-31' → table '2019', bandFee 12000.
- '2021-01-01' → '2021', 13500.
- '2022-06-30' → '2021', 13500.
- '2022-07-01' → '2021', 13500 (BUG pin).
- '2022-07-02' → '2022', 15000.
- Also '2019-01-01' → '2019' 12000 (earliest).

Urgency now-dependence quirk numbers: opened '2021-05-10' (2021 table), STANDARD b1, deadline '2021-05-18':
- now '2021-05-10': 8 days → off → total 13500.
- now '2021-05-16': 2 days → on → 13500+2025 = 15525.

Past-deadline quirk: now '2021-05-10', deadline '2021-05-03' → −7 → on → 15525.

Also, should I pin that the urgency check uses `now` even when `now` < openedAt (past calculation time)? Not needed.

Fractional complexity test:
```ts
const r = fee(makeCase({ openedAt: '2021-06-15', complexity: 2.5 }));
expect(r.table).toBe('2021');
expect(r.bandFee).toBeUndefined();
expect(r.urgencyFee).toBe(0);
expect(r.expeditedFee).toBe(0);
expect(Number.isNaN(r.total)).toBe(true);
```
And with expedited:
```ts
const r2 = fee(makeCase({ openedAt: '2021-06-15', complexity: 2.5, expedited: true }));
expect(Number.isNaN(r2.expeditedFee)).toBe(true);
expect(Number.isNaN(r2.total)).toBe(true);
```

Wait: `makeCase` with `complexity: 2.5` — type is `number | null`, fine.

NaN complexity: `makeCase({ complexity: NaN })` → band 1 → 13500.

Edge: `complexity: 4.9`? `band > 4` → 4. `complexity: 1.2`? → `bands[0.2]` → undefined → NaN! Another fractional case in [1,4). Maybe pin 1.2 → NaN too? The 2.5 case is representative; I'll mention the range in FINDINGS. One test is enough; maybe also 3.999? No, stay focused.

Unknown type:
- 'MARITIME' → 13500 (2021, b1).
- '' → 13500.
- 'standard' → 13500.
- Also unknown type with 2022 table → STANDARD 2022 b1 15000 (shows the fallback is per-table). Maybe include.

Now the "table" string identity: already pinned everywhere via `toEqual` full object.

Now, the test file. Let me also think about file name and import.

Repo layout per convention: `test/<feature>.spec.ts`. I'll use `test/fee-calculator.spec.ts`. Import: `from '../feeCalculator'`.

Hmm wait — is the feeCalculator.ts at the workspace root? The reference shows `workspace/feeCalculator.ts`. And tsconfig `"include": ["*.ts"]` — only root-level TS files. So feeCalculator.ts is at the root, tests in `test/`. Import path `../feeCalculator`. With moduleResolution "bundler" and vitest, this works.

Should I add a vitest config? The convention block says Vitest for tests, pnpm. The workspace doesn't show a package.json (not provided). Since "deliver every file the solution needs" — a vitest.config.ts is not strictly needed; vitest's defaults find `test/**/*.spec.ts`. I'll not add it. If the harness has its own setup, adding one could conflict. The deliverables per the task: "the test suite + FINDINGS.md." Just two files.

FINDINGS.md location: at the repo root — `FINDINGS.md`.

Now let me write the FINDINGS.md content: structure:

```md
# FINDINGS — feeCalculator.ts characterization

Context: suite pins current behavior; findings below are pinned as-is by flagged tests (names prefixed BUG:/QUIRK:). None of the proposed fixes are applied. All reproductions use the fake `now` clock via the existing optional parameter.

## 1. BUG — 2022 rate revision misses its own effective date
- Where: tableFor(), `openedAt > REVISION_2022` (strict >), while the 2021 cut uses `>=`.
- Reproducing input: calculateFee({ type:'STANDARD', complexity:1, openedAt:'2022-07-01' }, '2022-07-01') → table '2021', bandFee 13500. A day later, '2022-07-02' → '2022', 15000.
- Effect: every case opened exactly 2022-07-01 was billed the 2021 schedule: base fees ~10–15% lower, urgency 15% instead of 18%, expedited 12% on a smaller base.
- Blast radius: stored/audited fees with opened_at = '2022-07-01'. Under-charged relative to the intended schedule.
- Pinned by: 'BUG: ...'
- Proposed fix (not applied): `openedAt >= REVISION_2022`. Requires billing reconciliation for all 2022-07-01 rows before applying.

## 2. QUIRK — table selection is lexicographic string comparison
- Reproduction: '2022-07-01T00:00:00Z' → 2022; same instant as '2022-07-01' → 2021. 'garbage' → 2022. '2021/05/10' → 2021.
- Blast radius: combined with #1, the same calendar day (2022-07-01) has both schedules in history depending on the stored format; non-ISO rows (slash dates, datetimes) are bucketed by accident of string sort, not by date.
- Proposed fix: normalize/parse openedAt to a Date (or strict YYYY-MM-DD validation) before comparison.

## 3. BUG — fractional complexity → NaN fees
- Reproduction: complexity 2.5 → bandFee undefined (array index 1.5), total NaN; with expedited: expeditedFee NaN too.
- Also: complexity NaN → silently band 1 (falsy).
- Blast radius: any such fee, if persisted, is NaN/null in billing aggregates and audits; the breakdown carries no error marker.
- Proposed fix: integer validation or Math.round clamp to 1..4; reject out-of-range non-integers with a typed error.

## 4. QUIRK — degenerate complexity silently clamps
- 0, negative → band 1; >4 → band 4; only null/undefined throws.
- Blast radius: data-entry 0s billed as band 1, indistinguishable in history from real band-1 cases.
- Proposed fix: validate and throw a typed error (or a fallback flag in the breakdown).

## 5. QUIRK — unknown case type falls back to STANDARD
- 'MARITIME', '', 'standard' → STANDARD rates of the selected table; no flag in output.
- Blast radius: old-system imports silently billed as STANDARD (over/under); CaseType union is decorative — input is a plain string.
- Proposed fix: throw on unknown type, or persist an explicit fallback marker.

## 6. QUIRK — urgency is anchored to `now`, not openedAt
- Reproduction: same case (opened 2021-05-10, deadline 2021-05-18): now 2021-05-10 → no urgency (13500); now 2021-05-16 → urgency (15525).
- Also: with no `now`, the wall clock is used → the same stored case re-billed on different days yields different fees; the suite always injects `now`.
- Blast radius: recomputation (audit, re-bill, migration) is not reproducible from case data alone.
- Proposed fix: anchor urgency to a documented, persisted reference date.

## 7. QUIRK — past deadline still earns urgency
- Reproduction: now 2021-05-10, deadline 2021-05-03 → daysBetween = −7 ≤ 7 → urgency.
- Blast radius: overdue cases keep earning the surcharge on every recomputation.
- Proposed fix: require 0 ≤ days ≤ 7.

## 8. QUIRK — stepwise Math.round (half-up); expedited compounds on the rounded urgency
- Reproduction: 2019 STANDARD band 2, urgent+expedited → urgency 2775, expedited on 21275 → 2127.5 → 2128 (total 23403). Down-rounds: 2022 STANDARD b4 → 6938.4 → 6938.
- Note: on the current tables, the urgency step never rounds (all band fees are multiples of 100; pcts are integers) — only the expedited step rounds. A "cleanup" that rounds only the total would silently shift many stored fees.
- Proposed fix: treat stepwise rounding as the contract; change only with a full historical reconciliation.
```

Also note about the `table` field: derived by object identity — no finding.

Maybe also add: `deadline` empty string is treated as absent (falsy). Minor, either skip in FINDINGS or one line under #7? I'll skip; the test still pins. Actually, let me not add the '' deadline test to keep scope tight… hmm, "degenerate inputs" — zero, negative, unknown type are specified. I have them + NaN + fractional + undefined. That's enough. I'll drop the '' deadline pin. Actually, it's a one-liner and cheap… the discipline says do exactly what's asked; extra degenerate pins are in-spirit ("degenerate inputs" list is illustrative). I'll include the undefined complexity pin (which is explicitly in the code path), drop the '' deadline.

Wait, one more consideration: the `now` parameter — the task says fake clock may be injected only via the existing optional `now` parameter. My tests always pass it. Good. "No real dates" — all dates are fixed strings. Good. "No randomness" — none.

Now let me write the actual test file. Style: strict TS. Let me draft.

```ts
// test/fee-calculator.spec.ts
//
// Characterization suite for feeCalculator.ts (in production since 2019).
//
// Purpose: pin the module's CURRENT behavior -- including quirks and at
// least one genuine bug -- so the planned modifications next month cannot
// silently change audited fee history. Quirks/bugs are pinned AS THEY ARE
// and flagged in the test name with a `QUIRK:` or `BUG:` prefix. See
// FINDINGS.md for each item: reproducing input, blast radius, and the
// proposed (NOT applied) fix.
//
// Determinism: the fake clock is injected ONLY through the module's
// existing optional `now` parameter. No `new Date()` ever runs in this
// suite; every date is a fixed string.
//
// Production code is untouched.
```

Then imports, helpers.

```ts
import { describe, expect, it } from 'vitest';

import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';

/** Fixed reference clock. The suite never omits `now`. */
const NOW = '2021-05-10';

function makeCase(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2021-06-15',
    ...overrides,
  };
}

function fee(input: CaseInput, now: string = NOW): FeeBreakdown {
  return calculateFee(input, now);
}
```

Base fees:

```ts
type BaseRow = {
  openedAt: string;
  type: string;
  complexity: number;
  table: '2019' | '2021' | '2022';
  bandFee: number;
};

const BASE_ROWS: BaseRow[] = [
  // 2019 schedule (opened before 2021-01-01)
  { openedAt: '2020-06-15', type: 'STANDARD', complexity: 1, table: '2019', bandFee: 12000 },
  ...
];

describe('base fee: every case type x complexity band x rate table', () => {
  it.each(BASE_ROWS)(
    'table $table: $type band $complexity opened $openedAt -> bandFee $bandFee cents, no surcharges',
    ({ openedAt, type, complexity, table, bandFee }) => {
      expect(fee(makeCase({ openedAt, type, complexity }))).toEqual({
        table,
        bandFee,
        urgencyFee: 0,
        expeditedFee: 0,
        total: bandFee,
      });
    },
  );
});
```

Note: `it.each` with object rows and `$prop` interpolation works in Vitest (which mirrors Jest). Vitest supports `$var` templates in titles for object params. Yes, Vitest supports it (jest-style). To be safe, I could also use a positional template with `#%`… Vitest docs: you can use `$variable` for object rows. I'm fairly confident Vitest supports it. Alternative safer: `it.each(BASE_ROWS)('$#', ...)`? `$#` is the index. Hmm. Let me use a function name: `it.each(BASE_ROWS)('row $%# ...')`? Jest supports `#%` (index) in newer versions. To be maximally safe across vitest versions, I can build the title from a positional row:

Use a tuple row: `[openedAt, type, complexity, table, bandFee]` and title `'$1/$3/$2 -> $4'`? Positional `$1` is jest 29.1+; vitest supports `$1` too I think. Safest universally: build the title via a callback? `it.each`'s title can't be a function.

Simplest robust approach: nested describes per table, and inside a flat `it.each` over a 2-tuple `[type, complexity, bandFee]` with title `'$0 band $1 -> $2 cents'` — `$0`, `$1`, `$2` positional placeholders are supported in Jest and Vitest. I'm confident Vitest supports `$1..` and `$#`? Let me recall vitest's `each` docs: "You can use `$1`, `$2`... in the title" — yes, vitest's each supports `$1` style and `#` (index) and `$#`. I've seen vitest docs: `it.each([['a'], ['b']])('test $1', ...)`. Yes.

Let me do per-table describes with 3-tuples:

```ts
describe('base fee: every case type x complexity band, 2019 schedule', () => {
  it.each([
    ['STANDARD', 1, 12000],
    ['STANDARD', 2, 18500],
    ...
  ])('%s band %i -> %i cents', (type, complexity, bandFee) => {
    expect(fee(makeCase({ openedAt: '2020-06-15', type, complexity }))).toEqual({
      table: '2019', bandFee, urgencyFee: 0, expeditedFee: 0, total: bandFee,
    });
  });
});
```

`%i` in titles: does vitest's fmt support `%i`? Jest's printf supports %i/%d. Vitest uses similar fmt. To be safe, I'll use `$1 band $2 -> $3 cents` positional strings, avoiding printf verbs entirely.

Titles: `'$1 band $2 -> $3 cents'`.

Good, robust.

Boundary group:

```ts
describe('rate table selection: revision date boundaries', () => {
  it('opened 2019-01-01 -> 2019 schedule', () => {
    expect(fee(makeCase({ openedAt: '2019-01-01' }))).toMatchObject({ table: '2019', bandFee: 12000 });
  });
  it('opened 2020-12-31 (day before first revision) -> 2019 schedule', ...);
  it('opened 2021-01-01 (first revision, inclusive edge) -> 2021 schedule', ...13500);
  it('opened 2022-06-30 (day before second revision) -> 2021 schedule', ...13500);
  it('BUG: opened 2022-07-01 (second revision effective date) -> 2021 schedule, not 2022', () => {
    // Pinned as-is: tableFor() uses `openedAt > REVISION_2022`, so the
    // revision day itself still bills 2021 rates. See FINDINGS.md #1.
    expect(fee(makeCase({ openedAt: '2022-07-01' }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });
  it('opened 2022-07-02 (day after second revision) -> 2022 schedule', ...15000);
  it('opened 2023-11-30 -> 2022 schedule (no later revision exists)', ...15000);
});
```

String-comparison quirk:

```ts
describe('QUIRK: openedAt is compared as a raw string (lexicographic)', () => {
  it('the same instant as "2022-07-01" but with a time part -> 2022 schedule', () => {
    // '2022-07-01T00:00:00Z' > '2022-07-01' lexicographically (longer string
    // with the same prefix), so a datetime-stamped copy of the "buggy day"
    // bills 2022 rates while the bare date bills 2021 rates. FINDINGS.md #2.
    expect(fee(makeCase({ openedAt: '2022-07-01T00:00:00Z' }))).toMatchObject({ table: '2022', bandFee: 15000 });
  });
  it('non-ISO openedAt "garbage" sorts after both revisions -> 2022 schedule', () => {
    expect(fee(makeCase({ openedAt: 'garbage' }))).toMatchObject({ table: '2022', bandFee: 15000 });
  });
  it('slash-separated openedAt "2021-05-10" -> 2021 schedule by string accident', () => {
    expect(fee(makeCase({ openedAt: '2021/05-10' }))) ... 
  });
});
```

Wait '2021/05-10': compared to '2021-01-01': chars '2021' equal, then '/' (47) vs '-' (45) → '/' > '-' → greater → then vs '2022-07-01': at index 3 '1' < '2' → not greater → 2021. ✓. Let me use '2021/05/10'.

Urgency group:

```ts
describe('urgency surcharge (deadline within 7 days of `now`)', () => {
  const NOW = '2021-05-10'; // local const shadows outer; fine, or reuse outer
```

Actually the outer NOW = '2021-05-10' works for 2019/2021 cases; for 2022 table cases I need a now in the 2023 range? No — now can be any date; urgency only cares about now→deadline. The table is picked by openedAt. So I can use the same NOW '2021-05-10' and deadline '2021-05-17' even for openedAt '2023-03-15' (a case opened in the future). Semantically weird, but the code doesn't validate. For readability, I'll use a 2023 now for the 2022 table urgency rows: now '2023-03-15', deadline '2023-03-22'.

Tests:

```ts
it('deadline exactly 7 days before `now` -> urgency applies (inclusive edge)', () => {
  // 2021 schedule: STANDARD band 1, 15%
  expect(fee(makeCase({ openedAt: '2021-06-15', deadline: '2021-05-17' }))).toEqual({
    table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
  });
});
```

Wait: openedAt '2021-06-15' with now '2021-05-10' — now is before openedAt. Code-wise fine. But semantically odd (calculated before the case was opened). Use openedAt '2021-05-01'? That's 2021 table (>= 2021-01-01) ✓ and before now ✓. deadline '2021-05-17' is 7 days from now. Good: opened '2021-05-01'.

Let me standardize: for 2021-table urgency tests, openedAt '2021-05-01', now '2021-05-10'.

- 8 days: deadline '2021-05-18' → no urgency: total 13500.
- Same day: deadline '2021-05-10' → urgency 2025.
- Past: deadline '2021-05-03' → QUIRK urgency 2025.
- pcts per table:
  - 2019: opened '2020-05-01', now '2021-05-10', deadline '2021-05-17': 12000 → 1800, total 13800.
  - 2022: opened '2023-03-01', now '2023-03-15', deadline '2023-03-22': 15000 → 2700 (18%), total 17700.
- now-anchored quirk:
```ts
it('QUIRK: urgency is measured against `now` (calc time), not openedAt', () => {
  const input = makeCase({ openedAt: '2021-05-10', deadline: '2021-05-18' });
  expect(fee(input, '2021-05-10').total).toBe(13500); // 8 days out -> no urgency
  expect(fee(input, '2021-05-16').total).toBe(15525); // 2 days out -> urgency
});
```
- No deadline → no urgency even with expedited:
```ts
it('no deadline -> no urgency, even when expedited', () => {
  expect(fee(makeCase({ openedAt: '2021-05-01', expedited: true }))).toEqual({
    table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120,
  });
});
```
13500*0.12 = 1620 ✓ total 15120 ✓.

Expedited group:

```ts
describe('expedited surcharge (pct on band fee + urgency fee)', () => {
  it('2019: 10% of band fee when not urgent', () => {
    expect(fee(makeCase({ openedAt: '2020-05-01', expedited: true }))).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 1200, total: 13200,
    });
  });
  it('2021: 12% of band fee when not urgent', () => {
    ... 1620, 15120
  });
  it('2022: 12% of band fee when not urgent', () => {
    opened '2023-03-01', now '2023-03-15' → 1800, 16800
  });
  it('compounds on urgency: pct is applied to bandFee + urgencyFee', () => {
    // 2021, urgent: (13500 + 2025) * 12% = 1863
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-17', expedited: true }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 1863, total: 17388,
    });
    // 2019, urgent: (12000 + 1800) * 10% = 1380
    expect(fee(makeCase({ openedAt: '2020-05-01', deadline: '2021-05-17', expedited: true }))).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 1380, total: 15180,
    });
    // 2022, urgent: (15000 + 2700) * 12% = 2124
    expect(fee(makeCase({ openedAt: '2023-03-01', deadline: '2023-03-22', expedited: true }), '2023-03-15')).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 2700, expeditedFee: 2124, total: 19824,
    });
  });
});
```

Rounding group:

```ts
describe('rounding: Math.round (half-up) at each step; expedited compounds on the rounded urgency', () => {
  it('half-cent rounds UP: 2019 STANDARD band 2 urgent+expedited -> 2127.5 -> 2128', () => {
    expect(fee(makeCase({ openedAt: '2020-05-01', complexity: 2, deadline: '2021-05-17', expedited: true }))).toEqual({
      table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403,
    });
  });
  it('fractional cents round DOWN: 2022 STANDARD band 4 urgent+expedited -> 6938.4 -> 6938', ...);
  it('fractional cents round DOWN: 2022 COMMERCIAL band 1 -> 3752.4 -> 3752', ...);
  it('fractional cents round UP: 2022 COMMERCIAL band 3 -> 7575.6 -> 7576', ...);
  it('fractional cents round UP: 2022 COMMERCIAL band 4 -> 11398.8 -> 11399', ...);
  it('fractional cents round DOWN: 2022 ESTATE band 2 -> 4389.6 -> 4390', ...);
  it('exact sum needs no rounding: 2021 APPEAL band 4 urgent+expedited -> 13662', ...);
  it('the urgency step itself is exact on every current band fee (multiples of 100 x integer pct)', () => {
    // pin: 15% and 18% of every band fee land on whole cents; the only
    // step that can round today is the expedited step.
    const samples: Array<[string, number, number, number]> = [ ... ];
```

Hmm, for the last one, I could loop over all 48 band fees × pcts and assert integrality — but the expected values are the data itself. Alternative: assert a few explicit: e.g. 2022 APPEAL b4: urgency 19620 (109000*0.18); 2019 APPEAL b4: 13800. And a generic check: for each row in BASE_ROWS, urgency = bandFee * pct is an integer — but that computes the expectation from the formula (self-fulfilling). Better: assert the pinned sample values + a note. Actually, a clean behavioral pin: "on the current tables, urgencyFee is always an integer number of cents, and equals pct% of bandFee exactly" — I can assert `Number.isInteger(r.urgencyFee)` and `r.urgencyFee * 100 === r.bandFee * pct` for a sweep of all 48 combos. The second assertion re-derives, but the first (integrality) + the explicitly pinned values in the urgency group give both a pin and a general statement. I'll do the sweep with the exact-equality assertion — it documents the invariant that "the urgency step never loses cents on the current tables," which is a behavioral invariant worth pinning (if the table data changes to non-multiples-of-100, this test will start showing rounding). Hmm, but `urgencyFee*100 === bandFee*pct` is exactly `Math.round(x) === x`, i.e. "no rounding occurred" — that's a behavioral property (integrality), fine to assert. I'll include the sweep:

```ts
it('urgency step loses no cents on any current band fee (integer pct of a multiple of 100)', () => {
  const pctByTable: Record<string, number> = { '2019': 15, '2021': 15, '2022': 18 };
  for (const { openedAt, type, complexity, table, bandFee } of BASE_ROWS) {
    const r = fee(makeCase({ openedAt, type, complexity, deadline: '2021-05-17' }), '2021-05-10');
    expect(r.urgencyFee * 100).toBe(bandFee * pctByTable[table]);
  }
});
```

Wait — deadline '2021-05-17' with now '2021-05-10' → 7 days → urgency on for all. ✓. For 2022-table rows (openedAt '2023-03-15'), now '2021-05-10' is before the opening — irrelevant to the code. OK. But hmm, `deadline: '2021-05-17'` with now '2021-05-10' — fine.

Actually simpler: reuse the BASE_ROWS defined in the base describe — I need it at module scope. I'll define BASE_ROWS at module level with the full shape (openedAt, type, complexity, table, bandFee). And the base describe uses it.

Now, let me write the base rows fully:

```ts
const BASE_ROWS: Array<{
  openedAt: string;
  type: string;
  complexity: number;
  table: '2019' | '2021' | '2022';
  bandFee: number;
}> = [
  // 2019 schedule — opened before 2021-01-01
  { openedAt: '2020-06-15', type: 'STANDARD', complexity: 1, table: '2019', bandFee: 12000 },
  { openedAt: '2020-06-15', type: 'STANDARD', complexity: 2, table: '2019', bandFee: 18500 },
  { openedAt: '2020-06-15', type: 'STANDARD', complexity: 3, table: '2019', bandFee: 27000 },
  { openedAt: '2020-06-15', type: 'STANDARD', complexity: 4, table: '2019', bandFee: 41000 },
  { openedAt: '2020-06-15', type: 'COMMERCIAL', complexity: 1, table: '2019', bandFee: 22000 },
  { openedAt: '2020-06-15', type: 'COMMERCIAL', complexity: 2, table: '2019', bandFee: 31500 },
  { openedAt: '2020-06-15', type: 'COMMERCIAL', complexity: 3, table: '2019', bandFee: 45000 },
  { openedAt: '2020-06-15', type: 'COMMERCIAL', complexity: 4, table: '2019', bandFee: 68000 },
  { openedAt: '2020-06-15', type: 'ESTATE', complexity: 1, table: '2019', bandFee: 18000 },
  { openedAt: '2020-06-15', type: 'ESTATE', complexity: 2, table: '2019', bandFee: 26000 },
  { openedAt: '2020-06-15', type: 'ESTATE', complexity: 3, table: '2019', bandFee: 39500 },
  { openedAt: '2020-06-15', type: 'ESTATE', complexity: 4, table: '2019', bandFee: 60000 },
  { openedAt: '2020-06-15', type: 'APPEAL', complexity: 1, table: '2019', bandFee: 30000 },
  { openedAt: '2020-06-15', type: 'APPEAL', complexity: 2, table: '2019', bandFee: 42000 },
  { openedAt: '2020-06-15', type: 'APPEAL', complexity: 3, table: '2019', bandFee: 61000 },
  { openedAt: '2020-06-15', type: 'APPEAL', complexity: 4, table: '2019', bandFee: 92000 },
  // 2021 schedule — opened 2021-01-01..2022-06-30 (note: 2022-07-01 also, see BUG below)
  { openedAt: '2021-06-15', type: 'STANDARD', complexity: 1, table: '2021', bandFee: 13500 },
  ... 20500, 29500, 44500
  { openedAt: '2021-06-15', type: 'COMMERCIAL', ... 24000, 34000, 48500, 73000 },
  { openedAt: '2021-06-15', type: 'ESTATE', ... 19500, 28000, 42500, 64500 },
  { openedAt: '2021-06-15', type: 'APPEAL', ... 32500, 45500, 66000, 99000 },
  // 2022 schedule — opened after 2022-07-01
  { openedAt: '2023-03-15', type: 'STANDARD', ... 15000, 22500, 32500, 49000 },
  { openedAt: '2023-03-15', type: 'COMMERCIAL', ... 26500, 37500, 53500, 80500 },
  { openedAt: '2023-03-15', type: 'ESTATE', ... 21500, 31000, 47000, 71000 },
  { openedAt: '2023-03-15', type: 'APPEAL', ... 36000, 50000, 72500, 109000 },
];
```

And the base describe:

```ts
describe('base fee: every case type x complexity band x rate table (48 rows)', () => {
  it.each(BASE_ROWS)('$1/$3/$2/$4 -> $5 cents', (openedAt, type, complexity, table, bandFee) => {
    expect(fee(makeCase({ openedAt, type, complexity }))).toEqual({
      table,
      bandFee,
      urgencyFee: 0,
      expeditedFee: 0,
      total: bandFee,
    });
  });
});
```

`$1/$3/$2/$4 -> $5 cents` → e.g. "2020-06-15/STANDARD/1/2019 -> 12000 cents". Good.

Also sanity: each bandFee is a multiple of 100 (data property underpinning the "urgency step never rounds" invariant):

```ts
it('pinned data: every band fee is a whole number of cents and a multiple of 100', () => {
  for (const { bandFee } of BASE_ROWS) {
    expect(bandFee % 100).toBe(0);
  }
});
```

That's a test on my own data… it documents the premise for finding #8. Acceptable? A test that asserts about a constant. It pins the premise. I'll keep it — it's the premise for finding #8; if the table changes, the finding's reasoning changes. Hmm, "test the behavior, not the implementation" — this asserts on a fixture. I'd rather fold that premise into the urgency-sweep test as a comment, and the sweep itself asserts behavior. Let me drop the constant test and keep the sweep:

```ts
it('urgency step is exact on every current band fee (no cent lost at step one)', () => {
  const urgencyPct: Record<'2019' | '2021' | '2022', number> = { '2019': 15, '2021': 15, '2022': 18 };
  for (const row of BASE_ROWS) {
    const r = fee(makeCase({ openedAt: row.openedAt, type: row.type, complexity: row.complexity, deadline: '2021-05-17' }), '2021-05-10');
    expect(r.urgencyFee).toBe((row.bandFee * urgencyPct[row.table]) / 100);
    expect(Number.isInteger(r.urgencyFee)).toBe(true);
  }
});
```

This is behavioral: for every type × band × table, the urgency fee equals the exact percentage (no rounding loss).

Degenerate inputs group:

```ts
describe('degenerate inputs', () => {
  it('complexity null -> throws "complexity is required"', () => {
    expect(() => fee(makeCase({ complexity: null }))).toThrow('complexity is required');
  });
  it('complexity undefined -> throws "complexity is required"', () => {
    expect(() => fee(makeCase({ complexity: undefined }))).toThrow('complexity is required');
  });

  describe('QUIRK: out-of-band complexity is silently clamped, not rejected', () => {
    it('complexity 0 -> band 1 fee (2021 STANDARD: 13500)', () => {
      expect(fee(makeCase({ complexity: 0 }))).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
    });
    it('complexity -2 -> band 1 fee', ...);
    it('complexity NaN -> band 1 fee (NaN is falsy)', ...);
    it('complexity 5 -> band 4 fee (44500)', ...);
    it('complexity 99 -> band 4 fee', ...);
  });

  it('BUG: fractional complexity 2.5 -> bandFee undefined, total NaN', () => {
    const r = fee(makeCase({ openedAt: '2021-06-15', complexity: 2.5 }));
    expect(r.table).toBe('2021');
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(Number.isNaN(r.total)).toBe(true);
  });
  it('BUG: fractional complexity 2.5 + expedited -> expeditedFee NaN too', () => {
    const r = fee(makeCase({ openedAt: '2021-06-15', complexity: 2.5, expedited: true }));
    expect(Number.isNaN(r.expeditedFee)).toBe(true);
    expect(Number.isNaN(r.total)).toBe(true);
  });

  describe('QUIRK: unknown case type silently falls back to STANDARD rates of the selected table', () => {
    it('type "MARITIME" (2021 table) -> STANDARD band 1: 13500', ...);
    it('type "" -> STANDARD fallback', ...);
    it('type "standard" (lowercase) -> STANDARD fallback', ...);
    it('type "MARITIME" (2022 table) -> STANDARD 2022 band 1: 15000', () => {
      expect(fee(makeCase({ openedAt: '2023-03-15', type: 'MARITIME' }))).toMatchObject({ table: '2022', bandFee: 15000 });
    });
  });
});
```

Verify `complexity: 5` → band 4 → 2021 STANDARD b4 = 44500 ✓. `complexity: 0` → `!0` true → band 1 → 13500 ✓. `-2`: `!-2` false, `-2 < 1` true → band 1 ✓. `NaN`: `!NaN` true → 1 ✓.

Unknown type 2021 STANDARD b1 13500 ✓.

Also: type fallback with band 4? Not needed.

One more potential quirk: `expedited: true` with no urgency and 2019 → 10% (already covered in the expedited group).

Now, the "table" string identity: pinned everywhere via `toEqual` full object.

Let me also confirm `it.each(BASE_ROWS)` with an object parameter and `$1..` positional — vitest's positional placeholders work with array/tuple parameters; with object rows, I think `$1` doesn't map (object rows use `$key`). Since I'm using `it.each` with object rows… positional `$1` is only for arrays. So for BASE_ROWS (objects), I'll use `$openedAt/$type/$complexity/$table -> $bandFee cents`? Does vitest support `$key` in titles for object rows? Jest: yes, `it.each([{a:1}])('value is $a')`. Vitest supports the same. I'm fairly confident vitest supports `$variable` for object arrays. To minimize risk, I could make BASE_ROWS tuples: `[openedAt, type, complexity, table, bandFee]` and use `$1/$3/$2/$4 -> $5 cents`. Positional with tuples is definitely supported (that's the basic jest/vitest each feature). Let me use tuples.

`const BASE_ROWS: Array<[string, string, number, '2019'|'2021'|'2022', number]>`.

The sweep test destructures the tuple: `for (const [openedAt, type, complexity, table, bandFee] of BASE_ROWS)`.

Good.

Now `toMatchObject` vs `toEqual`: for full-object pins I use toEqual (strict). For boundary tests I could also use full toEqual — fine, I'll use full toEqual everywhere with the 4 zeros. For quirk tests I only care about table/bandFee; but full pin is stronger: 'garbage' → { table '2022', bandFee 15000, 0,0,15000 }. I'll use full toEqual.

Let me also decide `now` for the base rows: no deadline → urgency 0 regardless; expedited undefined → 0. `fee()` defaults now = NOW = '2021-05-10'. Fine.

Now — one more check on `daysBetween` for the urgency tests: `new Date('2021-05-17').getTime() - new Date('2021-05-10').getTime()` — both date-only ISO → UTC midnight → 7*86400000 → /86400000 = 7, floor 7 ✓. `Math.floor` on exact integer is fine.

Past deadline: '2021-05-03' − '2021-05-10' = −7 days → floor(−7) = −7 → ≤ 7 → urgent ✓.

Now `expect(...).toEqual` with `bandFee: undefined`? I avoid toEqual for the NaN cases; I use individual expectations ✓ (toEqual treats undefined keys leniently — I avoid the trap).

Now FINDINGS.md — write it thoroughly but concisely. Structure: intro + 8 findings, each with: location, reproduction, current behavior (pinned test name), blast radius, proposed fix (not applied). Also a header note that the suite is deterministic via `now`.

Let me also re-verify the claim "urgency step never rounds on current tables": all band fees are multiples of 100 (yes, every listed fee ends in 00). 15% of 100k = 15k integer; 18% = 18k integer. ✓.

And the 2019 expedited pct is 10; 2021/2022 are 12.

Let me verify a few of the 48 values from the source once more:

2019: STANDARD [12000, 18500, 27000, 41000] ✓; COMMERCIAL [22000, 31500, 45000, 68000] ✓; ESTATE [18000, 26000, 39500, 60000] ✓; APPEAL [30000, 42000, 61000, 92000] ✓.

2021: STANDARD [13500, 20500, 29500, 44500] ✓; COMMERCIAL [24000, 34000, 48500, 73000] ✓; ESTATE [19500, 28000, 42500, 64500] ✓; APPEAL [32500, 45500, 66000, 99000] ✓.

2022: STANDARD [15000, 22500, 32500, 49000] ✓; COMMERCIAL [26500, 37500, 53500, 80500] ✓; ESTATE [21500, 31000, 47000, 71000] ✓; APPEAL [36000, 50000, 72500, 109000] ✓.

Rounding rows recheck:
1. 2019 STANDARD b2: 18500; urgency 15% = 2775 (18500*15=277500/100 ✓); sum 21275; 10% = 2127.5 → 2128; total 18500+2775+2128 = 23403 ✓.
2. 2022 STANDARD b4: 49000; 18% = 8820 (49000*18 = 882000/100 ✓); sum 57820; 12% = 6938.4 → 6938; total 49000+8820+6938 = 64758 ✓.
3. 2022 COMMERCIAL b1: 26500; 18% = 4770 (26500*18=477000/100 ✓); sum 31270; 12% = 3752.4 → 3752; total 35022 ✓.
4. 2022 COMMERCIAL b3: 53500; 18% = 9630; sum 63130; 12% = 7575.6 → 7576; total 53500+9630+7576 = 70706 ✓.
5. 2022 COMMERCIAL b4: 80500; 18% = 14490 (80500*18=1449000/100 ✓); sum 94990; 12% = 11398.8 → 11399; total 80500+14490+11399 = 106389 ✓.
6. 2022 ESTATE b2: 31000; 18% = 5580; sum 36580; 12% = 4389.6 → 4390; total 31000+5580+4390 = 40970 ✓.
7. 2021 APPEAL b4: 99000; 15% = 14850; sum 113850; 12% = 13662.0 exact; total 127512 ✓.

Also, expedited with urgency for each table (STANDARD b1): computed above ✓.

Now the boundary test values: STANDARD b1: 2019 → 12000; 2021 → 13500; 2022 → 15000 ✓.

Now the file header comment in the test should also mention: the `now` parameter is the only clock injection; all tests pass it; the suite is timezone-independent? daysBetween on date-only strings is UTC-parsed → timezone-independent ✓. I'll note in the header: all dates are ISO date-only strings, parsed as UTC by the ES spec → no environment timezone dependence.

Also note: the tests must not depend on the real clock — never omit `now` ✓.

Now let me write FINDINGS.md in full.

```md
# FINDINGS — feeCalculator.ts

These findings come from writing the characterization suite
(`test/fee-calculator.spec.ts`). Every item below is pinned AS IT IS by a
flagged test (`BUG:` / `QUIRK:` prefix). No fix has been applied; production
code is untouched. All reproductions are deterministic — the clock is
injected through the module's existing optional `now` parameter.

Blast radius note: this module's outputs are stored and audited (billing).
Every behavior below, "quirk" or not, is part of the historical record.
Any fix changes the meaning of past rows and needs a billing reconciliation
before it ships.

## 1. BUG — the 2022 rate revision misses its own effective date

- Where: `tableFor()` — `openedAt > REVISION_2022` (strict `>`), while the
  2021 cut uses `>=`.
- Reproducing input:
  ```ts
  calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2022-07-01')
  // => { table: '2021', bandFee: 13500, ... }   // expected 2022 schedule: 15000
  calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-02' }, '2022-07-01')
  // => { table: '2022', bandFee: 15000, ... }
  ```
- Current behavior: a case opened exactly on 2022-07-01 is billed the 2021
  schedule: base fees ~10-15% lower, urgency 15% instead of 18%, expedited
  12% on the smaller base. The revision is in force only from 2022-07-02.
- Blast radius: every stored/audited fee with `opened_at = '2022-07-01'`
  (one day of intake, all types/bands, plus their surcharges) is
  under-charged relative to the intended 2022 schedule.
- Pinned by: `BUG: opened 2022-07-01 ... -> 2021 schedule`.
- Proposed fix (NOT applied): compare with `>=`:
  `if (openedAt >= REVISION_2022) return RATE_TABLE_2022;` — i.e. make both
  cuts inclusive. Shipping it re-bills the 2022-07-01 cohort; reconcile
  those rows with billing first.

## 2. QUIRK — `openedAt` is compared as a raw string (lexicographic)

- Where: `tableFor()` compares `openedAt` directly against the revision
  constants; no parsing, no validation.
- Reproducing input:
  ```ts
  calculateFee({ ..., openedAt: '2022-07-01T00:00:00Z' }, ...) // => table '2022'
  calculateFee({ ..., openedAt: '2022-07-01' }, ...)           // => table '2021'
  calculateFee({ ..., openedAt: 'garbage' }, ...)              // => table '2022'
  calculateFee({ ..., openedAt: '2021/05/10' }, ...)           // => table '2021'
  ```
- Current behavior: the same instant (2022-07-01) is billed the 2022
  schedule when stored with a time component and the 2021 schedule when
  stored as a bare date — a direct consequence of finding 1 plus string
  ordering (a longer string with the same prefix sorts after the prefix).
  Non-ISO values land in whichever table the string happens to sort into.
- Blast radius: rows imported with datetime or slash formats are bucketed
  by accident, not by date; the "buggy day" 2022-07-01 has BOTH schedules
  present in the historical record, split by storage format.
- Pinned by: the three `QUIRK: ... string comparison` tests.
- Proposed fix (NOT applied): normalize `openedAt` (parse to a date, or
  validate strict `YYYY-MM-DD`) before the boundary checks.

## 3. BUG — fractional complexity produces NaN fees

- Where: `calculateFee()` clamps with `if (!band || band < 1) band = 1; if
  (band > 4) band = 4;` — nothing rejects non-integers in [1, 4).
- Reproducing input:
  ```ts
  calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2021-06-15' }, '2021-05-10')
  // => { table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
  // with expedited: true => expeditedFee: NaN as well
  ```
  `bands[2.5 - 1]` is `undefined`, and arithmetic on `undefined` is `NaN`.
  (`complexity: NaN` takes the falsy branch and silently becomes band 1.)
- Blast radius: any fee computed with a fractional complexity is NaN; if
  persisted it becomes a null/NaN in billing aggregates, audits and JSON
  exports, with no error marker in the breakdown.
- Pinned by: `BUG: fractional complexity 2.5 ...` tests.
- Proposed fix (NOT applied): validate `Number.isInteger(band)` and throw a
  typed error, or round intentionally (`Math.round`) and then clamp 1..4.

## 4. QUIRK — degenerate complexity is silently clamped, not rejected

- Where: same clamping block.
- Reproducing input: `complexity: 0`, `-2`, `NaN` → band 1; `complexity: 5`,
  `99` → band 4. Only `null`/`undefined` throws (`'complexity is required'`).
- Blast radius: data-entry mistakes (a 0, a 00, a blank parsed as 0) are
  billed as band 1 and are indistinguishable from genuine band-1 cases in
  the stored history; the only "validation" in the module is the throw for
  missing values.
- Pinned by: the `QUIRK: out-of-band complexity ...` tests.
- Proposed fix (NOT applied): reject out-of-range bands with a typed error
  (or record an explicit fallback flag in the breakdown so audits can see it).

## 5. QUIRK — unknown case type silently falls back to STANDARD

- Where: `if (!bands) bands = table.base['STANDARD'];`
- Reproducing input: `type: 'MARITIME'` / `''` / `'standard'` (lowercase)
  → STANDARD rates of whichever table the opened date selects.
- Blast radius: the `CaseType` union is decorative — the input is a plain
  `string` — so old-system imports with unrecognized types were billed as
  STANDARD (over- or under-charge depending on the true type), with no flag
  in the stored breakdown to detect them afterwards.
- Pinned by: the `QUIRK: unknown case type ...` tests.
- Proposed fix (NOT applied): throw on unknown type, or add a
  `fellBackToStandard: true` marker to the breakdown and alert upstream.

## 6. QUIRK — urgency is anchored to `now` (calculation time), not to the case

- Where: `const ref = now ? now : <wall clock>` and
  `daysBetween(ref, c.deadline) <= 7`.
- Reproducing input:
  ```ts
  const c = { type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2021-05-18' };
  calculateFee(c, '2021-05-10').total // 13500  (8 days out: no urgency)
  calculateFee(c, '2021-05-16').total // 15525  (2 days out: urgency)
  ```
  And with `now` omitted, the real wall clock is used.
- Blast radius: the same stored case re-billed / re-audited on different
  days yields different fees; historical outputs are only reproducible if
  the exact `now` used at billing time is known. This is also why the
  characterization suite injects `now` in every call.
- Pinned by: `QUIRK: urgency is measured against now ...`.
- Proposed fix (NOT applied): anchor urgency to a documented, persisted
  reference (e.g. the case's `openedAt`, or the first-computation date
  stored next to the fee).

## 7. QUIRK — a past deadline still earns the urgency surcharge

- Where: `daysBetween(ref, c.deadline) <= 7` has no lower bound.
- Reproducing input:
  ```ts
  calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2021-05-01', deadline: '2021-05-03' }, '2021-05-10')
  // daysBetween = -7, -7 <= 7 => urgencyFee 2025, total 15525
  ```
- Blast radius: overdue cases keep earning the urgency percentage on every
  recomputation, indefinitely.
- Pinned by: `QUIRK: a PAST deadline ...`.
- Proposed fix (NOT applied): require `0 <= days <= 7`.

## 8. QUIRK — stepwise `Math.round` (half-up); expedited compounds on the rounded urgency

- Where: `pctOf()` rounds at each step ("rounded at each step since 2019;
  billing reconciles against these"); the expedited percentage is applied to
  `bandFee + urgencyFee`, i.e. on the already-rounded urgency.
- Reproducing input:
  ```ts
  // 2019 schedule, STANDARD band 2, urgent + expedited:
  //   urgency  18500 * 15% = 2775        (exact)
  //   expedited (18500+2775) * 10% = 2127.5 -> 2128  (half rounds up)
  //   total 23403
  ```
  Down-rounding examples pinned in the suite: 2022 STANDARD band 4 →
  6938.4 → 6938; 2022 COMMERCIAL band 1 → 3752.4 → 3752; up-rounding:
  2022 COMMERCIAL band 3 → 7575.6 → 7576.
- Note: on the current tables the FIRST step (urgency) never actually
  rounds — every band fee is a multiple of 100 and both percentages are
  integers — so today only the expedited step can lose a fraction of a
  cent. A "cleanup" that rounds only the final total, or that stops
  compounding on the rounded urgency, would silently shift many stored
  fees (the 2127.5 case above is one of them).
- Pinned by: the `rounding ...` describe block.
- Proposed fix (NOT applied): treat stepwise rounding as the contract. If
  billing ever wants to change it, do a full historical reconciliation
  first; until then, keep the per-step `Math.round`.
```

That's solid. Maybe also add a short "Pinned but not findings" section? Not necessary.

Should I also mention `deadline` falsy empty string? I decided to skip that test; skip it in findings too.

Now, let me double check that all my test expectations match the code exactly. Let me re-simulate some in my head.

Test: `fee(makeCase({ openedAt: '2022-07-01' }))` with default now '2021-05-10', no deadline, no expedited.
- complexity 1 → not null/undefined.
- tableFor('2022-07-01'): '2022-07-01' >= '2021-01-01' true; '2022-07-01' > '2022-07-01' false → RATE_TABLE_2021. tableName '2021'.
- bands STANDARD, band 1 → 13500.
- no deadline → urgency 0. expedited undefined → 0. total 13500. ✓

Test '2022-07-02': > '2022-07-01' true → 2022. bandFee 15000 ✓.

Test '2022-07-01T00:00:00Z': >= '2021-01-01' true; > '2022-07-01' → string compare: prefix equal up to '2022-07-01', then 'T...' vs end of string → longer is greater → true → 2022 ✓ bandFee 15000 ✓.

Test 'garbage': >= '2021-01-01': 'g' (0x67) > '2' (0x32) → true. > '2022-07-01' → true → 2022, 15000 ✓.

Test '2021/05/10': >= '2021-01-01': '2021' equal; '/' (0x2F) vs '-' (0x2D): 0x2F > 0x2D → true. > '2022-07-01': at index 3 '1' vs '2' → '1' < '2' → false → 2021. bandFee 13500 ✓.

Urgency 2021 b1: 13500*15/100 = 2025 ✓.

Test `fee(makeCase({ openedAt: '2020-05-01', deadline: '2021-05-17' }))` default now '2021-05-10': daysBetween('2021-05-10','2021-05-17') = 7 ≤ 7 → urgent. 2019 table (2020-05-01 < 2021-01-01 ✓). 12000*0.15 = 1800 ✓ total 13800 ✓.

2022 urgency: `fee(makeCase({ openedAt: '2023-03-01', deadline: '2023-03-22' }), '2023-03-15')`: table 2022 ✓ (2023-03-01 > 2022-07-01). daysBetween('2023-03-15','2023-03-22') = 7 ✓. 15000*0.18 = 2700 ✓ total 17700 ✓.

Expedited 2019: `makeCase({ openedAt: '2020-05-01', expedited: true })` now default: no deadline → urgency 0; expedited = 12000*0.10 = 1200 ✓ total 13200 ✓.

2021 expedited: openedAt '2021-05-01' (2021 table) → 1620, 15120 ✓.

2022 expedited no urgency: `fee(makeCase({ openedAt: '2023-03-01', expedited: true }), '2023-03-15')` → 15000*0.12 = 1800, total 16800 ✓.

Compound 2019: opened '2020-05-01', deadline '2021-05-17', expedited true, now default: urgency 1800; expedited = (12000+1800)*0.10 = 1380 ✓; total 15180 ✓.
Compound 2021: opened '2021-05-01', deadline '2021-05-17': (13500+2025)*0.12 = 1863 ✓ total 17388 ✓.
Compound 2022: (15000+2700)*0.12 = 2124 ✓ total 19824 ✓.

Rounding rows (all with expedited + urgent):
Row 1: opened '2020-05-01', complexity 2, deadline '2021-05-17', now '2021-05-10': table 2019; bandFee 18500; urgency 2775; expedited Math.round(21275*10/100)=Math.round(2127.5)=2128; total 23403 ✓.
Row 2: opened '2023-03-01', complexity 4, deadline '2023-03-22', now '2023-03-15': 2022; 49000; 8820; Math.round(57820*0.12)=Math.round(6938.4)=6938; total 64758 ✓.
Row 3: 2022 COMM b1: complexity 1, type COMMERCIAL, opened '2023-03-01', deadline '2023-03-22', now '2023-03-15': 26500; 4770; Math.round(31270*.12)=Math.round(3752.4)=3752; total 35022 ✓.
Row 4: 2022 COMM b3: 53500; 9630; Math.round(63130*.12)=Math.round(7575.6)=7576; total 70706 ✓.
Row 5: 2022 COMM b4: 80500; 14490; Math.round(94990*.12)=Math.round(11398.8)=11399; total 106389 ✓.
Row 6: 2022 ESTATE b2: 31000; 5580; Math.round(36580*.12)=Math.round(4389.6)=4390; total 40970 ✓.
Row 7: 2021 APPEAL b4: opened '2021-05-01', complexity 4, deadline '2021-05-17', now '2021-05-10': 99000; 14850; (99000+14850)=113850*.12=13662 exact; total 127512 ✓.

Urgency sweep: for every base row, deadline '2021-05-17' + now '2021-05-10' → urgency on. 2022 rows (opened 2023-03-15) still fine. urgencyFee = bandFee*pct/100 exactly ✓ integer ✓.

Boundary group:
- '2019-01-01' → 2019, 12000 ✓.
- '2020-12-31' → 2019, 12000 ✓.
- '2021-01-01' → 2021, 13500 ✓.
- '2022-06-30' → 2021, 13500 ✓.
- '2022-07-01' → 2021, 13500 ✓ (BUG pin).
- '2022-07-02' → 2022, 15000 ✓.
- '2023-11-30' → 2022, 15000 ✓.

Urgency edges:
- '2021-05-17' (7 days): on → 15525 (2021 table, opened '2021-05-01').
- '2021-05-18' (8 days): off → 13500.
- '2021-05-10' (0): on → 15525.
- '2021-05-03' (−7): on (QUIRK) → 15525.

Now quirk: now-dependence: opened '2021-05-10', deadline '2021-05-18': now '2021-05-10' → 8 → off 13500; now '2021-05-16' → 2 → on 15525 ✓.

Degenerate:
- null → throw 'complexity is required' ✓ (message exact).
- undefined → throw ✓.
- 0 → 13500 ✓; -2 → 13500 ✓; NaN → 13500 ✓; 5 → 44500 ✓; 99 → 44500 ✓. (Default openedAt '2021-06-15' → 2021 table ✓.)
- 2.5 → NaN ✓.
- Unknown type: default opened '2021-06-15' → 13500; 2022 variant → 15000 ✓.

Wait, default makeCase openedAt — I set it to '2021-06-15' (2021 table). Good for the degenerate pins (2021 rates).

`complexity: undefined` under TS strict: `makeCase({ complexity: undefined })` — `Partial<CaseInput>` makes `complexity?: number | null`. Assigning `undefined` explicitly: allowed unless `exactOptionalPropertyTypes` (not set). ✓.

Type of the tuples for it.each: `Array<[string, string, number, '2019' | '2021' | '2022', number]>`. In `it.each(BASE_ROWS)('$1/$3/$2/$4 -> $5 cents', (openedAt, type, complexity, table, bandFee) => ...)`, the callback parameters are typed by inference ✓.

Inside, `toEqual({ table, bandFee, ... })` — `table` is a union, fine.

Sweep: `const urgencyPct: Record<'2019' | '2021' | '2022', number> = { '2019': 15, '2021': 15, '2022': 18 };` and `urgencyPct[table]` ✓.

`expect(r.urgencyFee).toBe((row.bandFee * urgencyPct[table]) / 100);` — toBe uses Object.is; both integers ✓.

Now the test file header should also mention: the suite is timezone-safe because date-only ISO strings parse as UTC. And that `now` is always injected.

One more consideration: should the test file import `FeeBreakdown`? I use it as the return type annotation for the `fee` helper ✓. And `CaseInput` ✓.

Potential strict TS issue: `const r = fee(...)` then `r.bandFee` is typed `number`; `expect(r.bandFee).toBeUndefined()` — fine at runtime; TS allows the comparison (toBeUndefined accepts anything). ✓.

`Number.isNaN(r.total)` — `r.total` is typed number ✓.

Now, about `describe`/`it` naming and the requirement "test names that flag them": I have `BUG:` / `QUIRK:` prefixes. ✓.

Should I include a small describe for "breakdown shape / invariants"? E.g. total = bandFee + urgencyFee + expeditedFee across a sample matrix? The toEqual pins already fix total to the sum. A general invariant test:

```ts
it('total is always bandFee + urgencyFee + expeditedFee', () => {
  const samples: Array<{ input: CaseInput; now: string }> = [ ...a few... ];
  for (const s of samples) {
    const r = fee(s.input, s.now);
    if (Number.isNaN(r.total)) continue; // NaN rows pinned separately
    expect(r.total).toBe(r.bandFee + r.urgencyFee + r.expeditedFee);
  }
});
```

Hmm — this re-derives the total from the fields; it's an invariant pin (that the total is the sum, no hidden fee). That's a legitimate behavioral invariant. But `bandFee` can be undefined (NaN case) — I skip NaN rows. This is nice but marginal; the toEqual pins on every other test already verify total = sum with concrete numbers. I'll include a compact version — it guards against a future "add a hidden fee" change. Keep it small with 4-5 samples covering the shapes (base, urgent, expedited, both).

Actually — to honor "test the behavior, not the implementation" and avoid hollow assertions, all my tests assert concrete expected values. The invariant test adds marginal value; I'll include it because it's a real contract ("total" means the sum of the parts) and it's cheap. Fine.

Now file order: the task says to begin with the first heading. Two files:
1. `test/fee-calculator.spec.ts`
2. `FINDINGS.md`

Which first? Either. Let me put the spec first, then FINDINGS.md.

Format: level-3 heading with only the path, then a fenced block with only the file contents. No prose between blocks. "Keep it to nothing" — so no intro text at all. Begin with `### test/fee-calculator.spec.ts`.

Now let me write the final test file in full.

```ts
// test/fee-calculator.spec.ts
//
// Characterization suite for feeCalculator.ts (in production since 2019;
// its outputs are stored and audited by billing).
//
// Goal: pin the module's CURRENT behavior -- quirks and bugs included --
// so the planned modifications next month cannot silently change audited
// fee history. Quirks and bugs are pinned AS THEY ARE and are flagged in
// the test name with a `QUIRK:` or `BUG:` prefix. For each one, see
// FINDINGS.md: reproducing input, likely blast radius, and the proposed
// (deliberately NOT applied) fix.
//
// Determinism:
//   * The fake clock is injected ONLY through the module's existing
//     optional `now` parameter. Every call below passes it; the real
//     wall clock never runs in this suite.
//   * All dates are fixed ISO date-only strings, which the ES spec parses
//     as UTC -- the suite has no timezone or environment dependence.
//   * No randomness anywhere.
//
// Production code is untouched by this suite.

import { describe, expect, it } from 'vitest';

import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';

/** Fixed reference clock used unless a test states otherwise. */
const NOW = '2021-05-10';

/** Default case: 2021 schedule (opened 2021-06-15), STANDARD band 1. */
function makeCase(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2021-06-15',
    ...overrides,
  };
}

/** Always inject the clock -- never rely on the wall clock. */
function fee(input: CaseInput, now: string = NOW): FeeBreakdown {
  return calculateFee(input, now);
}

/**
 * Every case type x complexity band x rate table.
 * Row: [openedAt, type, complexity, table, expectedBandFee (cents)]
 */
const BASE_ROWS: Array<[string, string, number, '2019' | '2021' | '2022', number]> = [
  // 2019 schedule -- opened before 2021-01-01
  ['2020-06-15', 'STANDARD', 1, '2019', 12000],
  ['2020-06-15', 'STANDARD', 2, '2019', 18500],
  ['2020-06-15', 'STANDARD', 3, '2019', 27000],
  ['2020-06-15', 'STANDARD', 4, '2019', 41000],
  ['2020-06-15', 'COMMERCIAL', 1, '2019', 22000],
  ['2020-06-15', 'COMMERCIAL', 2, '2019', 31500],
  ['2020-06-15', 'COMMERCIAL', 3, '2019', 45000],
  ['2020-06-15', 'COMMERCIAL', 4, '2019', 68000],
  ['2020-06-15', 'ESTATE', 1, '2019', 18000],
  ['2020-06-15', 'ESTATE', 2, '2019', 26000],
  ['2020-06-15', 'ESTATE', 3, '2019', 39500],
  ['2020-06-15', 'ESTATE', 4, '2019', 60000],
  ['2020-06-15', 'APPEAL', 1, '2019', 30000],
  ['2020-06-15', 'APPEAL', 2, '2019', 42000],
  ['2020-06-15', 'APPEAL', 3, '2019', 61000],
  ['2020-06-15', 'APPEAL', 4, '2019', 92000],
  // 2021 schedule -- opened 2021-01-01 .. 2022-06-30
  // (and, by BUG #1 below, also on 2022-07-01 itself)
  ['2021-06-15', 'STANDARD', 1, '2021', 13500],
  ['2021-06-15', 'STANDARD', 2, '2021', 20500],
  ['2021-06-15', 'STANDARD', 3, '2021', 29500],
  ['2021-06-15', 'STANDARD', 4, '2021', 44500],
  ['2021-06-15', 'COMMERCIAL', 1, '2021', 24000],
  ['2021-06-15', 'COMMERCIAL', 2, '2021', 34000],
  ['2021-06-15', 'COMMERCIAL', 3, '2021', 48500],
  ['2021-06-15', 'COMMERCIAL', 4, '2021', 73000],
  ['2021-06-15', 'ESTATE', 1, '2021', 19500],
  ['2021-06-15', 'ESTATE', 2, '2021', 28000],
  ['2021-06-15', 'ESTATE', 3, '2021', 42500],
  ['2021-06-15', 'ESTATE', 4, '2021', 64500],
  ['2021-06-15', 'APPEAL', 1, '2021', 32500],
  ['2021-06-15', 'APPEAL', 2, '2021', 45500],
  ['2021-06-15', 'APPEAL', 3, '2021', 66000],
  ['2021-06-15', 'APPEAL', 4, '2021', 99000],
  // 2022 schedule -- opened after 2022-07-01
  ['2023-03-15', 'STANDARD', 1, '2022', 15000],
  ['2023-03-15', 'STANDARD', 2, '2022', 22500],
  ['2023-03-15', 'STANDARD', 3, '2022', 32500],
  ['2023-03-15', 'STANDARD', 4, '2022', 49000],
  ['2023-03-15', 'COMMERCIAL', 1, '2022', 26500],
  ['2023-03-15', 'COMMERCIAL', 2, '2022', 37500],
  ['2023-03-15', 'COMMERCIAL', 3, '2022', 53500],
  ['2023-03-15', 'COMMERCIAL', 4, '2022', 80500],
  ['2023-03-15', 'ESTATE', 1, '2022', 21500],
  ['2023-03-15', 'ESTATE', 2, '2022', 31000],
  ['2023-03-15', 'ESTATE', 3, '2022', 47000],
  ['2023-03-15', 'ESTATE', 4, '2022', 71000],
  ['2023-03-15', 'APPEAL', 1, '2022', 36000],
  ['2023-03-15', 'APPEAL', 2, '2022', 50000],
  ['2023-03-15', 'APPEAL', 3, '2022', 72500],
  ['2023-03-15', 'APPEAL', 4, '2022', 109000],
];

describe('base fee: every case type x complexity band x rate table', () => {
  it.each(BASE_ROWS)('$1/$3/$2/$4 -> $5 cents', (openedAt, type, complexity, table, bandFee) => {
    expect(fee(makeCase({ openedAt, type, complexity }))).toEqual({
      table,
      bandFee,
      urgencyFee: 0,
      expeditedFee: 0,
      total: bandFee,
    });
  });
});
```

Wait — `$1/$3/$2/$4 -> $5 cents` renders as e.g. `2020-06-15/STANDARD/1/2019 -> 12000 cents`. ✓.

Continuing:

```ts
describe('rate table selection: revision date boundaries (inclusive/exclusive edges)', () => {
  it('opened 2019-01-01 (earliest plausible date) -> 2019 schedule', () => {
    expect(fee(makeCase({ openedAt: '2019-01-01' }))).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('opened 2020-12-31 (day before first revision) -> 2019 schedule', () => {
    expect(fee(makeCase({ openedAt: '2020-12-31' }))).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('opened 2021-01-01 (first revision effective date, INCLUSIVE edge) -> 2021 schedule', () => {
    expect(fee(makeCase({ openedAt: '2021-01-01' }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('opened 2022-06-30 (day before second revision) -> 2021 schedule', () => {
    expect(fee(makeCase({ openedAt: '2022-06-30' }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('BUG: opened 2022-07-01 (second revision effective date) still gets the 2021 schedule', () => {
    // Pinned as-is: tableFor() uses `openedAt > REVISION_2022` (strict), so
    // the 2022 rates only kick in from 2022-07-02 -- one day late compared
    // to the inclusive 2021 cut. See FINDINGS.md #1.
    expect(fee(makeCase({ openedAt: '2022-07-01' }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('opened 2022-07-02 (day after second revision) -> 2022 schedule', () => {
    expect(fee(makeCase({ openedAt: '2022-07-02' }))).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });

  it('opened 2023-11-30 (no later revision exists) -> 2022 schedule', () => {
    expect(fee(makeCase({ openedAt: '2023-11-30' }))).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });
});

describe('QUIRK: openedAt is compared as a raw string, not parsed as a date', () => {
  it('QUIRK: the same instant as "2022-07-01" but with a time part gets the 2022 schedule', () => {
    // '2022-07-01T00:00:00Z' > '2022-07-01' lexicographically (longer string,
    // same prefix), so a datetime-stamped copy of the "buggy day" (#1) bills
    // 2022 rates while the bare date bills 2021 rates. FINDINGS.md #2.
    expect(fee(makeCase({ openedAt: '2022-07-01T00:00:00Z' }))).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });

  it('QUIRK: non-ISO openedAt "garbage" sorts after both revisions -> 2022 schedule', () => {
    expect(fee(makeCase({ openedAt: 'garbage' }))).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });

  it('QUIRK: slash-separated openedAt "2021/05/10" lands in 2021 by string accident', () => {
    expect(fee(makeCase({ openedAt: '2021/05/10' }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });
});

describe('urgency surcharge: deadline within 7 days of `now`', () => {
  it('deadline exactly 7 days ahead of now -> urgency applies (inclusive edge)', () => {
    // 2021 schedule, STANDARD band 1: 15% of 13500 = 2025.
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-17' }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });

  it('deadline 8 days ahead of now -> no urgency (exclusive edge)', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-18' }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('deadline on the day of now (0 days) -> urgency applies', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-10' }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });

  it('QUIRK: a PAST deadline (7 days before now) still earns the urgency surcharge', () => {
    // daysBetween(now, deadline) = -7, and -7 <= 7. FINDINGS.md #7.
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-03' }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });

  it('urgency percentage per table: 15% (2019), 15% (2021), 18% (2022)', () => {
    expect(fee(makeCase({ openedAt: '2020-05-01', deadline: '2021-05-17' }))).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 0, total: 13800,
    });
    expect(
      fee(makeCase({ openedAt: '2023-03-01', deadline: '2023-03-22' }), '2023-03-15'),
    ).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 2700, expeditedFee: 0, total: 17700,
    });
  });

  it('QUIRK: urgency is measured against `now` (calculation time), not openedAt', () => {
    // Same stored case; only the clock moves. FINDINGS.md #6.
    const input = makeCase({ openedAt: '2021-05-10', deadline: '2021-05-18' });
    expect(fee(input, '2021-05-10')).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    }); // 8 days out at that moment -> no urgency
    expect(fee(input, '2021-05-16')).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    }); // 2 days out at that moment -> urgency
  });

  it('no deadline -> no urgency, even when expedited', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', expedited: true }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120,
    });
  });
});

describe('expedited surcharge: percentage on (bandFee + urgencyFee)', () => {
  it('not urgent: 2019 -> 10% of band fee', () => {
    expect(fee(makeCase({ openedAt: '2020-05-01', expedited: true }))).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 1200, total: 13200,
    });
  });

  it('not urgent: 2021 -> 12% of band fee', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', expedited: true }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120,
    });
  });

  it('not urgent: 2022 -> 12% of band fee', () => {
    expect(fee(makeCase({ openedAt: '2023-03-01', expedited: true }), '2023-03-15')).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 1800, total: 16800,
    });
  });

  it('compounds on the urgency fee: pct is applied to bandFee + urgencyFee', () => {
    // 2019: (12000 + 1800) * 10% = 1380
    expect(fee(makeCase({ openedAt: '2020-05-01', deadline: '2021-05-17', expedited: true }))).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 1380, total: 15180,
    });
    // 2021: (13500 + 2025) * 12% = 1863
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-17', expedited: true }))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 1863, total: 17388,
    });
    // 2022: (15000 + 2700) * 12% = 2124
    expect(
      fee(makeCase({ openedAt: '2023-03-01', deadline: '2023-03-22', expedited: true }), '2023-03-15'),
    ).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 2700, expeditedFee: 2124, total: 19824,
    });
  });
});

describe('rounding: Math.round (half-up) at each step; expedited compounds on the rounded urgency', () => {
  it('half-cent rounds UP: 2019 STANDARD band 2, urgent+expedited -> 2127.5 -> 2128', () => {
    expect(
      fee(makeCase({ openedAt: '2020-05-01', complexity: 2, deadline: '2021-05-17', expedited: true })),
    ).toEqual({
      table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403,
    });
  });

  it('fractional cents round DOWN: 2022 STANDARD band 4 -> 6938.4 -> 6938', () => {
    expect(
      fee(makeCase({ openedAt: '2023-03-01', complexity: 4, deadline: '2023-03-22', expedited: true }), '2023-03-15'),
    ).toEqual({
      table: '2022', bandFee: 49000, urgencyFee: 8820, expeditedFee: 6938, total: 64758,
    });
  });

  it('fractional cents round DOWN: 2022 COMMERCIAL band 1 -> 3752.4 -> 3752', () => {
    expect(
      fee(makeCase({ openedAt: '2023-03-01', type: 'COMMERCIAL', deadline: '2023-03-22', expedited: true }), '2023-03-15'),
    ).toEqual({
      table: '2022', bandFee: 26500, urgencyFee: 4770, expeditedFee: 3752, total: 35022,
    });
  });

  it('fractional cents round UP: 2022 COMMERCIAL band 3 -> 7575.6 -> 7576', () => {
    expect(
      fee(makeCase({ openedAt: '2023-03-01', type: 'COMMERCIAL', complexity: 3, deadline: '2023-03-22', expedited: true }), '2023-03-15'),
    ).toEqual({
      table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 7576, total: 70706,
    });
  });

  it('fractional cents round UP: 2022 COMMERCIAL band 4 -> 11398.8 -> 11399', () => {
    expect(
      fee(makeCase({ openedAt: '2023-03-01', type: 'COMMERCIAL', complexity: 4, deadline: '2023-03-22', expedited: true }), '2023-03-15'),
    ).toEqual({
      table: '2022', bandFee: 80500, urgencyFee: 14490, expeditedFee: 11399, total: 106389,
    });
  });

  it('fractional cents round UP: 2022 ESTATE band 2 -> 4389.6 -> 4390', () => {
    expect(
      fee(makeCase({ openedAt: '2023-03-01', type: 'ESTATE', complexity: 2, deadline: '2023-03-22', expedited: true }), '2023-03-15'),
    ).toEqual({
      table: '2022', bandFee: 31000, urgencyFee: 5580, expeditedFee: 4390, total: 40970,
    });
  });

  it('exact sum needs no rounding: 2021 APPEAL band 4 -> 13662', () => {
    expect(
      fee(makeCase({ openedAt: '2021-05-01', type: 'APPEAL', complexity: 4, deadline: '2021-05-17', expedited: true })),
    ).toEqual({
      table: '2021', bandFee: 99000, urgencyFee: 14850, expeditedFee: 13662, total: 127512,
    });
  });

  it('urgency step (step one) loses no cents on any current band fee', () => {
    // Every band fee is a multiple of 100 and both urgency percentages are
    // integers, so 15%/18% of any of them is exact. If the rate tables ever
    // change, this is where the "round at each step" contract shows up at
    // step one. FINDINGS.md #8.
    const urgencyPct: Record<'2019' | '2021' | '2022', number> = { '2019': 15, '2021': 15, '2022': 18 };
    for (const [openedAt, type, complexity, table, bandFee] of BASE_ROWS) {
      const r = fee(makeCase({ openedAt, type, complexity, deadline: '2021-05-17' }));
      expect(r.urgencyFee).toBe((bandFee * urgencyPct[table]) / 100);
      expect(Number.isInteger(r.urgencyFee)).toBe(true);
    }
  });
});
```

Wait — in the sweep, for the 2022 rows, openedAt '2023-03-15' with deadline '2021-05-17' and now '2021-05-10' → daysBetween('2021-05-10', '2021-05-17') = 7 → urgency on ✓ (deadline vs now, independent of openedAt). ✓.

Now the degenerate group:

```ts
describe('degenerate inputs', () => {
  it('complexity null -> throws "complexity is required"', () => {
    expect(() => fee(makeCase({ complexity: null }))).toThrow('complexity is required');
  });

  it('complexity undefined -> throws "complexity is required"', () => {
    expect(() => fee(makeCase({ complexity: undefined }))).toThrow('complexity is required');
  });

  describe('QUIRK: out-of-band complexity is silently clamped, not rejected', () => {
    it('complexity 0 -> band 1 fee (2021 STANDARD: 13500)', () => {
      expect(fee(makeCase({ complexity: 0 }))).toEqual({
        table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
      });
    });

    it('complexity -2 -> band 1 fee', () => {
      expect(fee(makeCase({ complexity: -2 }))).toEqual({
        table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
      });
    });

    it('complexity NaN -> band 1 fee (NaN is falsy, takes the same branch as 0)', () => {
      expect(fee(makeCase({ complexity: NaN }))).toEqual({
        table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
      });
    });

    it('complexity 5 -> band 4 fee (44500)', () => {
      expect(fee(makeCase({ complexity: 5 }))).toEqual({
        table: '2021', bandFee: 44500, urgencyFee: 0, expeditedFee: 0, total: 44500,
      });
    });

    it('complexity 99 -> band 4 fee (44500)', () => {
      expect(fee(makeCase({ complexity: 99 }))).toEqual({
        table: '2021', bandFee: 44500, urgencyFee: 0, expeditedFee: 0, total: 44500,
      });
    });
  });

  describe('BUG: fractional complexity produces NaN fees', () => {
    it('complexity 2.5 -> bandFee undefined, total NaN (array index 1.5 misses)', () => {
      const r = fee(makeCase({ complexity: 2.5 }));
      expect(r.table).toBe('2021');
      expect(r.bandFee).toBeUndefined();
      expect(r.urgencyFee).toBe(0);
      expect(r.expeditedFee).toBe(0);
      expect(Number.isNaN(r.total)).toBe(true);
    });

    it('complexity 2.5 + expedited -> expeditedFee is NaN too', () => {
      const r = fee(makeCase({ complexity: 2.5, expedited: true }));
      expect(Number.isNaN(r.expeditedFee)).toBe(true);
      expect(Number.isNaN(r.total)).toBe(true);
    });
  });

  describe('QUIRK: unknown case type silently falls back to STANDARD rates', () => {
    it('type "MARITIME" (2021 table) -> STANDARD band 1: 13500', () => {
      expect(fee(makeCase({ type: 'MARITIME' }))).toEqual({
        table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
      });
    });

    it('type "" (empty) -> STANDARD band 1: 13500', () => {
      expect(fee(makeCase({ type: '' }))).toEqual({
        table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
      });
    });

    it('type "standard" (lowercase) -> STANDARD band 1: 13500', () => {
      expect(fee(makeCase({ type: 'standard' }))).toEqual({
        table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
      });
    });

    it('fallback is per-table: type "MARITIME" (2022 table) -> STANDARD 2022 band 1: 15000', () => {
      expect(fee(makeCase({ openedAt: '2023-03-15', type: 'MARITIME' }))).toEqual({
        table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
      });
    });
  });
});
```

Verify: default openedAt '2021-06-15' → 2021 ✓.

And finally a small invariant describe:

```ts
describe('breakdown invariants', () => {
  it('total is always bandFee + urgencyFee + expeditedFee (no hidden components)', () => {
    const samples: Array<[CaseInput, string]> = [
      [makeCase({ openedAt: '2021-05-01' }), '2021-05-10'],
      [makeCase({ openedAt: '2021-05-01', deadline: '2021-05-17' }), '2021-05-10'],
      [makeCase({ openedAt: '2023-03-01', expedited: true }), '2023-03-15'],
      [makeCase({ openedAt: '2023-03-01', type: 'APPEAL', complexity: 4, deadline: '2023-03-22', expedited: true }), '2023-03-15'],
    ];
    for (const [input, now] of samples) {
      const r = fee(input, now);
      expect(r.total).toBe(r.bandFee + r.urgencyFee + r.expeditedFee);
    }
  });
});
```

Hmm, the first two samples have now '2021-05-10' — deadline '2021-05-17' → 7 days → urgency. ✓ all finite. Fine.

Is this invariant test "hollow"? It asserts a numeric equality that is structurally true from the source, but behaviorally it pins "total = sum of parts" — a real contract. It's cheap, I'll keep it. Actually… the convention warns against hollow assertions. This one has a real assertion (equality on computed values) and would catch a change where total includes a hidden component. Keep it.

Now — one thing to double check: `fee(makeCase({ complexity: 0 }))` — `makeCase`'s override spreads `complexity: 0` → overrides 1 ✓.

TS: `makeCase({ complexity: undefined })` — OK.

`it.each(BASE_ROWS)('$1/$3/$2/$4 -> $5 cents', (openedAt, type, complexity, table, bandFee) => {` — the callback parameters are typed from the tuple ✓. `toEqual({ table, bandFee, ... })` ✓.

Vitest's positional `$1` etc.: supported (vitest's `each` docs show `it.each([[1],[2]])('$1')`… actually, to be extra safe, the vitest docs for `each` show: "You can use `$1`, `$2`… in the title" — hmm, do I recall vitest supporting `#` (index) and `$#`? Let me think. Vitest docs (test/api.mdx, fn.each): example:

```js
test.each([[1, 2, 3], [4, 5, 6]])('adds %i and %i', (a, b, expected) => {...})
```

They show printf-style. And jest supports $1. Vitest's each: I think vitest supports both `#` and `$#`? Honestly, the most safe title format is plain text with no placeholders, or printf-style `%s` which is definitely supported (jest's util.format, vitest uses pretty-format + its own fmt… vitest's each title formatting: supports `#`, `$#`, `%s`, `%d`, etc. via a jest-compatible util).

Hmm, risk assessment: if `$1` isn't supported, the title would show literally as `$1/$3/...` — the test still runs, the assertion unaffected. The mechanical grader probably runs the suite (vitest) and checks pass + assertions. Bad titles don't fail tests. But for quality, let me use printf verbs which are definitely supported in both jest and vitest: `'$openedAt'`? No.

Actually, let me recall vitest's source: `packages/vitest/src/integrations/vi.ts` or `each.ts` — vitest's each has `normalizeTestArguments` and the title formatting uses `formatTestName`… vitest supports `#` (test index) in titles. And I'm fairly sure vitest supports jest-style `$1` too? Hmm.

Let me look at what I know: vitest docs for `test.each`:

> ```js
> test.each([
>   [1, 2, 3],
>   [4, 5, 9],
> ])('$1 + $2 = $3', (a, b, expected) => {
>   expect(a + b).toBe(expected)
> })
> ```

Yes! I'm fairly sure the vitest docs use exactly `$1 + $2 = $3`. So `$1..$5` is safe.

Alternatively, I'll use it to be bulletproof: `it.each(BASE_ROWS)('$1/$2/$3/$4 -> $5 cents')` — the order: openedAt/type/complexity/table/bandFee → `$1/$2/$3/$4 -> $5 cents`. I had written `$1/$3/$2/$4` (swapped type and complexity to read "date/STANDARD/1/2019"). `$1/$3/$2` is fine if positional placeholders work. Let me simplify to `$1/$2/$3/$4 -> $5 cents` → "2020-06-15/STANDARD/1/2019 -> 12000 cents". Same thing, no need to swap.

Now let me finalize the header comment and check that there's no `ASSUMPTION` needed. Are there any genuinely unresolved symbols? No — I'm importing from an existing module whose API I was shown. No assumptions needed. The task said to mark assumptions if a symbol is truly absent; none are.

Also: should I include the `CaseType` type in the tests? Not necessary.

One more check — `import { calculateFee } from '../feeCalculator';` — file is at root `feeCalculator.ts`, test is at `test/fee-calculator.spec.ts` → `../feeCalculator` ✓.

ESM: with "type": "module" and vitest, extensionless TS imports are resolved by vite ✓.

Now let me finalize the FINDINGS.md content (per the draft above). Let me refine the wording, keep it professional, and make sure the "proposed fix — not applied" is explicit for each.

Also the header of FINDINGS should mention the deliverable relationship: the suite is `test/fee-calculator.spec.ts`.

Let me also double-check the claim in finding #1: "base fees ~10-15% lower." 2021 vs 2022: STANDARD b1 13500 vs 15000 (−10%), b4 44500 vs 49000 (−9.2%), COMM b1 24000 vs 26500 (−9.4%), APPEAL b4 99000 vs 109000 (−9.2%). So "~9-10% lower" is more accurate. Let me say "roughly 9-10% lower" — compute: 13500/15000 = 0.9 → −10%; 20500/22500 = 0.911 → −8.9%; 29500/32500 = 0.9077 → −9.2%; 44500/49000 = 0.908 → −9.2%; 24000/26500 = 0.9057 → −9.4%; 34000/37500 = 0.9067; 48500/53500 = 0.9065; 73000/80500 = 0.9068; 19500/21500 = 0.907; 28000/31000 = 0.903; 42500/47000 = 0.904; 64500/71000 = 0.908; 32500/36000 = 0.903; 45500/50000 = 0.91; 66000/72500 = 0.910; 99000/109000 = 0.908. So ~9-10% lower. I'll write "roughly 9-10% lower base fees, urgency 15% instead of 18%".

Finding #6 example numbers re-verify: opened '2021-05-10' → 2021 table ✓ (>= 2021-01-01). deadline '2021-05-18'. now '2021-05-10' → 8 days → off → 13500 ✓. now '2021-05-16' → 2 days → on → 15525 ✓.

Finding #7: opened '2021-05-01', deadline '2021-05-03', now '2021-05-10': daysBetween('2021-05-10','2021-05-03') = −7 → urgency 2025, total 15525 ✓.

Finding #3: complexity 2.5, opened '2021-06-15', now '2021-05-10': table 2021; bands[1.5] undefined; bandFee undefined; no deadline → urgency 0; expedited false → 0; total = undefined + 0 + 0 = NaN ✓. With expedited: pctOf(undefined, 12) = Math.round(NaN) = NaN ✓.

Note: `undefined + 0 + 0` → NaN ✓ (undefined coerces to NaN in addition).

Finding #8 example re-verify: 2019 STD b2: 18500, urgency 2775, (18500+2775)=21275, 10% = 2127.5 → 2128, total 23403 ✓.

All good. Let me also include in FINDINGS a short intro that enumerates the pinned locations (test names) for traceability. I have "Pinned by" per finding. Good.

Length/format: FINDINGS.md is markdown — fenced code blocks inside are fine; the outer fence is markdown; the inner ```ts blocks are fine (the outer fence is the file's fence in the response format; the inner triple-backticks would… wait — the response format: one fenced block per file. If FINDINGS.md contains its own ``` fences, does that break parsing? The parser looks for a fenced block after the heading — the fence opens with ``` and closes at the first line that is exactly ``` (or same-length). Inner triple-backticks would close the outer fence early!

Danger. The format says: "For each file, a level-3 heading with only its repo-relative path, immediately followed by one fenced block containing only the file's contents." If the file's contents contain ``` sequences, a naive parser sees the first inner ``` as the fence closer.

How to handle? Options:
1. Avoid triple backticks inside FINDINGS.md — use indented code blocks (4-space indent) instead of fenced code blocks. That's safe.
2. Use a longer outer fence (````) — but the format probably expects a standard fence; a ```` fence might break the mechanical parser expecting ```.

Safest: write FINDINGS.md without any triple-backtick lines — use 4-space-indented code for the reproduction snippets. Markdown indented code blocks are valid markdown.

Alternatively, avoid code blocks entirely in FINDINGS.md and use inline code (single backticks). Inline backticks are safe (a single ` doesn't close a fence). Let me use inline code for expressions, and 4-space indent for multi-line reproductions. Actually, even simpler: use inline code for the reproductions, mostly single-line: `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2022-07-01')` — inline. Multi-line → 4-space indent block.

Also, does the test file contain backticks? Template literals? I don't use template literals in my test file (titles are static strings). No backtick characters in the test file? Comments: I write `'2022-07-01T00:00:00Z'` with single quotes — no problem. No backticks anywhere in the .ts file. ✓.

Now let me also confirm: no `#` in the it.each titles. Fine.

Let me write FINDINGS.md fully, with 4-space-indented code blocks:

```md
# FINDINGS — `feeCalculator.ts`

Companion to the characterization suite `test/fee-calculator.spec.ts`. Every
item below is pinned AS IT IS by a flagged test in that suite (title prefix
`BUG:` or `QUIRK:`). No fix has been applied; the production file is
untouched. All reproductions are deterministic: the clock is injected through
the module's existing optional `now` parameter, and every date is a fixed
ISO date-only string (parsed as UTC, so timezone-independent).

Blast-radius context: this module's outputs are stored and audited by
billing. Every behavior below — quirk or bug — is already part of the
historical record, so any fix changes the meaning of existing rows and
needs a billing reconciliation before it ships.

## 1. BUG — the 2022 rate revision misses its own effective date

- Where: `tableFor()` — the 2022 cut uses a strict `>` (`openedAt > REVISION_2022`)
  while the 2021 cut uses `>=`.
- Reproducing input:
  - `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2022-07-01')`
    → `{ table: '2021', bandFee: 13500, ... }`
  - `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-02' }, '2022-07-01')`
    → `{ table: '2022', bandFee: 15000, ... }`
- Current behavior: a case opened exactly on 2022-07-01 is billed the 2021
  schedule — base fees roughly 9-10% lower, urgency 15% instead of 18%,
  expedited 12% on the smaller base. The 2022 rates only apply from
  2022-07-02.
- Blast radius: every stored/audited fee with `opened_at = '2022-07-01'`
  (one full day of intake, all types and bands, plus their surcharges) is
  under-charged relative to the intended 2022 schedule.
- Pinned by: `BUG: opened 2022-07-01 (second revision effective date) still
  gets the 2021 schedule`.
- Proposed fix (NOT applied): make the cut inclusive — `openedAt >= REVISION_2022`.
  Shipping it re-bills the 2022-07-01 cohort, so reconcile those rows with
  billing first.

## 2. QUIRK — `openedAt` is compared as a raw string, never parsed

- Where: `tableFor()` compares the input string directly against the
  revision constants.
- Reproducing input:
  - `openedAt: '2022-07-01T00:00:00Z'` → 2022 schedule
  - `openedAt: '2022-07-01'` → 2021 schedule (the same instant)
  - `openedAt: 'garbage'` → 2022 schedule
  - `openedAt: '2021/05/10'` → 2021 schedule
- Current behavior: lexicographic comparison decides the table. A
  datetime-stamped copy of the "buggy day" from #1 bills 2022 rates while
  the bare date bills 2021 rates (a longer string with the same prefix sorts
  after the prefix). Non-ISO values land in whichever table the string
  happens to sort into.
- Blast radius: rows imported with datetime or slash formats are bucketed by
  string accident, not by date. The historical record for 2022-07-01
  contains BOTH schedules, split by storage format.
- Pinned by: the three `QUIRK: ...` tests under "openedAt is compared as a
  raw string".
- Proposed fix (NOT applied): normalize before comparing — parse to a
  `Date` (or validate strict `YYYY-MM-DD` and reject anything else).

## 3. BUG — fractional complexity produces NaN fees

- Where: the clamping block `if (!band || band < 1) band = 1; if (band > 4)
  band = 4;` never rejects non-integers in [1, 4).
- Reproducing input:
  - `calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2021-06-15' }, '2021-05-10')`
    → `{ table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }`
    (`bands[2.5 - 1]` is an out-of-range array index → `undefined`;
    arithmetic on `undefined` → `NaN`.)
  - Same input with `expedited: true` → `expeditedFee: NaN` as well.
  - `complexity: NaN` takes the falsy branch and silently becomes band 1.
- Blast radius: any fee computed with a fractional complexity is NaN; if
  persisted it becomes a hole in billing aggregates, audits and JSON
  exports, with no error marker in the breakdown.
- Pinned by: `BUG: fractional complexity 2.5 ...` tests.
- Proposed fix (NOT applied): validate `Number.isInteger(band)` and throw a
  typed error, or round intentionally (`Math.round`) and then clamp to 1..4.

## 4. QUIRK — degenerate complexity is silently clamped, not rejected

- Where: same clamping block.
- Reproducing input: `complexity: 0`, `-2`, `NaN` → band 1 fee;
  `complexity: 5`, `99` → band 4 fee. Only `null` / `undefined` throws
  (`'complexity is required'`).
- Blast radius: data-entry mistakes (a 0, an empty field parsed as 0) are
  billed as band 1 and are indistinguishable from genuine band-1 cases in
  the stored history. The only "validation" in the module is the missing-
  value throw.
- Pinned by: the `QUIRK: out-of-band complexity ...` tests.
- Proposed fix (NOT applied): reject out-of-range bands with a typed error,
  or record an explicit fallback flag in the breakdown so audits can see it.

## 5. QUIRK — unknown case type silently falls back to STANDARD

- Where: `if (!bands) bands = table.base['STANDARD'];`
- Reproducing input: `type: 'MARITIME'`, `type: ''`, `type: 'standard'`
  (lowercase) → STANDARD rates of whichever table the opened date selects
  (2021 table: 13500 for band 1; 2022 table: 15000).
- Blast radius: the `CaseType` union is decorative — the input field is a
  plain `string` — so old-system imports with unrecognized types were billed
  as STANDARD (over- or under-charge depending on the true type), with no
  flag in the stored breakdown to detect them afterwards.
- Pinned by: the `QUIRK: unknown case type ...` tests.
- Proposed fix (NOT applied): throw on unknown type, or add an explicit
  `fellBackToStandard` marker to the breakdown and alert upstream.

## 6. QUIRK — urgency is anchored to `now` (calculation time), not to the case

- Where: `const ref = now ? now : <wall clock>` and
  `daysBetween(ref, c.deadline) <= 7`.
- Reproducing input:
  - input `{ type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2021-05-18' }`
  - `calculateFee(input, '2021-05-10')` → total 13500 (8 days out: no urgency)
  - `calculateFee(input, '2021-05-16')` → total 15525 (2 days out: urgency)
  - `now` omitted → the real wall clock is used.
- Blast radius: the same stored case re-billed, re-audited or re-migrated on
  different days yields different fees; historical outputs are only
  reproducible if the exact `now` used at billing time is known. This is
  also why the suite injects `now` in every call.
- Pinned by: `QUIRK: urgency is measured against now (calculation time), not
  openedAt`.
- Proposed fix (NOT applied): anchor urgency to a documented, persisted
  reference (e.g. the case's `openedAt`, or the first-computation date
  stored next to the fee).

## 7. QUIRK — a past deadline still earns the urgency surcharge

- Where: `daysBetween(ref, c.deadline) <= 7` has no lower bound.
- Reproducing input:
  - `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2021-05-01', deadline: '2021-05-03' }, '2021-05-10')`
    → `daysBetween = -7`; `-7 <= 7` → `urgencyFee: 2025`, `total: 15525`.
- Blast radius: overdue cases keep earning the urgency percentage on every
  recomputation, indefinitely.
- Pinned by: `QUIRK: a PAST deadline (7 days before now) still earns the
  urgency surcharge`.
- Proposed fix (NOT applied): require `0 <= days <= 7`.

## 8. QUIRK — stepwise `Math.round` (half-up); expedited compounds on the rounded urgency

- Where: `pctOf()` rounds at each step ("rounded at each step since 2019;
  billing reconciles against these"); the expedited percentage is applied to
  `bandFee + urgencyFee`, i.e. on the already-rounded urgency.
- Reproducing input:
  - 2019 schedule, STANDARD band 2, urgent + expedited:
    urgency `18500 * 15% = 2775` (exact); expedited
    `(18500 + 2775) * 10% = 2127.5 -> 2128` (half rounds up);
    `total: 23403`.
  - Down-rounding: 2022 STANDARD band 4 → `6938.4 -> 6938`;
    2022 COMMERCIAL band 1 → `3752.4 -> 3752`.
  - Up-rounding: 2022 COMMERCIAL band 3 → `7575.6 -> 7576`;
    2022 COMMERCIAL band 4 → `11398.8 -> 11399`.
- Note: on the current tables the first step (urgency) never actually
  rounds — every band fee is a multiple of 100 and both urgency percentages
  are integers — so today only the expedited step can lose a fraction of a
  cent. A "cleanup" that rounds only the final total, or that stops
  compounding on the rounded urgency, would silently shift many stored
  fees (the 2127.5 case above is one of them).
- Pinned by: the `rounding: ...` describe block, including the sweep that
  proves the urgency step is exact on all 48 band fees.
- Proposed fix (NOT applied): treat stepwise rounding as the contract. If
  billing ever wants to change it, do a full historical reconciliation
  first; until then, keep the per-step `Math.round`.
```

No triple backticks anywhere ✓. Inline code single backticks ✓ (safe inside fences).

Hmm wait, in #6 I wrote `<wall clock>` — that's fine.

Now, double check the arrow "→" character — fine in markdown/UTF-8.

Let me reconsider: does the task want FINDINGS.md to also include "the fix you propose — not applied" for each item — yes, each has a "Proposed fix (NOT applied)" ✓. "Reproduction input" ✓. "Likely blast radius (saved past fees!)" ✓.

Now, one more scan of the task requirements:

1. "A characterization test suite that pins the current behavior: all case type × complexity band ✓ (48 rows), urgency multipliers ✓ (pct per table + edges), date boundaries of the rate table (inclusive/exclusive edges of both transitions) ✓ (2021-01-01 inclusive; 2022-07-01 exclusive — pinned; plus adjacent days), rounding at each step ✓ (half-up, up, down, exact + sweep), degenerate inputs (zero ✓, negative ✓, unknown case type ✓; plus NaN, fractional, null, undefined, >4)."
2. "Production code untouched ✓. Fake clock only via `now` ✓."
3. "Pin quirks and bugs as-is with flagging test names ✓; document each in FINDINGS.md with reproduction input, blast radius, proposed fix not applied ✓."
4. "Deterministic; no real dates, no randomness ✓."

Deliver: suite + FINDINGS.md ✓.

Now the format of the response: begin with the first heading; only the heading + fenced block pattern; nothing else. Two files.

File paths: `test/fee-calculator.spec.ts` and `FINDINGS.md`.

Wait — one more consideration about the test file name. The layout convention: `test/<feature>.spec.ts`. The feature is… the module `feeCalculator`. The kebab-case convention for TS files: `fee-calculator.spec.ts`. I'm confident in `test/fee-calculator.spec.ts`.

Let me double-check the TS strictness of the test file once more:

- `BASE_ROWS` is a typed tuple array ✓.
- `it.each(BASE_ROWS)('$1/$2/$3/$4 -> $5 cents', (openedAt, type, complexity, table, bandFee) => {...})` — vitest's each with an array of tuples: the callback receives the tuple's elements ✓.
- `makeCase` return: `{ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', ...overrides }` → `CaseInput` ✓ (deadline/expedited optional).
- `fee(input, now: string = NOW)` ✓.
- `expect(() => fee(...)).toThrow('complexity is required')` ✓.
- `r.bandFee` is typed `number`; `expect(r.bandFee).toBeUndefined()` — TS is fine (toBeUndefined takes actual: any).
- Sweep: `for (const [openedAt, type, complexity, table, bandFee] of BASE_ROWS)` — destructuring a typed tuple ✓. `urgencyPct[table]` — `table` is a union ✓.
- Invariant: samples are typed `Array<[CaseInput, string]>` ✓.

No unused imports: `describe, expect, it` all used; `calculateFee`, `CaseInput`, `FeeBreakdown` used ✓.

One subtle: `makeCase({ complexity: undefined })` — the object literal `{ complexity: undefined }` is assignable to `Partial<CaseInput>` ✓ (without exactOptionalPropertyTypes).

Also `makeCase({ type: '' })` ✓.

Now — the `it.each` title: `'$1/$2/$3/$4 -> $5 cents'` produces e.g. `2020-06-15/STANDARD/1/2019 -> 12000 cents` ✓ readable.

Hmm, one risk: vitest's `each` title placeholders — if a version doesn't support `$n`, the title would be literal. The test still passes. Acceptable.

Also, verify the `toEqual` full-object match: the returned object has exactly keys table, bandFee, urgencyFee, expeditedFee, total ✓ (source returns exactly those). toEqual checks deep equality and fails on extra/missing keys (undefined-valued keys: the source's keys are always present; in the NaN case, `bandFee: undefined` — I avoid toEqual there ✓).

In the NaN test: `r.urgencyFee` is `0` (no deadline) ✓; `r.expeditedFee` is `0` (no expedited) ✓.

Second NaN test (expedited): `r.bandFee` undefined, `r.urgencyFee` 0, `r.expeditedFee` NaN, `r.total` NaN. I assert expeditedFee NaN and total NaN ✓.

Let me reconsider whether `daysBetween` could be off due to DST — date-only ISO strings parse as UTC (per ES2015+ spec) → no local tz → no DST effect ✓. I'll note in the header.

Edge: `new Date('2021-05-17')` — valid ✓.

Now, one more potential pitfall: `Math.floor(ms / 86400000)` for exact multiples → integer ✓.

OK. Also, let me think: should I add a test for the default `now` (no `now` passed) behavior? Non-deterministic — I can't pin. I'll note in FINDINGS #6 that the suite always injects. ✓.

I think I'm ready to write the final answer. Also let me confirm no prose outside the heading/fence pattern. Begin with `### test/fee-calculator.spec.ts`.

Let me assemble the final test file text in full, carefully.

Also — the header comment in the test file mentions `FINDINGS.md` — good traceability.

Let me count the describe blocks:
1. base fee (48 rows)
2. rate table selection boundaries
3. QUIRK string comparison
4. urgency
5. expedited
6. rounding
7. degenerate inputs
8. breakdown invariants

Good coverage.

One more sanity check on the boundary test '2019-01-01': '2019-01-01' >= '2021-01-01'? '2019...' < '2021...' → false → 2019 ✓.

And '2023-11-30' > '2022-07-01' → true → 2022 ✓.

Now let me write the final. In the FINDINGS, keep `->` rather than `→`? Either works; I'll use `→`, fine in UTF-8. Actually for parser safety (though markdown isn't parsed), either is fine. I'll keep `→`.

Also the file's first line should be meaningful. In the test file I start with a comment block. Good.

Final check on format compliance: "Nothing outside that pattern is read." So I output exactly:

### test/fee-calculator.spec.ts
```ts
...
```

### FINDINGS.md
```md
...
```

Wait — the inner content of FINDINGS.md contains no ``` lines, so the outer fence closes correctly at the end. ✓. And the ts file contains no backticks at all. Let me scan the ts draft for backticks… comments use single quotes; titles use single quotes; no template literals. ✓.

In FINDINGS.md, I use many inline single-backticks — each is a paired `...` on the same line; no line consisting of three or more backticks. Let me make sure no line accidentally starts with ```… none.

Also in FINDINGS #6 I have `<wall clock>` — angle brackets are fine.

Let me write it out.

Actually, one more consideration: the sweep test's title "urgency step (step one) loses no cents on any current band fee" — good, behavioral.

And I should double-check the `toEqual` in the 'urgency percentage per table' test — two separate expectations, fine.

Also, in the "no deadline -> no urgency, even when expedited" test: opened '2021-05-01', now '2021-05-10', no deadline → urgency 0; expedited 12% of 13500 = 1620; total 15120 ✓.

Done — let me produce the final answer.
```

## reply

### test/fee-calculator.spec.ts
```ts
// test/fee-calculator.spec.ts
//
// Characterization suite for feeCalculator.ts (in production since 2019;
// its outputs are stored and audited by billing).
//
// Goal: pin the module's CURRENT behavior -- quirks and bugs included -- so
// the planned modifications next month cannot silently change audited fee
// history. Quirks and bugs are pinned AS THEY ARE and are flagged in the
// test name with a `QUIRK:` or `BUG:` prefix. For each one, see FINDINGS.md:
// reproducing input, likely blast radius, and the proposed (deliberately NOT
// applied) fix.
//
// Determinism:
//   * The fake clock is injected ONLY through the module's existing optional
//     `now` parameter. Every call below passes it; the real wall clock never
//     runs in this suite.
//   * All dates are fixed ISO date-only strings, which the ES spec parses as
//     UTC -- the suite has no timezone or environment dependence.
//   * No randomness anywhere.
//
// Production code is untouched by this suite.

import { describe, expect, it } from 'vitest';

import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';

/** Fixed reference clock used unless a test states otherwise. */
const NOW = '2021-05-10';

/** Default case: 2021 schedule (opened 2021-06-15), STANDARD band 1. */
function makeCase(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2021-06-15',
    ...overrides,
  };
}

/** Always inject the clock -- never rely on the wall clock. */
function fee(input: CaseInput, now: string = NOW): FeeBreakdown {
  return calculateFee(input, now);
}

/**
 * Every case type x complexity band x rate table.
 * Row: [openedAt, type, complexity, table, expectedBandFee (cents)]
 */
const BASE_ROWS: Array<[string, string, number, '2019' | '2021' | '2022', number]> = [
  // 2019 schedule -- opened before 2021-01-01
  ['2020-06-15', 'STANDARD', 1, '2019', 12000],
  ['2020-06-15', 'STANDARD', 2, '2019', 18500],
  ['2020-06-15', 'STANDARD', 3, '2019', 27000],
  ['2020-06-15', 'STANDARD', 4, '2019', 41000],
  ['2020-06-15', 'COMMERCIAL', 1, '2019', 22000],
  ['2020-06-15', 'COMMERCIAL', 2, '2019', 31500],
  ['2020-06-15', 'COMMERCIAL', 3, '2019', 45000],
  ['2020-06-15', 'COMMERCIAL', 4, '2019', 68000],
  ['2020-06-15', 'ESTATE', 1, '2019', 18000],
  ['2020-06-15', 'ESTATE', 2, '2019', 26000],
  ['2020-06-15', 'ESTATE', 3, '2019', 39500],
  ['2020-06-15', 'ESTATE', 4, '2019', 60000],
  ['2020-06-15', 'APPEAL', 1, '2019', 30000],
  ['2020-06-15', 'APPEAL', 2, '2019', 42000],
  ['2020-06-15', 'APPEAL', 3, '2019', 61000],
  ['2020-06-15', 'APPEAL', 4, '2019', 92000],
  // 2021 schedule -- opened 2021-01-01 .. 2022-06-30
  // (and, by BUG #1 in FINDINGS.md, also on 2022-07-01 itself)
  ['2021-06-15', 'STANDARD', 1, '2021', 13500],
  ['2021-06-15', 'STANDARD', 2, '2021', 20500],
  ['2021-06-15', 'STANDARD', 3, '2021', 29500],
  ['2021-06-15', 'STANDARD', 4, '2021', 44500],
  ['2021-06-15', 'COMMERCIAL', 1, '2021', 24000],
  ['2021-06-15', 'COMMERCIAL', 2, '2021', 34000],
  ['2021-06-15', 'COMMERCIAL', 3, '2021', 48500],
  ['2021-06-15', 'COMMERCIAL', 4, '2021', 73000],
  ['2021-06-15', 'ESTATE', 1, '2021', 19500],
  ['2021-06-15', 'ESTATE', 2, '2021', 28000],
  ['2021-06-15', 'ESTATE', 3, '2021', 42500],
  ['2021-06-15', 'ESTATE', 4, '2021', 64500],
  ['2021-06-15', 'APPEAL', 1, '2021', 32500],
  ['2021-06-15', 'APPEAL', 2, '2021', 45500],
  ['2021-06-15', 'APPEAL', 3, '2021', 66000],
  ['2021-06-15', 'APPEAL', 4, '2021', 99000],
  // 2022 schedule -- opened after 2022-07-01
  ['2023-03-15', 'STANDARD', 1, '2022', 15000],
  ['2023-03-15', 'STANDARD', 2, '2022', 22500],
  ['2023-03-15', 'STANDARD', 3, '2022', 32500],
  ['2023-03-15', 'STANDARD', 4, '2022', 49000],
  ['2023-03-15', 'COMMERCIAL', 1, '2022', 26500],
  ['2023-03-15', 'COMMERCIAL', 2, '2022', 37500],
  ['2023-03-15', 'COMMERCIAL', 3, '2022', 53500],
  ['2023-03-15', 'COMMERCIAL', 4, '2022', 80500],
  ['2023-03-15', 'ESTATE', 1, '2022', 21500],
  ['2023-03-15', 'ESTATE', 2, '2022', 31000],
  ['2023-03-15', 'ESTATE', 3, '2022', 47000],
  ['2023-03-15', 'ESTATE', 4, '2022', 71000],
  ['2023-03-15', 'APPEAL', 1, '2022', 36000],
  ['2023-03-15', 'APPEAL', 2, '2022', 50000],
  ['2023-03-15', 'APPEAL', 3, '2022', 72500],
  ['2023-03-15', 'APPEAL', 4, '2022', 109000],
];

describe('base fee: every case type x complexity band x rate table', () => {
  it.each(BASE_ROWS)('$1/$2/$3/$4 -> $5 cents', (openedAt, type, complexity, table, bandFee) => {
    expect(fee(makeCase({ openedAt, type, complexity }))).toEqual({
      table,
      bandFee,
      urgencyFee: 0,
      expeditedFee: 0,
      total: bandFee,
    });
  });
});

describe('rate table selection: revision date boundaries (inclusive/exclusive edges)', () => {
  it('opened 2019-01-01 (earliest plausible date) -> 2019 schedule', () => {
    expect(fee(makeCase({ openedAt: '2019-01-01' }))).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 12000,
    });
  });

  it('opened 2020-12-31 (day before first revision) -> 2019 schedule', () => {
    expect(fee(makeCase({ openedAt: '2020-12-31' }))).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 12000,
    });
  });

  it('opened 2021-01-01 (first revision effective date, INCLUSIVE edge) -> 2021 schedule', () => {
    expect(fee(makeCase({ openedAt: '2021-01-01' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });

  it('opened 2022-06-30 (day before second revision) -> 2021 schedule', () => {
    expect(fee(makeCase({ openedAt: '2022-06-30' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });

  it('BUG: opened 2022-07-01 (second revision effective date) still gets the 2021 schedule', () => {
    // Pinned as-is: tableFor() uses `openedAt > REVISION_2022` (strict), so
    // the 2022 rates only kick in from 2022-07-02 -- one day late compared
    // to the inclusive 2021 cut. See FINDINGS.md #1.
    expect(fee(makeCase({ openedAt: '2022-07-01' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });

  it('opened 2022-07-02 (day after second revision) -> 2022 schedule', () => {
    expect(fee(makeCase({ openedAt: '2022-07-02' }))).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('opened 2023-11-30 (no later revision exists) -> 2022 schedule', () => {
    expect(fee(makeCase({ openedAt: '2023-11-30' }))).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });
});

describe('QUIRK: openedAt is compared as a raw string, not parsed as a date', () => {
  it('QUIRK: the same instant as "2022-07-01" but with a time part gets the 2022 schedule', () => {
    // '2022-07-01T00:00:00Z' > '2022-07-01' lexicographically (longer string,
    // same prefix), so a datetime-stamped copy of the "buggy day" (FINDINGS.md
    // #1) bills 2022 rates while the bare date bills 2021 rates.
    expect(fee(makeCase({ openedAt: '2022-07-01T00:00:00Z' }))).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('QUIRK: non-ISO openedAt "garbage" sorts after both revisions -> 2022 schedule', () => {
    expect(fee(makeCase({ openedAt: 'garbage' }))).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('QUIRK: slash-separated openedAt "2021/05/10" lands in 2021 by string accident', () => {
    expect(fee(makeCase({ openedAt: '2021/05/10' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });
});

describe('urgency surcharge: deadline within 7 days of now', () => {
  it('deadline exactly 7 days ahead of now -> urgency applies (inclusive edge)', () => {
    // 2021 schedule, STANDARD band 1: 15% of 13500 = 2025.
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-17' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 0,
      total: 15525,
    });
  });

  it('deadline 8 days ahead of now -> no urgency (exclusive edge)', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-18' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });

  it('deadline on the day of now (0 days) -> urgency applies', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-10' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 0,
      total: 15525,
    });
  });

  it('QUIRK: a PAST deadline (7 days before now) still earns the urgency surcharge', () => {
    // daysBetween(now, deadline) = -7, and -7 <= 7. FINDINGS.md #7.
    expect(fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-03' }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 0,
      total: 15525,
    });
  });

  it('urgency percentage per table: 15% (2019), 15% (2021), 18% (2022)', () => {
    expect(fee(makeCase({ openedAt: '2020-05-01', deadline: '2021-05-17' }))).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 1800,
      expeditedFee: 0,
      total: 13800,
    });
    expect(fee(makeCase({ openedAt: '2023-03-01', deadline: '2023-03-22' }), '2023-03-15')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 2700,
      expeditedFee: 0,
      total: 17700,
    });
  });

  it('QUIRK: urgency is measured against now (calculation time), not openedAt', () => {
    // Same stored case; only the injected clock moves. FINDINGS.md #6.
    const input = makeCase({ openedAt: '2021-05-10', deadline: '2021-05-18' });
    expect(fee(input, '2021-05-10')).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    }); // 8 days out at that moment -> no urgency
    expect(fee(input, '2021-05-16')).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 0,
      total: 15525,
    }); // 2 days out at that moment -> urgency
  });

  it('no deadline -> no urgency, even when expedited', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', expedited: true }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 1620,
      total: 15120,
    });
  });
});

describe('expedited surcharge: percentage on (bandFee + urgencyFee)', () => {
  it('not urgent: 2019 -> 10% of band fee', () => {
    expect(fee(makeCase({ openedAt: '2020-05-01', expedited: true }))).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 0,
      expeditedFee: 1200,
      total: 13200,
    });
  });

  it('not urgent: 2021 -> 12% of band fee', () => {
    expect(fee(makeCase({ openedAt: '2021-05-01', expedited: true }))).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 1620,
      total: 15120,
    });
  });

  it('not urgent: 2022 -> 12% of band fee', () => {
    expect(fee(makeCase({ openedAt: '2023-03-01', expedited: true }), '2023-03-15')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 1800,
      total: 16800,
    });
  });

  it('compounds on the urgency fee: pct is applied to bandFee + urgencyFee', () => {
    // 2019: (12000 + 1800) * 10% = 1380
    expect(
      fee(makeCase({ openedAt: '2020-05-01', deadline: '2021-05-17', expedited: true })),
    ).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 1800,
      expeditedFee: 1380,
      total: 15180,
    });
    // 2021: (13500 + 2025) * 12% = 1863
    expect(
      fee(makeCase({ openedAt: '2021-05-01', deadline: '2021-05-17', expedited: true })),
    ).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 1863,
      total: 17388,
    });
    // 2022: (15000 + 2700) * 12% = 2124
    expect(
      fee(
        makeCase({ openedAt: '2023-03-01', deadline: '2023-03-22', expedited: true }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 2700,
      expeditedFee: 2124,
      total: 19824,
    });
  });
});

describe('rounding: Math.round (half-up) at each step; expedited compounds on the rounded urgency', () => {
  it('half-cent rounds UP: 2019 STANDARD band 2, urgent+expedited -> 2127.5 -> 2128', () => {
    expect(
      fee(makeCase({ openedAt: '2020-05-01', complexity: 2, deadline: '2021-05-17', expedited: true })),
    ).toEqual({
      table: '2019',
      bandFee: 18500,
      urgencyFee: 2775,
      expeditedFee: 2128,
      total: 23403,
    });
  });

  it('fractional cents round DOWN: 2022 STANDARD band 4 -> 6938.4 -> 6938', () => {
    expect(
      fee(
        makeCase({ openedAt: '2023-03-01', complexity: 4, deadline: '2023-03-22', expedited: true }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 49000,
      urgencyFee: 8820,
      expeditedFee: 6938,
      total: 64758,
    });
  });

  it('fractional cents round DOWN: 2022 COMMERCIAL band 1 -> 3752.4 -> 3752', () => {
    expect(
      fee(
        makeCase({
          openedAt: '2023-03-01',
          type: 'COMMERCIAL',
          deadline: '2023-03-22',
          expedited: true,
        }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 26500,
      urgencyFee: 4770,
      expeditedFee: 3752,
      total: 35022,
    });
  });

  it('fractional cents round UP: 2022 COMMERCIAL band 3 -> 7575.6 -> 7576', () => {
    expect(
      fee(
        makeCase({
          openedAt: '2023-03-01',
          type: 'COMMERCIAL',
          complexity: 3,
          deadline: '2023-03-22',
          expedited: true,
        }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 53500,
      urgencyFee: 9630,
      expeditedFee: 7576,
      total: 70706,
    });
  });

  it('fractional cents round UP: 2022 COMMERCIAL band 4 -> 11398.8 -> 11399', () => {
    expect(
      fee(
        makeCase({
          openedAt: '2023-03-01',
          type: 'COMMERCIAL',
          complexity: 4,
          deadline: '2023-03-22',
          expedited: true,
        }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 80500,
      urgencyFee: 14490,
      expeditedFee: 11399,
      total: 106389,
    });
  });

  it('fractional cents round UP: 2022 ESTATE band 2 -> 4389.6 -> 4390', () => {
    expect(
      fee(
        makeCase({
          openedAt: '2023-03-01',
          type: 'ESTATE',
          complexity: 2,
          deadline: '2023-03-22',
          expedited: true,
        }),
        '2023-03-15',
      ),
    ).toEqual({
      table: '2022',
      bandFee: 31000,
      urgencyFee: 5580,
      expeditedFee: 4390,
      total: 40970,
    });
  });

  it('exact sum needs no rounding: 2021 APPEAL band 4 -> 13662', () => {
    expect(
      fee(
        makeCase({
          openedAt: '2021-05-01',
          type: 'APPEAL',
          complexity: 4,
          deadline: '2021-05-17',
          expedited: true,
        }),
      ),
    ).toEqual({
      table: '2021',
      bandFee: 99000,
      urgencyFee: 14850,
      expeditedFee: 13662,
      total: 127512,
    });
  });

  it('urgency step (step one) loses no cents on any current band fee', () => {
    // Every band fee is a multiple of 100 and both urgency percentages are
    // integers, so 15%/18% of any of them is exact. If the rate tables ever
    // change, this is where the "round at each step" contract shows up at
    // step one. FINDINGS.md #8.
    const urgencyPct: Record<'2019' | '2021' | '2022', number> = { '2019': 15, '2021': 15, '2022': 18 };
    for (const [openedAt, type, complexity, table, bandFee] of BASE_ROWS) {
      const r = fee(makeCase({ openedAt, type, complexity, deadline: '2021-05-17' }));
      expect(r.urgencyFee).toBe((bandFee * urgencyPct[table]) / 100);
      expect(Number.isInteger(r.urgencyFee)).toBe(true);
    }
  });
});

describe('degenerate inputs', () => {
  it('complexity null -> throws "complexity is required"', () => {
    expect(() => fee(makeCase({ complexity: null }))).toThrow('complexity is required');
  });

  it('complexity undefined -> throws "complexity is required"', () => {
    expect(() => fee(makeCase({ complexity: undefined }))).toThrow('complexity is required');
  });

  describe('QUIRK: out-of-band complexity is silently clamped, not rejected', () => {
    it('complexity 0 -> band 1 fee (2021 STANDARD: 13500)', () => {
      expect(fee(makeCase({ complexity: 0 }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('complexity -2 -> band 1 fee', () => {
      expect(fee(makeCase({ complexity: -2 }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('complexity NaN -> band 1 fee (NaN is falsy, takes the same branch as 0)', () => {
      expect(fee(makeCase({ complexity: NaN }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('complexity 5 -> band 4 fee (44500)', () => {
      expect(fee(makeCase({ complexity: 5 }))).toEqual({
        table: '2021',
        bandFee: 44500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 44500,
      });
    });

    it('complexity 99 -> band 4 fee (44500)', () => {
      expect(fee(makeCase({ complexity: 99 }))).toEqual({
        table: '2021',
        bandFee: 44500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 44500,
      });
    });
  });

  describe('BUG: fractional complexity produces NaN fees', () => {
    it('complexity 2.5 -> bandFee undefined, total NaN (array index 1.5 misses)', () => {
      const r = fee(makeCase({ complexity: 2.5 }));
      expect(r.table).toBe('2021');
      expect(r.bandFee).toBeUndefined();
      expect(r.urgencyFee).toBe(0);
      expect(r.expeditedFee).toBe(0);
      expect(Number.isNaN(r.total)).toBe(true);
    });

    it('complexity 2.5 + expedited -> expeditedFee is NaN too', () => {
      const r = fee(makeCase({ complexity: 2.5, expedited: true }));
      expect(Number.isNaN(r.expeditedFee)).toBe(true);
      expect(Number.isNaN(r.total)).toBe(true);
    });
  });

  describe('QUIRK: unknown case type silently falls back to STANDARD rates', () => {
    it('type "MARITIME" (2021 table) -> STANDARD band 1: 13500', () => {
      expect(fee(makeCase({ type: 'MARITIME' }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('type "" (empty) -> STANDARD band 1: 13500', () => {
      expect(fee(makeCase({ type: '' }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('type "standard" (lowercase) -> STANDARD band 1: 13500', () => {
      expect(fee(makeCase({ type: 'standard' }))).toEqual({
        table: '2021',
        bandFee: 13500,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 13500,
      });
    });

    it('fallback is per-table: type "MARITIME" (2022 table) -> STANDARD 2022 band 1: 15000', () => {
      expect(fee(makeCase({ openedAt: '2023-03-15', type: 'MARITIME' }))).toEqual({
        table: '2022',
        bandFee: 15000,
        urgencyFee: 0,
        expeditedFee: 0,
        total: 15000,
      });
    });
  });
});

describe('breakdown invariants', () => {
  it('total is always bandFee + urgencyFee + expeditedFee (no hidden components)', () => {
    const samples: Array<[CaseInput, string]> = [
      [makeCase({ openedAt: '2021-05-01' }), '2021-05-10'],
      [makeCase({ openedAt: '2021-05-01', deadline: '2021-05-17' }), '2021-05-10'],
      [makeCase({ openedAt: '2023-03-01', expedited: true }), '2023-03-15'],
      [
        makeCase({
          openedAt: '2023-03-01',
          type: 'APPEAL',
          complexity: 4,
          deadline: '2023-03-22',
          expedited: true,
        }),
        '2023-03-15',
      ],
    ];
    for (const [input, now] of samples) {
      const r = fee(input, now);
      expect(r.total).toBe(r.bandFee + r.urgencyFee + r.expeditedFee);
    }
  });
});
```

### FINDINGS.md
```md
# FINDINGS — `feeCalculator.ts`

Companion to the characterization suite `test/fee-calculator.spec.ts`. Every
item below is pinned AS IT IS by a flagged test in that suite (title prefix
`BUG:` or `QUIRK:`). No fix has been applied; the production file is
untouched. All reproductions are deterministic: the clock is injected
through the module's existing optional `now` parameter, and every date is a
fixed ISO date-only string (parsed as UTC, so timezone-independent).

Blast-radius context: this module's outputs are stored and audited by
billing. Every behavior below — quirk or bug — is already part of the
historical record, so any fix changes the meaning of existing rows and
needs a billing reconciliation before it ships.

## 1. BUG — the 2022 rate revision misses its own effective date

- Where: `tableFor()` — the 2022 cut uses a strict `>` (`openedAt > REVISION_2022`)
  while the 2021 cut uses `>=`.
- Reproducing input:
  - `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2022-07-01')`
    → `{ table: '2021', bandFee: 13500, ... }`
  - `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-02' }, '2022-07-01')`
    → `{ table: '2022', bandFee: 15000, ... }`
- Current behavior: a case opened exactly on 2022-07-01 is billed the 2021
  schedule — base fees roughly 9–10% lower, urgency 15% instead of 18%,
  expedited 12% on the smaller base. The 2022 rates only apply from
  2022-07-02.
- Blast radius: every stored/audited fee with `opened_at = '2022-07-01'`
  (one full day of intake, all types and bands, plus their surcharges) is
  under-charged relative to the intended 2022 schedule.
- Pinned by: `BUG: opened 2022-07-01 (second revision effective date) still
  gets the 2021 schedule`.
- Proposed fix (NOT applied): make the cut inclusive — `openedAt >= REVISION_2022`.
  Shipping it re-bills the 2022-07-01 cohort, so reconcile those rows with
  billing first.

## 2. QUIRK — `openedAt` is compared as a raw string, never parsed

- Where: `tableFor()` compares the input string directly against the
  revision constants.
- Reproducing input:
  - `openedAt: '2022-07-01T00:00:00Z'` → 2022 schedule
  - `openedAt: '2022-07-01'` → 2021 schedule (the same instant)
  - `openedAt: 'garbage'` → 2022 schedule
  - `openedAt: '2021/05/10'` → 2021 schedule
- Current behavior: lexicographic comparison decides the table. A
  datetime-stamped copy of the "buggy day" from #1 bills 2022 rates while
  the bare date bills 2021 rates (a longer string with the same prefix
  sorts after the prefix). Non-ISO values land in whichever table the
  string happens to sort into.
- Blast radius: rows imported with datetime or slash formats are bucketed by
  string accident, not by date. The historical record for 2022-07-01
  contains BOTH schedules, split by storage format.
- Pinned by: the three `QUIRK:` tests under "openedAt is compared as a raw
  string".
- Proposed fix (NOT applied): normalize before comparing — parse to a
  `Date` (or validate strict `YYYY-MM-DD` and reject anything else).

## 3. BUG — fractional complexity produces NaN fees

- Where: the clamping block `if (!band || band < 1) band = 1; if (band > 4)
  band = 4;` never rejects non-integers in [1, 4).
- Reproducing input:
  - `calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2021-06-15' }, '2021-05-10')`
    → `{ table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }`
    (`bands[2.5 - 1]` is an out-of-range array index → `undefined`;
    arithmetic on `undefined` → `NaN`.)
  - Same input with `expedited: true` → `expeditedFee: NaN` as well.
  - `complexity: NaN` takes the falsy branch and silently becomes band 1.
- Blast radius: any fee computed with a fractional complexity is NaN; if
  persisted it becomes a hole in billing aggregates, audits and JSON
  exports, with no error marker in the breakdown.
- Pinned by: the `BUG: fractional complexity 2.5 ...` tests.
- Proposed fix (NOT applied): validate `Number.isInteger(band)` and throw a
  typed error, or round intentionally (`Math.round`) and then clamp to 1..4.

## 4. QUIRK — degenerate complexity is silently clamped, not rejected

- Where: same clamping block.
- Reproducing input: `complexity: 0`, `-2`, `NaN` → band 1 fee;
  `complexity: 5`, `99` → band 4 fee. Only `null` / `undefined` throws
  (`'complexity is required'`).
- Blast radius: data-entry mistakes (a 0, an empty field parsed as 0) are
  billed as band 1 and are indistinguishable from genuine band-1 cases in
  the stored history. The only "validation" in the module is the missing-
  value throw.
- Pinned by: the `QUIRK: out-of-band complexity ...` tests.
- Proposed fix (NOT applied): reject out-of-range bands with a typed error,
  or record an explicit fallback flag in the breakdown so audits can see it.

## 5. QUIRK — unknown case type silently falls back to STANDARD

- Where: `if (!bands) bands = table.base['STANDARD'];`
- Reproducing input: `type: 'MARITIME'`, `type: ''`, `type: 'standard'`
  (lowercase) → STANDARD rates of whichever table the opened date selects
  (2021 table: 13500 for band 1; 2022 table: 15000).
- Blast radius: the `CaseType` union is decorative — the input field is a
  plain `string` — so old-system imports with unrecognized types were
  billed as STANDARD (over- or under-charge depending on the true type),
  with no flag in the stored breakdown to detect them afterwards.
- Pinned by: the `QUIRK: unknown case type ...` tests.
- Proposed fix (NOT applied): throw on unknown type, or add an explicit
  `fellBackToStandard` marker to the breakdown and alert upstream.

## 6. QUIRK — urgency is anchored to `now` (calculation time), not to the case

- Where: `const ref = now ? now : <wall clock>` and
  `daysBetween(ref, c.deadline) <= 7`.
- Reproducing input:
  - input `{ type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2021-05-18' }`
  - `calculateFee(input, '2021-05-10')` → total 13500 (8 days out: no urgency)
  - `calculateFee(input, '2021-05-16')` → total 15525 (2 days out: urgency)
  - `now` omitted → the real wall clock is used.
- Blast radius: the same stored case re-billed, re-audited or re-migrated on
  different days yields different fees; historical outputs are only
  reproducible if the exact `now` used at billing time is known. This is
  also why the suite injects `now` in every call.
- Pinned by: `QUIRK: urgency is measured against now (calculation time), not
  openedAt`.
- Proposed fix (NOT applied): anchor urgency to a documented, persisted
  reference (e.g. the case's `openedAt`, or the first-computation date
  stored next to the fee).

## 7. QUIRK — a past deadline still earns the urgency surcharge

- Where: `daysBetween(ref, c.deadline) <= 7` has no lower bound.
- Reproducing input:
  - `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2021-05-01', deadline: '2021-05-03' }, '2021-05-10')`
    → `daysBetween = -7`; `-7 <= 7` → `urgencyFee: 2025`, `total: 15525`.
- Blast radius: overdue cases keep earning the urgency percentage on every
  recomputation, indefinitely.
- Pinned by: `QUIRK: a PAST deadline (7 days before now) still earns the
  urgency surcharge`.
- Proposed fix (NOT applied): require `0 <= days <= 7`.

## 8. QUIRK — stepwise `Math.round` (half-up); expedited compounds on the rounded urgency

- Where: `pctOf()` rounds at each step ("rounded at each step since 2019;
  billing reconciles against these"); the expedited percentage is applied to
  `bandFee + urgencyFee`, i.e. on the already-rounded urgency.
- Reproducing input:
  - 2019 schedule, STANDARD band 2, urgent + expedited:
    urgency `18500 * 15% = 2775` (exact); expedited
    `(18500 + 2775) * 10% = 2127.5 -> 2128` (half rounds up);
    `total: 23403`.
  - Down-rounding: 2022 STANDARD band 4 → `6938.4 -> 6938`;
    2022 COMMERCIAL band 1 → `3752.4 -> 3752`.
  - Up-rounding: 2022 COMMERCIAL band 3 → `7575.6 -> 7576`;
    2022 COMMERCIAL band 4 → `11398.8 -> 11399`.
- Note: on the current tables the first step (urgency) never actually
  rounds — every band fee is a multiple of 100 and both urgency percentages
  are integers — so today only the expedited step can lose a fraction of a
  cent. A "cleanup" that rounds only the final total, or that stops
  compounding on the rounded urgency, would silently shift many stored
  fees (the 2127.5 case above is one of them).
- Pinned by: the `rounding: ...` describe block, including the sweep that
  proves the urgency step is exact on all 48 band fees.
- Proposed fix (NOT applied): treat stepwise rounding as the contract. If
  billing ever wants to change it, do a full historical reconciliation
  first; until then, keep the per-step `Math.round`.
```


---
