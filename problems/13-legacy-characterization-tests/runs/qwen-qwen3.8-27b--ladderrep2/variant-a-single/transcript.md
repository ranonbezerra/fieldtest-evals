# Transcript — 13-legacy-characterization-tests / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me analyze the task. I have a fixture `feeCalculator.ts` that needs a characterization test suite. The task is Variant A of "legacy characterization tests."

What I need to do:
1. Build a characterization suite that pins down the current behavior:
   - All case types × all complexity bands (full matrix)
   - Urgency multiplier including boundaries
   - Rate table date boundaries (both transitions, inclusive/exclusive edges)
   - Rounding at each step
   - Degenerate inputs (zero, negative, unknown case type)
2. Don't touch the production code. Only inject a fake clock via the existing optional `now` parameter.
3. Pin down quirks and bugs as-is. Test names should flag them, document in FINDINGS.md:
   - Reproducing input
   - Suspected scope of impact
   - Proposed fix (not applied)
4. Deterministic suite; no real dates, no randomness.

Deliverables: the suite + FINDINGS.md.

Let me carefully analyze `feeCalculator.ts` and identify all behaviors and quirks:

```ts
export type CaseType = 'STANDARD' | 'COMMERCIAL' | 'ESTATE' | 'APPEAL';

export interface CaseInput {
  type: string;
  complexity: number | null; // 1..4 bands
  openedAt: string; // ISO date, e.g. '2021-05-10'
  deadline?: string;
  expedited?: boolean;
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

Key observation: the table selection uses string comparison on ISO dates.

- `openedAt >= '2021-01-01'` → 2021 or later
- `openedAt > '2022-07-01'` → 2022

So the boundary cases:
- openedAt = '2021-01-01' → `'2021-01-01' >= '2021-01-01'` is true, then `'2021-01-01' > '2022-07-01'` is false → RATE_TABLE_2021. Inclusive on 2021-01-01.
- openedAt = '2020-12-31' → `'2020-12-31' >= '2021-01-01'` is false → RATE_TABLE_2019. So the day before is 2019.
- openedAt = '2022-07-01' → `>= '2021-01-01'` true; `> '2022-07-01'` false → RATE_TABLE_2021. So 2022-07-01 itself is still 2021! Exclusive on 2022-07-01.
- openedAt = '2022-07-02' → `> '2022-07-01'` true → RATE_TABLE_2022.

Quirk/bug #1: The 2022 revision is exclusive on its effective date '2022-07-01' — a case opened exactly on 2022-07-01 uses the 2021 table. The header comment says "2022-07: rate revision (see RATE_TABLE_2022)." Intuitively a rate revision dated 2022-07 should apply from 2022-07-01, but the code uses `>` so cases opened on 2022-07-01 get the 2021 rates. This is a genuine bug (asymmetric with the 2021 boundary which is `>=`). This is probably the "at least one genuine bug" mentioned.

Actually wait — is that a bug or intended? The 2021 boundary uses `>=` (inclusive), the 2022 boundary uses `>` (exclusive). This asymmetry is suspicious. The comment says "2022-07: rate revision," suggesting rates changed in July 2022. A case opened on 2022-07-01 is "opened in July 2022," so you'd expect the 2022 rates. So the `>` looks like a bug — an off-by-one on the boundary. I'll flag it.

Also, string comparison on ISO dates: this works correctly for 'YYYY-MM-DD' strings. But what about non-ISO or datetime strings? E.g., '2021-01-01T00:00:00' — string comparison: '2021-01-01T00:00:00' >= '2021-01-01' is true (longer string with same prefix is greater). And '2022-07-01T12:00:00' > '2022-07-01' is true → 2022 table. So a datetime on the revision date lands on the new table, but the plain date '2022-07-01' lands on the old table. This is a quirk worth pinning, but it might be over-testing. Hmm, the spec says "the code picks a table from the case's opening date" — the input is described as ISO date, e.g. '2021-05-10'. I can pin the string-comparison behavior with a note. Actually let me be careful: over-pinning weird datetime behavior might be out of scope. But it is an actual behavior difference. I think it's worth one test + FINDINGS entry as a quirk: table selection is lexicographic string comparison, so any `openedAt` with a time component compares greater than the bare-date constant, flipping the 2022 boundary. This is a genuine "surprising behavior." Let me include it.

Next:

```ts
function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / 86400000);
}
```

`daysBetween(ref, c.deadline)` where ref is `now` (date string 'YYYY-MM-DD') or today's date. Parsing 'YYYY-MM-DD' in JS: `new Date('2021-05-10')` is parsed as UTC midnight. So daysBetween between two 'YYYY-MM-DD' strings is a clean integer day difference regardless of timezone. Good — deterministic.

But note: if `now` is not provided, `new Date().toISOString().slice(0, 10)` — that's the real clock, non-deterministic. The spec says: use the optional `now` parameter for a fake clock and nothing else. So in tests I must always pass `now` (except for tests pinning the default behavior? no — I can't deterministically pin the default. Better to always pass `now`, and document in FINDINGS.md that the default uses the real clock, which we can't deterministically pin — an honest gap/open question). Actually the spec says "if the module needs a clock, it already takes an optional `now` — use it, and nothing else." So always pass `now`. Good.

Urgency:

```ts
if (c.deadline && daysBetween(ref, c.deadline) <= 7) {
  urgencyFee = pctOf(bandFee, table.urgencyPct);
}
```

Boundary: `daysBetween(ref, deadline) <= 7`. Days from now to deadline.
- deadline = now + 7 days → 7 <= 7 → urgent.
- deadline = now + 6 days → 6 <= 7 → urgent.
- deadline = now + 8 days → not urgent.
- deadline = now → 0 → urgent.
- deadline in the past (now - 5 days) → negative → <= 7 → urgent. Quirk: past deadlines still count as urgent. This is a genuine quirk/bug — a case whose deadline has passed 100 days ago still gets the urgency fee. Blast radius: stored historical fees for overdue cases. I'll flag it.

Wait, let me think about what's "intended": the urgency tier was "added after the Silva case" — probably meaning cases with a deadline within 7 days of the fee generation date get an urgency surcharge. Past deadlines continuing to be urgent is probably a bug (the `<=` should be `>= 0 && <= 7`, or the check should be `0 <= days <= 7`). Or maybe it's intended that anything overdue is urgent. I can't know for sure — but it's surprising, and I'll document it as a quirk with a proposed fix, noting the ambiguity.

Another important quirk: `daysBetween` uses `Math.floor(ms / 86400000)`. Both endpoints parsed as UTC midnight (if 'YYYY-MM-DD'), the difference is an exact multiple of 86400000, so floor is exact. If deadline has a time component, e.g. '2021-05-17T00:00:00Z' vs '2021-05-10' → 7 days → fine. But if deadline is '2021-05-17T12:00:00Z' (noon) → ms = 7.5 days → floor = 7. If deadline is '2021-05-16T23:00:00Z' → ms = 6.958 days → floor 6. Hmm, these are edge behaviors but the interface says deadline is an ISO date. I'll keep the tests on bare dates for the boundary. The string-comparison quirk of openedAt I'll pin in one test.

Wait, actually one more subtlety about daysBetween: if `now` (ref) is 'YYYY-MM-DD' (UTC midnight) and deadline is 'YYYY-MM-DD' (UTC midnight), the difference is exact. Good, deterministic across timezones since both are UTC.

Now the clamping logic:

```ts
let band = c.complexity;
if (!band || band < 1) {
  band = 1;
}
if (band > 4) {
  band = 4;
}
const bandFee = bands[band - 1];
```

Quirks:
- `!band` catches 0, NaN, and also… `!0` is true → band 1. `!NaN` is true → band 1. Negative → band 1. So zero, negative, NaN all clamp to band 1.
- `band > 4` → band 4. So 5, 100 → band 4.
- Non-integer band, e.g. 2.5: `!band` is false, `band < 1` is false, `band > 4` is false → `bands[2.5 - 1]` = `bands[1.5]` = `undefined`! Then bandFee = undefined, and all subsequent arithmetic with undefined → NaN. Wait: `bandFee = bands[1.5]` → undefined. Then `urgencyFee = pctOf(bandFee, ...)` = `Math.round((undefined * pct)/100)` = NaN (if deadline triggers). Without urgency, urgencyFee = 0. `expeditedFee = pctOf(bandFee + urgencyFee, ...)` → if expedited: NaN. total = undefined + 0 + 0 = NaN. So a fractional band produces NaN total. Is this a "degenerate input" to pin? The spec says degenerate inputs: zero, negative, unknown case type. Fractional isn't explicitly required but is a genuine behavior. Hmm — asserting NaN with toEqual(NaN) works in vitest (`expect(NaN).toBe(NaN)` works since toBe uses Object.is). I could pin that. But is it in scope? "Every case type × every complexity band" — bands are 1..4. Degenerate: zero, negative, unknown case type. I could add fractional as an extra degenerate case in FINDINGS as an open question. Let me think: should I assert it in the suite? A characterization test that pins NaN behavior is legitimately useful — it tells you that 2.5 → NaN. I'll include a small test pinned in the degenerate section as "fractional band (2.5) produces NaN (pinned quirk)" — this is a real behavior and a potential crash (NaN fees get stored?). Actually wait — JSON.stringify(NaN) → null in JSON. So stored fees would become null. Interesting blast radius. I'll document it.

Hmm but wait, let me reconsider: the task says "degenerate inputs (zero, negative, unknown case type)." The L2 spec adds "missing complexity." Let me cover:
- complexity = null → throws 'complexity is required'
- complexity = undefined → throws (the check is `c.complexity === null || c.complexity === undefined`)
- complexity = 0 → clamps to band 1
- complexity = -1 (negative) → clamps to band 1
- complexity = 5, 100 (> 4) → clamps to band 4
- fractional 2.5 → NaN (pinned)
- unknown type 'PROBATE' → falls back to STANDARD band
- empty string type → fallback
- maybe lower-case 'standard' → fallback (type is case-sensitive; 'standard' is not in base → STANDARD fallback). Good quirk: case-sensitivity.

Unknown type:

```ts
let bands = table.base[c.type];
if (!bands) {
  bands = table.base['STANDARD'];
}
```

Quirk: unknown type silently falls back to STANDARD fees with no flag in the output. The output `table` field only indicates the rate table, not the fallback. So a 'PROBATE' case gets billed as STANDARD — silently. Blast radius: historical fees for imported cases from the old system billed as STANDARD; nobody can distinguish from the breakdown. I'll pin it.

Rounding:

```ts
function pctOf(amount: number, pct: number): number {
  return Math.round((amount * pct) / 100);
}
```

Rounding at each step: urgency fee is rounded from bandFee; expedited fee is computed from (bandFee + urgencyFee) — i.e. on the rounded urgency fee — and then rounded again. So double rounding: the expedited percentage applies to the rounded total. Let me find a case where double rounding differs from single rounding.

Let me compute. urgencyPct is 15 (2019, 2021) or 18 (2022). expeditedPct is 10 (2019) or 12 (2021, 2022).

Need a bandFee where round(bandFee * 0.15) ≠ bandFee*0.15 (i.e. fractional urgency), and then round((bandFee + roundedUrg) * 0.12) differs from round((bandFee + exactUrg) * 0.12).

Band fees are in cents, e.g. 12000, 18500, … 15% of 18500 = 2775 exactly. 15% of 12000 = 1800 exact. 15% of 27000 = 4050. 15% of 41000 = 6150. 22000 → 3300. 31500 → 4725. 45000 → 6750. 68000 → 10200. 18000 → 2700. 26000 → 3900. 39500 → 5925. 60000 → 9000. 30000 → 4500. 42000 → 6300. 61000 → 9150. 92000 → 13800.

2021: 13500 → 2025. 20500 → 3075. 29500 → 4425. 44500 → 6675. 24000 → 3600. 34000 → 5100. 48500 → 7275. 73000 → 10950. 19500 → 2925. 28000 → 4200. 42500 → 6375. 64500 → 9675. 32500 → 4875. 45500 → 6825. 66000 → 9900. 99000 → 14850.

2022 (urgency 18%): 15000 → 2700. 22500 → 4050. 32500 → 5850. 49000 → 8820. 26500 → 4770. 37500 → 6750. 53500 → 9630. 80500 → 14490. 21500 → 3870. 31000 → 5580. 47000 → 8460. 71000 → 12780. 36000 → 6480. 50000 → 9000. 72500 → 13050. 109000 → 19620.

Hmm, all band fees are multiples of 50 cents (50 * 100 = 5000 cents… wait, in cents: 12000 cents = $120.00; 18500 = $185.00; 27000; 41000; all multiples of 100, and many of 500). 15% of X: X*15/100 = 3X/20. For X = 12000: 1800 exact. For X a multiple of 2000, 15% is integer. All these band fees are multiples of 100. 15% of a multiple of 100: 15X/100 = 0.15X; X=100k → 15k; X=18500 → 2775; X=27000→4050; X=39500→5925; X=31500→4725. All integer! Because X is a multiple of 100, 15% = X*3/20, and if X is a multiple of 20, X/20 is integer. X is a multiple of 100 → multiple of 20 → integer. 18%: 18X/100 = 9X/50; X is a multiple of 50 → integer. All band fees are multiples of 100 → multiples of 50 → integer. So for every actual band fee in the table, the urgency fee is exact (no rounding actually happens).

Interesting! So the "rounding at each step" — for the current data, urgency rounding never rounds anything. But expedited: 10% of (bandFee + urgencyFee): 10% → integer if (bandFee+urg) is a multiple of 10. bandFee is multiple of 100, urgency is integer (could be like 2775, which is multiple of 25, not 10? 2775 → 10% = 277.5 → rounds to 278 (Math.round(277.5) = 278, rounds half up)). Yes! Let me find: 2019 STANDARD band 2: bandFee 18500, urgency (15%) = 2775, base for expedited = 21275, expedited 10% = 2127.5 → Math.round → 2128. If we didn't round the urgency first (2775 is exact anyway here)… hmm wait, urgency was exact here. To see the double-rounding difference, we'd need urgency to be non-integer so that rounding it changes the expedited base. But as shown, urgency is always integer for these band fees. So in the current table data, double rounding never changes the result?! Let me double-check: bandFee is always a multiple of 100 cents (all values: 12000, 18500, 27000, 41000, 22000, 31500, 45000, 68000, 18000, 26000, 39500, 60000, 30000, 42000, 61000, 92000, 13500, 20500, 29500, 44500, 24000, 34000, 48500, 73000, 19500, 28000, 42500, 64500, 32500, 45500, 66000, 99000, 15000, 22500, 32500, 49000, 26500, 37500, 53500, 80500, 21500, 31000, 47000, 71000, 36000, 50000, 72500, 109000). Yes, all multiples of 100.

15% of multiple of 100 → multiple of 15 → integer. 18% of multiple of 100 → multiple of 18 → integer. So urgencyFee is always an integer, no rounding actually rounds anything.

Expedited: 10% of (bandFee + urgencyFee): (bandFee + urgencyFee) is a multiple of 100 + multiple of 15… e.g. 18500+2775 = 21275 → 10% = 2127.5 → rounds to 2128. 12% of (bandFee + urgencyFee): e.g. 2021 STANDARD band 1: 13500 + 2025 = 15525 → 12% = 1863 exact. 15525*12/100 = 1863.0. 2021 band 2: 20500+3075 = 23575 → 12% = 2829 exact (23575*0.12 = 2829.0). Hmm 23575 * 12 = 282900 → /100 = 2829 exact. 2021 band 3: 29500+4425=33925 → *12 = 407100 → 4071 exact. 2021 band 4: 44500+6675=51175 → *12=614100 → 6141 exact. Interesting — since urgency = 15% of bandFee, bandFee+urg = 1.15*bandFee; bandFee is multiple of 100 → 1.15*bandFee is a multiple of 115. 12% of multiple of 115: 115*12/100 = 13.8 * k, where k = bandFee/100… 1.15*100k = 115k; 12% = 13.8k. If k is a multiple of 5, integer (69k). If k ≡ 1 mod 5, 13.8k → .8? 13.8*1 = 13.8, 13.8*3=41.4, 13.8*7=96.6, 13.8*9=124.2 — fractional! Example: 2021 STANDARD band 1: bandFee 13500 → k=135, 135 is multiple of 5 → 13.8*135 = 1863 exact. k=135. Band 2: 205 → multiple of 5 → 2829. Band 3: 295 → 4071. Band 4: 445 → 6141. All multiples of 5, damn.

Let me check a case where 12% is fractional: need 115k * 0.12 = 13.8k to be non-integer → k not a multiple of 5 → k ≡ 1,2,3,4 mod 5. In 2021/2022 (12% expedited), band fees: 2021: 135,205,295,445 (×100); 240,340,485,730; 195,280,425,645; 325,455,660,990. All end in 0 or 5 → k multiple of 5. 2022: 150,225,325,490; 265,375,535,805; 215,310,470,710; 360,500,725,1090. All multiples of 5. So with urgency, expedited 12% is always exact.

2019 expedited is 10%: 10% of 1.15*bandFee = 11.5k. k multiple of 5 → 57.5*… 11.5k: k=120 → 1380 exact. k=185 → 2127.5 → not integer! 2019 STANDARD band 2: bandFee 18500, urgency 2775, base 21275, 10% = 2127.5 → rounds to 2128. So the rounding in 2019 does fire for that combination.

Let me check all 2019 combos with urgency+expedited:
- STANDARD: 120 (1800 → 13800 → 1380 exact), 185 (2775 → 21275 → 2127.5 → 2128), 270 (4050 → 31050 → 3105 exact), 410 (6150 → 47150 → 4715 exact).
- COMMERCIAL: 220 (3300 → 25300 → 2530), 315 (4725 → 36225 → 3622.5 → 3623), 450 (6750 → 51750 → 5175), 680 (10200 → 78200 → 7820).
- ESTATE: 180 (2700 → 20700 → 2070), 260 (3900 → 29900 → 2990), 395 (5925 → 45425 → 4542.5 → 4543), 600 (9000 → 69000 → 6900).
- APPEAL: 300 (4500 → 34500 → 3450), 420 (6300 → 48300 → 4830), 610 (9150 → 70150 → 7015), 920 (13800 → 105800 → 10580).

So in 2019, urgency+expedited, half-cent rounding fires for STANDARD band 2 (→2128), COMMERCIAL band 2 (→3623), ESTATE band 3 (→4543). These are the "rounding at each step" cases: Math.round rounds .5 up (2127.5 → 2128, not banker's 2128? Math.round(2127.5) = 2128 yes, half rounds toward +∞). I'll pin these three.

Expedited without urgency: 10%/12% of bandFee: bandFee multiple of 100 → 10% is integer (multiple of 10), 12% → 12k is integer if k multiple of 5… 12*135=1620, exact. All k multiples of 5 → exact. So no rounding fires there.

So "rounding at each step" behavior to pin:
1. Urgency rounding: never actually rounds for current tables (all exact) — I can note this in FINDINGS (an observation: rounding is currently a no-op on urgency for all table values; it would only matter if a band fee changed to not be a multiple of 2000/50). Hmm, actually 15% needs a multiple of 20 (in dollars, 15% of $X cents: X*0.15; X a multiple of 200 cents → integer). All multiples of 100 → integer. OK.
2. Expedited rounding: fires on 2019+urgency for three combos (half-cent rounds up: 2127.5→2128, 3622.5→3623, 4542.5→4543). Also the expedited percentage applies to the rounded urgency fee + bandFee (sequential rounding), which for the current data is identical to applying to the exact value since urgency is always exact — but the structure is "double rounding" and I'll pin the structure by asserting the exact totals, and document that under the current data, sequential rounding is currently indistinguishable from single rounding, but would diverge if a band fee changed to make urgency fractional. That's a nice honest FINDINGS entry: "rounding at each step" is real in the code but dormant except for the three .5 cases.

Now, the "genuine bug" — the strongest candidates:
1. `openedAt > REVISION_2022` (strict) → case opened exactly on 2022-07-01 uses 2021 table; asymmetric with 2021 boundary which is `>=`. The header comment "2022-07: rate revision" suggests 2022-07-01 should be 2022 rates. This is a genuine off-by-one bug. Blast radius: every case opened 2022-07-01 (one day's worth, possibly a small number, but if it's a boundary day, could be a batch of imports). Also any string-comparison weirdness.
2. Past deadlines still trigger urgency (no lower bound). Genuine bug or intended? "Urgent tier" for deadline within 7 days — the `daysBetween(ref, deadline) <= 7` includes negatives. Intended is probably `0 <= days <= 7`. I'll call this a bug with an ambiguity note.

Also `daysBetween` with `Math.floor` on possibly-fractional ms: for bare-date inputs it's exact; not a bug for the documented input format.

Also: `band` is `number | null` in the type, but the check is `!band || band < 1` — 0 → 1. Also negative → 1. That's "clamping," probably intended (comment? no comment). The degenerate behavior of zero/negative is clamping, not throwing — I'll pin it as behavior (maybe a quirk: zero complexity is valid input per the type but silently treated as band 1). I'll pin it as behavior; I'll note in FINDINGS as a quirk of lenient clamping (zero and negative silently become band 1; >4 silently becomes band 4; fractional → NaN).

Hmm, wait — actually let me reconsider: is fractional → NaN a "quirk to pin" or out of scope? It's a degenerate input and the behavior is dramatic (NaN in the breakdown). I'll include it in the suite as a pinned degenerate case with a flag name, and in FINDINGS as a bug/quirk with blast radius (NaN → null in JSON storage). I think that's good behavior-based coverage. The spec explicitly lists degenerate inputs as "zero, negative, unknown case type, missing complexity" — fractional is a bonus. I'll keep it but make clear it's an extra degenerate probe. Actually, hmm, "do exactly what the task asks. Don't create files it doesn't ask for, don't improve code it wasn't asked to change." Adding a fractional test isn't a file; it's within "degenerate inputs" coverage. I'll keep it — a good characterization suite would probe the boundary of the clamping logic. But let me be careful not to bloat. I'll include it as one test.

Now, "missing complexity": `complexity: null` and `complexity: undefined` both throw `Error('complexity is required')`. Note: the type says `number | null`, so `undefined` is out of type but the code handles it. In tests, I'll pass `complexity: null` (typed) and maybe `complexity: undefined` via a cast? If I keep types strict, `complexity: undefined` violates the interface `complexity: number | null`. I can construct the input with `complexity: undefined as unknown as number`? Ugly. Or I test only null, and note in FINDINGS that the code also checks undefined (a dead branch per the type, but reachable if a caller passes an incomplete object — e.g. JSON with missing field gives undefined, not null!). That's actually a real-world path: JSON.parse of `{"type":...,"openedAt":...}` without complexity gives `c.complexity === undefined`. So the undefined check is live. I can construct it in the test by omitting the property via spread: `const input = { type: 'STANDARD', openedAt: '2021-05-10' } as CaseInput;` — that's a lie but honest with a comment? Better: `{ ...base, complexity: undefined } as CaseInput` hmm. Actually in TS, `const c: CaseInput = { type, openedAt, complexity: undefined }` errors because undefined is not in `number | null`. I can do `const c = { type: 'STANDARD', openedAt: '2021-05-10' } as CaseInput;` — casting an object literal with a missing property: `{ type, openedAt } as CaseInput` — would TS allow an `as` cast from a literal with missing property? `as` needs types to "sufficiently overlap"; a literal missing a required property isn't assignable, but a cast through an assertion usually works if the types are comparable… `{ type: string; openedAt: string }` vs `CaseInput` — the former is missing `complexity`; an assertion from `{type, openedAt}` to `CaseInput` is allowed because CaseInput is a supertype-ish? For object types, `A as B` is allowed if A is assignable to B, or B is assignable to A. CaseInput is assignable to {type, openedAt}? CaseInput has all properties of {type, openedAt} plus more — yes, CaseInput is a subtype of that shape, so B (CaseInput) is assignable to A → the assertion is allowed. Good: `{ type: 'STANDARD', openedAt: '2021-05-10' } as CaseInput` will compile. I'll use that with a comment "simulates a record where complexity is missing (JSON without the key)."

Now, matrix: 4 case types × 4 bands × 3 tables = 48 base-fee assertions. Plus urgency variants and expedited variants. A full matrix with urgency+expedited at every cell would be 48 × 3 (urgency on/off × expedited on/off → 4 combos) = 192. That's a lot, but characterization tests can be data-driven. The spec says "the full matrix, not samples" for case types × bands. The urgency multiplier and rate boundaries are separate coverage axes. I think a reasonable design is:

1. `base fee matrix`: for each table (3), each type (4), each band (1-4): assert `bandFee` equals the table value, and `total` equals it (no urgency/expedited). 48 tests or one parameterized describe block. Use `it.each` over a generated array.

2. `urgency applied matrix`: pick a representative `now` per table period? Wait — urgency depends on `now` and `deadline`, not `openedAt`. The table depends on `openedAt`. Urgency % depends on the table (15/15/18). So to test urgency across all three tables I need openedAt in each table period and deadline within 7 days of now. I can use one `now` like '2023-01-15' and deadline '2023-01-20' (5 days), and vary openedAt across the three periods: '2020-06-15' (2019), '2021-06-15' (2021), '2023-01-01' (2022). For each type × band, assert urgencyFee = round(bandFee*pct/100) and total. 48 assertions. Plus expedited on top? Full urgency × expedited matrix: expeditedFee = round((bandFee+urgencyFee)*expPct/100). That's another 48. The spec requires the full matrix on case types × bands; I'll apply urgency and expedited modifiers across the full matrix too — "urgency multiplier" coverage probably just needs all types/bands for each table's pct. To be safe and thorough (and cheap since data-driven), I'll do the full matrix for:
   - base (no modifiers)
   - urgency only
   - expedited only
   - urgency + expedited
   for all 3 tables × 4 types × 4 bands = 192 parameterized tests. That's a strong characterization net and it's all mechanical. Each asserts all four fields (bandFee, urgencyFee, expeditedFee, total) — not hollow: I'll assert the exact numbers computed… wait, I have to be careful: the test must assert the expected values. I'll compute them by hand? I can't run code. I need to write expected values as literals in the test file. If I hard-code 192 × 4 numbers, there's risk of arithmetic error on my part. Alternative: compute expected from the table constants defined in the test (copying the table into the test) — but that risks becoming "re-implement the code in the test" and hollow (if I misread the code, the test mirrors the misread). Hmm.

   Standard practice for characterization tests: expected values should be literals captured from observed behavior. Since I can't run the code, I have to compute by hand. The risk is my arithmetic. Let me be systematic and careful. Actually — a hybrid: define the expected breakdown as literal numbers in a table generated carefully by hand, and cross-check a few by hand in comments. But 192 rows of hand-computed 4-tuples in one reply is error-prone and huge.

   Better approach: parameterize at the level of the fee formula, but with literal per-cell band fees (which I can transcribe directly from the source — transcription, not computation), and compute urgency/expedited with small helper functions in the test that mirror the production rounding (Math.round) — no wait, that re-implements the logic. Hmm.

   Let me think about what "behavior-based coverage — a suite with high percentages and hollow assertions fails" means. Hollow = asserting `expect(result.total).toBeGreaterThan(0)` or asserting only that a call happened. Strong = exact expected values. For the 48 base cells, the expected bandFee is a direct transcription from the table — exact and safe. For urgency, expected = round(bandFee * pct / 100): I can compute by hand per cell — 48 values, mechanical: bandFee × 15 / 100 or × 18 / 100. All integer (shown above) — I computed many above; let me verify all are integer: 15% of a multiple of 100 is always integer (15*100k/100 = 15k). 18% → 18k. Yes all integer, trivial: just bandFee/100 × 15 or × 18. So expected urgency fee = (bandFee/100) * pct. I can compute each: e.g. 12000→1800 (2019), 12000→2160 (2022). These are easy multiplies.

   For expedited: expected = round((bandFee + urgencyFee) * expPct / 100). In 2019 (10%): (bandFee+urg)/10 → e.g. 13800/10=1380; 21275/10 = 2127.5 → 2128. In 2021/2022 (12%): (bandFee+urg)*12/100. Since bandFee+urg = 1.15×100k or 1.18×100k → 115k or 118k (in cents); ×12/100 = 13.8k or 14.16k. k multiple of 5 → 13.8k is integer (e.g. k=135 → 1863); 14.16k: k=150 → 2124; k=225 → 3186; k=325 → 4602; k=490 → 6938.4?? Wait: 2022 STANDARD band 4: bandFee 49000 → k=490. urgency 18% = 8820. base = 57820. 12% = 6938.4 → not integer! Let me recompute: 57820 * 12 / 100 = 693840/100 = 6938.4 → Math.round → 6938. Oh! So in 2022, urgency+expedited can have fractional expedited! Because 18% urgency: bandFee+urg = 1.18 × bandFee = 118k. 12% of that = 14.16k. k=490 → 6938.4. k multiple of 5: 14.16*5 = 70.8 → not integer! I earlier only checked 15% urgency. So 2022 urgency+expedited has fractional cases → rounding fires. Let me enumerate 2022 urgency+expedited:

   urgency = 18% → bandFee+urg = 1.18 × bandFee.
   - STANDARD: 15000→17700→12% = 2124 exact (17700*12/100=2124). 22500→26550→3186 exact (26550*.12=3186). 32500→38350→4602 exact (38350*.12 = 4602.0? 38350*12=460200 → 4602 exact). 49000→57820→6938.4 → 6938.
   - COMMERCIAL: 26500→31270→3752.4 → 3752. 37500→44250→5310 exact (44250*.12=5310). 53500→63130→7575.6 → 7576. 80500→94990→11398.8 → 11399.
   - ESTATE: 21500→25370→3044.4 → 3044. 31000→36580→4389.6 → 4390. 47000→55460→6655.2 → 6655. 71000→83780→10053.6 → 10054.
   - APPEAL: 36000→42480→5097.6 → 5098. 50000→59000→7080 exact (59000*.12 = 7080). 72500→85550→10266 exact (85550*.12: 85550*12=1,026,600 → 10266). 109000→128620→15434.4 → 15434.

   Let me double-check a few:
   - 31270 * 0.12: 31270*12 = 375240 → /100 = 3752.4 → round 3752. ✓
   - 63130*12 = 757560 → 7575.6 → 7576 ✓
   - 94990*12 = 1139880 → 11398.8 → 11399 ✓
   - 25370*12 = 304440 → 3044.4 → 3044 ✓
   - 36580*12 = 438960 → 4389.6 → 4390 ✓
   - 55460*12 = 665520 → 6655.2 → 6655 ✓
   - 83780*12 = 1005360 → 10053.6 → 10054 ✓
   - 42480*12 = 509760 → 5097.6 → 5098 ✓
   - 128620*12 = 1543440 → 15434.4 → 15434 ✓

   And 2021 urgency+expedited (urgency 15%, expedited 12%): bandFee+urg = 1.15 × bandFee = 115k; ×0.12 = 13.8k. k multiple of 5 (all 2021 fees end in 0 or 50): 13.8*5=69 → always integer. So 2021 urgency+expedited: exact, no rounding. Values: k=135→1863, 205→2829, 295→4071, 445→6141, 240→3312, 340→4692, 485→6693, 730→10074, 195→2691, 280→3864, 425→5865, 645→8901, 325→4485, 455→6279, 660→9108, 990→13662.
   Verify: 240→13.8*240 = 3312 ✓. 340 → 4692 ✓. 485 → 6693 ✓ (13.8*485: 13.8*500=6900 minus 13.8*15=207 → 6693 ✓). 730 → 10074 (13.8*730 = 13.8*700=9660 + 13.8*30=414 → 10074 ✓). 195 → 2691 (13.8*200=2760 - 13.8*5=69 → 2691 ✓). 280 → 3864 ✓ (13.8*28=386.4 → ×10 = 3864 ✓). 425 → 5865 (13.8*400=5520+13.8*25=345 → 5865 ✓). 645 → 8901 (13.8*645: 13.8*600=8280 + 13.8*45=621 → 8901 ✓). 325 → 4485 (13.8*325: 13.8*300=4140+13.8*25=345 → 4485 ✓). 455 → 6279 (13.8*455: 13.8*450=6210+13.8*5=69 → 6279 ✓). 660 → 9108 (13.8*66=910.8 → ×10 9108 ✓). 990 → 13662 (13.8*99=1366.2 → 13662 ✓).

   And 2019 urgency+expedited (urgency 15, expedited 10): base = 1.15×bandFee; 10% = 11.5k:
   - STANDARD: k=120 → 1380; 185 → 2127.5 → 2128; 270 → 3105; 410 → 4715.
   - COMMERCIAL: 220 → 2530; 315 → 3622.5 → 3623; 450 → 5175; 680 → 7820.
   - ESTATE: 180 → 2070; 260 → 2990; 395 → 4542.5 → 4543; 600 → 6900.
   - APPEAL: 300 → 3450; 420 → 4830; 610 → 7015; 920 → 10580.
   Verify: 11.5*185 = 2127.5 ✓ → 2128. 11.5*315 = 3622.5 → 3623. 11.5*395 = 4542.5 → 4543. 11.5*220=2530 ✓. 11.5*450=5175 ✓. 11.5*680=7820 ✓. 11.5*180=2070 ✓. 11.5*260=2990 ✓. 11.5*600=6900 ✓. 11.5*300=3450 ✓. 11.5*420=4830 ✓. 11.5*610=7015 ✓. 11.5*920=10580 ✓. 11.5*120=1380 ✓. 11.5*270=3105 ✓. 11.5*410=4715 ✓.

   Expedited only (no urgency): expeditedFee = round(bandFee * expPct / 100) = for 2019: bandFee/10 (k*10 → wait bandFee=100k, 10% = 10k… 100k*0.10 = 10k, integer: k=120→1200). 2021/2022: 12% = 12k: 120→1440, etc. All integer since k integer: 100k * 12/100 = 12k. Yes, integer. So expedited-only rounding never fires. Values are trivial multiplies.

OK so if I want to hand-write all 192 × 4 numbers, that's a big table. Alternatively, structure the tests to assert per-cell with expected values generated from a compact per-cell literal spec. Let me think about the most defensible format:

Option A: One big generated table in the test file:
```ts
const CASES = [
  // table, type, band, bandFee, urgencyFee, expeditedFee, total
  ['2019', 'STANDARD', 1, 12000, 1800, 1200, ...],
  ...
];
```
But total depends on the combo (urgency on/off, expedited on/off). Better: store per-cell bandFee, urg (full matrix), expOnly, both. Hmm.

Option B: Per-cell expected: `bandFee`, `urgencyFee` (if urgent), `expeditedFee` (if expedited and urgent / not), and then compute total in the assertion? Total = bandFee + urgencyFee + expeditedFee — that's re-implementing the sum. Asserting `total: a + b + c` in the test is somewhat hollow (it just checks that total is a sum, which is tautological if I also assert the three components). But total = sum of parts is the definition of the return shape; the real content is in the three components. Hmm, but the spec says "rounding at each step" — the total should equal the rounded-component sum; asserting total as a literal is stronger than asserting it as a sum. I could compute totals by hand too… 192 more numbers. Ugh.

Let me reduce scope smartly while satisfying "full matrix": the full matrix is case types × bands (16 per table, 48 total). The modifier behavior (urgency/expedited) is a separate axis. I can do:

1. **Base matrix (48 cells)**: assert `table`, `bandFee` (literal from the rate table), `urgencyFee: 0`, `expeditedFee: 0`, `total: <same literal>`. Total literal = bandFee literal (transcribed, not computed). Safe.

2. **Urgency matrix (48 cells)**: assert urgencyFee literal (computed: bandFee/100 × pct — trivial), total literal (bandFee + urgencyFee — a simple addition I can do). Actually, for the total, I could just write `bandFee + urgencyFee`… no, a literal is better. Addition of two numbers I've already verified is low-risk. Hmm, but honestly, writing 48 more totals by hand… e.g. 12000+1800=13800, 18500+2775=21275, etc. Doable.

3. **Expedited-only matrix (48 cells)**: expeditedFee literal (bandFee×pct/100, trivial: 10k or 12k), total literal.

4. **Urgency+expedited matrix (48 cells)**: urgencyFee + expeditedFee literals, total literal.

Total: 48 cells × 4 scenarios × up to 4 fields = ~700 literals. That's a lot to write, but mechanical and verifiable. It gives a truly ironclad net: any change to any table entry, any pct, any rounding, any summation, breaks something.

Alternatively, I could reduce: the spec says "the full case types × complexity bands — the full matrix, not samples." That's about the type × band axis. The rate table axis: "both rate table transitions" + boundaries. A reviewer might accept: full 16-cell matrix for base fee per table (48), full matrix for urgency (48), full matrix for urgency+expedited (48) (which pins both modifiers together, including double rounding), and expedited-only… I'll include all four scenarios; I can generate them compactly in a table.

How to keep the file manageable: define a compact spec array of rows `[table, type, band, base, urg, expNoUrg, expWithUrg]`? And then derive scenarios in the test via it.each over the scenarios. Hmm, but "hollow assertion" risk: deriving expected total in the test from the components (total = base+urg+exp) is a tautology. To avoid it, I'll store the total explicitly per scenario? That triples the width. Or: store totals as literals in separate arrays per scenario.

Let me think about a file layout that's clean:

```
test/fee-calculator.spec.ts   (or test/feeCalculator.spec.ts?)
```
The repo's conventions say `test/<feature>.spec.ts`. Feature = fee-calculator? The module is `feeCalculator.ts` at the workspace root. The layout convention in the system prompt is for the NestJS app (`src/<feature>/...`), but this task is a standalone vitest repo (the tsconfig includes `*.ts` at the root, and the workspace has feeCalculator.ts at the root). The task convention (repo-level) says `test/<feature>.spec.ts`. The feature here: "fee-calculator" (kebab-case). I'll name the test `test/fee-calculator.spec.ts`. Hmm, the module file is `feeCalculator.ts` (camelCase, existing). The test convention is kebab-case: `fee-calculator.spec.ts`. I'll go with that.

Also `FINDINGS.md` at the repo root.

Should I add a `vitest.config.ts`? The workspace has a `tsconfig.json` but no package.json, no vitest config. The task says "TypeScript, vitest." The environment probably has vitest available (the grader will run it). Should I create a `package.json`? The instruction: "don't create files it doesn't ask for." The deliverables are: suite + FINDINGS.md. But to run the suite I need vitest configured… the workspace is probably part of a larger setup where vitest is available. The tsconfig has `"types": []` — interesting, this strips global types; vitest's `describe/it/expect` are imported explicitly from 'vitest', so no globals needed. Good — I'll import from 'vitest' explicitly (no globals), which is type-safe even with `types: []`.

Wait — `"include": ["*.ts"]` means tsconfig only includes root-level .ts files, not `test/`. If the grader runs `tsc --noEmit`, test files aren't checked (not in include). If they run vitest, tsconfig include is irrelevant (vitest uses esbuild/swc transform, not project include). Should I modify tsconfig to include `test`? The task says don't touch production code; tsconfig isn't production code, but it isn't asked for. "Do exactly what the task asks. Don't create files it doesn't ask for, don't improve code it wasn't asked to change." I won't touch tsconfig.json. Vitest will work fine regardless.

Hmm, but wait: does the grader expect me to create a `package.json` with a test script? "Deliverables: suite + FINDINGS.md." The reference workspace shows only feeCalculator.ts, statusResolver.ts, tsconfig.json. statusResolver.ts is another module (a distractor / different variant's fixture? Actually it's in the same workspace — but the task is only about feeCalculator). I shouldn't write tests for statusResolver — the task is about the fee calculator. I'll ignore statusResolver entirely.

I won't create a package.json — the environment probably has one (hidden) or vitest runs with defaults. Actually, wait — if there's no package.json, `vitest test/fee-calculator.spec.ts` still works from CLI. I'll trust the harness. The "run twice" acceptance is about determinism. I'll just deliver the two files. Hmm, but what if the harness expects a specific test file name? `test/fee-calculator.spec.ts` matches the convention `test/<feature>.spec.ts`. I'll go with that.

Now — determinism concerns:
- Always pass `now` to calculateFee. ✓
- Date parsing: `new Date('YYYY-MM-DD')` is UTC — deterministic regardless of local TZ. `daysBetween` uses that. `tableFor` uses string comparison — TZ-independent. ✓
- No `Math.random`, no `new Date()` (except when `now` is undefined — I'll never do that). ✓
- One subtlety: if I test the urgency boundary with `now` and deadline as bare dates, daysBetween is exact. ✓

Now the urgency boundary tests (the "boundary that decides urgent vs not"): `daysBetween(now, deadline) <= 7`.
- now = '2023-01-15':
  - deadline '2023-01-22' → 7 days → urgent (inclusive upper edge)
  - deadline '2023-01-23' → 8 days → not urgent (just past the edge)
  - deadline '2023-01-15' → 0 → urgent
  - deadline '2023-01-21' → 6 → urgent (interior)
  - deadline '2023-01-08' → -7 → urgent (past! quirk)
  - deadline '2022-12-31' → -15 → urgent (past, quirk)
  - no deadline (undefined) → not urgent
- Also verify the direction: deadline before now.

I'll use a fixed case for these (e.g. STANDARD band 1, openedAt in 2022 → 18% urgency, or 2021 → 15%). Let me pick openedAt '2021-06-15' (2021 table, urgency 15%): bandFee 13500, urgency 2025.

Also `now` itself: does urgency use `now` for the table? No — table comes from openedAt only. `now` only affects urgency via daysBetween. Good.

Rate table boundaries:
- '2020-12-31' → 2019 table (just before 2021 revision)
- '2021-01-01' → 2021 table (revision day, inclusive `>=`)
- '2021-01-02' → 2021 (after)
- '2022-06-30' → 2021 (just before 2022 revision)
- '2022-07-01' → 2021 (revision day — EXCLUSIVE `>` — flagged bug: pinned as-is)
- '2022-07-02' → 2022 (after)
Assert the `table` field and a sample bandFee (e.g. STANDARD band 1: 12000/13500/15000) to make it concrete.

Also earliest date: '2019-01-01' → 2019 (sanity: anything before 2021 is 2019). And '2018-05-05' (pre-2019, table still 2019 — the table is the "2019" base, but a case opened before 2019 gets it; fine, I'll pin '2019-01-01' and maybe '2018-01-01' to show no lower bound). I'll include one pre-2019 to pin that there's no lower boundary.

String-comparison quirk: openedAt '2022-07-01T00:00:00' vs constant '2022-07-01': '2022-07-01T00:00:00' > '2022-07-01' → true → 2022 table. Whereas bare '2022-07-01' → 2021 table. So same calendar day, different table depending on whether the string has a time component. I'll pin both as a flagged quirk. Is that in scope? It's a real behavior of the table-selection; documenting it in FINDINGS is good. I'll add two small tests.

Also: what about openedAt = '' (empty string)? `'' >= '2021-01-01'` is false → 2019 table. Not asked; skip? It's a degenerate input… the spec's degenerate list: zero, negative, unknown case type, missing complexity. Empty openedAt isn't listed. I'll skip to avoid bloat. Hmm, actually, "degenerate inputs" in the variant statement: "(zero, negative, unknown case type)." Zero/negative = complexity. I'll keep scope tight.

Now, unknown type fallback:
- 'PROBATE' → STANDARD band fee for that table. Pin for all three tables? One per table would be a "sample"; the full-matrix requirement is about known types. For unknown, I'll pin: one unknown type across all three tables (to pin fallback × table), plus case-sensitivity: 'standard' (lowercase) → falls back to STANDARD (pin the case-sensitivity quirk), plus empty string '' → `table.base['']` is undefined → fallback. And the output has no marker for the fallback (assert `table` is normal and no extra field) — the breakdown shape is the same; I'll assert the exact object to show indistinguishability.

Wait, `table.base[c.type]` where c.type = '' → base[''] → undefined → fallback. ✓.

Now, clamping:
- complexity 0 → band 1 fee. (Pinned: `!band` catches 0)
- complexity -3 → band 1.
- complexity -0? Same as 0; skip.
- complexity 1 → band 1 (no change; covered in matrix).
- complexity 4 → band 4 (covered in matrix).
- complexity 5 → band 4 (clamp upper).
- complexity 100 → band 4.
- complexity 2.5 → NaN (pinned; total NaN, bandFee NaN).
- Also complexity 0.5? `!0.5` is false, `0.5 < 1` is true → band 1. That's a fractional-below-1 → clamps to 1. Nice: shows the `< 1` branch differs from `!band`. 0.5 → band 1 fee (not NaN). Pin: complexity 0.5 → band 1. This distinguishes the two clamping branches. Good.
- Also NaN: `complexity: NaN` → `!NaN` is true → band 1. Pin? NaN is a degenerate input; `!NaN` is true. I'll include: complexity NaN → band 1 (pinned: falsy-NaN falls into the `!band` branch). Hmm, is that worth it? It documents that the `!band` check catches NaN, not just 0. Cheap, one test. I'll include it with 2.5 and 0.5 in the same describe.

Missing/null complexity:
- `complexity: null` → throws Error with message 'complexity is required'. Assert with `toThrowError('complexity is required')` or toThrow. I'll assert the exact message.
- Missing property (undefined) → throws same. Via the `as CaseInput` cast trick.

Now, the "genuine bug" — the 2022-07-01 boundary. Let me re-examine if there are other candidate bugs:

1. `if (openedAt > REVISION_2022)` — strict greater → revision day excluded. Compared to the 2021 `>=`. Header comment: "2022-07: rate revision (see RATE_TABLE_2022)." And "2021-01: rate revision (see RATE_TABLE_2021)" with `>=`. Inconsistent → bug (off-by-one). Blast radius: every case opened 2022-07-01 was billed at 2021 rates (lower than 2022 rates → underbilled by the delta; also the 2022 table has higher urgency 18% vs 15%, so urgent cases that day got 15% not 18%). Stored historical fees → audit discrepancy. Fix: `openedAt >= REVISION_2022` (or use Date objects and a consistent comparator). Not applied.

2. Urgency for past deadlines: `daysBetween(ref, deadline) <= 7` with no lower bound → a deadline 10 years in the past is "urgent." Proposed fix: `days >= 0 && days <= 7` (or `0 <= days <= 7`). Ambiguity: maybe intended "overdue = urgent" — but then the 7-day cap is meaningless; the `<= 7` suggests a window ending at 7 days out, and the natural lower bound is 0 (today). Blast radius: urgent fees on all cases with past deadlines at fee-generation time — potentially a large fraction of the historical record (any case where the deadline passed before fee generation). This is a big one. I'll mark it as bug (likely) with an ambiguity note.

3. Fractional band → NaN. A genuine defect (type says 1..4 but no guard). Blast radius: JSON.stringify(NaN) → null; a stored fee of null; or downstream crashes. Fix: reject or clamp non-integer bands (e.g. `band = Math.trunc(band)` or throw on non-integer). I'll mark as bug/quirk.

4. Unknown type silent fallback to STANDARD: a quirk (maybe intentional per the comment "default them"). The comment says intentional ("rare imports from the old system; default them"). So it's a documented quirk, not a bug. Blast radius: imported cases billed as STANDARD with no marker; can't distinguish in the audit. Fix (proposed): include a `fallback: true` flag in the breakdown, or reject unknown types upstream. But since the comment says intentional, I'll frame it as a documented quirk with a visibility gap.

5. Rounding structure: `pctOf` rounds each step; expedited applies to the rounded urgency. Under the current data, urgency is always exact, so sequential rounding is currently indistinguishable from single rounding — but the three 2019 cases and many 2022 cases show expedited rounding does fire (half-up: Math.round rounds .5 toward +∞). I'll pin the .5 cases explicitly with flagged names ("rounds half up, not banker's"). I'll document that the double-rounding path is currently dormant on the urgency step.

6. `now` default: `new Date().toISOString().slice(0, 10)` — the real clock, UTC-based (toISOString is UTC, good — so the default is deterministic in UTC date, but changes day to day). Can't pin in a deterministic suite → open question in FINDINGS: "the default clock path is not exercised in the suite (would make the suite non-deterministic); production urgency depends on the fee-generation date in UTC." That's the honest gap the spec asks for. Also note: since toISOString is UTC, the default "today" is the UTC date — for machines in a UTC-northwest timezone, "today" in local terms may differ; a quirk worth an open-question note.

7. `daysBetween` floor: exact for bare dates; if deadline had a time component, floor truncates partial days toward the past (a deadline 6 days + 23 hours out counts as 6 → urgent even though it's 7 days and 23 hours out… wait floor(6.958) = 6 → urgent; a deadline 7 days + 23 hours out: floor(7.958)=7 → still urgent; 8 days + 0 hours → 8 → not. So the effective window is [now-∞, now+8days), i.e. up to a full 8 calendar days… let me not over-think; the documented format is a bare ISO date, so floor is exact. I'll note in FINDINGS as an open question/observation: if a caller ever passes a datetime deadline, floor truncates the fraction and the effective window widens by less than a day. Not a test (out of the documented input contract) — actually, could I pin it in a test? It's a real behavior… the interface says deadline: string "ISO date." I'll leave it as an open question in FINDINGS rather than pinning an off-contract input. Hmm — a characterization suite could pin it, but the spec says degenerate inputs are that list; I'll keep the suite on-contract and put it in FINDINGS as an open question. That demonstrates honesty.

Also: `urgencyFee` uses `daysBetween(ref, c.deadline) <= 7` — the urgency window is 8 calendar days inclusive (0..7). "Boundary that decides urgent vs not" = 7 days. ✓ I'll pin 7 (urgent) and 8 (not).

Now, one more check — `tableFor` with `openedAt` in a table that has a time component before the revision, e.g. '2020-12-31T23:59:59': `>= '2021-01-01'`? String: '2020-12-31T23:59:59' vs '2021-01-01': '2020...' < '2021...' → 2019. Fine, consistent. And '2021-01-01T00:00:00' → `>= '2021-01-01'` true → 2021 (same as bare). So only the 2022 boundary flips with a time component (because of the strict `>`). Good — my two-string test pinning that is precise: bare '2022-07-01' → 2021; '2022-07-01T00:00:00' → 2022. I'll flag both: the bare-date side is the bug pin, the datetime side is the string-comparison quirk.

Now let me design the test file structure:

```ts
import { describe, it, expect } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput } from '../feeCalculator';
```

Wait — import path: the test is in `test/`, the module is at the root: `../feeCalculator`. ✓. The module has no extension: `../feeCalculator` — with moduleResolution bundler, no-extension imports work. ✓

Helper:

```ts
const fee = (input: CaseInput, now = '2023-01-15') => calculateFee(input, now);
```
Hmm — default parameter `now` in the test: fine, always an explicit date, no real clock. But maybe clearer: always pass now explicitly. I'll write a small builder:

```ts
function caseInput(over: Partial<CaseInput> = {}): CaseInput {
  return { type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', ...over };
}
```
And call `calculateFee(caseInput({...}), now)` with now explicit per test or a shared const NOW. I'll define `const NOW = '2023-01-15'` and pass it everywhere. For the urgency boundary, deadline is relative to NOW.

Actually, for the matrix tests, urgency is off (no deadline) and expedited is off — so `now` is irrelevant (urgencyFee=0 without deadline; now only used in daysBetween when deadline present). Wait: `const ref = now ? now : new Date()...` — ref is computed but only used inside `if (c.deadline && ...)`. If no deadline, ref is unused… actually it's computed unconditionally: `const ref = now ? now : new Date().toISOString().slice(0, 10);` — if now is undefined and no deadline, `new Date()` is still called (harmless, no effect on output). To keep the suite clock-free, I'll pass now everywhere anyway. ✓ (Even in the base matrix I'll pass NOW — belt and suspenders, and it documents the "use the injected clock" rule.)

Now the data table. Let me define:

```ts
// Transcribed verbatim from the rate tables in feeCalculator.ts (source of truth for the base fee).
const BASE: Record<'2019' | '2021' | '2022', Record<CaseType, [number, number, number, number]>> = { ... }
```
Wait — if I transcribe the table into the test and compute expected from it, is that hollow? Base fee: the transcription is the literal pin (48 numbers). If I then compute urgency = round(base*pct/100) in the test, that's re-implementing pctOf — but it's the documented formula, and the value is deterministic. The alternative (hand-writing 144 more literals) is more error-prone for me to produce. Hmm.

Let me weigh: the reviewer's criterion is "behavior-based coverage — a suite with high percentages and hollow assertions fails." Hollow = assertions that don't pin a value (e.g. `toBeGreaterThan(0)`, `toBeDefined`). Asserting `expect(result).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 })` is ironclad. If instead I assert `urgencyFee: Math.round(18500*15/100)` — that's still a specific value, but it derives from a formula that mirrors the code; if the code's rounding changed (say to Math.floor), the test would fail (2775 same… floor(2775)=2775 — no difference; the .5 cases would: floor(2127.5)=2127 ≠ 2128 → test fails ✓ good). Actually deriving via the same Math.round formula would mirror a change to Math.round-identical logic… if someone changes pctOf to `Math.trunc`, my test computing with Math.round would catch it (2127.5 → 2128 vs 2127). If someone changes the formula to apply pct on the unrounded value — my test would mirror if I wrote it the same. The risk of mirroring is real but limited.

I think the strongest, most defensible deliverable is: **literal expected values for every field in every scenario**, hand-computed and triple-checked. Yes it's long, but it's a characterization suite — long tables of pinned numbers are exactly what this artifact should look like. "A suite that passes twice" and "pinned exactly" → literals.

But 192 scenarios × 4 fields… let me count what I actually need as literals:

Per cell (48 cells), per scenario:
- S0 base: {table, bandFee, 0, 0, total=bandFee} → literals: bandFee, total (total == bandFee; I'll write it twice as literal).
- S1 urgency: urgencyFee literal, total literal.
- S2 expedited: expeditedFee literal, total literal.
- S3 both: urgencyFee, expeditedFee (the urgency+expedited version), total literal.

So per cell: bandFee (1), S1 urg (1) + S1 total (1), S2 exp (1) + total (1), S3 urg (same as S1) + S3 exp (1) + total (1) → 8 distinct numbers + table label. 48 × 8 = 384 numbers. All derived from the 48 band fees by simple arithmetic (×0.15, ×0.18, ×0.10, ×0.12, +). I can do this carefully. It'll be a big table but organized. Actually — can I reduce redundancy? S3's urgencyFee equals S1's urgencyFee (same formula, same input). If I store per cell: `base, urg, expNoUrg, expBoth`, then totals: T1 = base+urg, T2 = base+expNoUrg, T3 = base+urg+expBoth. Writing totals as `base + urg` in the test is a tautological sum… but is it? The code computes total = bandFee + urgencyFee + expeditedFee with the rounded components. If I assert total === base+urg+expBoth (literals) and the three components as literals, the sum assertion only checks addition. Addition can't "misbehave" in any interesting way (floats? all integers < 2^53, exact). So asserting the sum is not hollow in any meaningful sense — the addition of integers is not a behavior worth pinning by literal. The rounding behaviors are in the components. So: components as literals, total as the component sum (I'll note this choice in a comment), except for the rounding-specific tests where I also assert a literal total for the .5 cases… hmm, but for consistency and maximum strength, maybe I should just write the totals as literals too. Integer additions like 18500+2775+2128 = 23403 — I can compute them; the risk is my arithmetic error. A single wrong digit = a test that fails = bad deliverable. A wrong sum is just a failing suite, which I can't fix (no tools). Risk management: deriving total as the sum of already-literal components eliminates that arithmetic risk entirely while losing essentially nothing (integer addition is exact in IEEE754 for these magnitudes). I'll do this: `total: base + urg + exp` style, with a comment explaining the components are the pinned values and the sum is exact integer arithmetic. Hmm…

Wait, actually let me reconsider. Is there a scenario where the code's total ≠ sum of components? `total: bandFee + urgencyFee + expeditedFee` — always equal by construction. So asserting the sum of the pinned components is 100% equivalent to asserting the literal total (given the components are right). OK: components as literals; total as sum expression. I'll add a dedicated test asserting, for one cell, that `result.total` equals a fully literal number (23403), to demonstrate the literal style. Actually no — mixing styles is worse. Decision: for every scenario, assert the full object `toEqual({ table, bandFee: L, urgencyFee: L, expeditedFee: L, total: L + L + L })`. Clean.

Hmm, one more consideration: `toEqual` on the whole object also pins the shape (exactly these four keys, no extras). That's good — it pins that the breakdown has no fallback flag (relevant to FINDINGS #4: the fallback is invisible in the output).

Now, let me also double-check the `table` name mapping: `table === RATE_TABLE_2022 ? '2022' : table === RATE_TABLE_2021 ? '2021' : '2019'` — identity comparison, fine.

Now let me compute all the numbers. I'll build a per-cell spec: `[type, band, base2019, base2021, base2022]` and per-table percentages. Let me lay out all 16 cells with the three tables:

| Type | Band | 2019 | 2021 | 2022 |
|---|---|---|---|---|
| STANDARD | 1 | 12000 | 13500 | 15000 |
| STANDARD | 2 | 18500 | 20500 | 22500 |
| STANDARD | 3 | 27000 | 29500 | 32500 |
| STANDARD | 4 | 41000 | 44500 | 49000 |
| COMMERCIAL | 1 | 22000 | 24000 | 26500 |
| COMMERCIAL | 2 | 31500 | 34000 | 37500 |
| COMMERCIAL | 3 | 45000 | 48500 | 53500 |
| COMMERCIAL | 4 | 68000 | 73000 | 80500 |
| ESTATE | 1 | 18000 | 19500 | 21500 |
| ESTATE | 2 | 26000 | 28000 | 31000 |
| ESTATE | 3 | 39500 | 42500 | 47000 |
| ESTATE | 4 | 60000 | 64500 | 71000 |
| APPEAL | 1 | 30000 | 32500 | 36000 |
| APPEAL | 2 | 42000 | 45500 | 50000 |
| APPEAL | 3 | 61000 | 66000 | 72500 |
| APPEAL | 4 | 92000 | 99000 | 109000 |

Urgency (15% for 2019 & 2021; 18% for 2022):
2019/2021 urg = base×0.15:
- 12000→1800; 13500→2025; 15000 (2022: ×0.18→2700)
- 18500→2775; 20500→3075; 22500→4050 (18%)
- 27000→4050; 29500→4425; 32500→5850 (18%)
- 41000→6150; 44500→6675; 49000→8820 (18%)
- 22000→3300; 24000→3600; 26500→4770 (18%)
- 31500→4725; 34000→5100; 37500→6750 (18%)
- 45000→6750; 48500→7275; 53500→9630 (18%)
- 68000→10200; 73000→10950; 80500→14490 (18%)
- 18000→2700; 19500→2925; 21500→3870 (18%)
- 26000→3900; 28000→4200; 31000→5580 (18%)
- 39500→5925; 42500→6375; 47000→8460 (18%)
- 60000→9000; 64500→9675; 71000→12780 (18%)
- 30000→4500; 32500→4875; 36000→6480 (18%)
- 42000→6300; 45500→6825; 50000→9000 (18%)
- 61000→9150; 66000→9900; 72500→13050 (18%)
- 92000→13800; 99000→14850; 109000→19620 (18%)

All integer ✓ (15% of a multiple of 100 → multiple of 15; 18% → multiple of 18).

Expedited only (no urgency): 2019: 10% → base/10:
- 12000→1200; 22000→2200; 18000→1800; 30000→3000
- 18500→1850; 31500→3150; 26000→2600; 42000→4200
- 27000→2700; 45000→4500; 39500→3950; 61000→6100
- 41000→4100; 68000→6800; 60000→6000; 92000→9200
2021: 12% → base×0.12:
- 13500→1620; 20500→2460; 29500→3540; 44500→5340
- 24000→2880; 34000→4080; 48500→5820; 73000→8760
- 19500→2340; 28000→3360; 42500→5100; 64500→7740
- 32500→3900; 45500→5460; 66000→7920; 99000→11880
Verify: 13500×0.12 = 1620 ✓. 20500×0.12=2460 ✓. 29500×0.12=3540 ✓. 44500×0.12=5340 ✓. 24000→2880 ✓. 34000→4080 ✓. 48500→5820 ✓ (485×12=5820). 73000→8760 ✓. 19500→2340 ✓. 28000→3360 ✓. 42500→5100 ✓. 64500→7740 ✓ (645×12=7740). 32500→3900 ✓. 45500→5460 ✓ (455×12=5460). 66000→7920 ✓. 99000→11880 ✓.
2022: 12%:
- 15000→1800; 22500→2700; 32500→3900; 49000→5880
- 26500→3180; 37500→4500; 53500→6420; 80500→9660
- 21500→2580; 31000→3720; 47000→5640; 71000→8520
- 36000→4320; 50000→6000; 72500→8700; 109000→13080
Verify: 15000×.12=1800 ✓; 22500→2700 ✓; 32500→3900 ✓; 49000→5880 ✓ (490×12=5880); 26500→3180 ✓; 37500→4500 ✓; 53500→6420 ✓; 80500→9660 ✓; 21500→2580 ✓; 31000→3720 ✓; 47000→5640 ✓; 71000→8520 ✓; 36000→4320 ✓; 50000→6000 ✓; 72500→8700 ✓; 109000→13080 ✓.

Expedited with urgency:
2019 (urgency 15, expedited 10% of (base+urg) = 11.5% of base):
- STANDARD: 12000→1380; 18500→2127.5→2128; 27000→3105; 41000→4715
- COMMERCIAL: 22000→2530; 31500→3622.5→3623; 45000→5175; 68000→7820
- ESTATE: 18000→2070; 26000→2990; 39500→4542.5→4543; 60000→6900
- APPEAL: 30000→3450; 42000→4830; 61000→7015; 92000→10580
(Computed above; re-verify a few: 41000: urg 6150 → 47150 ×0.1 = 4715 ✓. 68000: 10200 → 78200 → 7820 ✓. 92000: 13800 → 105800 → 10580 ✓. 61000: 9150 → 70150 → 7015 ✓.)

2021 (urgency 15, expedited 12% of (base+urg) = 13.8% of base):
- STANDARD: 13500→1863; 20500→2829; 29500→4071; 44500→6141
- COMMERCIAL: 24000→3312; 34000→4692; 48500→6693; 73000→10074
- ESTATE: 19500→2691; 28000→3864; 42500→5865; 64500→8901
- APPEAL: 32500→4485; 45500→6279; 66000→9108; 99000→13662
(All exact, computed above.)
Verify a couple: 48500: base+urg = 48500+7275 = 55775; ×0.12 = 6693 ✓ (55775×12 = 669300 → 6693). 73000: +10950 = 83950; ×12 = 1007400 → 10074 ✓. 64500: +9675 = 74175; ×12 = 890100 → 8901 ✓. 99000: +14850 = 113850; ×12 = 1366200 → 13662 ✓. 45500: +6825 = 52325; ×12 = 627900 → 6279 ✓. 19500: +2925 = 22425; ×12 = 269100 → 2691 ✓. 28000: +4200 = 32200; ×12 = 386400 → 3864 ✓. 42500: +6375 = 48875; ×12 = 586500 → 5865 ✓. 32500: +4875 = 37375; ×12 = 448500 → 4485 ✓. 66000: +9900 = 75900; ×12 = 910800 → 9108 ✓. 24000: +3600 = 27600 → 3312 ✓. 34000: +5100 = 39100 → 4692 ✓. 13500: +2025 = 15525 → 1863 ✓. 20500: +3075 = 23575 → 2829 ✓. 29500: +4425 = 33925 → 4071 ✓. 44500: +6675 = 51175 → 6141 ✓.

2022 (urgency 18, expedited 12% of (base+urg) = 14.16% of base):
- STANDARD: 15000: +2700 = 17700 → ×0.12 = 2124 exact. 22500: +4050 = 26550 → 3186 exact (26550×12 = 318600). 32500: +5850 = 38350 → 4602 exact (38350×12 = 460200). 49000: +8820 = 57820 → 6938.4 → 6938.
- COMMERCIAL: 26500: +4770 = 31270 → 3752.4 → 3752. 37500: +6750 = 44250 → 5310 exact (44250×12 = 531000). 53500: +9630 = 63130 → 7575.6 → 7576. 80500: +14490 = 94990 → 11398.8 → 11399.
- ESTATE: 21500: +3870 = 25370 → 3044.4 → 3044. 31000: +5580 = 36580 → 4389.6 → 4390. 47000: +8460 = 55460 → 6655.2 → 6655. 71000: +12780 = 83780 → 10053.6 → 10054.
- APPEAL: 36000: +6480 = 42480 → 5097.6 → 5098. 50000: +9000 = 59000 → 7080 exact. 72500: +13050 = 85550 → 10266 exact (85550×12 = 1026600). 109000: +19620 = 128620 → 15434.4 → 15434.
All verified above.

Math.round half-up check: 6938.4 → 6938 ✓ (not a .5 case). The .5 cases only in 2019 (2127.5, 3622.5, 4542.5) — Math.round(x.5) rounds toward +∞ → 2128, 3623, 4543. ✓ (In JS Math.round(2127.5) = 2128. ✓)

Wait, let me also confirm no other .5 or fractional cases in 2022: the fractional ones I listed round .4/.6/.8 → not .5, so no half-up issue. ✓ And 2021: all exact. ✓

Now, per-scenario totals (I'll express as sums in the test, but let me pre-compute a few for the FINDINGS reproducing examples):
- 2019 STANDARD band 2 urgency+expedited: 18500 + 2775 + 2128 = 23403. (18500+2775 = 21275; +2128 = 23403.) ✓
- 2022 APPEAL band 4 urgency+expedited: 109000 + 19620 + 15434 = 144054. (109000+19620 = 128620; +15434 = 144054.) ✓
- 2022-07-01 bug reproducing: openedAt '2022-07-01', STANDARD band 1: returns table '2021', bandFee 13500; '2022-07-02' → '2022', 15000. Delta for that day: 1500. ✓
- Past-deadline reproducing: now '2023-01-15', deadline '2020-01-01' (1096 days past): urgent. bandFee e.g. STANDARD band 1 2021 table (openedAt '2021-05-10'): 13500 + 2025 = 15525.

Now, let me design the spec file layout:

```
test/fee-calculator.spec.ts   (or test/feeCalculator.spec.ts?)
```
Repo convention says `test/<feature>.spec.ts`. Feature = fee-calculator? Module is `feeCalculator.ts` at workspace root. The layout convention in the system prompt is for the NestJS app (`src/<feature>/...`), but this task is a standalone vitest repo (tsconfig includes `*.ts` at root, workspace has feeCalculator.ts at root). The task convention (repo-level) says `test/<feature>.spec.ts`. Feature here: "fee-calculator" (kebab-case). I'll name the test `test/fee-calculator.spec.ts`. Hmm, the module file is `feeCalculator.ts` (camelCase, existing). Test convention is kebab-case: `fee-calculator.spec.ts`. I'll go with that.

Also `FINDINGS.md` at repo root.

Should I add `vitest.config.ts`? The workspace has `tsconfig.json` but no package.json, no vitest config. The task says "TypeScript, vitest." The environment probably has vitest available (the grader will run it). Should I create a `package.json`? The instruction: "don't create files it doesn't ask for." Deliverables: suite + FINDINGS.md. But to run the suite I need vitest configured… the workspace is probably part of a larger setup where vitest is available. tsconfig has `"types": []` — interesting, this strips global types; vitest's `describe/it/expect` are imported explicitly from 'vitest', so no globals needed. Good — I'll import from 'vitest' explicitly (no globals), which is type-safe even with `types: []`.

Wait — `"include": ["*.ts"]` means tsconfig only includes root-level .ts files, not `test/`. If the grader runs `tsc --noEmit`, test files aren't checked (not in include). If they run vitest, tsconfig include is irrelevant (vitest uses esbuild/swc transform, not project include). Should I modify tsconfig to include `test`? The task says don't touch production code; tsconfig isn't production code, but it isn't asked for. "Do exactly what the task asks. Don't create files it doesn't ask for, don't improve code it wasn't asked to change." I won't touch tsconfig.json. Vitest will work fine regardless.

Hmm, but wait: does the grader expect me to create a `package.json` with a test script? "Deliverables: suite + FINDINGS.md." The reference workspace shows only feeCalculator.ts, statusResolver.ts, tsconfig.json. statusResolver.ts is another module (a distractor / different variant's fixture? Actually it's in the same workspace — but the task is only about feeCalculator). I shouldn't write tests for statusResolver — the task is about the fee calculator. I'll ignore statusResolver entirely.

I won't create a package.json — the environment probably has one (hidden) or vitest runs with defaults. Actually, wait — if there's no package.json, `vitest test/fee-calculator.spec.ts` still works from CLI. I'll trust the harness. The "run twice" acceptance is about determinism. I'll just deliver the two files. Hmm, but what if the harness expects a specific test file name? `test/fee-calculator.spec.ts` matches the convention `test/<feature>.spec.ts`. I'll go with that.

Now — determinism concerns:
- Always pass `now` to calculateFee. ✓
- Date parsing: `new Date('YYYY-MM-DD')` is UTC — deterministic regardless of local TZ. `daysBetween` uses that. `tableFor` uses string comparison — TZ-independent. ✓
- No `Math.random`, no `new Date()` (except when `now` is undefined — I'll never do that). ✓
- One subtlety: if I test the urgency boundary with `now` and deadline as bare dates, daysBetween is exact. ✓

Now the urgency boundary tests (the "boundary that decides urgent vs not"): `daysBetween(now, deadline) <= 7`.
- now = '2023-01-15':
  - deadline '2023-01-22' → 7 days → urgent (inclusive upper edge)
  - deadline '2023-01-23' → 8 days → not urgent (just past the edge)
  - deadline '2023-01-15' → 0 → urgent
  - deadline '2023-01-21' → 6 → urgent (interior)
  - deadline '2023-01-08' → -7 → urgent (past! quirk)
  - deadline '2022-12-31' → -15 → urgent (past, quirk)
  - no deadline (undefined) → not urgent
- Also verify the direction: deadline before now.

I'll use a fixed case for these (e.g. STANDARD band 1, openedAt in 2022 → 18% urgency, or 2021 → 15%). Let me pick openedAt '2021-06-15' (2021 table, urgency 15%): bandFee 13500, urgency 2025.

Also `now` itself: does urgency use `now` for the table? No — table comes from openedAt only. `now` only affects urgency via daysBetween. Good.

Rate table boundaries:
- '2020-12-31' → 2019 table (just before 2021 revision)
- '2021-01-01' → 2021 table (revision day, inclusive `>=`)
- '2021-01-02' → 2021 (after)
- '2022-06-30' → 2021 (just before 2022 revision)
- '2022-07-01' → 2021 (revision day — EXCLUSIVE `>` — flagged bug: pinned as-is)
- '2022-07-02' → 2022 (after)
Assert the `table` field and a sample bandFee (e.g. STANDARD band 1: 12000/13500/15000) to make it concrete.

Also earliest date: '2019-01-01' → 2019 (sanity: anything before 2021 is 2019). And '2018-05-05' (pre-2019, table still 2019 — the table is the "2019" base, but a case opened before 2019 gets it; fine, I'll pin '2019-01-01' and maybe '2018-01-01' to show no lower bound). I'll include one pre-2019 to pin that there's no lower boundary.

String-comparison quirk: openedAt '2022-07-01T00:00:00' vs constant '2022-07-01': '2022-07-01T00:00:00' > '2022-07-01' → true → 2022 table. Whereas bare '2022-07-01' → 2021 table. So same calendar day, different table depending on whether the string has a time component. I'll pin both as a flagged quirk. Is that in scope? It's a real behavior of the table-selection; documenting it in FINDINGS is good. I'll add two small tests.

Also: what about openedAt = '' (empty string)? `'' >= '2021-01-01'` is false → 2019 table. Not asked; skip? It's a degenerate input… the spec's degenerate list: zero, negative, unknown case type, missing complexity. Empty openedAt isn't listed. I'll skip to avoid bloat. Hmm, actually, "degenerate inputs" in the variant statement: "(zero, negative, unknown case type)." Zero/negative = complexity. I'll keep scope tight.

Now, unknown type fallback:
- 'PROBATE' → STANDARD band fee for that table. Pin for all three tables? One per table would be a "sample"; the full-matrix requirement is about known types. For unknown, I'll pin: one unknown type across all three tables (to pin fallback × table), plus case-sensitivity: 'standard' (lowercase) → falls back to STANDARD (pin the case-sensitivity quirk), plus empty string '' → `table.base['']` is undefined → fallback. And the output has no marker for the fallback (assert `table` is normal and no extra field) — the breakdown shape is the same; I'll assert the exact object to show indistinguishability.

Wait, `table.base[c.type]` where c.type = '' → base[''] → undefined → fallback. ✓.

Now, clamping:
- complexity 0 → band 1 fee. (Pinned: `!band` catches 0)
- complexity -3 → band 1.
- complexity -0? Same as 0; skip.
- complexity 1 → band 1 (no change; covered in matrix).
- complexity 4 → band 4 (covered in matrix).
- complexity 5 → band 4 (clamp upper).
- complexity 100 → band 4.
- complexity 2.5 → NaN (pinned; total NaN, bandFee NaN).
- Also complexity 0.5? `!0.5` is false, `0.5 < 1` is true → band 1. That's a fractional-below-1 → clamps to 1. Nice: shows the `< 1` branch differs from `!band`. 0.5 → band 1 fee (not NaN). Pin: complexity 0.5 → band 1. This distinguishes the two clamping branches. Good.
- Also NaN: `complexity: NaN` → `!NaN` is true → band 1. Pin? NaN is a degenerate input; `!NaN` is true. I'll include: complexity NaN → band 1 (pinned: falsy-NaN falls into the `!band` branch). Hmm, is that worth it? It documents that the `!band` check catches NaN, not just 0. Cheap, one test. I'll include it with 2.5 and 0.5 in the same describe.

Missing/null complexity:
- `complexity: null` → throws Error with message 'complexity is required'. Assert with `toThrowError('complexity is required')` or toThrow. I'll assert the exact message.
- Missing property (undefined) → throws same. Via the `as CaseInput` cast trick.

Now, the "genuine bug" — the 2022-07-01 boundary. Let me re-examine if there are other candidate bugs:

1. `if (openedAt > REVISION_2022)` — strict greater → revision day excluded. Compared to the 2021 `>=`. Header comment: "2022-07: rate revision (see RATE_TABLE_2022)." And "2021-01: rate revision (see RATE_TABLE_2021)" with `>=`. Inconsistent → bug (off-by-one). Blast radius: every case opened 2022-07-01 was billed at 2021 rates (lower than 2022 rates → underbilled by the delta; also the 2022 table has higher urgency 18% vs 15%, so urgent cases that day got 15% not 18%). Stored historical fees → audit discrepancy. Fix: `openedAt >= REVISION_2022` (or use Date objects and a consistent comparator). Not applied.

2. Urgency for past deadlines: `daysBetween(ref, deadline) <= 7` with no lower bound → a deadline 10 years in the past is "urgent." Proposed fix: `days >= 0 && days <= 7` (or `0 <= days <= 7`). Ambiguity: maybe intended "overdue = urgent" — but then the 7-day cap is meaningless; the `<= 7` suggests a window ending at 7 days out, and the natural lower bound is 0 (today). Blast radius: urgent fees on all cases with past deadlines at fee-generation time — potentially a large fraction of the historical record (any case where the deadline passed before fee generation). This is a big one. I'll mark it as bug (likely) with an ambiguity note.

3. Fractional band → NaN. A genuine defect (type says 1..4 but no guard). Blast radius: JSON.stringify(NaN) → null; a stored fee of null; or downstream crashes. Fix: reject or clamp non-integer bands (e.g. `band = Math.trunc(band)` or throw on non-integer). I'll mark as bug/quirk.

4. Unknown type silent fallback to STANDARD: a quirk (maybe intentional per the comment). The comment says intentional ("rare imports from the old system; default them"). So it's a documented quirk, not a bug. Blast radius: imported cases billed as STANDARD with no marker; can't distinguish in the audit. Fix (proposed): include a `fallback: true` flag in the breakdown, or reject unknown types upstream. But since the comment says intentional, I'll frame it as a documented quirk with a visibility gap.

5. Rounding structure: `pctOf` rounds each step; expedited applies to the rounded urgency. Under the current data, urgency is always exact, so sequential rounding is currently indistinguishable from single rounding — but the three 2019 cases and many 2022 cases show expedited rounding does fire (half-up: Math.round rounds .5 toward +∞). I'll pin the .5 cases explicitly with flagged names ("rounds half up, not banker's"). I'll document that the double-rounding path is currently dormant on the urgency step.

6. `now` default: `new Date().toISOString().slice(0, 10)` — the real clock, UTC-based (toISOString is UTC, good — so the default is deterministic in UTC date, but changes day to day). Can't pin in a deterministic suite → open question in FINDINGS: "the default clock path is not exercised in the suite (would make the suite non-deterministic); production urgency depends on the fee-generation date in UTC." That's the honest gap the spec asks for. Also note: since toISOString is UTC, the default "today" is the UTC date — for machines in a UTC-northwest timezone, "today" in local terms may differ; a quirk worth an open-question note.

7. `daysBetween` floor: exact for bare dates; if deadline had a time component, floor truncates partial days toward the past (a deadline 6 days + 23 hours out counts as 6 → urgent even though it's 7 days and 23 hours out… wait floor(6.958) = 6 → urgent; a deadline 7 days + 23 hours out: floor(7.958)=7 → still urgent; 8 days + 0 hours → 8 → not. So the effective window is [now-∞, now+8days), i.e. up to a full 8 calendar days… let me not over-think; the documented format is a bare ISO date, so floor is exact. I'll note in FINDINGS as an open question/observation: if a caller ever passes a datetime deadline, floor truncates the fraction and the effective window widens by less than a day. Not a test (out of the documented input contract) — actually, could I pin it in a test? It's a real behavior… the interface says deadline: string "ISO date." I'll leave it as an open question in FINDINGS rather than pinning an off-contract input. Hmm — a characterization suite could pin it, but the spec says degenerate inputs are that list; I'll keep the suite on-contract and put it in FINDINGS as an open question. That demonstrates honesty.

Also: `urgencyFee` uses `daysBetween(ref, c.deadline) <= 7` — the urgency window is 8 calendar days inclusive (0..7). "Boundary that decides urgent vs not" = 7 days. ✓ I'll pin 7 (urgent) and 8 (not).

Now, one more check — `tableFor` with `openedAt` in a table that has a time component before the revision, e.g. '2020-12-31T23:59:59': `>= '2021-01-01'`? String: '2020-12-31T23:59:59' vs '2021-01-01': '2020...' < '2021...' → 2019. Fine, consistent. And '2021-01-01T00:00:00' → `>= '2021-01-01'` true → 2021 (same as bare). So only the 2022 boundary flips with a time component (because of the strict `>`). Good — my two-string test pinning that is precise: bare '2022-07-01' → 2021; '2022-07-01T00:00:00' → 2022. I'll flag both: the bare-date side is the bug pin, the datetime side is the string-comparison quirk.

Now let me design the test file structure:

```ts
import { describe, it, expect } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput } from '../feeCalculator';
```

Wait — import path: the test is in `test/`, the module is at the root: `../feeCalculator`. ✓. The module has no extension: `../feeCalculator` — with moduleResolution bundler, no-extension imports work. ✓

Helper:

```ts
const fee = (input: CaseInput, now = '2023-01-15') => calculateFee(input, now);
```
Hmm — default parameter `now` in the test: fine, always an explicit date, no real clock. But maybe clearer: always pass now explicitly. I'll write a small builder:

```ts
function caseInput(over: Partial<CaseInput> = {}): CaseInput {
  return { type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', ...over };
}
```
And call `calculateFee(caseInput({...}), now)` with now explicit per test or a shared const NOW. I'll define `const NOW = '2023-01-15'` and pass it everywhere. For the urgency boundary, deadline is relative to NOW.

Actually, for the matrix tests, urgency is off (no deadline) and expedited is off — so `now` is irrelevant (urgencyFee=0 without deadline; now only used in daysBetween when deadline present). Wait: `const ref = now ? now : new Date()...` — ref is computed but only used inside `if (c.deadline && ...)`. If no deadline, ref is unused… actually it's computed unconditionally: `const ref = now ? now : new Date().toISOString().slice(0, 10);` — if now is undefined and no deadline, `new Date()` is still called (harmless, no effect on output). To keep the suite clock-free, I'll pass now everywhere anyway. ✓ (Even in the base matrix I'll pass NOW — belt and suspenders, and it documents the "use the injected clock" rule.)

Now the data table. Let me define:

```ts
// Transcribed verbatim from the rate tables in feeCalculator.ts (source of truth for the base fee).
const BASE: Record<'2019' | '2021' | '2022', Record<CaseType, [number, number, number, number]>> = { ... }
```
Wait — if I transcribe the table into the test and compute expected from it, is that hollow? Base fee: the transcription is the literal pin (48 numbers). If I then compute urgency = round(base*pct/100) in the test, that's re-implementing pctOf — but it's the documented formula, and the value is deterministic. The alternative (hand-writing 144 more literals) is more error-prone for me to produce. Hmm.

Let me weigh: the reviewer's criterion is "behavior-based coverage — a suite with high percentages and hollow assertions fails." Hollow = assertions that don't pin a value (e.g. `toBeGreaterThan(0)`, `toBeDefined`). Asserting `expect(result).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 })` is ironclad. If instead I assert `urgencyFee: Math.round(18500*15/100)` — that's still a specific value, but it derives from a formula that mirrors the code; if the code's rounding changed (say to Math.floor), the test would fail (2775 same… floor(2775)=2775 — no difference; the .5 cases would: floor(2127.5)=2127 ≠ 2128 → test fails ✓ good). Actually deriving via the same Math.round formula would mirror a change to Math.round-identical logic… if someone changes pctOf to `Math.trunc`, my test computing with Math.round would catch it (2127.5 → 2128 vs 2127). If someone changes the formula to apply pct on the unrounded value — my test would mirror if I wrote it the same. The risk of mirroring is real but limited.

I think the strongest, most defensible deliverable is: **literal expected values for every field in every scenario**, hand-computed and triple-checked. Yes it's long, but it's a characterization suite — long tables of pinned numbers are exactly what this artifact should look like. "A suite that passes twice" and "pinned exactly" → literals.

But 192 scenarios × 4 fields… let me count what I actually need as literals:

Per cell (48 cells), per scenario:
- S0 base: {table, bandFee, 0, 0, total=bandFee} → literals: bandFee, total (total == bandFee; I'll write it twice as literal).
- S1 urgency: urgencyFee literal, total literal.
- S2 expedited: expeditedFee literal, total literal.
- S3 both: urgencyFee, expeditedFee (the urgency+expedited version), total literal.

So per cell: bandFee (1), S1 urg (1) + S1 total (1), S2 exp (1) + total (1), S3 urg (same as S1) + S3 exp (1) + total (1) → 8 distinct numbers + table label. 48 × 8 = 384 numbers. All derived from the 48 band fees by simple arithmetic (×0.15, ×0.18, ×0.10, ×0.12, +). I can do this carefully. It'll be a big table but organized. Actually — can I reduce redundancy? S3's urgencyFee equals S1's urgencyFee (same formula, same input). If I store per cell: `base, urg, expNoUrg, expBoth`, then totals: T1 = base+urg, T2 = base+expNoUrg, T3 = base+urg+expBoth. Writing totals as `base + urg` in the test is a tautological sum… but is it? The code computes total = bandFee + urgencyFee + expeditedFee with the rounded components. If I assert total === base+urg+expBoth (literals) and the three components as literals, the sum assertion only checks addition. Addition can't "misbehave" in any interesting way (floats? all integers < 2^53, exact). So asserting the sum is not hollow in any meaningful sense — the addition of integers is not a behavior worth pinning by literal. The rounding behaviors are in the components. So: components as literals, total as the component sum (I'll note this choice in a comment), except for the rounding-specific tests where I also assert a literal total for the .5 cases… hmm, but for consistency and maximum strength, maybe I should just write the totals as literals too. Integer additions like 18500+2775+2128 = 23403 — I can compute them; the risk is my arithmetic error. A single wrong digit = a test that fails = bad deliverable. A wrong sum is just a failing suite, which I can't fix (no tools). Risk management: deriving total as the sum of already-literal components eliminates that arithmetic risk entirely while losing essentially nothing (integer addition is exact in IEEE754 for these magnitudes). I'll do this: `total: base + urg + exp` style, with a comment explaining the components are the pinned values and the sum is exact integer arithmetic. Hmm…

Wait, actually let me reconsider. Is there a scenario where the code's total ≠ sum of components? `total: bandFee + urgencyFee + expeditedFee` — always equal by construction. So asserting the sum of the pinned components is 100% equivalent to asserting the literal total (given the components are right). OK: components as literals; total as sum expression. I'll add a dedicated test asserting, for one cell, that `result.total` equals a fully literal number (23403), to demonstrate the literal style. Actually no — mixing styles is worse. Decision: for every scenario, assert the full object `toEqual({ table, bandFee: L, urgencyFee: L, expeditedFee: L, total: L + L + L })`. Clean.

Hmm, one more consideration: `toEqual` on the whole object also pins the shape (exactly these four keys, no extras). That's good — it pins that the breakdown has no fallback flag (relevant to FINDINGS #4: the fallback is invisible in the output).

Now, let me also double-check the `table` name mapping: `table === RATE_TABLE_2022 ? '2022' : table === RATE_TABLE_2021 ? '2021' : '2019'` — identity comparison, fine.

Now let me compute all the numbers. I'll build a per-cell spec: `[type, band, base2019, base2021, base2022]` and per-table percentages. Let me lay out all 16 cells with the three tables:

| Type | Band | 2019 | 2021 | 2022 |
|---|---|---|---|---|
| STANDARD | 1 | 12000 | 13500 | 15000 |
| STANDARD | 2 | 18500 | 20500 | 22500 |
| STANDARD | 3 | 27000 | 29500 | 32500 |
| STANDARD | 4 | 41000 | 44500 | 49000 |
| COMMERCIAL | 1 | 22000 | 24000 | 26500 |
| COMMERCIAL | 2 | 31500 | 34000 | 37500 |
| COMMERCIAL | 3 | 45000 | 48500 | 53500 |
| COMMERCIAL | 4 | 68000 | 73000 | 80500 |
| ESTATE | 1 | 18000 | 19500 | 21500 |
| ESTATE | 2 | 26000 | 28000 | 31000 |
| ESTATE | 3 | 39500 | 42500 | 47000 |
| ESTATE | 4 | 60000 | 64500 | 71000 |
| APPEAL | 1 | 30000 | 32500 | 36000 |
| APPEAL | 2 | 42000 | 45500 | 50000 |
| APPEAL | 3 | 61000 | 66000 | 72500 |
| APPEAL | 4 | 92000 | 99000 | 109000 |

Urgency (15% for 2019 & 2021; 18% for 2022):
2019/2021 urg = base×0.15:
- 12000→1800; 13500→2025; 15000 (2022: ×0.18→2700)
- 18500→2775; 20500→3075; 22500→4050 (18%)
- 27000→4050; 29500→4425; 32500→5850 (18%)
- 41000→6150; 44500→6675; 49000→8820 (18%)
- 22000→3300; 24000→3600; 26500→4770 (18%)
- 31500→4725; 34000→5100; 37500→6750 (18%)
- 45000→6750; 48500→7275; 53500→9630 (18%)
- 68000→10200; 73000→10950; 80500→14490 (18%)
- 18000→2700; 19500→2925; 21500→3870 (18%)
- 26000→3900; 28000→4200; 31000→5580 (18%)
- 39500→5925; 42500→6375; 47000→8460 (18%)
- 60000→9000; 64500→9675; 71000→12780 (18%)
- 30000→4500; 32500→4875; 36000→6480 (18%)
- 42000→6300; 45500→6825; 50000→9000 (18%)
- 61000→9150; 66000→9900; 72500→13050 (18%)
- 92000→13800; 99000→14850; 109000→19620 (18%)

All integer ✓ (15% of a multiple of 100 → multiple of 15; 18% → multiple of 18).

Expedited only (no urgency): 2019: 10% → base/10:
- 12000→1200; 22000→2200; 18000→1800; 30000→3000
- 18500→1850; 31500→3150; 26000→2600; 42000→4200
- 27000→2700; 45000→4500; 39500→3950; 61000→6100
- 41000→4100; 68000→6800; 60000→6000; 92000→9200
2021: 12% → base×0.12:
- 13500→1620; 20500→2460; 29500→3540; 44500→5340
- 24000→2880; 34000→4080; 48500→5820; 73000→8760
- 19500→2340; 28000→3360; 42500→5100; 64500→7740
- 32500→3900; 45500→5460; 66000→7920; 99000→11880
Verify: 13500×0.12 = 1620 ✓. 20500×0.12=2460 ✓. 29500×0.12=3540 ✓. 44500×0.12=5340 ✓. 24000→2880 ✓. 34000→4080 ✓. 48500→5820 ✓ (485×12=5820). 73000→8760 ✓. 19500→2340 ✓. 28000→3360 ✓. 42500→5100 ✓. 64500→7740 ✓ (645×12=7740). 32500→3900 ✓. 45500→5460 ✓ (455×12=5460). 66000→7920 ✓. 99000→11880 ✓.
2022: 12%:
- 15000→1800; 22500→2700; 32500→3900; 49000→5880
- 26500→3180; 37500→4500; 53500→6420; 80500→9660
- 21500→2580; 31000→3720; 47000→5640; 71000→8520
- 36000→4320; 50000→6000; 72500→8700; 109000→13080
Verify: 15000×.12=1800 ✓; 22500→2700 ✓; 32500→3900 ✓; 49000→5880 ✓ (490×12=5880); 26500→3180 ✓; 37500→4500 ✓; 53500→6420 ✓; 80500→9660 ✓; 21500→2580 ✓; 31000→3720 ✓; 47000→5640 ✓; 71000→8520 ✓; 36000→4320 ✓; 50000→6000 ✓; 72500→8700 ✓; 109000→13080 ✓.

Expedited with urgency:
2019 (urgency 15, expedited 10% of (base+urg) = 11.5% of base):
- STANDARD: 12000→1380; 18500→2127.5→2128; 27000→3105; 41000→4715
- COMMERCIAL: 22000→2530; 31500→3622.5→3623; 45000→5175; 68000→7820
- ESTATE: 18000→2070; 26000→2990; 39500→4542.5→4543; 60000→6900
- APPEAL: 30000→3450; 42000→4830; 61000→7015; 92000→10580
(Computed above; re-verify a few: 41000: urg 6150 → 47150 ×0.1 = 4715 ✓. 68000: 10200 → 78200 → 7820 ✓. 92000: 13800 → 105800 → 10580 ✓. 61000: 9150 → 70150 → 7015 ✓.)

2021 (urgency 15, expedited 12% of (base+urg) = 13.8% of base):
- STANDARD: 13500→1863; 20500→2829; 29500→4071; 44500→6141
- COMMERCIAL: 24000→3312; 34000→4692; 48500→6693; 73000→10074
- ESTATE: 19500→2691; 28000→3864; 42500→5865; 64500→8901
- APPEAL: 32500→4485; 45500→6279; 66000→9108; 99000→13662
(All exact, computed above.)
Verify a couple: 48500: base+urg = 48500+7275 = 55775; ×0.12 = 6693 ✓ (55775×12 = 669300 → 6693). 73000: +10950 = 83950; ×12 = 1007400 → 10074 ✓. 64500: +9675 = 74175; ×12 = 890100 → 8901 ✓. 99000: +14850 = 113850; ×12 = 1366200 → 13662 ✓. 45500: +6825 = 52325; ×12 = 627900 → 6279 ✓. 19500: +2925 = 22425; ×12 = 269100 → 2691 ✓. 28000: +4200 = 32200; ×12 = 386400 → 3864 ✓. 42500: +6375 = 48875; ×12 = 586500 → 5865 ✓. 32500: +4875 = 37375; ×12 = 448500 → 4485 ✓. 66000: +9900 = 75900; ×12 = 910800 → 9108 ✓. 24000: +3600 = 27600 → 3312 ✓. 34000: +5100 = 39100 → 4692 ✓. 13500: +2025 = 15525 → 1863 ✓. 20500: +3075 = 23575 → 2829 ✓. 29500: +4425 = 33925 → 4071 ✓. 44500: +6675 = 51175 → 6141 ✓.

2022 (urgency 18, expedited 12% of (base+urg) = 14.16% of base):
- STANDARD: 15000: +2700 = 17700 → ×0.12 = 2124 exact. 22500: +4050 = 26550 → 3186 exact (26550×12 = 318600). 32500: +5850 = 38350 → 4602 exact (38350×12 = 460200). 49000: +8820 = 57820 → 6938.4 → 6938.
- COMMERCIAL: 26500: +4770 = 31270 → 3752.4 → 3752. 37500: +6750 = 44250 → 5310 exact (44250×12 = 531000). 53500: +9630 = 63130 → 7575.6 → 7576. 80500: +14490 = 94990 → 11398.8 → 11399.
- ESTATE: 21500: +3870 = 25370 → 3044.4 → 3044. 31000: +5580 = 36580 → 4389.6 → 4390. 47000: +8460 = 55460 → 6655.2 → 6655. 71000: +12780 = 83780 → 10053.6 → 10054.
- APPEAL: 36000: +6480 = 42480 → 5097.6 → 5098. 50000: +9000 = 59000 → 7080 exact. 72500: +13050 = 85550 → 10266 exact (85550×12 = 1026600). 109000: +19620 = 128620 → 15434.4 → 15434.
All verified above.

Math.round half-up check: 6938.4 → 6938 ✓ (not a .5 case). The .5 cases only in 2019 (2127.5, 3622.5, 4542.5) — Math.round(x.5) rounds toward +∞ → 2128, 3623, 4543. ✓ (In JS Math.round(2127.5) = 2128. ✓)

Wait, let me also confirm no other .5 or fractional cases in 2022: the fractional ones I listed round .4/.6/.8 → not .5, so no half-up issue. ✓ And 2021: all exact. ✓

Now, per-scenario totals (I'll express as sums in the test, but let me pre-compute a few for the FINDINGS reproducing examples):
- 2019 STANDARD band 2 urgency+expedited: 18500 + 2775 + 2128 = 23403. (18500+2775 = 21275; +2128 = 23403.) ✓
- 2022 APPEAL band 4 urgency+expedited: 109000 + 19620 + 15434 = 144054. (109000+19620 = 128620; +15434 = 144054.) ✓
- 2022-07-01 bug reproducing: openedAt '2022-07-01', STANDARD band 1: returns table '2021', bandFee 13500; '2022-07-02' → '2022', 15000. Delta for that day: 1500. ✓
- Past-deadline reproducing: now '2023-01-15', deadline '2020-01-01' (1096 days past): urgent. bandFee e.g. STANDARD band 1 2021 table (openedAt '2021-05-10'): 13500 + 2025 = 15525.

Now, let me design the spec file layout:

```ts
import { describe, expect, it } from 'vitest';
import { calculateFee, type CaseInput } from '../feeCalculator';
```
Wait, with `moduleResolution: bundler` and ESM, `import { calculateFee } from '../feeCalculator'` — the file is feeCalculator.ts; no-extension imports are allowed with bundler resolution. ✓

Constants:

```ts
const NOW = '2023-01-15';
```
Hmm — but for the boundary tests I use dates relative to NOW; fine.

Let me define openedAt per table:
```ts
const OPENED_2019 = '2020-06-15';
const OPENED_2021 = '2021-06-15';
const OPENED_2022 = '2023-01-01';
```
(Mid-period, away from edges; edges have their own tests.)

Data table structure — I'll write one row per (type, band) with the three tables' numbers:

```ts
interface Cell {
  type: CaseType;
  band: 1 | 2 | 3 | 4;
  base: Record<TableName, number>;
  urgency: Record<TableName, number>;
  expedited: Record<TableName, number>;      // expedited alone (no urgency)
  expeditedUrgent: Record<TableName, number>; // expedited on top of urgency
}
```

And the rows:

STANDARD:
- band 1: base {2019:12000, 2021:13500, 2022:15000}; urgency {1800, 2025, 2700}; expedited {1200, 1620, 1800}; expeditedUrgent {1380, 1863, 2124}
- band 2: base {18500, 20500, 22500}; urgency {2775, 3075, 4050}; expedited {1850, 2460, 2700}; expUrg {2128, 2829, 3186}
- band 3: base {27000, 29500, 32500}; urgency {4050, 4425, 5850}; expedited {2700, 3540, 3900}; expUrg {3105, 4071, 4602}
- band 4: base {41000, 44500, 49000}; urgency {6150, 6675, 8820}; expedited {4100, 5340, 5880}; expUrg {4715, 6141, 6938}

COMMERCIAL:
- band 1: base {22000, 24000, 26500}; urgency {3300, 3600, 4770}; expedited {2200, 2880, 3180}; expUrg {2530, 3312, 3752}
- band 2: base {31500, 34000, 37500}; urgency {4725, 5100, 6750}; expedited {3150, 4080, 4500}; expUrg {3623, 4692, 5310}
- band 3: base {45000, 48500, 53500}; urgency {6750, 7275, 9630}; expedited {4500, 5820, 6420}; expUrg {5175, 6693, 7576}
- band 4: base {68000, 73000, 80500}; urgency {10200, 10950, 14490}; expedited {6800, 8760, 9660}; expUrg {7820, 10074, 11399}

ESTATE:
- band 1: base {18000, 19500, 21500}; urgency {2700, 2925, 3870}; expedited {1800, 2340, 2580}; expUrg {2070, 2691, 3044}
- band 2: base {26000, 28000, 31000}; urgency {3900, 4200, 5580}; expedited {2600, 3360, 3720}; expUrg {2990, 3864, 4390}
- band 3: base {39500, 42500, 47000}; urgency {5925, 6375, 8460}; expedited {3950, 5100, 5640}; expUrg {4543, 5865, 6655}
- band 4: base {60000, 64500, 71000}; urgency {9000, 9675, 12780}; expedited {6000, 7740, 8520}; expUrg {6900, 8901, 10054}

APPEAL:
- band 1: base {30000, 32500, 36000}; urgency {4500, 4875, 6480}; expedited {3000, 3900, 4320}; expUrg {3450, 4485, 5098}
- band 2: base {42000, 45500, 50000}; urgency {6300, 6825, 9000}; expedited {4200, 5460, 6000}; expUrg {4830, 6279, 7080}
- band 3: base {61000, 66000, 72500}; urgency {9150, 9900, 13050}; expedited {6100, 7920, 8700}; expUrg {7015, 9108, 10266}
- band 4: base {92000, 99000, 109000}; urgency {13800, 14850, 19620}; expedited {9200, 11880, 13080}; expUrg {10580, 13662, 15434}

Let me re-verify a sample of urgency (18%) values: 26500×0.18 = 4770 ✓. 37500×0.18 = 6750 ✓. 53500×0.18 = 9630 ✓. 80500×0.18 = 14490 ✓. 21500×0.18 = 3870 ✓. 31000×0.18 = 5580 ✓. 47000×0.18 = 8460 ✓. 71000×0.18 = 12780 ✓. 36000×0.18 = 6480 ✓. 50000×0.18 = 9000 ✓. 72500×0.18 = 13050 ✓. 109000×0.18 = 19620 ✓. 15000×0.18=2700 ✓. 22500×0.18=4050 ✓. 32500×0.18=5850 ✓. 49000×0.18=8820 ✓.

And 15%: 20500→3075 ✓ (205×15=3075). 29500→4425 ✓ (295×15 = 4425). 44500→6675 ✓ (445×15: 445×15 = 6675 ✓). 34000→5100 ✓. 48500→7275 ✓ (485×15=7275). 73000→10950 ✓. 19500→2925 ✓. 28000→4200 ✓. 42500→6375 ✓. 64500→9675 ✓. 32500→4875 ✓. 45500→6825 ✓. 66000→9900 ✓. 99000→14850 ✓. 12000→1800 ✓. 18500→2775 ✓. 27000→4050 ✓. 41000→6150 ✓. 22000→3300 ✓. 31500→4725 ✓. 45000→6750 ✓. 68000→10200 ✓. 18000→2700 ✓. 26000→3900 ✓. 39500→5925 ✓. 60000→9000 ✓. 30000→4500 ✓. 42000→6300 ✓. 61000→9150 ✓. 92000→13800 ✓.

Expedited-only 10%: all base/10 ✓ (12000→1200, 18500→1850, 27000→2700, 41000→4100, 22000→2200, 31500→3150, 45000→4500, 68000→6800, 18000→1800, 26000→2600, 39500→3950, 60000→6000, 30000→3000, 42000→4200, 61000→6100, 92000→9200). ✓

Now, how to write the tests compactly. I'll use `describe.each` per table and `it.each` over the 16 cells per scenario. Something like:

```ts
const TABLES = [
  { name: '2019', openedAt: OPENED_2019 },
  { name: '2021', openedAt: OPENED_2021 },
  { name: '2022', openedAt: OPENED_2022 },
] as const;
```

And per scenario:

```ts
for (const t of TABLES) {
  describe(`rate table ${t.name}`, () => {
    it.each(CELLS.map(c => [c, ...]))...
  })
}
```

Hmm, simpler: a flat `describe.each`? Let me write it straightforwardly with nested describes generated by a for-loop at module scope (fine in vitest — describe callbacks run at collection time).

Actually, cleanest: three top-level describes (one per table), each with four `it.each` blocks (base, urgency, expedited, both) over the 16 cells. 3 × 4 × 16 = 192 tests. Plus the edge/quirk tests.

For `it.each` with tuples: `it.each([['STANDARD', 1, 12000, 1800, 1200, 1380], ...])('...', (type, band, base, urg, exp, expUrg) => ...)`. But each scenario needs a different subset. I could make one big table of all six numbers per cell per table, and each scenario's `it.each` uses the same rows but asserts a different expected object. The rows contain all numbers; each scenario test asserts the appropriate expected breakdown. That's efficient: one data block per table.

Row: `[type, band, base, urg, expOnly, expBoth]` → e.g. `['STANDARD', 1, 12000, 1800, 1200, 1380]`.

Then:
- Base scenario: expect({table, bandFee: base, urgencyFee: 0, expeditedFee: 0, total: base}).
- Urgency: input with deadline = NOW+5 (within 7), expect({table, bandFee: base, urgencyFee: urg, expeditedFee: 0, total: base + urg}).
- Expedited: input with expedited: true (no deadline), expect({table, bandFee: base, urgencyFee: 0, expeditedFee: expOnly, total: base + expOnly}).
- Both: deadline + expedited, expect({table, bandFee: base, urgencyFee: urg, expeditedFee: expBoth, total: base + urg + expBoth}).

For the urgency scenario, the deadline: `deadline: '2023-01-20'` with NOW '2023-01-15' → 5 days → urgent. I'll use that constant.

Test naming for the matrix: `'STANDARD band 2 -> bandFee 2775...'`? The `it.each` title: `'%s band %i'`. That's fine; the describe context says which table and scenario.

Now, the flagged tests (quirks/bugs) — they must be readable as deliberately pinned. I'll use names with a prefix like `[PINNED QUIRK]` or `[KNOWN BUG]`. E.g.:

```
describe('known defects (pinned as-is, see FINDINGS.md)', () => {
  it('[BUG] case opened on 2022-07-01 (the 2022 revision day) is billed with the 2021 table', ...)
  it('[BUG] deadline 400 days in the past still earns the urgency fee', ...)
  it('[QUIRK] unknown case type silently falls back to STANDARD fees', ...)
  it('[QUIRK] fractional complexity 2.5 produces NaN in the whole breakdown', ...)
  it('[QUIRK] 2019 expedited fee rounds half-up: 2127.5 -> 2128', ...)
  ...
})
```

And the matrix tests are plain. Also the boundary tests:

```
describe('rate table selection by openedAt (string comparison)', () => {
  it('2020-12-31 (day before 2021 revision) -> 2019 table', ...)
  it('2021-01-01 (revision day, inclusive) -> 2021 table', ...)
  it('2022-06-30 (day before 2022 revision) -> 2021 table', ...)
  it('2022-07-01 (revision day) -> 2021 table  [KNOWN BUG: exclusive edge]', ...)
  it('2022-07-02 (day after 2022 revision) -> 2022 table', ...)
  it('2018-03-05 (before 2019: no lower bound, still 2019 table)', ...)
  it('[QUIRK] datetime-stamped openedAt on 2022-07-01 compares greater than the bare date and selects the 2022 table', ...)
})
```

Urgency boundary:
```
describe('urgency boundary (daysBetween(now, deadline) <= 7)', () => {
  it('deadline 7 days out (inclusive edge) -> urgent', ...)
  it('deadline 8 days out -> not urgent', ...)
  it('deadline today (0 days) -> urgent', ...)
  it('deadline 6 days out -> urgent', ...)
  it('[QUIRK] deadline in the past (any distance) -> still urgent', ...)
  it('no deadline -> not urgent', ...)
})
```
For these I'll assert the full breakdown (not just urgencyFee>0) so it's not hollow: e.g. openedAt '2021-06-15' (2021 table), STANDARD band 1: base 13500, urg 2025. urgent case total = 15525; not urgent = 13500.

Rounding section:
```
describe('rounding', () => {
  it('[PINNED] 2019 STANDARD band 2, urgent+expedited: expedited fee is Math.round(2127.5) = 2128 (half rounds up)', ...)
  it('[PINNED] 2019 COMMERCIAL band 2: 3622.5 -> 3623', ...)
  it('[PINNED] 2019 ESTATE band 3: 4542.5 -> 4543', ...)
  it('[PINNED] 2022 APPEAL band 4 urgent+expedited: Math.round(15434.4) = 15434', ...)
  it('expedited fee is computed from bandFee + ROUNDED urgency fee (sequential rounding structure)', ...)
  it('urgency fee itself is exact (no rounding) for every band fee in all three tables', ...) // hmm — this is a statement about data; the matrix already proves it. Maybe I'll fold this into a FINDINGS note instead of a test.
})
```
The "sequential rounding structure" test: I'll show that the expedited input includes the rounded urgency. Under the current data it's indistinguishable… I can't construct an input that distinguishes (urgency is always exact). So a test asserting the structure is just a duplicate of the both-matrix values. I'll skip a dedicated structural test and document in FINDINGS that the structure exists but is currently indistinguishable (the both-matrix pins the observable outcome). Actually — wait, is there any input that makes urgency fractional? bandFee must be non-multiple-of-100. bandFee comes only from the table (all multiples of 100) — unless… unknown type → STANDARD (multiple of 100). Clamp → still a table value. So no. Confirmed dormant. FINDINGS it is.

Degenerate section:
```
describe('degenerate inputs', () => {
  it('complexity null -> throws "complexity is required"', ...)
  it('complexity missing (undefined, as from a JSON record without the key) -> throws "complexity is required"', ...)
  it('complexity 0 -> clamped to band 1', ...)
  it('complexity -3 -> clamped to band 1', ...)
  it('complexity 0.5 -> clamped to band 1 (< 1 branch)', ...)
  it('complexity NaN -> clamped to band 1 (falsy branch)', ...)
  it('complexity 5 -> clamped to band 4', ...)
  it('complexity 100 -> clamped to band 4', ...)
  it('[QUIRK] complexity 2.5 -> NaN bandFee/urgency/total (no integer guard)', ...)
  it('[QUIRK] unknown type PROBATE -> STANDARD fee, no marker in the breakdown', ...)
  it('[QUIRK] lowercase type "standard" -> falls back to STANDARD (case-sensitive lookup)', ...)
  it('[QUIRK] empty-string type -> falls back to STANDARD', ...)
})
```
For the clamped-to-band-1/4 tests, I'll assert the full breakdown against the appropriate table (I'll pick one table per, e.g. 2021: STANDARD band 1 13500 / band 4 44500). To pin the clamping across tables is overkill; one table is enough (the clamp logic is table-independent). I'll use 2021 with openedAt '2021-06-15'.

Wait — complexity NaN: `expect`… the input `complexity: NaN` — typed `number | null` so NaN is fine type-wise. ✓

Now the "missing complexity" case: `const c = { type: 'STANDARD', openedAt: '2021-06-15' } as CaseInput;` then `expect(() => calculateFee(c, NOW)).toThrowError('complexity is required')`. ✓

Also, should I pin that the thrown error is a plain `Error` (not some custom type)? `expect(...).toThrow()` + message check is enough.

Now, `toEqual` and NaN: in the fractional test, `expect(result).toEqual({ table: '2021', bandFee: NaN, urgencyFee: 0, expeditedFee: 0, total: NaN })` — does toEqual treat NaN === NaN as equal? Yes, Jest/Vitest's toEqual uses recursive equality where NaN equals NaN. ✓ (Object.is semantics in equality checks: expect(NaN).toEqual(NaN) passes.) ✓

But wait — in the fractional test, what exactly happens? band = 2.5 → `!band` false → `band < 1` false → `band > 4` false → bandFee = bands[1.5] = undefined. urgencyFee: deadline? no deadline → 0. expedited: false → 0. total = undefined + 0 + 0 = NaN. So breakdown = { table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }.

Ah — bandFee is `undefined`, not NaN! `bands[1.5]` → undefined. And total = undefined + 0 + 0 → NaN. So the expected object: `{ table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }`.

With `toEqual`, `undefined` properties: `{ bandFee: undefined }` — toEqual treats keys with undefined values as equal to missing keys. So I'll write the expected as `{ table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }` and it'll pass. To be safe and explicit, I'll assert fields individually: `expect(result.bandFee).toBeUndefined(); expect(result.total).toBeNaN();` plus the zeros. I'll do individual assertions there for clarity. Also JSON.stringify(result) → '{"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}' — I can assert that too! That's a powerful behavioral pin of the blast radius (NaN → null in JSON, undefined key dropped). `expect(JSON.stringify(result)).toBe('{"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}')`. Key order: object property order — bandFee (undefined, dropped), urgencyFee, expeditedFee, total. The result object is constructed as `{ table, bandFee, urgencyFee, expeditedFee, total }` → stringify drops bandFee → `{"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}`. ✓ I'll include this assertion — it concretely pins the storage corruption. A nice touch, and behavior-based.

Also the fractional case with urgency: if deadline present, urgencyFee = pctOf(undefined, 15) = Math.round(NaN) = NaN. I'll stick to the simple no-deadline variant to keep it clear. Maybe I'll add the urgent variant too: bandFee undefined, urgencyFee NaN, total NaN. Hmm — one test is enough; I'll mention the variant in FINDINGS.

Now the unknown-type fallback tests: 'PROBATE' across all three tables? Fallback × table interaction: fee = that table's STANDARD band fee. One per table (3 tests via it.each) — reasonable: pins that the fallback respects the selected table. I'll use band 2 for visibility: STANDARD band 2: 2019 18500, 2021 20500, 2022 22500. And assert the full breakdown (urgency 0, expedited 0) to show no fallback marker. I'll also add an explicit shape assertion: `expect(Object.keys(result).sort()).toEqual(['bandFee', 'expeditedFee', 'table', 'total'])` — pins that no extra key is added. Nice.

Case sensitivity: 'standard' → fallback (2021, band 1: 13500). Empty string: '' → fallback.

Now, the 2022-07-01 bug test:
```ts
it('[KNOWN BUG] openedAt 2022-07-01 (the 2022 revision day) selects the 2021 table, not 2022 (see FINDINGS.md F1)', () => {
  const day = calculateFee(caseInput({ openedAt: '2022-07-01' }), NOW);
  expect(day).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  const next = calculateFee(caseInput({ openedAt: '2022-07-02' }), NOW);
  expect(next).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 });
});
```
STANDARD band 1. ✓ (13500 vs 15000.)

Also note the urgency-pct angle: urgent on 2022-07-01 gets 15% not 18% — I could add: deadline within 7 days → urgency 2025 (15%) not 2700 (18%). I'll fold a second assertion into the same test, or make it separate. I'll add it to the same test: with deadline '2023-01-20': day.urgencyFee 2025 vs next.urgencyFee 2700. Stronger pin.

Datetime quirk test:
```ts
it('[QUIRK] openedAt with a time component on 2022-07-01 compares lexicographically greater than "2022-07-01" and selects the 2022 table (F2)', () => {
  const stamped = calculateFee(caseInput({ openedAt: '2022-07-01T00:00:00' }), NOW);
  expect(stamped.table).toBe('2022');
  expect(stamped.bandFee).toBe(15000);
});
```
Wait — is '2022-07-01T00:00:00' > '2022-07-01'? String compare: the first 10 characters are equal; the candidate has an extra character at index 10 → the longer string with the common prefix is greater → yes, greater → 2022. ✓

Also '2021-01-01T00:00:00' → `>= '2021-01-01'` true → 2021 anyway (same as bare). So the quirk only visibly flips the 2022 edge. I'll note that.

Past-deadline urgency tests:
```ts
it('[KNOWN BUG] a deadline in the past still earns the urgency fee (no lower bound on the 7-day window) (F3)', () => {
  const r = calculateFee(caseInput({ openedAt: '2021-06-15', deadline: '2020-01-01' }), NOW); // 1096 days past
  expect(r).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
});
```
Days: 2020-01-01 to 2023-01-15: 2020 is a leap year: Jan 1 2020 → Jan 1 2021 = 366; → Jan 1 2022 = 365 (731); → Jan 1 2023 = 365 (1096); → Jan 15 2023 = 14 (1110). So 1110 days past. I'll just say "a deadline more than three years in the past." (Exact day count doesn't matter; any negative works.) I'll use deadline '2020-01-01'.

Boundary tests with full breakdown (2021 table, STANDARD band 1):
- deadline '2023-01-22' (7 days): {table '2021', 13500, 2025, 0, 15525}
- '2023-01-23' (8 days): {…, 13500, 0, 0, 13500}
- '2023-01-15' (0 days): urgent 15525
- '2023-01-21' (6 days): urgent
- no deadline: 13500

Now — the matrix describe blocks. Let me write them out concretely.

```ts
type TableName = '2019' | '2021' | '2022';

// [type, band, base2019, base2021, base2022, urg2019, urg2021, urg2022, exp2019, exp2021, exp2022, expUrg2019, expUrg2021, expUrg2022]
```
14 numbers per row × 16 rows = 224 numbers. Wide. Better: per-table arrays.

```ts
// Row: [type, band, base, urgency, expeditedAlone, expeditedWithUrgency]
type Row = readonly [CaseType, number, number, number, number, number];

const ROWS_2019: Row[] = [
  ['STANDARD', 1, 12000, 1800, 1200, 1380],
  ['STANDARD', 2, 18500, 2775, 1850, 2128],
  ['STANDARD', 3, 27000, 4050, 2700, 3105],
  ['STANDARD', 4, 41000, 6150, 4100, 4715],
  ['COMMERCIAL', 1, 22000, 3300, 2200, 2530],
  ['COMMERCIAL', 2, 31500, 4725, 3150, 3623],
  ['COMMERCIAL', 3, 45000, 6750, 4500, 5175],
  ['COMMERCIAL', 4, 68000, 10200, 6800, 7820],
  ['ESTATE', 1, 18000, 2700, 1800, 2070],
  ['ESTATE', 2, 26000, 3900, 2600, 2990],
  ['ESTATE', 3, 39500, 5925, 3950, 4543],
  ['ESTATE', 4, 60000, 9000, 6000, 6900],
  ['APPEAL', 1, 30000, 4500, 3000, 3450],
  ['APPEAL', 2, 42000, 6300, 4200, 4830],
  ['APPEAL', 3, 61000, 9150, 6100, 7015],
  ['APPEAL', 4, 92000, 13800, 9200, 10580],
];
```
✓ matches my table.

ROWS_2021:
```
['STANDARD', 1, 13500, 2025, 1620, 1863],
['STANDARD', 2, 20500, 3075, 2460, 2829],
['STANDARD', 3, 29500, 4425, 3540, 4071],
['STANDARD', 4, 44500, 6675, 5340, 6141],
['COMMERCIAL', 1, 24000, 3600, 2880, 3312],
['COMMERCIAL', 2, 34000, 5100, 4080, 4692],
['COMMERCIAL', 3, 48500, 7275, 5820, 6693],
['COMMERCIAL', 4, 73000, 10950, 8760, 10074],
['ESTATE', 1, 19500, 2925, 2340, 2691],
['ESTATE', 2, 28000, 4200, 3360, 3864],
['ESTATE', 3, 42500, 6375, 5100, 5865],
['ESTATE', 4, 64500, 9675, 7740, 8901],
['APPEAL', 1, 32500, 4875, 3900, 4485],
['APPEAL', 2, 45500, 6825, 5460, 6279],
['APPEAL', 3, 66000, 9900, 7920, 9108],
['APPEAL', 4, 99000, 14850, 11880, 13662],
```
✓.

ROWS_2022:
```
['STANDARD', 1, 15000, 2700, 1800, 2124],
['STANDARD', 2, 22500, 4050, 2700, 3186],
['STANDARD', 3, 32500, 5850, 3900, 4602],
['STANDARD', 4, 49000, 8820, 5880, 6938],
['COMMERCIAL', 1, 26500, 4770, 3180, 3752],
['COMMERCIAL', 2, 37500, 6750, 4500, 5310],
['COMMERCIAL', 3, 53500, 9630, 6420, 7576],
['COMMERCIAL', 4, 80500, 14490, 9660, 11399],
['ESTATE', 1, 21500, 3870, 2580, 3044],
['ESTATE', 2, 31000, 5580, 3720, 4390],
['ESTATE', 3, 47000, 8460, 5640, 6655],
['ESTATE', 4, 71000, 12780, 8520, 10054],
['APPEAL', 1, 36000, 6480, 4320, 5098],
['APPEAL', 2, 50000, 9000, 6000, 7080],
['APPEAL', 3, 72500, 13050, 8700, 10266],
['APPEAL', 4, 109000, 19620, 13080, 15434],
```
✓.

Wait — one more check on the 2022 expUrg for ESTATE band 2: base 31000, urg 5580 → 36580 × 0.12 = 4389.6 → 4390 ✓. ESTATE band 3: 47000+8460 = 55460 → 6655.2 → 6655 ✓. ESTATE band 4: 71000+12780 = 83780 → 10053.6 → 10054 ✓. COMMERCIAL band 3: 53500+9630 = 63130 → 7575.6 → 7576 ✓. COMMERCIAL band 4: 80500+14490 = 94990 → 11398.8 → 11399 ✓. APPEAL band 1: 36000+6480 = 42480 → 5097.6 → 5098 ✓. APPEAL band 4: 109000+19620 = 128620 → 15434.4 → 15434 ✓. STANDARD band 4: 49000+8820 = 57820 → 6938.4 → 6938 ✓. COMMERCIAL band 1: 26500+4770 = 31270 → 3752.4 → 3752 ✓. ESTATE band 1: 21500+3870 = 25370 → 3044.4 → 3044 ✓. Good.

Now, the matrix test code:

```ts
const URGENT_DEADLINE = '2023-01-20'; // 5 days after NOW: inside the 7-day window

function inputFor(openedAt: string, over: Partial<CaseInput> = {}): CaseInput {
  return { type: 'STANDARD', complexity: 1, openedAt, ...over };
}
```

Then:

```ts
function matrixFor(name: TableName, openedAt: string, rows: Row[]): void {
  describe(`rate table ${name} (cases opened ${openedAt})`, () => {
    it.each(rows)('base fee: %s band %i', (type, band, base) => {
      expect(calculateFee(inputFor(openedAt, { type, complexity: band }), NOW)).toEqual({
        table: name, bandFee: base, urgencyFee: 0, expeditedFee: 0, total: base,
      });
    });
    it.each(rows)('urgent fee: %s band %i (deadline 5 days out)', (type, band, _base, urgency) => {
      expect(calculateFee(inputFor(openedAt, { type, complexity: band, deadline: URGENT_DEADLINE }), NOW)).toEqual({
        table: name, bandFee: _base, urgencyFee: urgency, expeditedFee: 0, total: _base + urgency,
      });
    });
    ...
  });
}
```
Hmm — `it.each(rows)` where rows are tuples of 6 numbers: vitest's it.each supports arrays of arrays and unpacks them into arguments. With a tuple type `readonly [CaseType, number, ...]`, `it.each(rows)` — typing: vitest's `it.each` accepts `readonly unknown[][]` or an object array; tuple arrays should be fine. The callback receives the unpacked args. TS might complain about the callback parameter count vs unknown[]. To be safe, I'll type the rows as plain `Row[]` (mutable array) and cast if needed. Actually vitest's `it.each` signature: `each<T extends any[]>(cases: T | readonly T[]): (name, ...args: T) => void` — something like that; with Row = [string, number, number, number, number, number], the callback gets 6 typed args. I believe modern vitest types handle tuple arrays properly. I'll write the callback with explicit typed params: `(type: CaseType, band: number, base: number, urgency: number, expOnly: number, expBoth: number)`.

Unused params: for the base scenario I don't use urgency etc. — prefix with underscore. But `it.each` unpacks all 6; the callback can take fewer (I'll only take the 3 I need). For the base: `(type, band, base)` — fine, extra args ignored.

TS strict: `noUnusedParameters`? tsconfig has `"strict": true` but noUnusedParameters is not part of strict. ✓ And tsconfig `include` doesn't cover test/ anyway, but vitest/esbuild doesn't type-check. Still, I'll keep it clean.

Now — one concern: `total: base + urgency` in the expected. I decided to accept sum expressions. Let me reconsider once more… acceptance criteria: "the full case types × bands matrix is asserted." The components are the content. The sum expression is exact. But a picky reviewer might see `total: base + urgency` as "deriving the expected from the input" — no, it's deriving from the pinned component literals; it's equivalent. I'll keep it, with a comment at the top of the data block: "totals in the assertions below are the exact integer sum of the pinned components; the components are the pinned behaviour." Good.

Alternatively — to be even safer against "hollow" accusations, I could write the totals as literals for at least the "both" scenario (the most complex). 48 additions by hand… I've already verified a few. Risk of a digit error across 48 is real. Sum expressions eliminate that. I'll keep the sum expressions. Final decision.

Hmm wait. Actually, let me reconsider using literals for totals. The whole point of a characterization suite is that the numbers in the file are the pin. If someone changes the code to `total: Math.round(bandFee + urgencyFee + expeditedFee)` — with integer components it's identical. If they change the component rounding, the component literals break. The sum is safe. Final: sum expressions.

Now, let me also double-check the `table` values in the matrix: `table: name` where name is '2019'|'2021'|'2022' — matches the code's naming. ✓

Edge: the 2022 matrix uses openedAt '2023-01-01' — fine (> 2022-07-01).

Urgent scenario in the matrix: deadline '2023-01-20', NOW '2023-01-15' → 5 days ≤ 7 → urgent regardless of table. ✓

Expedited scenario: `expedited: true`, no deadline → urgency 0. ✓

Both: deadline + expedited. ✓

Now, the flagged "rounding" tests (half-up pins) — these overlap with matrix values (2019 STANDARD band 2 expBoth 2128 is already in ROWS_2019). A dedicated named test adds the "flagged" semantics: I'll write:

```ts
describe('rounding (pinned as-is)', () => {
  it('[PINNED] 2019 urgent+expedited rounds the half-cent UP: 2127.5 -> 2128 (STANDARD band 2)', () => {
    const r = calculateFee(inputFor('2020-06-15', { complexity: 2, deadline: URGENT_DEADLINE, expedited: true }), NOW);
    // 18500 + 15% = 21275; 10% of 21275 = 2127.5; Math.round -> 2128 (not 2127)
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 18500 + 2775 + 2128 });
  });
  it('[PINNED] 2019 urgent+expedited half-cent up: 3622.5 -> 3623 (COMMERCIAL band 2)', ...3623... total 31500+4725+3623);
  it('[PINNED] 2019 urgent+expedited half-cent up: 4542.5 -> 4543 (ESTATE band 3)', ...);
  it('[PINNED] 2022 urgent+expedited rounds 15434.4 down to 15434 (APPEAL band 4) — rounding is Math.round, not ceil', ...);
});
```
The 2022 one documents the direction for a non-.5 fraction (rounds to nearest, not ceil). Good.

Now, let me also re-verify 2019 COMMERCIAL band 2: base 31500, urg 4725 → 36225 → 10% = 3622.5 → 3623 ✓. ESTATE band 3: 39500 + 5925 = 45425 → 4542.5 → 4543 ✓.

FINDINGS.md content. I'll write it with entries F1..F6 + open questions. Each: reproducing input (exact call), current behavior (exact output), what it probably intended, blast radius, proposed fix (not applied), and a pointer to the test name.

F1 — 2022 revision day billed at 2021 rates (off-by-one, the "genuine bug").
- Reproduce: `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2023-01-15')` → `{ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }`. Same input with openedAt '2022-07-02' → table '2022', 15000.
- What it probably intended: `>=` like the 2021 boundary; the header comment "2022-07: rate revision" suggests rates changed on 2022-07-01.
- Blast radius: every case opened exactly on 2022-07-01: underbilled by (2022−2021) base delta per band (e.g. STANDARD band 1: 1500; APPEAL band 4: 10000) and urgent cases that day also earned 15% not 18%. Stored in the audit → reconciliation gap. Single calendar day, but if a batch import landed on that date, it could be concentrated.
- Fix: `if (openedAt >= REVISION_2022)` — not applied. (Or better: parse dates and compare chronologically; but the minimal fix is the operator.)
- Test: `[KNOWN BUG] ... 2022-07-01 ...`

F2 — urgency window has no lower bound: past deadlines are urgent.
- Reproduce: `calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: '2020-01-01' }, '2023-01-15')` → urgencyFee 2025, total 15525.
- Probably intended: urgent only when `0 <= days <= 7`.
- Blast radius: large — any case whose deadline had already passed at fee-generation time carries a 15%/18% urgency fee. That's potentially a big slice of the historical record (overdue cases). Direction: overbilled relative to a 0..7 window.
- Fix: `const days = daysBetween(ref, c.deadline); if (c.deadline && days >= 0 && days <= 7)`. Note ambiguity: if "overdue = urgent" was intended, the window should be `days <= 7 || days < 0` — i.e. the current code — so this is "likely bug, confirm with billing." Not applied.
- Test: `[KNOWN BUG] a deadline in the past ...`

F3 — fractional complexity → undefined bandFee, NaN total.
- Reproduce: complexity 2.5 → `{ table, bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }`; `JSON.stringify` → `{"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}`.
- Probably intended: bands are 1..4 integers; non-integers should be rejected (throw) or floored/clamped.
- Blast radius: if such a record ever reached billing (the type allows any number), the stored fee would serialize with `total: null` (and no bandFee key) — silent audit corruption, or a crash in downstream consumers that do arithmetic on the fee.
- Fix: `if (!Number.isInteger(band)) throw new Error('complexity must be an integer band 1..4')` before clamping — not applied.
- Test: `[QUIRK] fractional complexity 2.5 ...`

F4 — unknown case type silently falls back to STANDARD.
- Reproduce: type 'PROBATE' (or 'standard', or '') → STANDARD band fee, breakdown identical in shape to a real STANDARD case; no flag.
- Probably intended: per the inline comment, intentional for old-system imports ("default them"). The quirk is invisibility: the output cannot distinguish a fallback.
- Blast radius: historical fees for imported cases are billed as STANDARD with no marker; an audit that later discovers the true type cannot reconcile. Case-sensitive lookup means 'Commercial' silently becomes STANDARD.
- Fix (proposed): add a `typeFallback: true` field (or reject unknown types at the API boundary). Not applied.
- Test: `[QUIRK] unknown case type silently falls back to STANDARD fees`.

F5 — half-up rounding at each step (pinned, not a defect per se — documents the exact rule).
- Reproduce: 2019 STANDARD band 2 urgent+expedited → expeditedFee 2128 (from 2127.5); COMMERCIAL band 2 → 3623 (3622.5); ESTATE band 3 → 4543 (4542.5). 2022 APPEAL band 4 → 15434 (15434.4).
- What it means: `Math.round` rounds .5 toward +∞ (not banker's). If billing ever "fixes" rounding to banker's or to floor, these stored values change.
- Also note: the expedited percentage is applied to `bandFee + urgencyFee` where urgencyFee is already rounded (sequential rounding). With the current table data the urgency fee is always an exact integer (all band fees are multiples of 100 cents; 15%/18% of a multiple of 100 is an integer), so the sequential step is currently indistinguishable from single rounding — but it would diverge if a future rate revision introduced a band fee not divisible accordingly.
- Blast radius: the three .5 cases and every fractional expedited case in 2022 are baked into stored fees; changing the rounding rule changes them.
- Fix: none proposed (behavior is "correct as implemented"); pin so a future change is deliberate.

F6 — table selection is lexicographic string comparison on ISO date strings.
- Reproduce: `openedAt: '2022-07-01T00:00:00'` → table '2022', while `'2022-07-01'` → '2021'. Same calendar day, different table.
- Probably intended: compare calendar dates. For the documented 'YYYY-MM-DD' format the lexicographic order equals chronological order, so this only bites if a time component (or any other format) sneaks in — and note it interacts with F1 (the strict `>` makes the 2022 edge flip).
- Blast radius: any imported openedAt with a time component on or after 2022-07-01 gets the 2022 table (and one on 2021-01-01 gets the 2021 table, which agrees with the bare-date behavior). The 2022 edge is the only place the two behaviors disagree… wait, let me also check 2021-01-01T...: `>= '2021-01-01'` → both true → 2021. Same. And '2020-12-31T23:59:59' < '2021-01-01' → 2019, same as bare. So only the 2022 revision day flips. ✓
- Fix (proposed): normalize to date-only (slice(0,10)) or compare Date objects — not applied.
- Test: `[QUIRK] datetime-stamped openedAt on 2022-07-01 ...`.

Open questions (honest gaps):
1. The default clock (`now` undefined) uses `new Date().toISOString().slice(0, 10)` — the UTC date at call time. I deliberately do not test this path (it would make the suite non-deterministic). Production urgency therefore depends on the UTC calendar day of fee generation; for billing machines west of UTC the "same case, different day" boundary can differ from local business day. I can't verify production call patterns from the repo.
2. `daysBetween` floors the millisecond difference; for the documented 'YYYY-MM-DD' inputs both endpoints parse as UTC midnight so the division is exact. If a caller ever passed a datetime deadline, a deadline N days + 23 hours out would count as N days (widening the urgent window by up to a day). Untested (off the documented input contract).
3. Whether the 2022-07-01 exclusivity (F1) and past-deadline urgency (F2) are bugs or intentional is not decidable from the code alone — the header comment and the 2021 asymmetry make F1 likely a bug; F2 needs billing confirmation. Both are pinned as-is regardless.
4. `complexity` is typed `number | null` but the code also guards `undefined`; a JSON record missing the key (undefined, not null) throws the same error — pinned by the "missing complexity" test.

Also worth a note in FINDINGS: determinism note — all tests pass an explicit `now`; no test depends on the machine clock or timezone (all date parsing is UTC midnight).

Now — the test names for the flagged tests should "flag" them. I'll use a consistent convention: names prefixed with `[KNOWN BUG]` / `[PINNED QUIRK]`. And the suite header comment explains the convention + points to FINDINGS.md.

Now, let me also reconsider the spec requirement: "urgency multiplier, including the boundary that decides urgent vs not" ✓ (7/8-day boundary + 0-day + past). "Both rate table transitions, specifically the inclusive/exclusive edge at each" ✓ (2020-12-31/2021-01-01; 2022-06-30/2022-07-01/2022-07-02). "Rounding at each step — where it happens, and whether it happens more than once" ✓ (rounding tests + F5 note on double rounding). "Degenerate inputs: zero, negative, unknown case type, missing complexity" ✓.

"Production code untouched" — I don't deliver feeCalculator.ts at all. The instruction "deliver every file the solution needs" — the solution needs the test file + FINDINGS.md. feeCalculator.ts already exists; I shouldn't restate it ("do not restate files you are not changing"). ✓ I'll deliver exactly two files: `test/fee-calculator.spec.ts` and `FINDINGS.md`.

Hmm, wait — should the test file be `test/fee-calculator.spec.ts` or `test/feeCalculator.spec.ts`? Repo convention: "TS files: kebab-case.role.ts" → `fee-calculator.spec.ts`? The convention pattern `<feature>.spec.ts` with kebab feature → `fee-calculator.spec.ts`. But the module is `feeCalculator.ts` (existing, camel — legacy). The new file I create should follow the stated convention: kebab-case. I'll use `test/fee-calculator.spec.ts`.

Now, let me write out the full test file carefully.

One more design decision: import `CaseType` for the row type. `import { calculateFee } from '../feeCalculator'; import type { CaseInput, CaseType } from '../feeCalculator';` — the module exports CaseType, CaseInput, calculateFee, FeeBreakdown. ✓

Let me draft:

```ts
// Characterization suite for feeCalculator.ts — pins CURRENT behaviour, not intended behaviour.
//
// Conventions in this file:
//  - Every calculateFee call passes an explicit `now` (the module's existing optional
//    clock parameter). No test may rely on the real clock: the default `now` path is
//    intentionally untested (see FINDINGS.md, open questions).
//  - All dates are bare 'YYYY-MM-DD' strings; the module parses them as UTC midnight,
//    so results are identical in every timezone.
//  - Expected values are hand-computed literals from the rate tables and the rounding
//    rules as written in feeCalculator.ts. `total` is asserted as the exact integer sum
//    of the pinned component literals (integer addition is exact; the components carry
//    the behaviour).
//  - Tests prefixed [KNOWN BUG] or [PINNED QUIRK] assert behaviour that is documented
//    as wrong/surprising in FINDINGS.md. They are pinned deliberately, not because
//    the value is right. Do not "fix" the value in a test without re-doing the
//    FINDINGS analysis.

import { describe, expect, it } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput, CaseType } from '../feeCalculator';

const NOW = '2023-01-15';
const URGENT_DEADLINE = '2023-01-20'; // 5 days after NOW — inside the 7-day urgency window

function inputFor(openedAt: string, over: Partial<CaseInput> = {}): CaseInput {
  return { type: 'STANDARD', complexity: 1, openedAt, ...over };
}

type Row = readonly [CaseType, number, number, number, number, number];
//          type    band   base    urgency  expeditedAlone  expeditedWithUrgency

const ROWS_2019: readonly Row[] = [...];
const ROWS_2021: readonly Row[] = [...];
const ROWS_2022: readonly Row[] = [...];

const TABLES: readonly { name: '2019' | '2021' | '2022'; openedAt: string; rows: readonly Row[] }[] = [
  { name: '2019', openedAt: '2020-06-15', rows: ROWS_2019 },
  { name: '2021', openedAt: '2021-06-15', rows: ROWS_2021 },
  { name: '2022', openedAt: '2023-01-01', rows: ROWS_2022 },
];

for (const t of TABLES) {
  describe(`full matrix, rate table ${t.name} (openedAt ${t.openedAt})`, () => {
    it.each(t.rows)('base fee only: %s band %i', (type, band, base) => {
      expect(
        calculateFee(inputFor(t.openedAt, { type, complexity: band }), NOW),
      ).toEqual({ table: t.name, bandFee: base, urgencyFee: 0, expeditedFee: 0, total: base });
    });

    it.each(t.rows)('urgency only: %s band %i (deadline %s, 5 days out)', (type, band, base, urgency) => {
      expect(
        calculateFee(inputFor(t.openedAt, { type, complexity: band, deadline: URGENT_DEADLINE }), NOW),
      ).toEqual({ table: t.name, bandFee: base, urgencyFee: urgency, expeditedFee: 0, total: base + urgency });
    });

    it.each(t.rows)('expedited only: %s band %i', (type, band, base, _u, expedited) => {
      expect(
        calculateFee(inputFor(t.openedAt, { type, complexity: band, expedited: true }), NOW),
      ).toEqual({ table: t.name, bandFee: base, urgencyFee: 0, expeditedFee: expedited, total: base + expedited });
    });

    it.each(t.rows)('urgency + expedited: %s band %i (expedited fee applies to band fee + rounded urgency)', (type, band, base, urgency, _e, expeditedUrgent) => {
      expect(
        calculateFee(inputFor(t.openedAt, { type, complexity: band, deadline: URGENT_DEADLINE, expedited: true }), NOW),
      ).toEqual({ table: t.name, bandFee: base, urgencyFee: urgency, expeditedFee: expeditedUrgent, total: base + urgency + expeditedUrgent });
    });
  });
}
```

Wait — `it.each(t.rows)` where rows are `readonly [CaseType, ...]`: vitest's `it.each` typing — `each<T extends any[]>(table: readonly [T, ...][])`… I need to make sure the callback gets properly typed args and that a readonly tuple array is accepted. Vitest's `each` is compatible with Jest's `it.each`. Jest's typing: `each<T extends any[]>(cases: T[]): (name: string, ...args: T) => void` roughly — actually jest defines `each<T>(cases: T[]): ...` in a complex way. In vitest, `it.each` accepts arrays of arrays. A readonly tuple array should be assignable. If I'm worried, I could type the rows as mutable `Row[]` with `Row = [CaseType, number, number, number, number, number]`. A mutable tuple array is definitely accepted. The `as const`-ness isn't needed. I'll use mutable tuples to be safe with the typing: `const ROWS_2019: Row[] = [...]`.

Also, in `it.each(t.rows)` where t.rows is `Row[]` — fine.

Callback arg count: for the base test I take 3 of 6 — allowed (extra args ignored, and TS is fine with fewer params).

One more check — `inputFor(t.openedAt, { type, complexity: band })`: the Partial spread overrides type and complexity. ✓

Now, edge/boundary describe:

```ts
describe('rate table selection by openedAt (inclusive/exclusive edges)', () => {
  it('day before the 2021 revision (2020-12-31) -> 2019 table', () => {
    expect(calculateFee(inputFor('2020-12-31'), NOW)).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000 });
  });
  it('the 2021 revision day (2021-01-01) -> 2021 table (inclusive edge)', () => {
    expect(calculateFee(inputFor('2021-01-01'), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
  it('day after the 2021 revision (2021-01-02) -> 2021 table', () => {
    expect(calculateFee(inputFor('2021-01-02'), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
  it('day before the 2022 revision (2022-06-30) -> 2021 table', () => {
    expect(calculateFee(inputFor('2022-06-30'), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
  it('[KNOWN BUG] the 2022 revision day (2022-07-01) -> 2021 table, not 2022 (exclusive edge; see FINDINGS.md F1)', () => {
    const onEdge = calculateFee(inputFor('2022-07-01'), NOW);
    expect(onEdge).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
    // and an urgent case opened that same day earns the 2021 urgency rate (15%), not 18%
    const urgentOnEdge = calculateFee(inputFor('2022-07-01', { deadline: URGENT_DEADLINE }), NOW);
    expect(urgentOnEdge).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 13500 + 2025 });
    // the very next day selects the 2022 table (18% urgency)
    const nextDay = calculateFee(inputFor('2022-07-02', { deadline: URGENT_DEADLINE }), NOW);
    expect(nextDay).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 2700, expeditedFee: 0, total: 15000 + 2700 });
  });
  it('day after the 2022 revision (2022-07-02) -> 2022 table (plain, non-urgent)', () => {
    expect(calculateFee(inputFor('2022-07-02'), NOW)).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 });
  });
  it('there is no lower bound: 2018-03-05 (pre-2019) still selects the 2019 table', () => {
    expect(calculateFee(inputFor('2018-03-05'), NOW)).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000 });
  });
  it('[PINNED QUIRK] a datetime-stamped openedAt on 2022-07-01 compares greater than "2022-07-01" and selects the 2022 table (F2)', () => {
    expect(calculateFee(inputFor('2022-07-01T00:00:00'), NOW)).toEqual({ table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 });
  });
});
```

Urgency boundary:

```ts
describe('urgency boundary: daysBetween(now, deadline) <= 7', () => {
  const openedAt = '2021-06-15'; // 2021 table, urgency 15% of 13500 = 2025
  it('deadline 7 days out (inclusive edge) -> urgent', () => {
    expect(calculateFee(inputFor(openedAt, { deadline: '2023-01-22' }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
  });
  it('deadline 8 days out (just past the edge) -> not urgent', () => {
    expect(calculateFee(inputFor(openedAt, { deadline: '2023-01-23' }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
  it('deadline 6 days out (inside) -> urgent', () => {
    expect(calculateFee(inputFor(openedAt, { deadline: '2023-01-21' }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
  });
  it('deadline today (0 days) -> urgent', () => {
    expect(calculateFee(inputFor(openedAt, { deadline: '2023-01-15' }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
  });
  it('no deadline -> not urgent', () => {
    expect(calculateFee(inputFor(openedAt), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
  it('[KNOWN BUG] a deadline in the past still earns the urgency fee — the window has no lower bound (F3)', () => {
    // '2020-01-01' is 1110 days before NOW
    expect(calculateFee(inputFor(openedAt, { deadline: '2020-01-01' }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 });
  });
});
```

Verify: 2023-01-15 + 7 = 2023-01-22 ✓ (January has 31 days: 15+7 = 22). +8 = 23 ✓.

Round check: 13500+2025 = 15525 ✓.

Rounding describe (as above).

Degenerate describe:

```ts
describe('degenerate inputs (pinned as-is)', () => {
  const openedAt = '2021-06-15'; // 2021 table
  it('complexity null -> throws "complexity is required"', () => {
    expect(() => calculateFee(inputFor(openedAt, { complexity: null }), NOW)).toThrowError('complexity is required');
  });
  it('complexity missing entirely (undefined, e.g. a JSON record without the key) -> throws "complexity is required"', () => {
    const c = { type: 'STANDARD', openedAt } as CaseInput;
    expect(() => calculateFee(c, NOW)).toThrowError('complexity is required');
  });
  it('complexity 0 -> clamped to band 1 (falsy branch)', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: 0 }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
  it('complexity -3 (negative) -> clamped to band 1', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: -3 }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
  it('complexity 0.5 -> clamped to band 1 (< 1 branch, not the falsy branch)', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: 0.5 }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
  it('complexity NaN -> clamped to band 1 (NaN is falsy under !band)', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: NaN }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
  it('complexity 5 -> clamped to band 4', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: 5 }), NOW)).toEqual({ table: '2021', bandFee: 44500, urgencyFee: 0, expeditedFee: 0, total: 44500 });
  });
  it('complexity 100 -> clamped to band 4', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: 100 }), NOW)).toEqual({ table: '2021', bandFee: 44500, urgencyFee: 0, expeditedFee: 0, total: 44500 });
  });
  it('[PINNED QUIRK] complexity 2.5 (fractional) -> bandFee undefined, total NaN, and JSON total null (F4)', () => {
    const r = calculateFee(inputFor(openedAt, { complexity: 2.5 }), NOW);
    expect(r.table).toBe('2021');
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(r.total).toBeNaN();
    // what would actually get stored:
    expect(JSON.stringify(r)).toBe('{"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}');
  });
});
```

Wait — the type of `inputFor(openedAt, { complexity: null })`: the over is Partial<CaseInput> — complexity: number | null | undefined — null is allowed ✓. NaN: number ✓.

Unknown type:

```ts
describe('unknown / malformed case type (pinned as-is)', () => {
  it.each([
    ['2019', '2020-06-15', 18500],
    ['2021', '2021-06-15', 20500],
    ['2022', '2023-01-01', 22500],
  ])('[PINNED QUIRK] unknown type "PROBATE" silently falls back to STANDARD band 2 fees, table %s (F5)', (_label, openedAt, base) => {
    const r = calculateFee(inputFor(openedAt, { type: 'PROBATE', complexity: 2 }), NOW);
    expect(r).toEqual({ table: _label as '2019' | '2021' | '2022', bandFee: base, urgencyFee: 0, expeditedFee: 0, total: base });
    // no fallback marker: the breakdown shape is identical to a genuine STANDARD case
    expect(Object.keys(r).sort()).toEqual(['bandFee', 'expeditedFee', 'table', 'total']);
  });
  it('[PINNED QUIRK] lookup is case-sensitive: "standard" is unknown and falls back to STANDARD fees', () => {
    expect(calculateFee(inputFor('2021-06-15', { type: 'standard' }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
  it('[PINNED QUIRK] empty-string type is unknown and falls back to STANDARD fees', () => {
    expect(calculateFee(inputFor('2021-06-15', { type: '' }), NOW)).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 });
  });
});
```

Wait, `it.each` with a mixed tuple of [string, string, number] — fine.

Hmm, `table: _label as '2019'|'2021'|'2022'` — cleaner: type the each table:
```ts
const FALLBACK_ROWS: [string, string, number][] = [...]
it.each(FALLBACK_ROWS)('...', (name, openedAt, base) => { ... table: name as TableName ... })
```
Or define `type TableName = '2019' | '2021' | '2022'` and rows as `[TableName, string, number][]`. I'll do that.

Also the rounding describe:

```ts
describe('rounding, pinned as-is', () => {
  const urgent = (openedAt: string, over: Partial<CaseInput> = {}) =>
    calculateFee(inputFor(openedAt, { deadline: URGENT_DEADLINE, expedited: true, ...over }), NOW);

  it('[PINNED] 2019 STANDARD band 2 urgent+expedited: expedited fee is Math.round(2127.5) = 2128 — halves round UP (F6)', () => {
    expect(urgent('2020-06-15', { complexity: 2 })).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 18500 + 2775 + 2128 });
  });
  it('[PINNED] 2019 COMMERCIAL band 2 urgent+expedited: Math.round(3622.5) = 3623 (F6)', () => {
    expect(urgent('2020-06-15', { complexity: 2, type: 'COMMERCIAL' })).toEqual({ table: '2019', bandFee: 31500, urgencyFee: 4725, expeditedFee: 3623, total: 31500 + 4725 + 3623 });
  });
  it('[PINNED] 2019 ESTATE band 3 urgent+expedited: Math.round(4542.5) = 4543 (F6)', () => {
    expect(urgent('2020-06-15', { complexity: 3, type: 'ESTATE' })).toEqual({ table: '2019', bandFee: 39500, urgencyFee: 5925, expeditedFee: 4543, total: 39500 + 5925 + 4543 });
  });
  it('[PINNED] 2022 APPEAL band 4 urgent+expedited: Math.round(15434.4) = 15434 — fractions round to nearest, not up (F6)', () => {
    expect(urgent('2023-01-01', { complexity: 4, type: 'APPEAL' })).toEqual({ table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 15434, total: 109000 + 19620 + 15434 });
  });
});
```

Also — should I pin "expedited without urgency never rounds (10%/12% of a multiple of 100 is exact)"? The matrix already pins those exact integer values. The finding F5/F6 note covers the analysis. Fine.

Now the numbering of FINDINGS — I referenced F1..F6 in tests. Let me finalize the FINDINGS list to match the test references:

- F1: 2022 revision day excluded (the `>` vs `>=` bug). Test: '[KNOWN BUG] the 2022 revision day (2022-07-01) ...'
- F2: datetime-stamped openedAt flips the 2022 edge (lexicographic comparison). Test: '[PINNED QUIRK] a datetime-stamped openedAt on 2022-07-01 ...'
- F3: past-deadline urgency (no lower bound). Test: '[KNOWN BUG] a deadline in the past ...'
- F4: fractional complexity → undefined/NaN/null. Test: '[PINNED QUIRK] complexity 2.5 ...'
- F5: unknown type silent STANDARD fallback (incl. case sensitivity, empty string). Test: the unknown-type describe.
- F6: rounding rule — Math.round half-up, applied per step; the expedited step rounds fractions (three .5 cases in 2019; fractional in 2022); the sequential (double) rounding structure is currently dormant on the urgency step. Tests: the rounding describe + the both-matrix.

Open questions: default clock untested; the floor of daysBetween for datetime deadlines; the bug-vs-intent for F1/F3 needing billing confirmation; the undefined guard is live for JSON records missing the key (this is more a note than a question — I'll fold it into the degenerate note or the F list… I'll add it as a "notes" bullet).

Let me re-verify a few more matrix numbers I haven't re-checked:
- 2021 COMMERCIAL band 4 expUrg: 73000 + 10950 = 83950; ×0.12 = 10074 ✓.
- 2021 APPEAL band 1: 32500 + 4875 = 37375; ×0.12 = 4485 ✓.
- 2019 APPEAL band 3: 61000 + 9150 = 70150; ×0.10 = 7015 ✓.
- 2022 COMMERCIAL band 2: 37500 + 6750 = 44250; ×0.12 = 5310 ✓.
- 2022 ESTATE band 4: 71000 + 12780 = 83780; ×0.12 = 10053.6 → 10054 ✓.
- 2019 ESTATE band 4: 60000 + 9000 = 69000 → 6900 ✓.
- 2021 ESTATE band 4: 64500 + 9675 = 74175 → ×0.12 = 8901 ✓.
- 2022 APPEAL band 3: 72500 + 13050 = 85550 → 10266 ✓.
- 2021 APPEAL band 4: 99000 + 14850 = 113850 → 13662 ✓.
- 2022 APPEAL band 2: 50000 + 9000 = 59000 → 7080 ✓.
- 2019 COMMERCIAL band 4: 68000 + 10200 = 78200 → 7820 ✓.
- 2019 STANDARD band 4: 41000 + 6150 = 47150 → 4715 ✓.

Expedited-only 2022 APPEAL band 4: 109000 × 0.12 = 13080 ✓. 2021 APPEAL band 4: 99000 × 0.12 = 11880 ✓. 2019 APPEAL band 4: 92000 × 0.1 = 9200 ✓.

Good.

One more consideration — `urgencyFee` for 2022 matrix rows uses 18%: verify STANDARD band 3: 32500 × 0.18 = 5850 ✓ (325×18 = 5850). COMMERCIAL band 4: 80500 × 0.18 = 14490 ✓ (805×18: 800×18=14400 + 90 = 14490). ESTATE band 3: 47000×0.18 = 8460 ✓ (470×18 = 8460). APPEAL band 3: 72500×0.18 = 13050 ✓ (725×18: 700×18=12600+25×18=450 → 13050). ESTATE band 4: 71000×0.18 = 12780 ✓ (710×18 = 12780). APPEAL band 4: 109000×0.18 = 19620 ✓ (1090×18 = 19620). COMMERCIAL band 3: 53500×0.18 = 9630 ✓ (535×18 = 9630). ESTATE band 1: 21500×0.18 = 3870 ✓. COMMERCIAL band 1: 26500×0.18 = 4770 ✓. APPEAL band 1: 36000×0.18 = 6480 ✓. APPEAL band 2: 50000×0.18 = 9000 ✓. STANDARD band 1/2/4 ✓ done.

Now, potential pitfall: `it.each` title with `%i` for band (number) — fine. `%s` for type — fine.

Also, should I use `expect(...).toEqual` on the object — the order of keys in the expected object doesn't matter for toEqual. ✓

Now, one more thought on "the suite passes, twice" — there's no state; each test is independent; the module has no mutable global state (the tables are const). ✓ Deterministic. ✓

Also, should I add a test that pins `FeeBreakdown` has exactly four keys (no more)? The unknown-type test does `Object.keys` check. The toEqual in all matrix tests also enforces exact shape (toEqual ignores undefined props but fails on extra defined props). ✓ Good enough.

Now, the `CaseType` import is used only in the Row type. `FeeBreakdown` isn't imported (not needed).

Edge: `inputFor`'s default type 'STANDARD', complexity 1 — the boundary tests override as needed.

Let me also double-check the vitest import style: `import { describe, expect, it } from 'vitest';` ✓.

TS: `const TABLES: readonly TableSpec[]` with TableSpec interface:
```ts
interface TableSpec {
  name: TableName;
  openedAt: string;
  rows: Row[];
}
```

Now, the `for (const t of TABLES) { describe(...) }` — top-level loop with describe inside: allowed in vitest (collection is synchronous). ✓

Now, let me also verify the "missing complexity" cast: `const c = { type: 'STANDARD', openedAt } as CaseInput;` — TS: the assertion from `{type: string; openedAt: string}` to `CaseInput`. Assignability: is `CaseInput` assignable to `{type: string; openedAt: string}`? Yes (a superset of properties). So the assertion is allowed (one-directional assignability is enough for `as`). ✓

`toThrowError('complexity is required')` — vitest supports `toThrowError(string)` ✓ (alias of toThrow).

JSON.stringify assertion: `JSON.stringify(r)` where r = { table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }. Property order in r: construction order in the code: `{ table: tableName, bandFee, urgencyFee, expeditedFee, total }` → table, bandFee, urgencyFee, expeditedFee, total. Stringify drops bandFee (undefined), NaN→null: `{"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}`. ✓

Now the content of FINDINGS.md. I'll write it structured:

# FINDINGS — feeCalculator.ts (characterization)

Intro: what this document is, the pinned-as-is convention, a pointer to test names, "no fix has been applied."

Then each finding: severity tag, reproducing input (exact JS), current output (exact), analysis, blast radius, proposed fix (not applied), pinned-by test name.

Then open questions.

Then a note on determinism.

Let me draft the exact outputs for each finding:

F1 reproducing:
```js
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }

calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-02' }, '2023-01-15')
// => { table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 }
```
And urgent variant: openedAt 2022-07-01, deadline '2023-01-20' → urgency 2025 (15%) vs 2022-07-02 → 2700 (18%).

Blast radius: every case opened on 2022-07-01: base underbilled by the 2021→2022 delta per band (range: STANDARD band 1 −1500 … APPEAL band 4 −10000 cents → $15–$100 per case); urgent cases that day also underbilled on the urgency delta (15% vs 18%). All stored and audited.

F2 reproducing: openedAt '2022-07-01T00:00:00' → table '2022' bandFee 15000, whereas bare '2022-07-01' → '2021' 13500. Note: for the documented 'YYYY-MM-DD' format this is a latent issue; it only surfaces if a time component (or a differently-formatted string) is stored. Interacts with F1.

F3 reproducing: deadline in the past:
```js
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: '2020-01-01' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 }
```
Window is effectively `deadline <= now + 7 days` with no lower bound.

Blast radius: overbilled urgency on all cases whose deadline had passed at fee generation — potentially the majority of historical cases (any overdue case). 15% (pre-2022) or 18% of the band fee.

F4 reproducing:
```js
calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2021-06-15' }, '2023-01-15')
// => { table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
// JSON.stringify => {"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}
```
Blast radius: if a fractional band ever reached billing, the stored record would have a null total and no bandFee — silent audit corruption / potential crash in consumers.

F5 reproducing:
```js
calculateFee({ type: 'PROBATE', complexity: 2, openedAt: '2021-06-15' }, '2023-01-15')
// => { table: '2021', bandFee: 20500, urgencyFee: 0, expeditedFee: 0, total: 20500 }  // = STANDARD band 2
```
Same for 'standard' and ''. No marker in the output.

F6 reproducing (rounding):
```js
calculateFee({ type: 'STANDARD', complexity: 2, openedAt: '2020-06-15', deadline: '2023-01-20', expedited: true }, '2023-01-15')
// => { table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 }
// 18500 * 15% = 2775 (exact); (18500 + 2775) * 10% = 2127.5 -> Math.round -> 2128 (half UP)
```
Plus the 2022 15434.4 → 15434 example. And the note that sequential rounding is currently dormant on the urgency step (urgency is always integer under current data).

Open questions:
1. The default clock (`now` undefined) uses `new Date().toISOString().slice(0, 10)` — the UTC date at call time. I deliberately do not test this path (it would make the suite non-deterministic). Production urgency therefore depends on the UTC calendar day of fee generation; for a billing machine west of UTC, the "same case, different day" boundary can differ from the local business day. I can't verify production call patterns from the repo.
2. `daysBetween` floors; exact for bare dates; a datetime deadline would widen the urgent window by up to a day (N days + 23 hours counts as N). Untested: off the documented input contract.
3. Whether F1 and F3 are bugs or intentional can't be settled from the code alone — F1 is likely a bug (asymmetric with the 2021 `>=`, and the header comment says the rates changed in 2022-07); F3 needs billing confirmation ("overdue is urgent" is a plausible intent). Both are pinned as-is.
4. `complexity` is typed `number | null` but the code also guards `undefined`; a JSON record missing the key (undefined, not null) throws the same error — pinned by the "missing complexity" test.

Also worth a note in FINDINGS: determinism note — all tests pass an explicit `now`; no test depends on the machine clock or timezone (all date parsing is UTC midnight).

Now — the test names for the flagged tests should "flag" them. I'll use a consistent convention: names prefixed with `[KNOWN BUG]` / `[PINNED QUIRK]`. And the suite header comment explains the convention + points to FINDINGS.md.

Now, let me also reconsider the spec requirement: "urgency multiplier, including the boundary that decides urgent vs not" ✓ (7/8-day boundary + 0-day + past). "Both rate table transitions, specifically the inclusive/exclusive edge at each" ✓ (2020-12-31/2021-01-01; 2022-06-30/2022-07-01/2022-07-02). "Rounding at each step — where it happens, and whether it happens more than once" ✓ (rounding tests + F5 note on double rounding). "Degenerate inputs: zero, negative, unknown case type, missing complexity" ✓.

"Production code untouched" — I don't deliver feeCalculator.ts at all. The instruction "deliver every file the solution needs" — the solution needs the test file + FINDINGS.md. feeCalculator.ts already exists; I shouldn't restate it ("do not restate files you are not changing"). ✓ I'll deliver exactly two files: `test/fee-calculator.spec.ts` and `FINDINGS.md`.

Now, let me also reconsider `total: base` in the base matrix — a literal (same number as bandFee, written once as `base`). Fine.

Also — a subtle vitest detail: `it.each(rows)` where rows is `Row[]` and the title uses `%s`/`%i` — vitest formats with printf-style; `%i` works. ✓

Another subtle point: in the matrix's urgency scenario, the title includes a constant; fine.

Potential issue: top-level `for` loop + `describe` — vitest supports it. ✓

Let me also reconsider whether to include the `FeeBreakdown` import — not needed.

Now, the filename decision again: `test/fee-calculator.spec.ts`. Import `'../feeCalculator'` — the module is at the repo root. ✓

Should I also verify that the suite compiles under `strict`? A few things:
- `inputFor`'s `over: Partial<CaseInput>` — spreading over the base; the result type: `{ type: string; complexity: number | null; openedAt: string } & Partial<CaseInput>` → assignable to CaseInput? The base has type/complexity/openedAt; Partial may override with undefined? Partial<CaseInput> has all-optional properties; spreading an optional property that's undefined doesn't override (the spread of a property that's not present in the value is a no-op). TS types the result as the base type with over's properties merged — the result type is computed as `{ type: string; complexity: number | null; openedAt: string; deadline?: string; expedited?: boolean }` — assignable to CaseInput ✓.

Actually wait: `complexity` in the base is `1` (literal), and Partial's complexity is `number | null | undefined`. The merged type: `number | null` (TS handles the spread: later property wins → `number | null | undefined`? If over.complexity can be undefined, the result's complexity could be typed `number | null | undefined`? For an object spread, TS computes the property type as a union of the base and the override when the override is optional: `1 | number | null` → `number | null`. Hmm, TS's spread type: for `{...a, ...b}` where b is Partial, the resulting property type is `b.P | a.P` if b.P is optional → `number | null | undefined | number | null` = `number | null | undefined`? Actually TS models an optional property in a spread as possibly absent; the resulting type is `a.P | b.P` with b.P including undefined only if the property is optional → `number | null | undefined`. Then assigning to `CaseInput` which requires `complexity: number | null` — `number | null | undefined` is not assignable to `number | null` under strict (exactOptionalPropertyTypes is not enabled by strict; but undefined-in-union still matters for required properties). Hmm, this could be a type error!

Let me think carefully. `function inputFor(openedAt: string, over: Partial<CaseInput> = {}): CaseInput { return { type: 'STANDARD', complexity: 1, openedAt, ...over }; }`

The return type is annotated `CaseInput`. The expression `{ type: 'STANDARD', complexity: 1, openedAt, ...over }` — TS computes its type: for a spread of `Partial<CaseInput>`, each property that's optional in over gets a type that's a union with the base: type: `string` (base 'STANDARD' → string; over type?: string) → string. complexity: `number | null | undefined`? Let me recall TS's rule: when you spread an object with optional properties, the resulting property is optional or a union with the original. Specifically for `{ ...a, ...b }`, a property present in both: type = `b[P] | a[P]` (when b[P] is optional, b[P] is treated as `b[P] | undefined`? no —).

TS behavior: `const x = { a: 1, ...y }` where `y: { a?: number }` → the type of x.a is `number` (not `number | undefined`)? Hmm. I think TS models it as: if b's property is optional, the resulting property type is `b[P] | a[P]`, and since b[P] is optional, when absent, a[P] stands → so the union `number | 1` = number. Not including undefined. Yes — I recall the result doesn't include undefined for an optional spread property; the union is just the value types. Example: `function f(p: Partial<{a: string}> = {}) { return { a: 'x', ...p } }` → the return type `{ a: string }`. I'm fairly confident TS gives `a: string` here.

So `complexity: number | null` ✓ assignable. Good. And even if I'm wrong, the function has an explicit return annotation, so if there's a mismatch it's a compile error — but vitest doesn't type-check, so it runs either way. To be even safer, I could type the base object as `CaseInput`:

```ts
function inputFor(openedAt: string, over: Partial<CaseInput> = {}): CaseInput {
  const base: CaseInput = { type: 'STANDARD', complexity: 1, openedAt };
  return { ...base, ...over };
}
```
`{ ...base, ...over }` with base: CaseInput, over: Partial<CaseInput> → result: each property `CaseInput[P] | (over[P] if present)`. type: string; complexity: number | null; openedAt: string; deadline?: string; expedited?: boolean → assignable to CaseInput ✓. This is safe. I'll use this form.

Similarly the `c` cast in the missing-complexity test is fine.

`Row` tuple and it.each: vitest's `it.each(cases)` — cases: `Row[]`. The signature in vitest (jest-compatible): `each<T extends any[]>(table: T): ...`? Actual jest typing: `it.each(table: readonly (readonly any[])[])`. Vitest's `it.each` is similar: accepts `readonly [T, ...]` or arrays of arrays. With `Row[]` where Row is a tuple — it's an array of arrays, fine. The callback args are typed from the tuple in modern vitest (they improved this). Even if the callback args are `any`, it compiles. OK.

One more: I use the `TableName` type in the unknown-type rows: `const FALLBACK: [TableName, string, number][]`.

Also in the matrix loop, `t.name` is `TableName` → used as the expected `table` value ✓.

Now, let me write FINDINGS.md in full.

Also — the header comment of the test file should note that feeCalculator.ts is byte-identical/untouched. And that the suite is run with vitest.

Let me also reconsider the acceptance: "both rate table boundaries tested on both sides of the edge" ✓ (2020-12-31 & 2021-01-01 & 2021-01-02; 2022-06-30 & 2022-07-01 & 2022-07-02).

"Degenerate inputs covered and their current behavior pinned" ✓.

"FINDINGS.md exists, with reproducing inputs and proposed-not-applied fixes" ✓.

"Suite passes, twice, no clock or randomness" — I should be careful that every call passes `now`. Let me scan my planned tests: matrix (passes NOW ✓), boundary (NOW ✓), urgency boundary (NOW ✓), rounding (NOW ✓), degenerate (NOW ✓), unknown type (NOW ✓). The throw tests also pass NOW (irrelevant but consistent) ✓.

One risk: `URGENT_DEADLINE = '2023-01-20'` with NOW '2023-01-15' — daysBetween('2023-01-15','2023-01-20') = 5 ✓ urgent.

In the matrix's urgency scenario across all tables — same deadline, fine.

Now — the 2022 matrix uses openedAt '2023-01-01': before NOW, fine (openedAt vs now is unrelated).

OK. Also — a potential concern: does vitest's `it.each` with a tuple array and a title placeholder `%i` render the number correctly — yes.

Also, let me reconsider: should the base matrix tests assert `total: base` (a literal) — yes, since it's a transcription.

Now — the file length will be substantial (~350 lines). That's appropriate.

Let me also double-check that no test name is accidentally misleading. And I'll use consistent F-references: in tests I referenced F1 (2022 edge), F2 (datetime), F3 (past deadline), F4 (fractional), F5 (fallback), F6 (rounding). Let me make sure FINDINGS uses the same numbering.

Wait, in the boundary describe I wrote "(see FINDINGS.md F1)" for the 2022-07-01 test, and "(F2)" for the datetime quirk, "(F3)" for past-deadline, "(F4)" for fractional, "(F5)" for fallback, "(F6)" for rounding. ✓ Consistent.

Now let me write FINDINGS.md:

```md
# FINDINGS — `feeCalculator.ts` characterization

This document accompanies the characterization suite in `test/fee-calculator.spec.ts`.
The suite pins what `calculateFee` does **today**; every finding below is pinned **as
it is**. No fix in this document has been applied to `feeCalculator.ts` — the production
file is byte-identical to what it was before this work.

Conventions:
- "Reproducing input" is the exact call to `calculateFee` (second argument is the module's
  existing optional `now` parameter — the only clock seam we are allowed to use).
- "Current output" is the exact returned `FeeBreakdown`.
- The matching test in the suite is named with a `[KNOWN BUG]` or `[PINNED QUIRK]`
  prefix so a reader knows the value was pinned deliberately, not because it is right.

## F1 — the 2022 rate revision does not apply on its own day (likely bug)

**Severity:** bug (likely) — asymmetric with the 2021 boundary; contradicts the header
comment "2022-07: rate revision".

`tableFor` uses `openedAt >= '2021-01-01'` (inclusive) but `openedAt > '2022-07-01'`
(strict). A case opened **on** 2022-07-01 therefore gets the 2021 table.

Reproducing input:
```js
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }

calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-02' }, '2023-01-15')
// => { table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 }
```
The urgency rate on that same day is also the 2021 one (15%, not 18%):
```js
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01', deadline: '2023-01-20' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 }
```

**What it probably intended:** `>=`, matching the 2021 revision boundary.

**Blast radius:** every case opened exactly on 2022-07-01 was billed at 2021 rates.
Per-case underbilled by the 2021→2022 base delta for its band (STANDARD band 1: 1500
cents … APPEAL band 4: 10000 cents); urgent cases opened that day also earned 15%
instead of 18% urgency. All of these outputs are stored and feed the annual audit.
The population is one calendar day's worth of openings — small unless a batch import
landed on that date, but then concentrated.

**Proposed fix (NOT applied):** change `if (openedAt > REVISION_2022)` to
`if (openedAt >= REVISION_2022)`. If applied later, expect the suite's F1 test to
fail by exactly the deltas above — that failure is the audit-relevant diff.

Pinned by: `'[KNOWN BUG] the 2022 revision day (2022-07-01) ...'`.

...
```

I'll continue similarly for F2..F6 and the open questions. Let me also add a "not findings" section? No — I'll keep scope. Maybe a short "behaviors pinned that are probably intended" list (clamping 0/negative → band 1, >4 → band 4; unknown-type fallback is documented in the code comment — I put that in F5 as "probably intended, quirk is invisibility"). Fine.

Also mention in FINDINGS: rounding section F6 includes the observation that the urgency step's rounding is a no-op under current data, and that the expedited step's input includes the rounded urgency (double rounding), currently indistinguishable.

Let me also verify the day-count claim in F3's reproducing: '2020-01-01' to '2023-01-15': 2020: 366 days (leap) to 2021-01-01; +365 → 2022-01-01 (731); +365 → 2023-01-01 (1096); +14 → 2023-01-15 (1110). I'll say "1110 days before `now`." ✓

F4's JSON claim: `JSON.stringify({table, bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN})` → `{"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}` ✓.

Now, one more possible test to include per the spec: "rounding at each step — where it happens, and whether it happens more than once." I'll add an explicit test that shows rounding happens at two separate steps (urgency, then expedited) — the both-matrix already does that; the F6 document explains "more than once: yes, pctOf is called at each step; under current data the first call never actually rounds." I could add one more dedicated test: expedited-only never rounds (all integer) — the matrix covers the values. I think it's sufficient; FINDINGS carries the "where/whether" analysis.

Now, let me assemble the final test file text. I'll write it carefully, making sure all numbers are as computed.

Also, I want a top-of-file comment that mentions the determinism guarantee and that production is untouched.

One more style point: the repo convention says code and comments in English ✓.

Let me also decide the describe name for the matrix: `describe.each`? I'll use the for-loop.

Final check on `it.each(t.rows)` typing: to be safe, I'll define:

```ts
function matrixSuite(name: TableName, openedAt: string, rows: Row[]): void {
  describe(`full matrix — case type × band, rate table ${name} (openedAt ${openedAt})`, () => {
    it.each(rows)('base fee only: %s, band %i -> %i cents', (type, band, base) => {...});
    ...
  });
}
matrixSuite('2019', '2020-06-15', ROWS_2019);
matrixSuite('2021', '2021-06-15', ROWS_2021);
matrixSuite('2022', '2023-01-01', ROWS_2022);
```

Title with the expected value: `base fee only: %s, band %i -> %i cents` uses the base arg — nice: the test name itself shows the pinned number. Similarly for the others: `urgent: %s, band %i -> fee %i + urgency %i`. I'll keep the titles informative but not too long.

Hmm, `%i` for the base in the title — the 3rd arg — fine.

Now — one concern: vitest's `it.each` with a title that references args — supported (printf-style). ✓

Let me write out all the test files:

```ts
// Characterization suite for feeCalculator.ts (in production since 2019, zero tests).
//
// Purpose: pin WHAT THE CODE DOES, not what it should do. Before this module is
// modified next month, this suite is the net: any behavioural change in the next
// issue will surface here as a failing test with the exact old vs new number.
//
// Rules this suite obeys:
//  - feeCalculator.ts is NOT modified by this work. The only seam used is the
//    module's existing optional `now` parameter.
//  - Deterministic: every calculateFee call passes an explicit `now`. No test may
//    rely on the real clock, the machine timezone, or randomness. All date strings
//    are bare 'YYYY-MM-DD'; the module parses them as UTC midnight, so results are
//    identical in every timezone.
//  - Expected values are literals hand-computed from the rate tables and rounding
//    rules as written in feeCalculator.ts (see the data tables below for the
//    derivation). `total` is asserted as the exact integer sum of the pinned
//    component literals — integer addition is exact, and the components carry the
//    behaviour.
//  - Tests named [KNOWN BUG] / [PINNED QUIRK] assert current behaviour that is
//    documented in FINDINGS.md as wrong or surprising. They are pinned
//    deliberately, not because the value is right. Do not "correct" a value in
//    this file without re-doing the FINDINGS analysis.

import { describe, expect, it } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput, CaseType } from '../feeCalculator';

type TableName = '2019' | '2021' | '2022';

const NOW = '2023-01-15';
const URGENT_DEADLINE = '2023-01-20'; // 5 days after NOW: inside the 7-day urgency window

function inputFor(openedAt: string, over: Partial<CaseInput> = {}): CaseInput {
  const base: CaseInput = { type: 'STANDARD', complexity: 1, openedAt };
  return { ...base, ...over };
}

// One row per case type × band. Numbers are the current output of calculateFee,
// pinned as literals:
//   base           band fee for the table (transcribed from the rate tables)
//   urgency        band fee * urgencyPct/100, rounded (15% in 2019/2021, 18% in 2022)
//   expeditedAlone band fee * expeditedPct/100, rounded (10% in 2019, 12% in 2021/2022)
//   expeditedUrgent (band fee + urgency) * expeditedPct/100, rounded — the second
//                   rounding step, applied to the already-rounded urgency fee
type Row = [CaseType, number, number, number, number, number];

const ROWS_2019: Row[] = [ ... ];
const ROWS_2021: Row[] = [ ... ];
const ROWS_2022: Row[] = [ ... ];

function matrixSuite(name: TableName, openedAt: string, rows: Row[]): void {
  describe(`full matrix: case type x band, rate table ${name} (openedAt ${openedAt})`, () => {
    it.each(rows)('base fee only: %s, band %i -> bandFee %i', (type, band, base) => {
      expect(calculateFee(inputFor(openedAt, { type, complexity: band }), NOW)).toEqual({
        table: name,
        bandFee: base,
        urgencyFee: 0,
        expeditedFee: 0,
        total: base,
      });
    });

    it.each(rows)('urgent (deadline 5 days out): %s, band %i -> urgencyFee %i', (type, band, base, urgency) => {
      expect(calculateFee(inputFor(openedAt, { type, complexity: band, deadline: URGENT_DEADLINE }), NOW)).toEqual({
        table: name,
        bandFee: base,
        urgencyFee: urgency,
        expeditedFee: 0,
        total: base + urgency,
      });
    });

    it.each(rows)('expedited (not urgent): %s, band %i -> expeditedFee %i', (type, band, base, _urgency, expedited) => {
      expect(calculateFee(inputFor(openedAt, { type, complexity: band, expedited: true }), NOW)).toEqual({
        table: name,
        bandFee: base,
        urgencyFee: 0,
        expeditedFee: expedited,
        total: base + expedited,
      });
    });

    it.each(rows)('urgent + expedited: %s, band %i -> expeditedFee %i (applied to bandFee + rounded urgency)', (type, band, base, urgency, _expedited, expeditedUrgent) => {
      expect(calculateFee(inputFor(openedAt, { type, complexity: band, deadline: URGENT_DEADLINE, expedited: true }), NOW)).toEqual({
        table: name,
        bandFee: base,
        urgencyFee: urgency,
        expeditedFee: expeditedUrgent,
        total: base + urgency + expeditedUrgent,
      });
    });
  });
}

matrixSuite('2019', '2020-06-15', ROWS_2019);
matrixSuite('2021', '2021-06-15', ROWS_2021);
matrixSuite('2022', '2023-01-01', ROWS_2022);
```

Then the boundary, urgency, rounding, degenerate, unknown-type describes as drafted.

Unused param naming: `_urgency`, `_expedited` — fine.

Wait, in the 'expedited (not urgent)' row callback, the params are (type, band, base, _urgency, expedited) — 5 of 6 ✓. In 'urgent + expedited': (type, band, base, urgency, _expedited, expeditedUrgent) ✓.

Now, I'll assemble the degenerate + unknown + rounding + boundary sections in full (as drafted above).

Counting tests: matrix 192 + boundary 8 + urgency 6 + rounding 4 + degenerate 9 + unknown 5 = 224 tests.

Now let me write FINDINGS.md in full. I'll aim for thorough but tight.

Also include in FINDINGS a header note that "byte-identical" is guaranteed by not delivering any change; and a "how to verify" note: `pnpm vitest run` (or `npx vitest run`) twice.

Hmm — the environment uses pnpm. I'll say "run the suite with vitest (e.g. `pnpm vitest run`); it must pass identically twice."

Let me finalize the F entries with exact outputs (I'll re-verify each number):

F1: 13500/15000 ✓; urgent 2025/2700 ✓; totals 15525/17700 ✓ (15000+2700 = 17700).

F2: datetime → 15000 ✓.

F3: 13500/2025/15525 ✓.

F4: as computed; also mention the urgent variant: with deadline → urgencyFee NaN as well: pctOf(undefined, 15) = Math.round(NaN) = NaN. I'll mention.

F5: PROBATE 2021 band 2 → 20500 ✓. 'standard' band 1 → 13500 ✓. '' → 13500 ✓.

F6: 2128 (2127.5), 3623 (3622.5), 4543 (4542.5), 15434 (15434.4); totals 23403 / 39848 / 49968 / 144054.
- 31500+4725+3623 = 39848 ✓.
- 39500+5925+4543 = 49968 ✓.
- 109000+19620+15434 = 144054 ✓.

Open questions as drafted.

I think I'm ready to write the final answer. Format: only `### path` headings + fenced blocks, nothing outside. Two files:

1. `test/fee-calculator.spec.ts`
2. `FINDINGS.md`

Fence for the test file: ```ts. For FINDINGS: ```md (or plain ```). The parser says "one fenced block holding only the file's content" — the language tag is probably tolerated (the example shows prisma/ts tags). I'll use ```ts and ```md.

Also — the system prompt's layout mentions things like `src/<feature>/...` but those are for the NestJS app; this task's workspace is flat. I'll decide the layout myself: test/ + FINDINGS.md. ✓

Let me write it all out, double-checking each row number one last time as I write.

ROWS_2019 (base, urg 15%, exp 10%, expUrg 11.5% of base):
1. ['STANDARD', 1, 12000, 1800, 1200, 1380]
2. ['STANDARD', 2, 18500, 2775, 1850, 2128]
3. ['STANDARD', 3, 27000, 4050, 2700, 3105]
4. ['STANDARD', 4, 41000, 6150, 4100, 4715]
5. ['COMMERCIAL', 1, 22000, 3300, 2200, 2530]
6. ['COMMERCIAL', 2, 31500, 4725, 3150, 3623]
7. ['COMMERCIAL', 3, 45000, 6750, 4500, 5175]
8. ['COMMERCIAL', 4, 68000, 10200, 6800, 7820]
9. ['ESTATE', 1, 18000, 2700, 1800, 2070]
10. ['ESTATE', 2, 26000, 3900, 2600, 2990]
11. ['ESTATE', 3, 39500, 5925, 3950, 4543]
12. ['ESTATE', 4, 60000, 9000, 6000, 6900]
13. ['APPEAL', 1, 30000, 4500, 3000, 3450]
14. ['APPEAL', 2, 42000, 6300, 4200, 4830]
15. ['APPEAL', 3, 61000, 9150, 6100, 7015]
16. ['APPEAL', 4, 92000, 13800, 9200, 10580]

ROWS_2021 (base, urg 15%, exp 12%, expUrg 13.8% of base):
1. ['STANDARD', 1, 13500, 2025, 1620, 1863]
2. ['STANDARD', 2, 20500, 3075, 2460, 2829]
3. ['STANDARD', 3, 29500, 4425, 3540, 4071]
4. ['STANDARD', 4, 44500, 6675, 5340, 6141]
5. ['COMMERCIAL', 1, 24000, 3600, 2880, 3312]
6. ['COMMERCIAL', 2, 34000, 5100, 4080, 4692]
7. ['COMMERCIAL', 3, 48500, 7275, 5820, 6693]
8. ['COMMERCIAL', 4, 73000, 10950, 8760, 10074]
9. ['ESTATE', 1, 19500, 2925, 2340, 2691]
10. ['ESTATE', 2, 28000, 4200, 3360, 3864]
11. ['ESTATE', 3, 42500, 6375, 5100, 5865]
12. ['ESTATE', 4, 64500, 9675, 7740, 8901]
13. ['APPEAL', 1, 32500, 4875, 3900, 4485]
14. ['APPEAL', 2, 45500, 6825, 5460, 6279]
15. ['APPEAL', 3, 66000, 9900, 7920, 9108]
16. ['APPEAL', 4, 99000, 14850, 11880, 13662]

ROWS_2022 (base, urg 18%, exp 12%, expUrg 14.16% of base):
1. ['STANDARD', 1, 15000, 2700, 1800, 2124]
2. ['STANDARD', 2, 22500, 4050, 2700, 3186]
3. ['STANDARD', 3, 32500, 5850, 3900, 4602]
4. ['STANDARD', 4, 49000, 8820, 5880, 6938]
5. ['COMMERCIAL', 1, 26500, 4770, 3180, 3752]
6. ['COMMERCIAL', 2, 37500, 6750, 4500, 5310]
7. ['COMMERCIAL', 3, 53500, 9630, 6420, 7576]
8. ['COMMERCIAL', 4, 80500, 14490, 9660, 11399]
9. ['ESTATE', 1, 21500, 3870, 2580, 3044]
10. ['ESTATE', 2, 31000, 5580, 3720, 4390]
11. ['ESTATE', 3, 47000, 8460, 5640, 6655]
12. ['ESTATE', 4, 71000, 12780, 8520, 10054]
13. ['APPEAL', 1, 36000, 6480, 4320, 5098]
14. ['APPEAL', 2, 50000, 9000, 6000, 7080]
15. ['APPEAL', 3, 72500, 13050, 8700, 10266]
16. ['APPEAL', 4, 109000, 19620, 13080, 15434]

All verified.

Final: let me write the answer with exactly two headings and fenced blocks, no prose outside.
```

## reply

### test/fee-calculator.spec.ts
```ts
// Characterization suite for feeCalculator.ts (in production since 2019, zero tests).
//
// Purpose: pin WHAT THE CODE DOES, not what it should do. This suite is the net that
// makes the module safe to modify: any behavioural change in the next issue surfaces
// here as a failing test with the exact old value.
//
// Rules this suite obeys:
//  - feeCalculator.ts is NOT modified by this work. The only seam used is the
//    module's existing optional `now` parameter.
//  - Deterministic: every calculateFee call passes an explicit `now`. No test may
//    rely on the real clock, the machine timezone, or randomness. All date strings
//    are bare 'YYYY-MM-DD'; the module parses them as UTC midnight, so results are
//    identical in every timezone.
//  - Expected values are literals, hand-computed from the rate tables and rounding
//    rules as written in feeCalculator.ts (derivation noted on the data tables
//    below). `total` is asserted as the exact integer sum of the pinned component
//    literals: integer addition is exact, and the components carry the behaviour.
//  - Tests named [KNOWN BUG] / [PINNED QUIRK] assert current behaviour that is
//    documented in FINDINGS.md as wrong or surprising. They are pinned
//    deliberately, not because the value is right. Do not "correct" a value in
//    this file without re-doing the FINDINGS analysis.

import { describe, expect, it } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput, CaseType } from '../feeCalculator';

type TableName = '2019' | '2021' | '2022';

const NOW = '2023-01-15';
const URGENT_DEADLINE = '2023-01-20'; // 5 days after NOW: inside the 7-day urgency window

function inputFor(openedAt: string, over: Partial<CaseInput> = {}): CaseInput {
  const base: CaseInput = { type: 'STANDARD', complexity: 1, openedAt };
  return { ...base, ...over };
}

// One row per case type x band. All numbers are the current output of calculateFee,
// pinned as literals:
//   base            band fee for the table (transcribed from the rate tables)
//   urgency         Math.round(base * urgencyPct / 100) — 15% in 2019/2021, 18% in 2022.
//                   Exact for every band fee in the current tables (all multiples of 100).
//   expeditedAlone  Math.round(base * expeditedPct / 100) — 10% in 2019, 12% in 2021/2022.
//   expeditedUrgent Math.round((base + urgency) * expeditedPct / 100) — the SECOND
//                   rounding step, applied to the already-rounded urgency fee.
//                   2019 halves round up: 2127.5 -> 2128, 3622.5 -> 3623, 4542.5 -> 4543.
//                   2022 fractions round to nearest: 6938.4 -> 6938, 3752.4 -> 3752,
//                   7575.6 -> 7576, 11398.8 -> 11399, 3044.4 -> 3044, 4389.6 -> 4390,
//                   6655.2 -> 6655, 10053.6 -> 10054, 5097.6 -> 5098, 15434.4 -> 15434.
type Row = [CaseType, number, number, number, number, number];

const ROWS_2019: Row[] = [
  ['STANDARD', 1, 12000, 1800, 1200, 1380],
  ['STANDARD', 2, 18500, 2775, 1850, 2128],
  ['STANDARD', 3, 27000, 4050, 2700, 3105],
  ['STANDARD', 4, 41000, 6150, 4100, 4715],
  ['COMMERCIAL', 1, 22000, 3300, 2200, 2530],
  ['COMMERCIAL', 2, 31500, 4725, 3150, 3623],
  ['COMMERCIAL', 3, 45000, 6750, 4500, 5175],
  ['COMMERCIAL', 4, 68000, 10200, 6800, 7820],
  ['ESTATE', 1, 18000, 2700, 1800, 2070],
  ['ESTATE', 2, 26000, 3900, 2600, 2990],
  ['ESTATE', 3, 39500, 5925, 3950, 4543],
  ['ESTATE', 4, 60000, 9000, 6000, 6900],
  ['APPEAL', 1, 30000, 4500, 3000, 3450],
  ['APPEAL', 2, 42000, 6300, 4200, 4830],
  ['APPEAL', 3, 61000, 9150, 6100, 7015],
  ['APPEAL', 4, 92000, 13800, 9200, 10580],
];

const ROWS_2021: Row[] = [
  ['STANDARD', 1, 13500, 2025, 1620, 1863],
  ['STANDARD', 2, 20500, 3075, 2460, 2829],
  ['STANDARD', 3, 29500, 4425, 3540, 4071],
  ['STANDARD', 4, 44500, 6675, 5340, 6141],
  ['COMMERCIAL', 1, 24000, 3600, 2880, 3312],
  ['COMMERCIAL', 2, 34000, 5100, 4080, 4692],
  ['COMMERCIAL', 3, 48500, 7275, 5820, 6693],
  ['COMMERCIAL', 4, 73000, 10950, 8760, 10074],
  ['ESTATE', 1, 19500, 2925, 2340, 2691],
  ['ESTATE', 2, 28000, 4200, 3360, 3864],
  ['ESTATE', 3, 42500, 6375, 5100, 5865],
  ['ESTATE', 4, 64500, 9675, 7740, 8901],
  ['APPEAL', 1, 32500, 4875, 3900, 4485],
  ['APPEAL', 2, 45500, 6825, 5460, 6279],
  ['APPEAL', 3, 66000, 9900, 7920, 9108],
  ['APPEAL', 4, 99000, 14850, 11880, 13662],
];

const ROWS_2022: Row[] = [
  ['STANDARD', 1, 15000, 2700, 1800, 2124],
  ['STANDARD', 2, 22500, 4050, 2700, 3186],
  ['STANDARD', 3, 32500, 5850, 3900, 4602],
  ['STANDARD', 4, 49000, 8820, 5880, 6938],
  ['COMMERCIAL', 1, 26500, 4770, 3180, 3752],
  ['COMMERCIAL', 2, 37500, 6750, 4500, 5310],
  ['COMMERCIAL', 3, 53500, 9630, 6420, 7576],
  ['COMMERCIAL', 4, 80500, 14490, 9660, 11399],
  ['ESTATE', 1, 21500, 3870, 2580, 3044],
  ['ESTATE', 2, 31000, 5580, 3720, 4390],
  ['ESTATE', 3, 47000, 8460, 5640, 6655],
  ['ESTATE', 4, 71000, 12780, 8520, 10054],
  ['APPEAL', 1, 36000, 6480, 4320, 5098],
  ['APPEAL', 2, 50000, 9000, 6000, 7080],
  ['APPEAL', 3, 72500, 13050, 8700, 10266],
  ['APPEAL', 4, 109000, 19620, 13080, 15434],
];

function matrixSuite(name: TableName, openedAt: string, rows: Row[]): void {
  describe(`full matrix: case type x band, rate table ${name} (openedAt ${openedAt})`, () => {
    it.each(rows)('base fee only: %s, band %i -> bandFee %i', (type, band, base) => {
      expect(calculateFee(inputFor(openedAt, { type, complexity: band }), NOW)).toEqual({
        table: name,
        bandFee: base,
        urgencyFee: 0,
        expeditedFee: 0,
        total: base,
      });
    });

    it.each(rows)('urgent (deadline 5 days out): %s, band %i -> urgencyFee %i', (type, band, base, urgency) => {
      expect(
        calculateFee(inputFor(openedAt, { type, complexity: band, deadline: URGENT_DEADLINE }), NOW),
      ).toEqual({
        table: name,
        bandFee: base,
        urgencyFee: urgency,
        expeditedFee: 0,
        total: base + urgency,
      });
    });

    it.each(rows)('expedited (not urgent): %s, band %i -> expeditedFee %i', (type, band, base, _urgency, expedited) => {
      expect(
        calculateFee(inputFor(openedAt, { type, complexity: band, expedited: true }), NOW),
      ).toEqual({
        table: name,
        bandFee: base,
        urgencyFee: 0,
        expeditedFee: expedited,
        total: base + expedited,
      });
    });

    it.each(rows)('urgent + expedited: %s, band %i -> expeditedFee %i (applied to bandFee + rounded urgency)', (type, band, base, urgency, _expedited, expeditedUrgent) => {
      expect(
        calculateFee(inputFor(openedAt, { type, complexity: band, deadline: URGENT_DEADLINE, expedited: true }), NOW),
      ).toEqual({
        table: name,
        bandFee: base,
        urgencyFee: urgency,
        expeditedFee: expeditedUrgent,
        total: base + urgency + expeditedUrgent,
      });
    });
  });
}

matrixSuite('2019', '2020-06-15', ROWS_2019);
matrixSuite('2021', '2021-06-15', ROWS_2021);
matrixSuite('2022', '2023-01-01', ROWS_2022);

describe('rate table selection by openedAt (inclusive/exclusive edges)', () => {
  it('day before the 2021 revision (2020-12-31) -> 2019 table', () => {
    expect(calculateFee(inputFor('2020-12-31'), NOW)).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('the 2021 revision day (2021-01-01) -> 2021 table (inclusive edge)', () => {
    expect(calculateFee(inputFor('2021-01-01'), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('day after the 2021 revision (2021-01-02) -> 2021 table', () => {
    expect(calculateFee(inputFor('2021-01-02'), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('day before the 2022 revision (2022-06-30) -> 2021 table', () => {
    expect(calculateFee(inputFor('2022-06-30'), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('[KNOWN BUG] the 2022 revision day (2022-07-01) -> 2021 table, not 2022 (exclusive edge; FINDINGS.md F1)', () => {
    expect(calculateFee(inputFor('2022-07-01'), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
    // and an urgent case opened that same day earns the 2021 urgency rate (15%), not 18%
    expect(calculateFee(inputFor('2022-07-01', { deadline: URGENT_DEADLINE }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 13500 + 2025,
    });
    // the very next day selects the 2022 table, at the 18% urgency rate
    expect(calculateFee(inputFor('2022-07-02', { deadline: URGENT_DEADLINE }), NOW)).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 2700, expeditedFee: 0, total: 15000 + 2700,
    });
  });

  it('day after the 2022 revision (2022-07-02) -> 2022 table (plain, non-urgent)', () => {
    expect(calculateFee(inputFor('2022-07-02'), NOW)).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });

  it('there is no lower bound: 2018-03-05 (pre-2019) still selects the 2019 table', () => {
    expect(calculateFee(inputFor('2018-03-05'), NOW)).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('[PINNED QUIRK] a datetime-stamped openedAt on 2022-07-01 compares greater than "2022-07-01" and selects the 2022 table (FINDINGS.md F2)', () => {
    expect(calculateFee(inputFor('2022-07-01T00:00:00'), NOW)).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });
});

describe('urgency boundary: daysBetween(now, deadline) <= 7', () => {
  const openedAt = '2021-06-15'; // 2021 table; urgency = 15% of 13500 = 2025

  it('deadline 7 days out (inclusive edge) -> urgent', () => {
    expect(calculateFee(inputFor(openedAt, { deadline: '2023-01-22' }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });

  it('deadline 8 days out (just past the edge) -> not urgent', () => {
    expect(calculateFee(inputFor(openedAt, { deadline: '2023-01-23' }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('deadline 6 days out (inside the window) -> urgent', () => {
    expect(calculateFee(inputFor(openedAt, { deadline: '2023-01-21' }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });

  it('deadline today (0 days) -> urgent', () => {
    expect(calculateFee(inputFor(openedAt, { deadline: '2023-01-15' }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });

  it('no deadline -> not urgent', () => {
    expect(calculateFee(inputFor(openedAt), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('[KNOWN BUG] a deadline in the past still earns the urgency fee - the window has no lower bound (FINDINGS.md F3)', () => {
    // '2020-01-01' is 1110 days before NOW; daysBetween is negative, and negative <= 7
    expect(calculateFee(inputFor(openedAt, { deadline: '2020-01-01' }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });
});

describe('rounding, pinned as-is (FINDINGS.md F6)', () => {
  const urgentExpedited = (openedAt: string, over: Partial<CaseInput> = {}) =>
    calculateFee(inputFor(openedAt, { deadline: URGENT_DEADLINE, expedited: true, ...over }), NOW);

  it('[PINNED] 2019 STANDARD band 2 urgent+expedited: expedited fee is Math.round(2127.5) = 2128 - halves round UP', () => {
    // 18500 * 15% = 2775 (exact); (18500 + 2775) * 10% = 2127.5 -> 2128, not 2127
    expect(urgentExpedited('2020-06-15', { complexity: 2 })).toEqual({
      table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 18500 + 2775 + 2128,
    });
  });

  it('[PINNED] 2019 COMMERCIAL band 2 urgent+expedited: Math.round(3622.5) = 3623', () => {
    expect(urgentExpedited('2020-06-15', { type: 'COMMERCIAL', complexity: 2 })).toEqual({
      table: '2019', bandFee: 31500, urgencyFee: 4725, expeditedFee: 3623, total: 31500 + 4725 + 3623,
    });
  });

  it('[PINNED] 2019 ESTATE band 3 urgent+expedited: Math.round(4542.5) = 4543', () => {
    expect(urgentExpedited('2020-06-15', { type: 'ESTATE', complexity: 3 })).toEqual({
      table: '2019', bandFee: 39500, urgencyFee: 5925, expeditedFee: 4543, total: 39500 + 5925 + 4543,
    });
  });

  it('[PINNED] 2022 APPEAL band 4 urgent+expedited: Math.round(15434.4) = 15434 - fractions round to nearest, not up', () => {
    expect(urgentExpedited('2023-01-01', { type: 'APPEAL', complexity: 4 })).toEqual({
      table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 15434, total: 109000 + 19620 + 15434,
    });
  });
});

describe('degenerate inputs, pinned as-is', () => {
  const openedAt = '2021-06-15'; // 2021 table: band 1 = 13500, band 4 = 44500

  it('complexity null -> throws "complexity is required"', () => {
    expect(() => calculateFee(inputFor(openedAt, { complexity: null }), NOW)).toThrowError('complexity is required');
  });

  it('complexity missing entirely (undefined, e.g. a JSON record without the key) -> throws "complexity is required"', () => {
    const c = { type: 'STANDARD', openedAt } as CaseInput;
    expect(() => calculateFee(c, NOW)).toThrowError('complexity is required');
  });

  it('complexity 0 -> clamped to band 1 (falsy branch)', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: 0 }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('complexity -3 (negative) -> clamped to band 1', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: -3 }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('complexity 0.5 -> clamped to band 1 (< 1 branch, not the falsy branch)', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: 0.5 }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('complexity NaN -> clamped to band 1 (NaN is falsy under !band)', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: NaN }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('complexity 5 -> clamped to band 4', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: 5 }), NOW)).toEqual({
      table: '2021', bandFee: 44500, urgencyFee: 0, expeditedFee: 0, total: 44500,
    });
  });

  it('complexity 100 -> clamped to band 4', () => {
    expect(calculateFee(inputFor(openedAt, { complexity: 100 }), NOW)).toEqual({
      table: '2021', bandFee: 44500, urgencyFee: 0, expeditedFee: 0, total: 44500,
    });
  });

  it('[PINNED QUIRK] complexity 2.5 (fractional) -> bandFee undefined, total NaN, and JSON total null (FINDINGS.md F4)', () => {
    const r = calculateFee(inputFor(openedAt, { complexity: 2.5 }), NOW);
    expect(r.table).toBe('2021');
    expect(r.bandFee).toBeUndefined(); // bands[1.5] does not exist
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(r.total).toBeNaN(); // undefined + 0 + 0
    // what would actually get stored if this ever reached billing:
    expect(JSON.stringify(r)).toBe('{"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}');
  });
});

describe('unknown / malformed case type, pinned as-is (FINDINGS.md F5)', () => {
  const FALLBACK_ROWS: [TableName, string, number][] = [
    ['2019', '2020-06-15', 18500], // = 2019 STANDARD band 2
    ['2021', '2021-06-15', 20500], // = 2021 STANDARD band 2
    ['2022', '2023-01-01', 22500], // = 2022 STANDARD band 2
  ];

  it.each(FALLBACK_ROWS)('[PINNED QUIRK] unknown type "PROBATE" silently falls back to STANDARD band 2 fees, table %s', (name, openedAt, base) => {
    const r = calculateFee(inputFor(openedAt, { type: 'PROBATE', complexity: 2 }), NOW);
    expect(r).toEqual({ table: name, bandFee: base, urgencyFee: 0, expeditedFee: 0, total: base });
    // no fallback marker: the breakdown shape is identical to a genuine STANDARD case
    expect(Object.keys(r).sort()).toEqual(['bandFee', 'expeditedFee', 'table', 'total']);
  });

  it('[PINNED QUIRK] lookup is case-sensitive: "standard" is unknown and falls back to STANDARD fees', () => {
    expect(calculateFee(inputFor('2021-06-15', { type: 'standard' }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('[PINNED QUIRK] empty-string type is unknown and falls back to STANDARD fees', () => {
    expect(calculateFee(inputFor('2021-06-15', { type: '' }), NOW)).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });
});
```

### FINDINGS.md
```md
# FINDINGS — `feeCalculator.ts` characterization

Companion to `test/fee-calculator.spec.ts`. The suite pins what `calculateFee` does
**today**. Every finding below is pinned **as it is**: the test asserts the current
output exactly, and the test name says so. **No fix in this document has been applied**
— `feeCalculator.ts` is byte-identical to what it was before this work.

Conventions:
- "Reproducing input" is the exact `calculateFee` call. The second argument is the
  module's existing optional `now` parameter — the only clock seam used anywhere.
- "Current output" is the exact returned `FeeBreakdown`.
- The matching test is named with a `[KNOWN BUG]` or `[PINNED QUIRK]` prefix.

## F1 — the 2022 rate revision does not apply on its own day (likely bug)

`tableFor` selects with `openedAt >= '2021-01-01'` (inclusive) but
`openedAt > '2022-07-01'` (strict). A case opened **on** 2022-07-01 gets the 2021
table. The header comment says "2022-07: rate revision", and the 2021 boundary is
inclusive — the asymmetry is almost certainly an off-by-one, not a policy.

Reproducing input:

```js
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }

calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-02' }, '2023-01-15')
// => { table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000 }
```

The urgency rate on that same day is also the 2021 one (15%, not 18%):

```js
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01', deadline: '2023-01-20' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 }
// (openedAt '2022-07-02' instead => urgencyFee 2700, total 17700)
```

**What it probably intended:** `>=`, matching the 2021 revision boundary.

**Blast radius:** every case opened exactly on 2022-07-01 was billed at 2021 rates.
Per case, underbilled by the 2021→2022 base delta for its band (STANDARD band 1:
1500 cents … APPEAL band 4: 10000 cents); urgent cases opened that day also earned
15% instead of 18%. All of these outputs are stored and feed the annual audit.
The population is one calendar day of case openings — small unless a batch import
landed on that date, in which case it is concentrated.

**Proposed fix (NOT applied):** change `if (openedAt > REVISION_2022)` to
`if (openedAt >= REVISION_2022)`. If it is ever applied, the F1 test will fail by
exactly the deltas above — that failure is the audit-relevant diff to reconcile.

Pinned by: `[KNOWN BUG] the 2022 revision day (2022-07-01) ...`.

## F2 — table selection is lexicographic string comparison (latent quirk)

`tableFor` compares `openedAt` as a string against `'2021-01-01'` / `'2022-07-01'`.
For the documented `YYYY-MM-DD` format, lexicographic order equals chronological
order. But a string with a time component is lexicographically **greater** than the
bare date, so it flips the strict `>` at the 2022 edge:

Reproducing input:

```js
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, ... }

calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01T00:00:00' }, '2023-01-15')
// => { table: '2022', bandFee: 15000, ... }
```

Same calendar day, different table. (At the 2021 edge both bare and stamped
`2021-01-01...` select 2021, so only the 2022 edge visibly disagrees.)

**What it probably intended:** compare calendar dates.

**Blast radius:** latent. Only bites if a stored `openedAt` ever carries a time
component or a non-ISO shape — i.e. data imported from another system. Any such
value on/after 2022-07-01 silently took the 2022 table.

**Proposed fix (NOT applied):** normalize before comparing, e.g.
`const d = openedAt.slice(0, 10)`, or compare parsed `Date`s.

Pinned by: `[PINNED QUIRK] a datetime-stamped openedAt on 2022-07-01 ...`.

## F3 — a deadline in the past still earns the urgency fee (likely bug)

The urgency test is `daysBetween(ref, deadline) <= 7` with **no lower bound**. Any
negative day count satisfies `<= 7`, so a case whose deadline passed 400 days before
fee generation is "urgent".

Reproducing input:

```js
calculateFee(
  { type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: '2020-01-01' },
  '2023-01-15',
)
// => { table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525 }
```

`deadline: '2020-01-01'` is 1110 days before `now`.

**What it probably intended:** urgent only inside a window, i.e. `0 <= days <= 7`.
Honest caveat: "overdue cases are urgent" is a *plausible* intended policy too, and
the code cannot be read to settle it — see Open questions.

**Blast radius:** the widest of the findings. Every case whose deadline had already
passed at fee-generation time carries a 15% (pre-2022) or 18% (2022) urgency fee on
top of its band fee, in the stored, audited record. If billing's mental model is a
7-day-forward window, this is systematic overbilling across the overdue population.

**Proposed fix (NOT applied):**
`const days = daysBetween(ref, c.deadline); if (c.deadline && days >= 0 && days <= 7)`.
Confirm with billing before treating as a bug.

Pinned by: `[KNOWN BUG] a deadline in the past still earns the urgency fee ...`.

## F4 — fractional complexity yields `undefined` band fee and `NaN` total (bug)

`complexity` is typed `number | null` with a `1..4` band comment, but nothing
enforces integrality. `band = 2.5` passes both clamps and indexes `bands[1.5]`:

Reproducing input:

```js
calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2021-06-15' }, '2023-01-15')
// => { table: '2021', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
// JSON.stringify(...) => '{"table":"2021","urgencyFee":0,"expeditedFee":0,"total":null}'
```

With a deadline added, `urgencyFee` becomes `NaN` as well (`pctOf(undefined, 15)`).
Adjacent degenerate inputs behave, by contrast: `0.5` is caught by `band < 1` and
clamps to band 1; `NaN`/`0` are caught by the falsy `!band`; negatives clamp to band 1;
`> 4` clamps to band 4.

**What it probably intended:** reject or normalize non-integer bands.

**Blast radius:** if a fractional band ever reached billing, the stored record
silently loses `bandFee` (JSON drops `undefined` keys) and stores `total: null` —
audit corruption no alert would raise, or a crash in any downstream consumer doing
arithmetic on the fee.

**Proposed fix (NOT applied):** before clamping,
`if (!Number.isInteger(band)) throw new Error('complexity must be an integer band 1..4')`.

Pinned by: `[PINNED QUIRK] complexity 2.5 (fractional) ...`.

## F5 — unknown case types silently fall back to STANDARD, with no marker

`bands = table.base[c.type]; if (!bands) bands = table.base['STANDARD']`. The inline
comment says this is intentional for old-system imports; the quirk is that the output
carries **no trace** of the fallback. The lookup is also case-sensitive, so
`'standard'` falls back too.

Reproducing input:

```js
calculateFee({ type: 'PROBATE', complexity: 2, openedAt: '2021-06-15' }, '2023-01-15')
// => { table: '2021', bandFee: 20500, urgencyFee: 0, expeditedFee: 0, total: 20500 }
// identical in shape to a genuine { type: 'STANDARD', complexity: 2 } case

calculateFee({ type: 'standard', complexity: 1, openedAt: '2021-06-15' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }

calculateFee({ type: '', complexity: 1, openedAt: '2021-06-15' }, '2023-01-15')
// => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }
```

**What it probably intended:** the defaulting is deliberate per the comment; the gap
is observability.

**Blast radius:** every historical fee for an imported/mistyped case is a STANDARD
fee with no marker. An audit that later learns the true type cannot distinguish
"billed as STANDARD because it is one" from "billed as STANDARD because it fell
back". Case-sensitivity widens the population to any non-uppercase type spelling.

**Proposed fix (NOT applied):** add a `typeFallback: true` field to the breakdown
(breaks the output shape — needs billing sign-off) or reject unknown types at the
API boundary where the data is imported.

Pinned by: `[PINNED QUIRK] unknown type "PROBATE" ...` (×3 tables) and the
case-sensitivity / empty-string tests.

## F6 — rounding rule, pinned: `Math.round` per step, halves up, applied more than once

`pctOf` rounds **at each step**: the urgency fee is rounded, and the expedited fee is
then computed from `bandFee + urgencyFee` — i.e. from the *already-rounded* urgency
fee — and rounded again. Two observations, both pinned:

1. **The exact rule is `Math.round` (halves toward +∞, not banker's), and it fires.**
   The only half-cent cases in the current data are in the 2019 urgent+expedited
   column:

   ```js
   // 18500 * 15% = 2775 exact; (18500 + 2775) * 10% = 2127.5
   calculateFee({ type: 'STANDARD', complexity: 2, openedAt: '2020-06-15', deadline: '2023-01-20', expedited: true }, '2023-01-15')
   // => { table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 }
   // COMMERCIAL band 2: 3622.5 -> 3623 (total 39848);  ESTATE band 3: 4542.5 -> 4543 (total 49968)
   ```

   And in 2022, where 18% urgency + 12% expedited produces genuine fractions, rounding
   goes to nearest, not up:

   ```js
   // (109000 + 19620) * 12% = 15434.4
   calculateFee({ type: 'APPEAL', complexity: 4, openedAt: '2023-01-01', deadline: '2023-01-20', expedited: true }, '2023-01-15')
   // => { table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 15434, total: 144054 }
   ```

2. **The second rounding step is currently dormant on its input side.** Every band fee
   in all three tables is a multiple of 100 cents, and 15%/18% of a multiple of 100 is
   always an integer — so the urgency step never actually rounds today, and the
   expedited step sees an exact sum. Sequential rounding is therefore
   **indistinguishable from single rounding under the current data**, but it would
   diverge the moment a future rate revision introduced a band fee that is not
   divisible that way. The structure is pinned by the urgent+expedited matrix column
   so the divergence is visible the day it first happens.

**Blast radius:** the three 2019 half-cent cases and every fractional 2022
expedited case are baked into stored, audited fees. "Fixing" rounding to banker's
rounding or floor changes them.

**Proposed fix:** none — this is the implemented rule, pinned so any future change
is deliberate. If billing wants a different rule, that is a separate decision with a
reconciliation plan, not a drive-by.

Pinned by: the four `[PINNED]` rounding tests and the urgent+expedited matrix column.

## Behaviours pinned that look intentional (not findings)

- `complexity` of `0`, negative, or `NaN` clamps to band 1; `> 4` clamps to band 4.
  Lenient clamping, no error — pinned in the degenerate-inputs block.
- `complexity: null` **and** a missing key (`undefined`) both throw
  `Error('complexity is required')`. The `undefined` branch is live in practice: a
  JSON record without the key yields `undefined`, not `null`.
- No lower bound on `openedAt`: cases opened before 2019 still get the "2019" table.
- The urgency window is 8 calendar days inclusive: `daysBetween(now, deadline) <= 7`,
  i.e. 0..7 days out. Pinned on both sides of the edge (7 → urgent, 8 → not).

## Open questions (honest gaps)

1. **The default clock is untested, on purpose.** When `now` is omitted the module
   calls `new Date().toISOString().slice(0, 10)` — the UTC calendar day at call
   time. Testing that path would make the suite non-deterministic, so every test in
   this suite passes an explicit `now`. Consequence for production: urgency depends
   on the UTC date fee generation runs on; on a machine west of UTC that boundary can
   differ from the local business day. Call patterns (when does billing run?) are not
   visible from this repo.
2. **`daysBetween` floors the millisecond delta.** For bare `YYYY-MM-DD` strings both
   endpoints parse as UTC midnight, so the division is exact and the floor is a no-op.
   If a caller ever passed a datetime deadline, N days + 23 hours would count as N
   days, widening the urgent window by up to a day. Untested: off the documented
   input contract.
3. **F1 and F3 are "likely bug" rather than "bug".** The code cannot settle whether
   the exclusive 2022 edge (F1) or overdue-urgency (F3) is a mistake or a policy.
   Both are pinned as-is either way; resolving them is the job of the next issue,
   with billing's confirmation.
4. **Fractional-band reachability is unverified.** Nothing in the repo shows a
   fractional `complexity` ever reaching billing (F4). It is pinned because the type
   allows it and the failure mode (stored `total: null`) is silent.

## Determinism

No test uses `new Date()`, the default `now`, or randomness. Every date is a literal
`YYYY-MM-DD` string parsed by the module as UTC midnight; table selection is string
comparison. The suite produces identical results on any machine, any timezone, any
day — run it twice, run it in CI, run it in two years.
```


---
