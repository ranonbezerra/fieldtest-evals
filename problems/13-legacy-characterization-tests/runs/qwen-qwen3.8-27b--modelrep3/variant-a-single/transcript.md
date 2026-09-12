# Transcript — 13-legacy-characterization-tests / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
The task is to build a characterization test suite against the existing `feeCalculator.ts` fixture. Let me carefully analyze the code to understand all the behaviors I need to pin down.

Fixture: `feeCalculator.ts`

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

const RATE_TABLE_2019 = {
  base: {
    STANDARD: [12000, 18500, 27000, 41000],
    COMMERCIAL: [22000, 31500, 45000, 68000],
    ESTATE: [18000, 26000, 39500, 60000],
    APPEAL: [30000, 42000, 61000, 92000],
  },
  urgencyPct: 15,
  expeditedPct: 10,
};

const RATE_TABLE_2021 = {
  base: {
    STANDARD: [13500, 20500, 29500, 44500],
    COMMERCIAL: [24000, 34000, 48500, 73000],
    ESTATE: [19500, 28000, 42500, 64500],
    APPEAL: [32500, 45500, 66000, 99000],
  },
  urgencyPct: 15,
  expeditedPct: 12,
};

const RATE_TABLE_2022 = {
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

Key observation #1 (genuine bug): the table selection uses a string comparison, and the boundary conditions are asymmetric:
- `openedAt >= '2021-01-01'` → 2021 table (inclusive on the lower bound)
- `openedAt > '2022-07-01'` → 2022 table (strictly greater, so 2022-07-01 itself uses the 2021 table!)
- Otherwise 2019.

The header comment says "2022-07: rate revision (see RATE_TABLE_2022)". The comment "2022-07" suggests the 2022 table should apply on and after 2022-07-01, but the code uses `>` rather than `>=`, so a case opened exactly on 2022-07-01 gets the 2021 table. This is the classic off-by-one boundary bug. Also, the string comparison `openedAt >= REVISION_2021` depends on ISO-format date strings being lexicographically comparable — works for correctly formatted 'YYYY-MM-DD', but breaks for non-ISO formats (e.g. '2021-1-1' vs '2021-01-01' — lexicographically '2021-1-1' > '2021-01-01' because '1' > '0'... actually wait, '2021-1' vs '2021-0': at index 5 it's '1' vs '0', so '2021-1-1' > '2021-01-01'. Hmm, that's a quirk but probably out of scope. Actually, let me think about which quirks to pin down.

Key observation #2: `daysBetween(a, b)` uses `new Date(b) - new Date(a)` in ms, floor-divided by 86400000. For pure date strings like '2021-05-10', `new Date('2021-05-10')` is parsed as UTC midnight. `now ? now : new Date().toISOString().slice(0, 10)` — the reference date is an ISO date string, also UTC midnight. So for date-only strings, daysBetween is exact days. But DST is irrelevant since both parse as UTC midnight. OK.

Key observation #3: urgency condition: `if (c.deadline && daysBetween(ref, c.deadline) <= 7)`. Note: if deadline is in the past (negative days), `daysBetween` is negative, so `<= 7` is TRUE — so a past deadline still triggers urgency! That's a genuine bug/quirk. Example: ref '2022-01-15', deadline '2022-01-01' → daysBetween = -14 ≤ 7 → urgency applies. That is probably a bug (urgency should only apply when there's ≤ 7 days left, not for overdue). Also, `daysBetween <= 7` means deadline within 7 days OR in the past.

Wait, let me re-check: daysBetween(ref, deadline) = deadline - ref. If deadline is 5 days after ref, that's 5 ≤ 7 → urgency. If deadline equals ref, that's 0 → urgency. If deadline is 10 days after ref, that's 10 > 7 → no urgency. If deadline is 3 days before ref, that's -3 ≤ 7 → urgency (bug).

Edge cases: deadline exactly 7 days out → 7 ≤ 7 → urgency applies (inclusive). Deadline 8 days out → no urgency.

Key observation #4: `band` handling: `let band = c.complexity; if (!band || band < 1) band = 1;` — so band 0, negative → 1. What about a fractional band, e.g. 2.5? `!band` is false, `band < 1` is false, `band > 4` is false → `bands[2.5 - 1] = bands[1.5]` → undefined! So bandFee = undefined, and then pctOf(undefined, ...) = NaN, total is NaN. That's a quirk: fractional complexity produces NaN. Also complexity = NaN? `!NaN` is true → band = 1. complexity = Infinity: `!Infinity` is false, `Infinity < 1` is false, `Infinity > 4` is true → band = 4. OK.

Wait, but the signature says `complexity: number | null`. `undefined` is also handled: `c.complexity === null || c.complexity === undefined` throws. So fractional complexity 2.5 → NaN. Hmm, is this a "genuine bug"? It's a quirk. The task says "the module contains quirks and at least one genuine bug." Genuine bug: the `>` vs `>=` on the 2022 boundary (the 2022-07-01 off-by-one). Another genuine bug candidate: negative day count triggering urgency for past deadlines. Both are legitimate. Also, expeditedPct is applied to (bandFee + urgencyFee) — is this a quirk or intended? The comment says "percent added when expedited". Whether expedited should apply only to base or also to urgency is ambiguous. Hmm, compounding could be intended (surcharge on surcharge), or it could be a bug. Flag it as a quirk/ambiguity and pin as-is.

Also: unknown case type defaults to the STANDARD band — documented as intentional ("unrecognized types were rare imports... default them"). Pin as behavior; mention in FINDINGS as a quirk (silent default may mask bad data).

Also: `tableFor` uses string comparison — a non-ISO `openedAt` (e.g. '2022-7-1', with a time '2022-07-01T10:00:00Z') changes which table is selected. Let me check: '2022-07-01T10:00:00' vs REVISION_2022 '2022-07-01': string comparison: '2022-07-01' is a prefix of '2022-07-01T10:00:00', and the longer string is greater → '2022-07-01T10:00:00' > '2022-07-01' → 2022 table. Hmm, interesting but maybe overreach. The comment says `openedAt: string; // ISO date, e.g. '2021-05-10'`. Date-only strings are the contract. Maybe pin one case that the boundary works lexicographically. Better not over-test non-ISO input since that's undefined-ish behavior. Actually — wait. Let me think about whether '2022-07-01' string comparison: REVISION_2022 = '2022-07-01'. `openedAt > '2022-07-01'` is false when openedAt === '2022-07-01'. So a case opened exactly on 2022-07-01 gets the 2021 table. And '2022-06-30' → 2021 table, '2022-07-02' → 2022 table. And '2021-01-01' → 2021 table (inclusive), '2020-12-31' → 2019 table.

So the boundary behavior:
- openedAt < '2021-01-01' → 2019
- '2021-01-01' ≤ openedAt ≤ '2022-07-01' → 2021 (2022-07-01 included! due to `>`)
- openedAt > '2022-07-01' → 2022

This asymmetry (2021 inclusive lower bound, 2022 exclusive boundary) is the bug. The header says "2022-07: rate revision (see RATE_TABLE_2022)" — the natural reading is that the 2022 rates apply from 2022-07-01. So a case opened on 2022-07-01 is under-billed against the intended schedule (2021 table is lower than 2022 table). Blast radius: stored historical fees for cases opened on 2022-07-01 (or possibly throughout July 2022? no — only exactly '2022-07-01' is affected. Since dates after '2022-07-01' lexicographically... wait, '2022-07-02' > '2022-07-01' is true. Any date after 2022-07-01 is lexicographically greater. So only the exact day '2022-07-01' is affected). Right: only cases opened exactly on 2022-07-01 are affected.

Wait, another subtlety with the string comparison: what about dates like '2022-07-010'? Not a real date. Ignore.

Also, `now` parameter: `const ref = now ? now : new Date()...`. A fake clock can be injected via `now`. The suite must always pass `now` for determinism.

Now, rounding: `pctOf(amount, pct) = Math.round((amount * pct) / 100)`. "rounded at each step" — the urgency fee is rounded, then expedited fee is computed on (bandFee + urgencyFee) and rounded again. Let me find values that demonstrate rounding.

For example, 2019 STANDARD band 1: 12000. Urgency 15%: 12000*15/100 = 1800 exactly. Expedited 10%: (12000+1800)*10/100 = 1380 exactly. Hmm, need a value that doesn't divide evenly.

12000 * 15 / 100 = 1800.0. 27000 * 15/100 = 4050. 41000*15/100=6150. 18500*15/100=2775. All exact because all base fees are multiples of 100 (two decimals in cents). 15% of a multiple of 100: x*15/100 = x*0.15. If x is a multiple of 100, x*15 = 1500*k → /100 = 15k exactly. Same for 18%, 12%, 10%: x*18/100 = 18k/... if x=100k then x*18/100=18k exactly. So urgency fee on base is always exact (in cents), since all base fees are multiples of 100. But expedited fee is pctOf(bandFee + urgencyFee, pct): bandFee + urgencyFee = 100k + 15k'... still a multiple of 100? urgencyFee = 15 * (bandFee/100) when exact... bandFee is a multiple of 100, urgencyFee = bandFee * 15/100 = bandFee/100 * 15, an integer. Is urgencyFee a multiple of 100? bandFee=12000 → 1800, yes. bandFee=18500 → 2775 — 2775 is not a multiple of 100! So bandFee + urgencyFee = 18500 + 2775 = 21275. Expedited 10%: 21275*10/100 = 2127.5 → Math.round → 2128. Aha! Rounding in action: 2127.5 rounds to 2128 (round-half-up via Math.round, which rounds .5 up toward +∞).

So 2019 STANDARD band 2 (18500), urgent, expedited:
- bandFee 18500
- urgencyFee round(18500*0.15) = round(2775) = 2775
- expeditedFee round(21275*0.10) = round(2127.5) = 2128
- total 21275+2128 = 23403.

Another: 2019 ESTATE band 3: 39500, urgency 15% = 5925 exact. bandFee+urgency = 45425, expedited 10% = 4542.5 → 4543. Total 45425+4543=49968.

2022 APPEAL band 1: 36000, urgency 18% = 6480, sum 42480, expedited 12% = 5097.6 → 5098. Total 42480+5098=47578.

2021 COMMERCIAL band 2: 34000, 15% = 5100, sum 39100, 12% = 4692 exact. Total 43792.

2022 STANDARD band 3: 32500, 18% = 5850, sum 38350, 12% = 4602 exact. Total 42952.

Let me find one with half-round in the urgency step: urgency = bandFee*0.15 or *0.18. bandFee is a multiple of 100 → exact. So urgency step is never rounded in this data. Only expedited step rounds (when bandFee+urgencyFee is not a multiple of 100... wait, expedited = (bandFee+urgency)*pct/100. For this to be non-integer, (bandFee+urgency)*pct must not be divisible by 100. With pct=10: (sum)*10/100 = sum/10. Non-integer when sum is not a multiple of 10 → sum ends in 5. urgencyFee ending in 5 happens when bandFee/100*15 ends in 5 → bandFee/100 ends in 1, 3, 7, 9 (odd non-multiple of 2... 15k mod 10: k=1→5, k=3→5, k=5→5 (75), k=7→5 (105), k=9→5 (135)). So bandFee mod 1000 is in {100,300,500,700,900}? k = bandFee/100; 15k mod 10 = 5 when k is odd. So bandFee = 100*(odd). 18500 → k=185 odd → 2775. Yes.

For pct=12: sum*12/100 = sum*3/25. Non-integer when sum is not a multiple of 25... e.g., sum=42480 → 42480*12/100 = 5097.6.

OK, plenty of rounding cases.

Now, "degenerate inputs (zero, negative, unknown case type)":
- complexity 0 → clamped to band 1.
- complexity -3 → band 1.
- complexity null → throws Error('complexity is required').
- complexity undefined → throws.
- complexity 5, 40, 1000 → band 4.
- complexity 2.5 → NaN (quirk!). Hmm — should I pin NaN? The task says pin quirks as they are, flag in test name, document in FINDINGS. Yes: "complexity 2.5 (fractional) → NaN breakdown". That's a real quirk. But careful: `bands[1.5]` is undefined, bandFee = undefined. urgencyFee: pctOf(undefined, 15) → NaN (Math.round(NaN) = NaN). total = undefined + 0 + 0 → NaN. So the breakdown: { table, bandFee: undefined, urgencyFee: NaN (if deadline triggers) or 0, expeditedFee: NaN (if expedited) or 0, total: NaN }.

Wait: if not urgent and not expedited: bandFee = undefined, urgencyFee = 0, expeditedFee = 0, total = undefined + 0 + 0 = NaN. Actually undefined + 0 = NaN. Yes, NaN.

If urgent: urgencyFee = Math.round(undefined*15/100) = NaN. So the test should reflect the non-expedited, non-urgent path: complexity 2.5 → bandFee undefined, total NaN. And complexity 2.5 with expedited → expeditedFee NaN.

Hmm, but does `!band` catch 0? Yes: `!0` is true → band 1. Also careful: complexity = 0 → band 1. complexity = '2' (a string)? The type is number|null, historically not validated. String '3': `!'3'` is false, `'3' < 1` is false (string vs number comparison → NaN comparison → false), `'3' > 4` is false → bands['3'-1] = bands[2] = band 3! Interesting: '3'-1 = 2. So a string complexity '3' behaves like band 3. But that's type-level noise; the type says number. Should I pin it? The interface comment says "1..4 band" with number|null. I'll skip string complexity — not required by the task ("degenerate inputs (zero, negative, unknown case type)"). But fractional is interesting... The task enumerates zero, negative, unknown case type. I'll include fractional as a flagged quirk since it's a true degenerate input, and document in FINDINGS. Good.

- unknown case type: type 'BANKRUPTCY' or lowercase 'standard' (case-sensitive: 'standard' is not in the table → default STANDARD!). Lowercase type silently maps to STANDARD — a quirk worth pinning and documenting. Yes! `type: 'standard'` → not in base → defaults to STANDARD band. Worth a flagged test and a FINDINGS entry (silent default masks typo'd/legacy type strings, including wrong case).

- openedAt before 2019, e.g. '2015-05-05' → 2019 table (earliest). Quirk: no lower bound; cases from 2005 get the 2019 table. The module has "been running since 2019" per header, so openedAt < '2019-01-01' → still 2019 table. Maybe pin '2000-01-01' → 2019. This is a quirk: no lower boundary.

- deadline = undefined → no urgency. deadline = '' (empty string) → `c.deadline &&` → falsy → no urgency. Maybe pin: empty-string deadline is treated as absent. This is a true quirk (empty string is falsy). Worth pinning + documenting? Might be good. Let me include a small set: `deadline: ''` → no urgency fee.

- expedited = false/undefined → expeditedFee 0.

- `now` parameter: inject the fake clock. All tests should pass now to be deterministic. Note: `now` only affects urgency, not table selection (which uses openedAt).

Now, the "genuine bug" #1 (2022-07-01 boundary) test:
- openedAt '2022-07-01' → table '2021' (the bug: should be '2022' per the header comment "2022-07: rate revision").
- openedAt '2022-06-30' → '2021'.
- openedAt '2022-07-02' → '2022'.
- openedAt '2021-01-01' → '2021' (inclusive lower bound).
- openedAt '2020-12-31' → '2019'.

And "urgency on past deadline" bug #2 test:
- now '2022-03-15', deadline '2022-03-01' (14 days overdue) → urgencyFee > 0 (bug).
- now '2022-03-15', deadline '2022-03-22' (7 days) → urgency (inclusive edge).
- deadline '2022-03-23' (8 days) → no urgency.
- deadline = now (0 days) → urgency.

Hmm, are both "genuine bugs" or is one a quirk? The task says "quirks and at least one genuine bug". Let me classify:
- Bug 1: 2022-07-01 falls into the 2021 table (`>` vs `>=`) — genuine bug, monetary impact.
- Bug 2: urgency triggered by past deadline (negative days ≤ 7) — genuine bug, overcharges on overdue cases.
- Quirks: silent STANDARD default for unknown/lowercase type; band clamping (0/negative → 1, >4 → 4); fractional band → NaN; expedited applied to (base+urgency) compounding; urgency not applied when deadline is undefined/''; no lower bound on table selection; rounding at each step (half-up); string-based date comparison; `now` fallback to real clock (nondeterministic in production).

Blast radius considerations:
- Bug 1: cases opened on 2022-07-01 were billed at 2021 rates. Under-billed (2022 table is higher everywhere). Audited historical outputs → discrepancy between auditor expectation ("from 2022-07 the 2022 rates") and stored fees.
- Bug 2: all cases whose deadline passed before the calculation time got the urgency surcharge. If calculateFee is run on historical cases (e.g., re-computing for audit with `now` = today), urgency inflates fees on long-overdue cases. Blast radius depends on call pattern: at creation, deadline > now so negative days don't occur... but re-computation (audits, re-billing) hits it.
- NaN fractional: if any legacy import has fractional complexity, stored fees are NaN → downstream JSON serialization → null! JSON.stringify(NaN) → null. That's a nasty blast radius: NaN in a fee field serializes as null. Worth mentioning in FINDINGS.
- Silent default: unknown type billed at STANDARD rates — under-billed APPEAL/COMMERCIAL mis-typed as e.g. 'appeal' (lowercase) → billed at STANDARD (much cheaper). Blast radius: mis-typed imports from the old system silently under-billed.

Now, the deliverable files:
1. The test suite. Following the repo conventions (Vitest, `test/<feature>.spec.ts`), the file will be `test/fee-calculator.spec.ts`. Hmm — the layout convention says `test/<feature>.spec.ts`. The feature here is feeCalculator. Should the filename be `test/fee-calculator.spec.ts` or `test/feeCalculator.spec.ts`? The convention is "TS files: `kebab-case.role.ts`". The existing fixture file is `feeCalculator.ts` (camelCase, legacy). The test file is a new file and follows the convention: `test/fee-calculator.spec.ts`. Yes.

2. `FINDINGS.md` in the workspace root.

Also, the workspace has a `statusResolver.ts` too — that's from another variant (probably variant B's fixture). The task is variant A: feeCalculator. Do not touch statusResolver. My test file imports only feeCalculator.

Also, tsconfig has `"include": ["*.ts"]` — root-level only. The test file in `test/` won't be type-checked by that tsconfig, but Vitest transforms via esbuild so that's fine. I shouldn't modify tsconfig (not asked).

Do I need a vitest.config? The workspace only has feeCalculator.ts, statusResolver.ts, tsconfig.json. No package.json is shown. Hmm. "No tools, no shell, no filesystem" — I have to deliver the files the solution needs. The repo conventions say Vitest, pnpm. The workspace given is minimal (just the fixture + tsconfig). I should deliver the test file and FINDINGS.md. Should I also deliver a package.json? "Don't create files that aren't asked for." The task says "Deliverables: suite + FINDINGS.md." So exactly two files: test/fee-calculator.spec.ts and FINDINGS.md. Since the task explicitly enumerates deliverables, I'll stick to those two files. Vitest presumably runs in the eval harness (the workspace shown is a subset). I won't create package.json, vitest.config.ts, etc.

Now, let me carefully compute all the expected values.

Rate tables (in cents):

2019:
- STANDARD: [12000, 18500, 27000, 41000], urgency 15, expedited 10
- COMMERCIAL: [22000, 31500, 45000, 68000]
- ESTATE: [18000, 26000, 39500, 60000]
- APPEAL: [30000, 42000, 61000, 92000]

2021:
- STANDARD: [13500, 20500, 29500, 44500], urgency 15, expedited 12
- COMMERCIAL: [24000, 34000, 48500, 73000]
- ESTATE: [19500, 28000, 42500, 64500]
- APPEAL: [32500, 45500, 66000, 99000]

2022:
- STANDARD: [15000, 22500, 32500, 49000], urgency 18, expedited 12
- COMMERCIAL: [26500, 37500, 53500, 80500]
- ESTATE: [21500, 31000, 47000, 71000]
- APPEAL: [36000, 50000, 72500, 109000]

Task requirement: "every case type × complexity band" — 4 types × 4 bands × 3 tables = 48 base-fee assertions. I can do this with data-driven loops (describe.each or nested loops) asserting bandFee for each cell. That pins every cell of all 3 tables. I'll write it data-driven: for each table/date, for each type, for each band, assert bandFee equals the expected value from a locally-defined matrix in the test (independent of the implementation's constants — I hardcode the expected values in the test, which is the whole point of characterization: the test encodes expected values, not re-derivation).

Actually, to be truly independent, I should hardcode the expected numbers in the test file, not import the table from the module (the tables aren't exported anyway, so I can't — good, they're `const` and not exported). So I'll write a literal matrix in the test.

Structure:

```ts
import { describe, it, expect } from 'vitest';
import { calculateFee } from '../feeCalculator.js';
```

Wait — ESM import. The tsconfig has moduleResolution bundler. With Vitest + TS, importing '../feeCalculator' without extension works (Vitest resolves TS). But the package is "type": "module" per conventions. Vitest handles `../feeCalculator.ts`? With `allowImportingTsExtensions` off, you can't write .ts in an import. Safest: `import { calculateFee } from '../feeCalculator';` — Vitest resolves it. Yes, that's standard for Vitest+TS.

Now let me plan the test file:

```ts
// Characterization suite for feeCalculator.ts (production since 2019).
// Pins current behavior exactly, quirks included — see FINDINGS.md.
// Deterministic: every call passes an explicit `now`; no real dates.

import { describe, expect, it } from 'vitest';
import { calculateFee, type CaseInput } from '../feeCalculator';
```

Hmm, `type CaseInput` — verbatimModuleSyntax? The tsconfig doesn't set it, so a regular import is fine, but `type` imports are safe. Actually, the tsconfig's `types: []` means no global types — but Vitest provides its own. OK.

A helper to build inputs:

```ts
const NOW = '2024-01-15'; // fixed fake clock for all urgency-sensitive calls

function input(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2020-01-01',
    ...overrides,
  };
}
```

Wait, CaseInput requires `type`, `complexity`, `openedAt`. The helper defaults openedAt to '2020-01-01' (2019 table). For urgency tests, pass now.

Test groups:

1. **Rate table selection by opening date (boundaries)**
   - `openedAt: '2019-01-01'` → '2019'
   - `openedAt: '2018-12-31'` → '2019' (no lower bound — pin as quirk)
   - `openedAt: '2020-12-31'` → '2019'
   - `openedAt: '2021-01-01'` → '2021' (inclusive)
   - `openedAt: '2021-01-02'` → '2021'
   - `openedAt: '2022-06-30'` → '2021'
   - `openedAt: '2022-07-01'` → '2021' ← BUG FLAG: `BUG: ...`
   - `openedAt: '2022-07-02'` → '2022'
   - `openedAt: '2024-12-31'` → '2022'

   For each, assert `table` field and `bandFee` to confirm the table actually applies. E.g., STANDARD band 1: 2019→12000, 2021→13500, 2022→15000.

2. **Every type × band, all 3 tables (base fee matrix)** — 48 cells. Data-driven with literal expected matrix:

```ts
const BASE_FEES = {
  '2019': {
    STANDARD: [12000, 18500, 27000, 41000],
    COMMERCIAL: [22000, 31500, 45000, 68000],
    ESTATE: [18000, 26000, 39500, 60000],
    APPEAL: [30000, 42000, 61000, 92000],
  },
  '2021': {
    STANDARD: [13500, 20500, 29500, 44500],
    COMMERCIAL: [24000, 34000, 48500, 73000],
    ESTATE: [19500, 28000, 42500, 64500],
    APPEAL: [32500, 45500, 66000, 99000],
  },
  '2022': {
    STANDARD: [15000, 22500, 32500, 49000],
    COMMERCIAL: [26500, 37500, 53500, 80500],
    ESTATE: [21500, 31000, 47000, 71000],
    APPEAL: [36000, 50000, 72500, 109000],
  },
} as const;

const TABLE_DATE: Record<...> = { '2019': '2020-06-15', '2021': '2021-06-15', '2022': '2023-01-10' };

describe('base fee — every case type × complexity band in every table', () => {
  for (const [table, fees] of Object.entries(BASE_FEES)) {
    for (const [type, bands] of Object.entries(fees)) {
      for (let band = 1; band <= 4; band++) {
        it(`${table} ${type} band ${band} -> ${bands[band-1]}c`, () => {
          const r = calculateFee(input({ type, complexity: band, openedAt: TABLE_DATE[table] }));
          expect(r).toEqual({ table, bandFee: bands[band-1], urgencyFee: 0, expeditedFee: 0, total: bands[band-1] });
        });
      }
    }
  }
});
```

Wait — `bands[band-1]` is indexed into a readonly tuple; with `as const` the type is a readonly tuple of literals; index with band-1 is fine, returns the numeric literal union. TypeScript might complain about indexing a readonly tuple with `number`? Indexing a tuple with `number` returns the union of element types. `band-1` is `number`, and a tuple indexed by number gives the union of its element types — OK in strict mode? Yes, tuple[ number ] is allowed (union of element types). OK.

Using `toEqual` on the full object per cell gives strong per-cell assertions. 48 tests.

Alternatively, describe.each to reduce repetition — either is fine. I'll generate with a loop but with a readable test name.

3. **Urgency multiplier** (via `now`):
   - No deadline → urgencyFee 0 (all 3 tables? at least pin per table's pct).
   - deadline exactly 7 days after now → urgency applies (inclusive `<= 7`).
   - deadline 8 days after → no urgency.
   - deadline same day → urgency.
   - deadline 1 day after → urgency.
   - Past deadline → urgency ← BUG FLAG.
   
   For each table, urgency pct differs (15/15/18). Pin:
   - 2019: urgencyPct 15. STANDARD band 2 (18500) → 2775. Use now '2020-06-10', deadline '2020-06-17' (7 days).
   - 2021: urgencyPct 15. STANDARD band 4 (44500) → 6675.
   - 2022: urgencyPct 18. APPEAL band 2 (50000) → 9000. Or STANDARD band 3 (32500) → 5850.
   
   Edge computation: daysBetween('2020-06-10','2020-06-17') = 7 days exactly (UTC midnight). Good.

   Also, `now` only shifts the urgency window, not the table: e.g., openedAt '2020-01-01' (2019 table), now '2024-01-15', deadline '2024-01-20' → still 2019 table, urgency applied. Good pin: table selection uses openedAt, urgency uses now.

4. **Expedited multiplier**:
   - expedited applies a pct on (bandFee + urgencyFee) — pin the compounding as-is (quirk/ambiguity: the surcharge base includes the urgency fee).
   - 2019 expeditedPct 10, 2021/2022: 12.
   - No urgency: 2019 STANDARD band 1: expedited = 12000*10/100 = 1200, total 13200.
   - With urgency (compounding): 2019 STANDARD band 2 urgent: expedited = round((18500+2775)*10/100) = round(2127.5) = 2128. ← Rounding at each step.
   - 2021 with urgency: ESTATE band 3 (42500), urgency 15% = 6375, sum 48875, expedited 12% = 5865 exact. Total 48875+5865 = 54740.
   - 2022 with urgency: APPEAL band 1 (36000), urgency 18% = 6480, sum 42480, expedited 12% = round(5097.6) = 5098. Total 47578. ← Rounding.
   - expedited without deadline: fine.

5. **Rounding at each step** (flag as behavior):
   - Case with .5: 2019 STANDARD band 2 urgent+expedited → 2127.5 → 2128 (Math.round half-up).
   - Case with .6: 2022 APPEAL band 1 urgent+expedited → 5097.6 → 5098.
   - Also confirm total = sum of parts exactly (no additional rounding on total).

6. **Band clamping / degenerate complexity**:
   - 0 → band 1 fee.
   - -1, -42 → band 1.
   - 5, 9, 100 → band 4.
   - null → throws Error('complexity is required').
   - undefined → throws. (The interface is `number | null` but the code checks undefined too — pin the throw.)
   - 2.5 → NaN breakdown (quirk flag): bandFee undefined, total NaN.
   - NaN? complexity: NaN → `!NaN` is true → band 1. Hmm, pin? `NaN` passes the null/undefined check, then `!band` catches it → band 1. Pin: NaN complexity is treated as band 1 (no throw). Include, flag as quirk (NaN silently becomes band 1, not an error).
   - Infinity → band 4. -Infinity → `!-Infinity` false, `-Infinity < 1` true → band 1. Can pin. Maybe include Infinity → band 4, -Infinity → band 1. Hmm, let me keep the suite focused; zero, negative, unknown type are the required degenerate inputs. I'll include 0, negative, null, undefined, >4, and flagged fractional NaN, NaN→1, Infinity→4. Thorough but each is 1 line. OK.

7. **Unknown case type** (required):
   - type 'BANKRUPTCY' → silently uses STANDARD band (all 3 tables? pin at least 2). Flag as quirk: silent default.
   - type 'standard' (lowercase) → STANDARD band (case-sensitivity quirk).
   - type '' → STANDARD band.
   - Assert bandFee equals STANDARD's fee for that table/band, and maybe also total.

8. **Deadline degenerate cases**:
   - deadline undefined → no urgency.
   - deadline '' → no urgency (falsy quirk).
   - deadline null? Type is string|undefined; passing null → `c.deadline &&` → falsy → no urgency. Since type allows undefined only, maybe skip. Skip to avoid type errors. Actually in strict TS, `deadline: null` would fail typecheck. Skip.

9. **Determinism / fake clock**: every urgency test passes `now`. Also assert: same input with different `now` (outside the 7-day window) → no urgency, confirming `now` is the reference. E.g., openedAt 2020, deadline 2020-06-17; now '2020-06-10' → urgency; now '2020-06-01' → 16 days → no urgency. Good.

Also: the production `new Date()` fallback — I can't pin that deterministically; just note in FINDINGS that the suite always injects `now` per the task constraints.

Now, `toEqual` vs `toEqual` for NaN: expect(NaN).toEqual? In Jest/Vitest, `toEqual` treats NaN as equal to NaN (recursive equality treats NaN === NaN). Yes, Object.is-based? Actually jest's `toEqual` considers NaN equal to NaN. Vitest follows. And `undefined` properties: toEqual ignores undefined properties! Careful: `{bandFee: undefined, ...}` toEqual `{bandFee: 12000}` would fail since expected is 12000. But for the NaN case, I assert individual fields: `expect(r.bandFee).toBeUndefined(); expect(r.total).toBeNaN(); expect(r.urgencyFee).toBe(0);`. Since toEqual treats keys with undefined values as equivalent to missing — for safety, assert fields individually for the NaN case. Good.

Also for the full-object toEqual in the base matrix: the result object has exactly {table, bandFee, urgencyFee, expeditedFee, total} — all defined. Safe.

Now, let me double-check daysBetween with date-only strings: new Date('2020-06-10') → UTC midnight. '2020-06-17' → UTC midnight. Difference = exactly 7 * 86400000. floor → 7. Good. And `now` passed as '2020-06-10' is used as string ref → new Date parses UTC midnight.

Note: `now` is an ISO date string; the code does `new Date(ref)` inside daysBetween. If I passed '2020-06-10T00:00:00.000Z', that's the same. I'll use plain dates.

Now, let me compute all numbers explicitly for the tests (double-checking each):

**Base matrix** (as above) — just copy the literals.

**Urgency tests:**

T1 (2019, urgency 15%):
- openedAt '2020-06-10'?? Wait, openedAt determines the table; now determines urgency. Let me set openedAt '2020-01-15', now '2020-06-10', deadline '2020-06-17' (7 days).
- STANDARD band 2: bandFee 18500, urgencyFee round(18500*15/100)=round(2775)=2775, total 21275.
- Also 8-day edge: deadline '2020-06-18' → 8 days → urgencyFee 0, total 18500.
- Same-day: deadline '2020-06-10' → 0 → urgency 2775.

T2 (2021, urgency 15%):
- openedAt '2021-06-15', now '2021-06-10'?? wait now can be anything; let's keep now ≥ openedAt for realism: now '2021-06-20', deadline '2021-06-27' (7 days).
- APPEAL band 1: 32500 → urgency round(32500*.15)=4875. total 37375.

T3 (2022, urgency 18%):
- openedAt '2023-03-01', now '2023-03-10', deadline '2023-03-17' (7 days).
- COMMERCIAL band 3: 53500 → round(53500*18/100) = round(9630) = 9630. total 63130.
  53500*18 = 963000 → /100 = 9630. Exact.
- Edge: deadline '2023-03-18' (8 days) → 0.

**Past-deadline bug:**
- now '2023-03-10', deadline '2023-02-25' (13 days overdue) → daysBetween = -13 ≤ 7 → urgency applies. 2022 COMMERCIAL band 3 → urgency 9630. Total 63130.
- More extreme: deadline '2020-01-01' (3+ years overdue) → still urgency.

**Expedited:**
- 2019 no urgency: openedAt '2020-01-15', no deadline, expedited true. STANDARD band 1: bandFee 12000, expedited round(12000*10/100)=1200, total 13200.
- 2019 with urgency (compounding + rounding .5): openedAt '2020-01-15', now '2020-06-10', deadline '2020-06-17', expedited true, STANDARD band 2: bandFee 18500, urgency 2775, expedited round(21275*0.10)=round(2127.5)=2128, total 21275+2128=23403.
- 2021: ESTATE band 3 (42500), urgent (urgency=6375), expedited: round(48875*12/100)=round(5865)=5865. 48875*12 = 586500 → /100 = 5865 exact. total = 42500+6375+5865 = 54740.
- 2022 rounding .6: APPEAL band 1 (36000), urgent 6480, expedited round(42480*12/100)=round(5097.6)=5098. total 36000+6480+5098=47578.
- expedited without urgency in 2022: STANDARD band 3 (32500) → round(32500*12/100)=3900. total 36400.
- expedited=false explicitly → 0. (The default is the same; include one to pin falsy handling? `if (c.expedited)` — false and undefined are the same. I'll include `expedited: false` in one test.)

**Rounding at each step — half-up behavior:**
The 2127.5→2128 case shows Math.round (round-half-up for positives). Also I can demonstrate that rounding is per-step and not on total: in the 2021 ESTATE case, both steps are exact; better to use a case where the urgency step is rounded — but as noted, urgency on a multiple-of-100 base is always exact. So "rounding at each step" in practice only manifests in the expedited step. The comment says "rounded at each step since 2019". I'll pin: expedited is computed on the (already rounded) urgency fee — i.e., compounding uses the rounded intermediate. To demonstrate: I need a case where the rounding of urgency changes the expedited result... urgency never rounds in this data. So I just pin: expedited base = bandFee + urgencyFee (rounded value). OK — document it.

Actually, wait — is there any urgency value that's non-exact? urgency = round(bandFee * pct / 100). bandFee ∈ tables, all multiples of 100 → exact. So in production data, urgency is never rounded. Note in FINDINGS: "The 'rounding at each step' comment is currently only exercisable on the expedited step, given that all published band fees are multiples of $1.00; if a future table has sub-$1 band fees, the urgency step will round."

**Table boundary tests with bandFee confirmation:**
- '2020-12-31' → 2019, STANDARD b1 → 12000
- '2021-01-01' → 2021, STANDARD b1 → 13500 (inclusive)
- '2022-06-30' → 2021, STANDARD b1 → 13500
- '2022-07-01' → 2021, STANDARD b1 → 13500 ← BUG (expected '2022'/15000)
- '2022-07-02' → 2022, STANDARD b1 → 15000
- '2019-01-01' → 2019, 12000
- '2018-06-15' → 2019, 12000 (no lower bound quirk)

**Unknown type:**
- 'BANKRUPTCY' b2 2019 → 18500 (STANDARD b2).
- 'standard' b4 2022 → 49000.
- '' b1 2021 → 13500.

**Complexity degenerate cases (2022 STANDARD as reference, or mix):**
- 0 → band 1: 2019 STANDARD b1 12000.
- -1 → 12000. (Use -42 for fun? -1 is fine.)
- 5 → band 4: 41000 (2019 STANDARD).
- 100 → 41000.
- null → throw 'complexity is required'.
- undefined → throw. (Pass `complexity: undefined` — but the interface says `number | null`; does explicit `complexity: undefined` violate the type in strict TS? `exactOptionalPropertyTypes` is not set, so assigning undefined to `number | null`... without exactOptionalPropertyTypes, `complexity?: number | null | undefined`? The property is required (no `?`): `complexity: number | null`. Assigning undefined to a required property of type `number | null` → TS error? Without exactOptionalPropertyTypes, required properties can still be undefined at runtime but the type is `number | null` — assigning undefined errors in strict? Let me think: strict includes strictNullChecks; the property type `number | null` doesn't include undefined, so `complexity: undefined` in an object literal of type CaseInput → error TS2322. Hmm. So a typed test `input({ complexity: undefined })` would fail typecheck. But Vitest doesn't typecheck (esbuild strips types). Still, I want clean code. Options: cast: `calculateFee({ ...input(), complexity: undefined } as CaseInput)` — cast makes it compile. That's fine: `as unknown as CaseInput`? `as CaseInput` from an object where complexity: undefined — is the direct cast allowed? Casting an object literal `{ type, complexity: undefined, openedAt }` to CaseInput: TS allows the assertion if the types are "comparable"; a property `undefined` vs `number | null` — assertions between object types with incompatible property types are... assertion requires one type to be assignable to the other. `{complexity: undefined}` is not assignable to CaseInput, but CaseInput is not assignable to `{complexity: undefined}` either... Actually, the assertion is allowed if either is assignable to the other. Is CaseInput assignable to the literal's type `{ type: string; complexity: undefined; openedAt: string }`? No (number isn't assignable to undefined). So `as CaseInput` errors "Conversion of type ... may be a mistake". Need `as unknown as CaseInput`. Hmm, ugly but honest — pinning a runtime behavior beyond the declared type. The code explicitly checks `c.complexity === undefined`, so it's worth pinning. I'll do it with a brief comment. Or skip the undefined case... The code has both null and undefined checks; the comment says "historically not validated upstream". Pinning undefined-throw is valuable. Use `as unknown as CaseInput`.

Hmm, wait, actually simpler: construct via spread of a partial:
```ts
const partial = { type: 'STANDARD', openedAt: '2020-01-15' };
calculateFee(partial as CaseInput);
```
`partial` has no complexity → missing property → cast from `{type, openedAt}` to CaseInput: CaseInput requires complexity → not assignable; the reverse: is CaseInput assignable to `{type, openedAt}`? Yes! CaseInput has all of those (extra properties are fine for assignability). So the assertion `partial as CaseInput`... Assertion rule: allowed if S is assignable to T, or T is assignable to S (in either direction after widening). CaseInput (T) is assignable to the partial's type (S)? T has type, complexity, openedAt, deadline?, expedited?. S's type is {type: string, openedAt: string}. T is assignable to S (extra properties allowed). So the assertion is allowed.

Then `expect(() => calculateFee(partial as CaseInput)).toThrow('complexity is required')`.

- 2.5 → NaN: `const r = calculateFee(input({ complexity: 2.5, openedAt: '2020-01-15' })); expect(r.bandFee).toBeUndefined(); expect(r.urgencyFee).toBe(0); expect(r.expeditedFee).toBe(0); expect(r.total).toBeNaN();`
  Wait: total = undefined + 0 + 0 → NaN. Yes.
  Also with expedited: expeditedFee = pctOf(undefined + 0, 10) = NaN. Maybe pin 1 variant with expedited true → expeditedFee NaN. Include both? One is enough + documented. I'll do non-expedited NaN and note expedited amplifies in FINDINGS. Actually, let me include the expedited variant too — cheap and pins that the NaN propagates.
- NaN complexity → band 1: `complexity: NaN` is allowed by the type (number). `!NaN` → true → band 1 → 12000. Flag as quirk: NaN silently treated as band 1.
- Infinity → band 4: `complexity: Infinity` → `!Inf` false, `<1` false, `>4` true → band 4 → 41000.
- -Infinity → band 1.

Hmm, how far to go? The task says "degenerate inputs (zero, negative, unknown case type)". I'll cover zero, negative (multiple), >4 clamping, null, undefined, fractional (flagged), NaN (flagged), ±Infinity (maybe skip -Inf, keep Infinity). Let me include zero, -1, 5, 100, null, undefined, 2.5, NaN, Infinity. That's comprehensive without being silly.

**Deadline empty string:**
- `deadline: ''` → no urgency (falsy). Pin with 2019 STANDARD b2: total 18500, urgencyFee 0, even if now is close.

**`now` is the urgency reference, not the table selector:**
- openedAt '2020-01-15' (2019 table), now '2024-05-01', deadline '2024-05-07' (6 days) → table '2019', urgency 2775 on b2. Total 21275.

Now, naming the tests that flag quirks/bugs: I'll prefix with `(BUG)` or `(QUIRK)`. E.g.:

- `it('(BUG) case opened exactly on 2022-07-01 is billed on the 2021 table, not 2022')`
- `it('(BUG) a deadline in the past still earns the urgency surcharge')`
- `it('(QUIRK) unknown case type silently falls back to STANDARD rates')`
- `it('(QUIRK) lowercase type "standard" matches nothing and falls back to STANDARD')`
- `it('(QUIRK) fractional complexity 2.5 produces a NaN fee (no band lookup guard)')`
- `it('(QUIRK) NaN complexity is silently coerced to band 1')`
- `it('(QUIRK) empty-string deadline is treated as no deadline')`
- `it('(QUIRK) opening dates before 2019 still get the 2019 table (no lower bound)')`
- `it('(QUIRK) expedited pct is computed on bandFee + urgencyFee (compounding)')` — this is more "ambiguous, pinned as-is".
- `it('(QUIRK) complexity 0 / negative clamps to band 1; >4 clamps to band 4')` — clamping may be intended; pin as behavior. Not necessarily a quirk — name it as behavior.

Now, the FINDINGS.md structure:

For each finding: title, category (BUG/QUIRK), reproducing input (exact CaseInput + now), observed output, expected/intended (if known), likely blast radius, proposed fix (not applied).

Findings list:
1. **BUG — 2022-07-01 off-by-one in rate table selection** (`>` vs `>=`). Repro: {type STANDARD, complexity 1, openedAt '2022-07-01'} → table '2021', bandFee 13500; per header comment ("2022-07: rate revision") the 2022 table (15000) should apply. Blast: every case opened on 2022-07-01 (single day) under-billed: e.g., STANDARD b1 short by 1500c (13500→15000 = -$15.00), band 4 APPEAL: 99000 vs 109000 = -$100. Urgency/expedited pct also differ (15→18) so urgent cases diverge further. Stored historical fees on 2022-07-01 conflict with the published rate schedule. Proposed fix: change to `>= REVISION_2022` — but this changes billed amounts for that day; coordinate with billing, and decide on re-billing/reconciliation before applying.

2. **BUG — Urgency surcharge applied when deadline has already passed** (`daysBetween(ref, deadline) <= 7` is true for any negative day count). Repro: now '2023-03-10', deadline '2023-02-25' → urgencyFee 9630 (2022 COMMERCIAL b3). Intended: urgency = deadline imminent (0..7 days). Blast: any recomputation (audit re-runs, corrections, re-billing) of cases whose deadline passed at calculation time is inflated by 15–18% (plus expedited compounding). If billing ever ran calculateFee with now past the deadline on stored cases, historical outputs are overstated. Proposed fix: `daysBetween(ref, c.deadline) >= 0 && daysBetween(ref, c.deadline) <= 7`.

3. **QUIRK — Silent fallback to STANDARD for unknown/case-mismatched case type.** Repro: type 'BANKRUPTCY' or 'standard' → STANDARD fee. Blast: mis-typed imports from old systems under-billed (e.g., a COMMERCIAL mistyped as 'commercial' pays STANDARD — 22000 vs ... wait 'commercial' lowercase → not found → STANDARD. A real COMMERCIAL b1 is 22000 (2019); mis-typed it's billed 12000 → -$100). No audit trail. Proposed fix: throw on unknown type, or an explicit legacy-alias map; at minimum, log.

4. **QUIRK — Fractional / out-of-domain complexity yields NaN (2.5) or silent clamp (0, -1, 5, NaN, Infinity).** Repro: complexity 2.5 → bandFee undefined, total NaN. Blast: NaN serializes to `null` in JSON → null fee in billing exports/audited outputs; downstream totals poison (NaN propagates). NaN complexity → silently band 1 (under-billed if the intended was 3/4). Proposed fix: integer guard: `Number.isInteger(c.complexity)` else throw; clamp or reject 1..4.

5. **QUIRK — Expedited surcharge compounds on (bandFee + urgencyFee), and rounding happens per step (Math.round, half-up).** Repro: 2019 STANDARD b2 urgent+expedited → 2127.5 → 2128. If expedited were on bandFee only: round(18500*.10)=1850 → total 23125 vs actual 23403. Blast: urgent+expedited cases over-billed vs a non-compounding reading; audited history embeds the compounding + rounding, so any "correction" re-prices those cases. Proposed fix: decide the policy (compound or not), then a one-off reconciliation.

6. **QUIRK — Rate table selection is a lexicographic string compare on openedAt.** Works for canonical 'YYYY-MM-DD'; non-canonical input ('2022-7-1', with a time suffix) silently selects a different table. E.g., '2022-07-01T00:00:00Z' > '2022-07-01' → 2022 table, whereas plain '2022-07-01' → 2021. Blast: any caller passing a datetime string (the CaseInput comment says "ISO date", but ISO also covers datetimes) flips tables. Proposed fix: parse to a date or validate the format.

Hmm — should I pin the datetime string behavior in the suite? It's a genuine observable difference. '2022-07-01T00:00:00Z' — string comparison: '2022-07-01T...' vs '2022-07-01': the former is longer with a common prefix → greater → `> REVISION_2022` true → 2022 table. So a case opened at the exact revision moment with a datetime gets the 2022 table, and the same day in date-only gets 2021. That's a sharp, testable manifestation of finding 6. I'll include one flagged test.

Also `daysBetween` floor with sub-day: '2020-06-10T08:00:00Z' vs deadline... The deadline is a date string per the comment. If deadline contains a time, the floor of ms/86400000 matters. E.g., now '2020-06-10', deadline '2020-06-17T00:00:00Z' → 7 days exactly → 7 → urgency. Fine, skip; the table-selection datetime case is enough.

7. **QUIRK — `now` falls back to the real clock** when omitted (nondeterministic). Can't be pinned deterministically; document. Suite always injects `now`. Also note: in production, a case's urgency silently depends on when the fee is (re)calculated.

8. Also, **URGENT tier history**: header says "2020-03: added URGENT tier after the Silva case" — but the code has no URGENT tier in the CaseType! The 2019 table was in production since 2019, urgencyPct exists in all tables... The header comment mentions an added URGENT tier, but the code implements urgency via `deadline` proximity, not a tier. That's a documentation/code mismatch — worth a small note in FINDINGS (unresolved provenance; don't assume). Hmm, maybe overreaching but a good finding to mention briefly as "unverified comment". I'll include a short note.

Also, "Do not modify without checking with billing first" — the FINDINGS fixes are proposals only, not applied. Good.

Now, the test file — let me also make sure every test passes a `now` when urgency is involved, and where no deadline, `now` is irrelevant (still fine to pass). For full determinism, pass `now` to every call via a helper? The urgency logic only runs if `c.deadline` is truthy. Without deadline, `now` is unused (well, `ref` is computed but only used in daysBetween when deadline). So determinism holds for no-deadline tests regardless. But to be safe and explicit, I'll pass now everywhere via a helper. I'll make a helper `fee(c)` that merges now. Actually simpler: every call `calculateFee(input({...}), NOW_<context>)`. Let me define a constant per group.

Wait, one more subtlety: `expect(r).toEqual({table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000})` — the returned object has exactly these keys. toEqual passes. Good.

Now, let me write out all tests with exact values. Let me double-check each computation:

Base matrix (from the fixture, copied):
2019: S [12000,18500,27000,41000], C [22000,31500,45000,68000], E [18000,26000,39500,60000], A [30000,42000,61000,92000]
2021: S [13500,20500,29500,44500], C [24000,34000,48500,73000], E [19500,28000,42500,64500], A [32500,45500,66000,99000]
2022: S [15000,22500,32500,49000], C [26500,37500,53500,80500], E [21500,31000,47000,71000], A [36000,50000,72500,109000]

Table representative dates: 2019: '2020-06-15'; 2021: '2021-06-15'; 2022: '2023-03-01'. (Avoid boundary days for the matrix; boundaries are tested separately.)

Urgency cases:
- 2019, S b2 (18500), 15%: 18500*15 = 277500 /100 = 2775. ✓ total 21275.
  now '2020-06-10', deadline '2020-06-17' → 7 days ✓.
  Edge 8: deadline '2020-06-18' → 8 → 0.
  Same day: deadline '2020-06-10' → 0 days → urgency.
- 2021, A b1 (32500), 15%: 32500*15=487500/100=4875. ✓ total 37375.
  openedAt '2021-06-15', now '2021-06-20', deadline '2021-06-27' (7). ✓
- 2022, C b3 (53500), 18%: 53500*18=963000/100=9630 ✓ total 63130.
  openedAt '2023-03-01', now '2023-03-10', deadline '2023-03-17' (7). ✓
  Edge 8: deadline '2023-03-18' → 0 urgency, total 53500.

Past deadline:
- now '2023-03-10', deadline '2023-02-25': daysBetween = Feb 25 − Mar 10. Feb 2023 has 28 days. Feb 25 → Mar 10 = 13 days. So -13 ≤ 7 → urgency 9630. ✓
- Extreme: deadline '2020-01-01', now '2023-03-10' → very negative → urgency. Same numbers 9630.

Expedited:
- 2019 no urgency, S b1 (12000), 10%: 1200. total 13200. ✓
- 2019 urgent S b2: sum 21275, 10%: 2127.5 → 2128. total 21275+2128 = 23403. ✓
- 2021 urgent E b3 (42500): urgency 6375 (42500*15=637500/100=6375 ✓), sum 48875, 12%: 48875*12=586500/100=5865 ✓. total 42500+6375+5865=54740. ✓
- 2022 urgent A b1 (36000): urgency 6480 (36000*18=648000/100 ✓), sum 42480, 12%: 42480*12=509760/100=5097.6 → 5098. total 36000+6480+5098=47578. ✓
- 2022 no urgency S b3 (32500), 12%: 32500*12=390000/100=3900 ✓ total 36400.
- expedited:false explicit → expeditedFee 0: use 2019 S b1, no deadline → total 12000.

Complexity:
- 0 → 2019 S b1 12000.
- -1 → 12000. (Use -7? -1 is fine.)
- 5 → 2019 S b4 41000.
- 100 → 41000.
- null → throw 'complexity is required'.
- missing (undefined) → throw (cast).
- 2.5 → NaN (2019 S): bandFee undefined, urgency 0, expedited 0, total NaN.
- 2.5 + expedited → expeditedFee NaN, total NaN.
- NaN → 12000 (band 1).
- Infinity → 41000 (band 4).

Unknown type (2019 as reference):
- 'BANKRUPTCY' b2 → 18500; also assert full object.
- 'standard' b4 2022 → 49000.
- '' b1 2021 → 13500.

Deadline degenerate:
- no deadline (already in matrix) — fine.
- '' deadline with now close → 0 urgency: 2019 S b2, now '2020-06-10', deadline '' → 18500.

Table selection (with bandFee):
- '2018-06-15' → 2019 / 12000 (quirk: no lower bound).
- '2019-01-01' → 2019 / 12000.
- '2020-12-31' → 2019 / 12000.
- '2021-01-01' → 2021 / 13500 (inclusive).
- '2021-01-02' → 2021 / 13500.
- '2022-06-30' → 2021 / 13500.
- '2022-07-01' → 2021 / 13500 (BUG).
- '2022-07-02' → 2022 / 15000.
- '2024-12-31' → 2022 / 15000.
- datetime string: '2022-07-01T00:00:00Z' → 2022 / 15000 (quirk: lexicographic). Wait — let me verify: is '2022-07-01T00:00:00Z' >= '2021-01-01'? Yes. > '2022-07-01'? Common prefix '2022-07-01', then 'T' vs end → longer is greater → true → 2022 table → 15000. ✓ So same wall-clock moment as '2022-07-01' but a different result — a great sharp demo. I'll also assert the date-only counterpart in the same describe for contrast.

`now` independence:
- openedAt '2020-01-15', now '2024-05-01', deadline '2024-05-07' (6 days) → table '2019', S b2 urgency 2775, total 21275.
  daysBetween('2024-05-01','2024-05-07') = 6 ✓.

Counting: 48 (matrix) + 10 (boundaries) + 7 (urgency: 3 tables × (7-day edge, 8-day no) + same day + past ×2... let me count when writing) + 6 expedited + ~10 complexity + 3 unknown type + 2 deadline degenerate + 2 now-independence + datetime 1. Roughly 90 tests. Nice breadth. All with value assertions (full-object toEqual or specific field assertions), no hollow "was called" tests.

Let me also think about `toEqual` on a result where urgencyFee/expeditedFee are 0 — fine.

One more check — 2019 '2019-01-01' `tableFor`: '2019-01-01' >= '2021-01-01'? No → 2019. ✓ '2018-06-15' → 2019. ✓

String compare '2020-12-31' >= '2021-01-01'? '2020' < '2021' → no → 2019 ✓.
'2021-01-01' >= '2021-01-01' ✓ → 2021. '2022-06-30' > '2022-07-01'? '06' < '07' → no → 2021 ✓. '2022-07-01' > '2022-07-01' no → 2021 ✓ (bug pin). '2022-07-02' > '2022-07-01' yes → 2022 ✓.

Now, FINDINGS.md content. Format: title, then findings. Each: classification, location, reproducing input, observed (actual) output, what I'd expect, blast radius, proposed fix (not applied). Plus a note on suite constraints (fake clock via `now`, production code untouched, list of pinned quirks → test names). Let me write it tight but complete.

Also mention the header comment mismatch ("2020-03: added URGENT tier" but no URGENT tier in CaseType) as an unresolved provenance note.

Double-checking the NaN serialization claim: JSON.stringify({a: NaN}) → '{"a":null}'. Correct.

Also, let me verify the 2022-07-01 under-billing delta: STANDARD b1: 15000−13500=1500c ($15). APPEAL b4: 109000−99000=10000c ($100). Urgent APPEAL b4 on 2022-07-01: actual 99000 + 15% = 14850 urgency → 113850; intended 109000 + 18% = 19620 → 128620. Delta $147.70. I can cite the band-1 STANDARD delta and mention the range. Keep it concise: "up to $100 base delta per case (APPEAL band 4: $990.00 billed vs $1,090.00 scheduled), more when urgent."

Past-deadline blast: urgency 15–18% of band fee + expedited compounding on top. E.g., 2022 APPEAL b4 overdue: 109000 + 19620 = 128620 vs intended 109000.

Let me now write the test file completely.

```ts
// Characterization suite for feeCalculator.ts (in production since 2019).
//
// Goal: pin the module's CURRENT behavior exactly — including its quirks —
// so the planned modification has a regression baseline. See FINDINGS.md for
// each flagged (BUG)/(QUIRK) test and the proposed (unapplied) fixes.
//
// Determinism: no real dates and no randomness. Every call that can touch
// the clock passes an explicit `now` (the module's existing optional
// parameter). Production code is untouched.

import { describe, expect, it } from 'vitest';
import { calculateFee, type CaseInput } from '../feeCalculator';

const CASES: Array<[string, number[]]> = ...
```

Hmm, let me structure it:

```ts
type TableName = '2019' | '2021' | '2022';

const BASE_FEES: Record<TableName, Record<string, [number, number, number, number]>> = {
  '2019': {
    STANDARD: [12000, 18500, 27000, 41000],
    COMMERCIAL: [22000, 31500, 45000, 68000],
    ESTATE: [18000, 26000, 39500, 60000],
    APPEAL: [30000, 42000, 61000, 92000],
  },
  '2021': {
    STANDARD: [13500, 20500, 29500, 44500],
    COMMERCIAL: [24000, 34000, 48500, 73000],
    ESTATE: [19500, 28000, 42500, 64500],
    APPEAL: [32500, 45500, 66000, 99000],
  },
  '2022': {
    STANDARD: [15000, 22500, 32500, 49000],
    COMMERCIAL: [26500, 37500, 53500, 80500],
    ESTATE: [21500, 31000, 47000, 71000],
    APPEAL: [36000, 50000, 72500, 109000],
  },
};

// A representative (non-boundary) opening date per rate table.
const TABLE_OPENED_AT: Record<TableName, string> = {
  '2019': '2020-06-15',
  '2021': '2021-06-15',
  '2022': '2023-03-01',
};

function input(overrides: Partial<CaseInput> = {}): CaseInput {
  return { type: 'STANDARD', complexity: 1, openedAt: '2020-01-15', ...overrides };
}
```

Wait: `Partial<CaseInput>` — complexity is required in CaseInput; Partial makes it optional, and I spread overrides over a full default. `complexity: 1` default then override — but what if the override explicitly sets `complexity: null`? `{type, complexity: 1, openedAt, ...{complexity: null}}` → complexity null. ✓ Works.

The test groups:

```ts
describe('base fee: every case type x complexity band, every rate table', () => {
  for (const table of ['2019', '2021', '2022'] as const) {
    for (const [type, bands] of Object.entries(BASE_FEES[table])) {
      for (let band = 1; band <= 4; band += 1) {
        const expected = bands[band - 1];
        it(`${table} table / ${type} / band ${band} -> ${expected}c`, () => {
          const r = calculateFee(input({ type, complexity: band, openedAt: TABLE_OPENED_AT[table] }), '2024-01-15');
          expect(r).toEqual({
            table,
            bandFee: expected,
            urgencyFee: 0,
            expeditedFee: 0,
            total: expected,
          });
        });
      }
    }
  }
});
```

`Object.entries(BASE_FEES[table])` — type: BASE_FEES[table] is Record<string, [n,n,n,n]>, entries → [string, [number,number,number,number]][] ✓. `bands[band-1]` → number ✓.

Boundary:

```ts
describe('rate table selection: opening-date boundaries', () => {
  // Standard band 1 as the probe: 2019 -> 12000c, 2021 -> 13500c, 2022 -> 15000c.
  const probe = (openedAt: string) =>
    calculateFee(input({ type: 'STANDARD', complexity: 1, openedAt }), '2024-01-15');

  it('opened 2019-01-01 -> 2019 table', () => {
    expect(probe('2019-01-01')).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000 });
  });
  ...
```

Maybe cleaner to write a helper that asserts table+bandFee:

```ts
function expectTable(openedAt: string, table: TableName, bandFee: number) {
  expect(probe(openedAt)).toEqual({ table, bandFee, urgencyFee: 0, expeditedFee: 0, total: bandFee });
}
```

Tests:
- expectTable('2018-06-15', '2019', 12000) with (QUIRK) name: no lower bound.
- expectTable('2019-01-01', '2019', 12000)
- expectTable('2020-12-31', '2019', 12000)
- expectTable('2021-01-01', '2021', 13500) — 2021 boundary is INCLUSIVE
- expectTable('2021-06-15', '2021', 13500)
- expectTable('2022-06-30', '2021', 13500)
- (BUG) expectTable('2022-07-01', '2021', 13500)
- expectTable('2022-07-02', '2022', 15000)
- expectTable('2024-12-31', '2022', 15000)

And the datetime quirk test:

```ts
it('(QUIRK) a datetime string for the same moment selects a different table than the date-only string', () => {
  // Lexicographic compare: '2022-07-01T00:00:00Z' > '2022-07-01'
  const dateOnly = calculateFee(input({ openedAt: '2022-07-01' }), '2024-01-15');
  const dateTime = calculateFee(input({ openedAt: '2022-07-01T00:00:00Z' }), '2024-01-15');
  expect(dateOnly.table).toBe('2021');
  expect(dateOnly.bandFee).toBe(13500);
  expect(dateTime.table).toBe('2022');
  expect(dateTime.bandFee).toBe(15000);
});
```

Urgency:

```ts
describe('urgency surcharge (deadline within 7 days of `now`)', () => {
  it('2019 table: deadline exactly 7 days out -> +15%', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17' }),
      '2020-06-10',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 0, total: 21275 });
  });
  it('2019 table: deadline 8 days out -> no surcharge (exclusive edge)', () => {
    ... deadline '2020-06-18', now '2020-06-10' → 18500/0/0/18500
  });
  it('deadline on the same day as `now` (0 days) -> surcharge applies', () => {
    deadline '2020-06-10', now '2020-06-10' → 2775
  });
  it('2021 table: 7 days out -> +15%', () => {
    A b1 32500 → 4875, total 37375; openedAt '2021-06-15', now '2021-06-20', deadline '2021-06-27'
  });
  it('2022 table: 7 days out -> +18% (the rate revision changed the urgency pct too)', () => {
    C b3 53500 → 9630 total 63130; openedAt '2023-03-01', now '2023-03-10', deadline '2023-03-17'
  });
  it('2022 table: 8 days out -> no surcharge', () => {
    deadline '2023-03-18' → 0
  });
  it('no deadline -> no surcharge even when `now` is close to anything', () => {
    S b2 no deadline, now '2020-06-10' → 18500/0
  });
  it('(QUIRK) empty-string deadline behaves like no deadline', () => {
    deadline '', now '2020-06-10' → 0 urgency
  });
  it('(BUG) deadline in the past (13 days overdue) still earns the surcharge', () => {
    2022 C b3, now '2023-03-10', deadline '2023-02-25' → 9630, total 63130
  });
  it('(BUG) a deadline years in the past still earns the surcharge', () => {
    deadline '2020-01-01', now '2023-03-10' → 9630
  });
  it('`now` shifts the window, not the rate table', () => {
    openedAt '2020-01-15', now '2024-05-01', deadline '2024-05-07' (6 days) → table 2019, S b2 2775, 21275
  });
});
```

Expedited:

```ts
describe('expedited surcharge', () => {
  it('2019 table: +10% of band fee when not urgent', () => {
    S b1 12000 → 1200, total 13200; no deadline; now arbitrary '2024-01-15'
  });
  it('2021 table: +12% of band fee when not urgent', () => {
    S b1 13500 → 1620, total 15120. Check: 13500*12=162000/100=1620 ✓
  });
  it('2022 table: +12% of band fee when not urgent', () => {
    S b3 32500 → 3900, total 36400
  });
  it('(QUIRK) when urgent, the expedited pct compounds on bandFee + urgencyFee', () => {
    2021 E b3: 42500 + 6375 = 48875 → 5865, total 54740; openedAt '2021-06-15', now '2021-06-20', deadline '2021-06-27', expedited true
  });
  it('expedited: false is the same as omitting it', () => {
    S b1 2019 expedited false → 12000
  });
});
```

Rounding:

```ts
describe('rounding: Math.round per step (half up)', () => {
  it('half-cent rounds UP: 2019 STANDARD band 2 urgent + expedited -> expedited 2127.5c rounds to 2128c', () => {
    r = calculateFee(input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17', expedited: true }), '2020-06-10');
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 });
  });
  it('fractional cents round to nearest: 2022 APPEAL band 1 urgent + expedited -> 5097.6c rounds to 5098c', () => {
    openedAt '2023-03-01', now '2023-03-10', deadline '2023-03-17', APPEAL b1, expedited → 36000/6480/5098/47578
  });
  it('the expedited fee is computed on the already-rounded urgency fee (per-step, not on the raw product)', () => {
    // In this data set the urgency step is always exact (all band fees are multiples of 100c),
    // so the per-step rounding is observably the expedited step on (bandFee + urgencyFee).
    // Pin the pipeline: expedited base = 21275 (the rounded sum), not the unrounded product.
    Same 2019 case: assert expeditedFee === Math.round((18500 + 2775) * 10 / 100) and !== Math.round(18500 * 10 / 100)
  });
});
```

Hmm, the third test asserts `r.expeditedFee === 2128 && 2128 !== 1850` — a good demonstration that compounding is happening (distinguishing from an expedited-on-band-fee-only reading). I'll phrase it as a behavior pin.

Wait, is 2128 !== 1850 a meaningful assertion? It demonstrates that the base of the surcharge includes the urgency fee. Good.

Complexity:

```ts
describe('complexity: validation and clamping', () => {
  it('complexity 0 clamps to band 1', () => 12000);
  it('negative complexity (-1) clamps to band 1', () => 12000);
  it('complexity 5 clamps to band 4', () => 41000);
  it('complexity 100 clamps to band 4', () => 41000);
  it('null complexity throws "complexity is required"', () => {
    expect(() => calculateFee(input({ complexity: null }), '2024-01-15')).toThrow('complexity is required');
  });
  it('missing (undefined) complexity throws "complexity is required"', () => {
    const bare = { type: 'STANDARD', openedAt: '2020-01-15' };
    expect(() => calculateFee(bare as CaseInput, '2024-01-15')).toThrow('complexity is required');
  });
  it('(QUIRK) fractional complexity 2.5 falls through the band guard and yields a NaN fee', () => {
    const r = calculateFee(input({ complexity: 2.5 }), '2024-01-15');
    expect(r.table).toBe('2019');
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(r.total).toBeNaN();
  });
  it('(QUIRK) fractional complexity 2.5 + expedited propagates NaN into expeditedFee', () => {
    const r = calculateFee(input({ complexity: 2.5, expedited: true }), '2024-01-15');
    expect(r.expeditedFee).toBeNaN();
    expect(r.total).toBeNaN();
  });
  it('(QUIRK) NaN complexity is silently treated as band 1', () => 12000);
  it('Infinity complexity clamps to band 4', () => 41000);
});
```

Wait, `bare as CaseInput` — check the assertion validity: type of bare is `{ type: string; openedAt: string }`. CaseInput = { type: string; complexity: number|null; openedAt: string; deadline?: string; expedited?: boolean }. Is CaseInput assignable to `{type, openedAt}`? Yes (extra properties are OK). So the assertion is allowed (assignable in one direction). ✓

Unknown type:

```ts
describe('case type: silent fallback to STANDARD', () => {
  it('(QUIRK) unknown type "BANKRUPTCY" is billed at STANDARD rates', () => {
    const r = calculateFee(input({ type: 'BANKRUPTCY', complexity: 2, openedAt: '2020-01-15' }), '2024-01-15');
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 0, expeditedFee: 0, total: 18500 });
  });
  it('(QUIRK) lowercase "standard" matches no table key and falls back to STANDARD', () => {
    type 'standard', complexity 4, openedAt '2023-03-01' → 49000, table '2022'
  });
  it('(QUIRK) empty-string type falls back to STANDARD', () => {
    type '', complexity 1, openedAt '2021-06-15' → 13500 '2021'
  });
  it('a known type is never affected (contrast: COMMERCIAL band 2, 2019)', () => {
    → 31500
  });
});
```

Also, maybe: an unknown type with urgency still gets the table's urgencyPct applied to the STANDARD band fee — implied; skip.

Also, the "every case type × complexity band" requirement is met by the 48-cell matrix.

Urgency pct per table — covered (15, 15, 18). Expedited pct per table (10, 12, 12) — covered.

Now, `toThrow('complexity is required')` — Vitest supports string substring matching. ✓

One concern: importing `type CaseInput` from '../feeCalculator' — the fixture exports the interface CaseInput ✓ and function calculateFee ✓.

Import path: the test file is at `test/fee-calculator.spec.ts`, the fixture at the root `feeCalculator.ts` → `../feeCalculator`. ✓

Should the filename be `test/fee-calculator.spec.ts`? Convention: `test/<feature>.spec.ts`, kebab-case. Feature is fee calculator. Yes.

FINDINGS.md — I'll write it in the root. Content plan:

# FINDINGS — feeCalculator.ts characterization
- Context: suite location, constraints (production code untouched, fake clock only via `now`, deterministic).
- How to read: test names with (BUG)/(QUIRK) map 1:1 to the findings below.

## BUG-1 — Cases opened on 2022-07-01 are billed at 2021 rates (off-by-one at the second revision)
- Location: `tableFor()`, `openedAt > REVISION_2022` (strict) vs `openedAt >= REVISION_2021` (inclusive).
- Reproducing input: `{ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }` → `{ table: '2021', bandFee: 13500, ... }`; the module's own header says "2022-07: rate revision (see RATE_TABLE_2022)", i.e., the intended table is '2022' (15000).
- Blast radius: every case opened exactly on 2022-07-01 (single day) under-billed by the 2021→2022 delta: $15.00 (STANDARD b1) up to $100.00 (APPEAL b4); urgent cases also miss the 15→18 pct bump. Stored/audited historical fees for that day contradict the published rate schedule.
- Proposed fix (not applied): `if (openedAt >= REVISION_2022)`. Requires billing sign-off + a reconciliation for the affected day before applying.

## BUG-2 — Urgency surcharge applies when the deadline has already passed
- `daysBetween(ref, c.deadline) <= 7` is true for any negative day count.
- Repro: `now '2023-03-10'`, `deadline '2023-02-25'`, 2022 COMMERCIAL b3 → urgencyFee 9630 (96300? no 9630c = $96.30), total 63130 instead of 53500.
- Intended: urgency = deadline imminent (0..7 days).
- Blast radius: any re-computation of historical cases (audit re-runs, corrections, re-billing) whose deadline had passed at calculation time is inflated by 15–18% of the band fee, plus compounded expedited. If any billing run did this on stored cases, those outputs are overstated.
- Fix: `const days = daysBetween(ref, c.deadline); if (days >= 0 && days <= 7)`.

## QUIRK-1 — Unknown / misspelled case type silently falls back to STANDARD
- `bands = table.base['STANDARD']` when the type isn't found. Case-sensitive lookup: 'standard'/'COMMERCIAL ' etc.
- Repro: type 'BANKRUPTCY' or 'standard' → STANDARD fee.
- Blast radius: legacy imports with bad type strings (old-system casing) are silently under-billed — e.g., a COMMERCIAL recorded as 'commercial' pays the STANDARD band (2019 b1: $120.00 instead of $220.00). No error, no log → invisible in audits.
- Fix: throw on unknown type (or an explicit legacy-alias map if the old-system casing is known) + alerting.

## QUIRK-2 — Fractional complexity escapes the band guard → NaN fee
- Guard handles `!band || band < 1` and `band > 4` but not non-integers: `bands[2.5-1]` → `bands[1.5]` → `undefined`.
- Repro: complexity 2.5 → `{ bandFee: undefined, total: NaN }`; with expedited, expeditedFee is NaN.
- Blast radius: JSON.stringify(NaN) → null: a corrupted/legacy fractional complexity writes a null fee into billing exports; NaN also poisons any sum that includes it. NaN complexity is a different path: `!NaN` is truthy → silently band 1 (under-billed, no error).
- Fix: `if (!Number.isInteger(c.complexity)) throw ...` and validate 1..4 (or clamp explicitly with a warning).

## QUIRK-3 — Expedited surcharge compounds on (bandFee + urgencyFee); rounding per step (Math.round, half-up)
- Repro: 2019 STANDARD b2 urgent + expedited: 18500 + 2775 = 21275; 10% → 2127.5 → 2128. If expedited were on band fee only: 1850. Total pinned: 23403.
- Status: may be intended ("percent added when expedited" is ambiguous about the base), but it's what billing has reconciled against since 2019.
- Blast radius: every urgent + expedited case is ~15×? over-billed vs a non-compounding reading (urgency pct × band fee is the delta: e.g., 2775*0.10 ≈ 277.5c here). Any "fix" re-prices a large historical slice; rounding is also baked into stored cents, so re-implementations must reproduce Math.round at the same step or diffs will appear in audit reconciliation.
- Fix: get billing to confirm the intended base; if the change is approved, run a reconciliation report over stored fees before re-billing.

## QUIRK-4 — Rate-table choice is a lexicographic string compare on `openedAt`
- Fine for canonical 'YYYY-MM-DD'; breaks for other ISO forms.
- Repro: '2022-07-01T00:00:00Z' → 2022 table (15000) but '2022-07-01' → 2021 (13500): same moment, different table.
- Blast radius: any caller passing a datetime (the field comment says "ISO date", but ISO also allows datetimes) silently switches tables around the revision boundaries.
- Fix: normalize/validate openedAt to 'YYYY-MM-DD' (or compare by parsed date).

## QUIRK-5 — `now` falls back to the real clock; urgency depends on when the fee is calculated
- `now ? now : new Date().toISOString()...`. Not testable deterministically; the suite always injects `now`.
- Blast: running the same stored case later can change its urgency fee (the deadline ages toward/past `now` — which combines with BUG-2).
- Fix: make `now` required (or pass an explicit calculation date from the caller).

## Note — header comment provenance
- "2020-03: added URGENT tier after the Silva case" but CaseType has no URGENT member, and no table has URGENT-specific rates; urgency is modeled purely by deadline proximity. Unresolved provenance — flag to billing before restructuring.

Also a "pinned behavior (intended, not a defect)" section: band clamping 0/negative→1, >4→4; no lower bound on table selection (pre-2019 → 2019); inclusive 7-day urgency edge; inclusive 2021 lower boundary; rounding is half-up. Maybe fold into the findings; keep the document scannable. I'll add a short section listing the pinned-as-is behaviors with test pointers.

Also, at the top of FINDINGS, map each (BUG)/(QUIRK) test to a finding.

Let me also double-check the claim "2022-07-01 is under-billed in every band": 2021 fees are lower than 2022 everywhere: S 13500<15000 ✓, C 24000<26500 ✓, E 19500<21500 ✓, A 32500<36000 ✓ (band 1); band 4: 44500<49000, 73000<80500, 64500<71000, 99000<109000 ✓. And urgency pct 15<18 ✓. So yes, strictly under-billed. Max base delta: APPEAL b4 109000−99000=10000c=$100.

BUG-2 example numbers: 2022 COMMERCIAL b3 53500, 18% → 9630c = $96.30. ✓

QUIRK-2 example: 2.5 → total NaN → null in JSON. ✓

QUIRK-3 delta: compound extra = expeditedPct × urgencyFee = 10% × 2775 = 277.5 → rounded in context; total with compounding 23403 vs without 21275+1850=23125; delta 278c. ✓

Now — formatting requirements: level-3 heading with only the repo-relative path, followed by one fenced block with the file's content. Nothing outside the pattern is read; keep prose to nothing. "Prose between blocks is ignored, so keep it to nothing." — I'll output just the two headings + blocks.

Files:
1. `test/fee-calculator.spec.ts`
2. `FINDINGS.md`

Order: probably FINDINGS.md first or the test first — either. I'll go with FINDINGS.md, then the test? The task says "Deliver: suite + FINDINGS.md." Either order is fine. I'll put the suite first, FINDINGS second.

Now, let me write the complete test file, double-checking all expected numbers and TS strictness.

One TS concern: `for (const table of ['2019','2021','2022'] as const)` — table: '2019'|'2021'|'2022' ✓. `BASE_FEES[table]` ✓. `TABLE_OPENED_AT[table]` ✓.

`Object.entries(BASE_FEES[table])` returns [string, [number,number,number,number]][] ✓.

In the matrix test, the expected object literal: `{ table, bandFee: expected, urgencyFee: 0, expeditedFee: 0, total: expected }` — `table` is a literal union ✓ matching FeeBreakdown.table.

toEqual with an exact object: the actual has exactly 5 keys ✓.

Now, `input({ type, complexity: band, openedAt: TABLE_OPENED_AT[table] })` — type is `string` (from Object.entries) ✓.

Complexity NaN test: `input({ complexity: NaN })` — the type allows number ✓.

Infinity: ✓ number.

The `bare as CaseInput` assertion — I determined it's allowed. Re-check TS assertion rules: an assertion S as T is allowed if S is assignable to T, or T is assignable to S (ignoring some checks). S = { type: string; openedAt: string } (the widened literal type). T = CaseInput. Is T assignable to S? T has type: string ✓, openedAt: string ✓, plus others — extra properties are fine in assignability. So T → S holds → assertion allowed. ✓

The null test: `input({ complexity: null })` ✓ (type is number|null).

Now, daysBetween sanity for the 2021 urgency: now '2021-06-20', deadline '2021-06-27' → 7 ✓. openedAt '2021-06-15' → 2021 table ✓.

2022: now '2023-03-10', deadline '2023-03-17' → 7 ✓; openedAt '2023-03-01' → '2023-03-01' > '2022-07-01' → 2022 ✓.

now-independence: openedAt '2020-01-15' → 2019; now '2024-05-01', deadline '2024-05-07' → 6 days ≤7 → urgency 15% of 18500 (b2) = 2775; total 21275 ✓.

8-day edge: '2020-06-10' → '2020-06-18' = 8 ✓ no urgency.

Same day: 0 ✓ urgency.

Past: '2023-03-10' → '2023-02-25': from Feb 25 to Mar 10: Feb has 28 days in 2023 → Feb 25→28 is 3 days, +10 = 13 → −13 ✓.

Extreme: '2023-03-10' → '2020-01-01' is a large negative ✓.

Rounding .5: 21275*10/100 = exactly 2127.5? 21275*10 = 212750; /100 = 2127.5 ✓. Floating point: is 2127.5 exactly representable? 2127.5 = 2127 + 0.5, yes binary-exact (0.5 = 2^-1). Math.round(2127.5) = 2128 ✓.

Rounding .6: 42480*12 = 509760; /100 = 5097.6. In floating point, 509760/100: is 5097.6 non-terminating in binary? 0.6 is not binary-terminating. 509760/100 in FP: 5097.6 ≈ 5097.6000000000003638 or ...996? Let me think: 509760/100 = 5097.6. IEEE division produces the correctly-rounded result of the real value 5097.6 → the double nearest to 5097.6, which could be slightly above or below. Math.round returns 5098 either way (since it's not near an integer boundary — 5097.6 is 0.6 from 5097, 0.4 from 5098; the FP error is ~1e-13). Safe ✓.

Also 2775: 18500*15 = 277500 /100 = exactly 2775 ✓. 4875: 32500*15=487500/100 ✓. 9630: 53500*18=963000/100 ✓. 6375: 42500*15=637500/100 ✓. 5865: 48875*12=586500/100 ✓ (48875*12: 48875*10=488750, *2=97750, sum 586500 ✓). 6480: 36000*18=648000/100 ✓. 1200: 12000*10=120000/100 ✓. 1620: 13500*12=162000/100 ✓. 3900: 32500*12=390000/100 ✓.

Totals:
- 18500+2775=21275 ✓
- 21275+2128=23403 ✓
- 32500+4875=37375 ✓
- 53500+9630=63130 ✓
- 42500+6375+5865=54740 ✓ (42500+6375=48875; +5865=54740)
- 36000+6480+5098=47578 ✓ (36000+6480=42480; +5098=47578)
- 12000+1200=13200 ✓
- 13500+1620=15120 ✓
- 32500+3900=36400 ✓

All good.

Now, one more consideration: the task says "urgency multipliers" — covered per table. "Rate table date boundaries (inclusive/exclusive edges on both transitions)" — covered: 2021 transition lower edge (2020-12-31/2021-01-01/2021-01-02) and 2022 transition edge (2022-06-30/2022-07-01/2022-07-02) ✓. "Rounding at each step" ✓. "Degenerate inputs (zero, negative, unknown case type)" ✓.

Test count is fine.

Let me write the final test file text. I'll keep the comments concise, in English.

One more detail: the file's top comment should note it's a characterization suite. Also, I might assert `expect(r.table).toBe(...)` inside the matrix via toEqual — done.

Also, the suite must not depend on statusResolver or NestJS — correct, it's a plain module. The repo conventions mention NestJS/Prisma, but this fixture is a standalone module; the task is a suite + FINDINGS only. No Prisma/Nest files needed. The conventions block is generic; the deliverable is defined by the task. I won't create a Nest module (not asked).

Vitest imports: `import { describe, expect, it } from 'vitest';` — standard.

Now, FINDINGS.md — I'll write it complete. I'll keep the table of contents short. Include the exact JSON of the reproducing input and output.

Let me draft:

```md
# FINDINGS — `feeCalculator.ts` characterization

Companion to `test/fee-calculator.spec.ts`. The suite pins the module's
current behavior exactly, quirks included. Every test name prefixed
`(BUG)` or `(QUIRK)` maps to a finding below.

Constraints honoured: production code untouched; the only injection point
is the existing optional `now` parameter; the suite is fully deterministic
(no real dates, no randomness — every clock-sensitive call passes an
explicit `now`).

## BUG-1 — Case opened exactly on 2022-07-01 is billed on the 2021 table

**Where:** `tableFor()` — `openedAt >= REVISION_2021` (inclusive) but
`openedAt > REVISION_2022` (strict).

**Reproducing input:**
```ts
{ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }  // now irrelevant
```
**Actual output:** `{ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }`
**Intended (per the header comment "2022-07: rate revision (see RATE_TABLE_2022)"):** table `'2022'`, bandFee `15000`.

**Blast radius:** every case opened on 2022-07-01 (one day) was billed at
2021 rates — under-billed in every band (STANDARD band 1: -$15.00, up to
APPEAL band 4: -$100.00 base), and urgent cases also lost the 15% -> 18%
urgency bump. Stored, audited historical fees for that day contradict the
published rate schedule.

**Proposed fix (not applied):** use `openedAt >= REVISION_2022`. Requires
billing sign-off plus a reconciliation of the affected day before it ships.

...
```

Then BUG-2, QUIRK-1..5, note. Also a final section "Pinned as-is (intended behavior, no change proposed)": band clamping, pre-2019 → 2019, 7-day inclusive edge, 2021 inclusive lower bound, Math.round half-up, no urgency without a deadline.

Hmm — "no urgency without a deadline" is intended. OK.

Let me make sure the test name in the suite exactly matches the referenced finding ID. I'll use labels like `(BUG-1)`, `(BUG-2)`, `(QUIRK-1)`... in test names. That's cleaner than a bare (BUG). Yes, I'll do that.

Final test file:

```ts
// Characterization suite for feeCalculator.ts (in production since 2019).
//
// Pins CURRENT behavior exactly, quirks included, so the planned modification
// has a regression baseline. Test names flagged (BUG-n)/(QUIRK-n) map 1:1 to
// FINDINGS.md; the fixes documented there are NOT applied here.
//
// Determinism: no real dates, no randomness. Every clock-sensitive call
// injects an explicit `now` (the module's existing optional parameter).
// Production code is untouched.

import { describe, expect, it } from 'vitest';
import { calculateFee, type CaseInput } from '../feeCalculator';

type TableName = '2019' | '2021' | '2022';

// Expected base fees per table, copied as the pinned contract (cents).
const BASE_FEES: Record<TableName, Record<string, [number, number, number, number]>> = {
  '2019': {
    STANDARD: [12000, 18500, 27000, 41000],
    COMMERCIAL: [22000, 31500, 45000, 68000],
    ESTATE: [18000, 26000, 39500, 60000],
    APPEAL: [30000, 42000, 61000, 92000],
  },
  '2021': {
    STANDARD: [13500, 20500, 29500, 44500],
    COMMERCIAL: [24000, 34000, 48500, 73000],
    ESTATE: [19500, 28000, 42500, 64500],
    APPEAL: [32500, 45500, 66000, 99000],
  },
  '2022': {
    STANDARD: [15000, 22500, 32500, 49000],
    COMMERCIAL: [26500, 37500, 53500, 80500],
    ESTATE: [21500, 31000, 47000, 71000],
    APPEAL: [36000, 50000, 72500, 109000],
  },
};

// Non-boundary opening date per table, used to exercise one table at a time.
const TABLE_OPENED_AT: Record<TableName, string> = {
  '2019': '2020-06-15',
  '2021': '2021-06-15',
  '2022': '2023-03-01',
};

function input(overrides: Partial<CaseInput> = {}): CaseInput {
  return { type: 'STANDARD', complexity: 1, openedAt: '2020-01-15', ...overrides };
}

function plain(table: TableName, bandFee: number) {
  return { table, bandFee, urgencyFee: 0, expeditedFee: 0, total: bandFee };
}
```

Then the describes. Let me write them all out:

```ts
describe('base fee: every case type x complexity band in every rate table', () => {
  for (const table of ['2019', '2021', '2022'] as const) {
    for (const [type, bands] of Object.entries(BASE_FEES[table])) {
      for (let band = 1; band <= 4; band += 1) {
        const expected = bands[band - 1];
        it(`${table} table / ${type} / band ${band} -> ${expected}c`, () => {
          const r = calculateFee(
            input({ type, complexity: band, openedAt: TABLE_OPENED_AT[table] }),
            '2024-01-15',
          );
          expect(r).toEqual(plain(table, expected));
        });
      }
    }
  }
});
```

Boundaries:

```ts
describe('rate table selection: opening-date boundaries (STANDARD band 1 probe: 12000/13500/15000c)', () => {
  const probe = (openedAt: string) =>
    calculateFee(input({ type: 'STANDARD', complexity: 1, openedAt }), '2024-01-15');

  it('opened before 2019 still gets the 2019 table (no lower bound)', () => {
    expect(probe('2018-06-15')).toEqual(plain('2019', 12000));
  });

  it('2019-01-01 -> 2019 table', () => {
    expect(probe('2019-01-01')).toEqual(plain('2019', 12000));
  });

  it('2020-12-31 -> 2019 table', () => {
    expect(probe('2020-12-31')).toEqual(plain('2019', 12000));
  });

  it('2021-01-01 (2021 transition, lower edge) -> 2021 table, edge is INCLUSIVE', () => {
    expect(probe('2021-01-01')).toEqual(plain('2021', 13500));
  });

  it('2021-01-02 -> 2021 table', () => {
    expect(probe('2021-01-02')).toEqual(plain('2021', 13500));
  });

  it('2022-06-30 (2022 transition, day before) -> 2021 table', () => {
    expect(probe('2022-06-30')).toEqual(plain('2021', 13500));
  });

  it('(BUG-1) 2022-07-01 (2022 transition, boundary day) -> 2021 table, edge is EXCLUSIVE', () => {
    expect(probe('2022-07-01')).toEqual(plain('2021', 13500));
  });

  it('2022-07-02 (day after the boundary) -> 2022 table', () => {
    expect(probe('2022-07-02')).toEqual(plain('2022', 15000));
  });

  it('2024-12-31 -> 2022 table', () => {
    expect(probe('2024-12-31')).toEqual(plain('2022', 15000));
  });

  it('(QUIRK-4) a datetime string for the boundary moment selects a different table than the date-only string', () => {
    // Lexicographic compare: '2022-07-01T00:00:00Z' > '2022-07-01'.
    expect(probe('2022-07-01T00:00:00Z')).toEqual(plain('2022', 15000));
    expect(probe('2022-07-01')).toEqual(plain('2021', 13500));
  });
});
```

Urgency:

```ts
describe('urgency surcharge: deadline within 7 days of the injected `now`', () => {
  it('2019 table (+15%): deadline exactly 7 days out applies (inclusive edge)', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17' }),
      '2020-06-10',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 0, total: 21275 });
  });

  it('2019 table: deadline 8 days out does NOT apply (exclusive edge)', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-18' }),
      '2020-06-10',
    );
    expect(r).toEqual(plain('2019', 18500));
  });

  it('2019 table: deadline on the same day as `now` (0 days) applies', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-10' }),
      '2020-06-10',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 0, total: 21275 });
  });

  it('2021 table (+15%): deadline 7 days out applies', () => {
    const r = calculateFee(
      input({ type: 'APPEAL', complexity: 1, openedAt: '2021-06-15', deadline: '2021-06-27' }),
      '2021-06-20',
    );
    expect(r).toEqual({ table: '2021', bandFee: 32500, urgencyFee: 4875, expeditedFee: 0, total: 37375 });
  });

  it('2022 table (+18%: the 2022 revision raised the urgency pct): deadline 7 days out applies', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-03-17' }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 });
  });

  it('2022 table: deadline 8 days out does NOT apply', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-03-18' }),
      '2023-03-10',
    );
    expect(r).toEqual(plain('2022', 53500));
  });

  it('no deadline -> no surcharge', () => {
    const r = calculateFee(input({ complexity: 2, openedAt: '2020-01-15' }), '2020-06-10');
    expect(r).toEqual(plain('2019', 18500));
  });

  it('(QUIRK-5? no...) empty-string deadline behaves like no deadline', () => {
```

Hmm, I was planning QUIRK IDs. Let me settle on the numbering for the findings:

- BUG-1: 2022-07-01 off-by-one.
- BUG-2: past-deadline urgency.
- QUIRK-1: unknown type → silent STANDARD.
- QUIRK-2: fractional/NaN complexity (NaN fee, silent band-1).
- QUIRK-3: expedited compounding + per-step rounding.
- QUIRK-4: lexicographic date compare (datetime string).
- QUIRK-5: real-clock fallback for `now`.
- QUIRK-6? empty-string deadline falsy — fold into QUIRK-5? No — fold the empty-string deadline into QUIRK-2? It's an "input falsiness" family... I'll make it its own QUIRK-6 (falsy deadline). Actually, let me keep the findings concise: 2 BUGs + 6 QUIRKs + 1 note. That works.

- QUIRK-6: empty-string deadline is falsy → no urgency.

Also, clamping (0/negative→1, >4→4) — I'll classify as "pinned as-is, likely intended", and not as a finding; the test names will be plain. Same for pre-2019 → 2019 (no lower bound) — I earlier named it a quirk in the boundary describe; I'll keep the plain name "opened before 2019 still gets the 2019 table (no lower bound)" and list it in the "pinned as-is" section. Good.

Continuing the tests:

```ts
  it('(QUIRK-6) empty-string deadline is falsy -> no surcharge', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '' }),
      '2020-06-10',
    );
    expect(r).toEqual(plain('2019', 18500));
  });

  it('(BUG-2) deadline 13 days in the PAST still earns the surcharge (days <= 7 is true for negatives)', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-02-25' }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 });
  });

  it('(BUG-2) a deadline years in the past still earns the surcharge', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2020-01-01' }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 });
  });

  it('`now` moves the urgency window but never the rate table (table follows openedAt)', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2024-05-07' }),
      '2024-05-01',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 0, total: 21275 });
  });
```

Expedited:

```ts
describe('expedited surcharge (pct of band fee when not urgent)', () => {
  it('2019 table: +10%', () => {
    const r = calculateFee(input({ complexity: 1, openedAt: '2020-01-15', expedited: true }), '2024-01-15');
    expect(r).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 1200, total: 13200 });
  });

  it('2021 table: +12%', () => {
    const r = calculateFee(
      input({ complexity: 1, openedAt: '2021-06-15', expedited: true }),
      '2024-01-15',
    );
    expect(r).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120 });
  });

  it('2022 table: +12%', () => {
    const r = calculateFee(
      input({ complexity: 3, openedAt: '2023-03-01', expedited: true }),
      '2024-01-15',
    );
    expect(r).toEqual({ table: '2022', bandFee: 32500, urgencyFee: 0, expeditedFee: 3900, total: 36400 });
  });

  it('expedited: false is the same as omitting it', () => {
    const r = calculateFee(input({ complexity: 1, openedAt: '2020-01-15', expedited: false }), '2024-01-15');
    expect(r).toEqual(plain('2019', 12000));
  });
});
```

Rounding + compounding:

```ts
describe('rounding per step (Math.round, half up) and expedited base', () => {
  it('(QUIRK-3) urgent + expedited: 10% of (18500 + 2775) = 2127.5c rounds UP to 2128c', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17', expedited: true }),
      '2020-06-10',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 });
  });

  it('(QUIRK-3) urgent + expedited (2022): 12% of (36000 + 6480) = 5097.6c rounds to 5098c', () => {
    const r = calculateFee(
      input({ type: 'APPEAL', complexity: 1, openedAt: '2023-03-01', deadline: '2023-03-17', expedited: true }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 36000, urgencyFee: 6480, expeditedFee: 5098, total: 47578 });
  });

  it('(QUIRK-3) the expedited base INCLUDES the urgency fee (compounding): 2128c, not 1850c (10% of band fee only)', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17', expedited: true }),
      '2020-06-10',
    );
    expect(r.expeditedFee).toBe(Math.round((18500 + 2775) * 10 / 100)); // 2128
    expect(r.expeditedFee).not.toBe(Math.round(18500 * 10 / 100));       // not 1850
    expect(r.urgencyFee).toBe(2775); // urgency step exact here; per-step rounding pins the pipeline
    expect(r.total).toBe(18500 + 2775 + 2128);
  });

  it('expedited fee is computed on the already-rounded urgency fee (2021, exact values)', () => {
    const r = calculateFee(
      input({ type: 'ESTATE', complexity: 3, openedAt: '2021-06-15', deadline: '2021-06-27', expedited: true }),
      '2021-06-20',
    );
    expect(r).toEqual({ table: '2021', bandFee: 42500, urgencyFee: 6375, expeditedFee: 5865, total: 54740 });
  });
});
```

Complexity:

```ts
describe('complexity: required, clamped to bands 1..4', () => {
  it('complexity 0 clamps to band 1', () => {
    expect(calculateFee(input({ complexity: 0 }), '2024-01-15')).toEqual(plain('2019', 12000));
  });

  it('complexity -1 clamps to band 1', () => {
    expect(calculateFee(input({ complexity: -1 }), '2024-01-15')).toEqual(plain('2019', 12000));
  });

  it('complexity -42 clamps to band 1', () => {
    expect(calculateFee(input({ complexity: -42 }), '2024-01-15')).toEqual(plain('2019', 12000));
  });

  it('complexity 5 clamps to band 4', () => {
    expect(calculateFee(input({ complexity: 5 }), '2024-01-15')).toEqual(plain('2019', 41000));
  });

  it('complexity 100 clamps to band 4', () => {
    expect(calculateFee(input({ complexity: 100 }), '2024-01-15')).toEqual(plain('2019', 41000));
  });

  it('Infinity clamps to band 4', () => {
    expect(calculateFee(input({ complexity: Infinity }), '2024-01-15')).toEqual(plain('2019', 41000));
  });

  it('null throws "complexity is required"', () => {
    expect(() => calculateFee(input({ complexity: null }), '2024-01-15')).toThrow('complexity is required');
  });

  it('missing (undefined) complexity throws "complexity is required"', () => {
    const bare = { type: 'STANDARD', openedAt: '2020-01-15' };
    expect(() => calculateFee(bare as CaseInput, '2024-01-15')).toThrow('complexity is required');
  });

  it('(QUIRK-2) fractional complexity 2.5 escapes the band guard -> undefined band fee, NaN total', () => {
    const r = calculateFee(input({ complexity: 2.5 }), '2024-01-15');
    expect(r.table).toBe('2019');
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(r.total).toBeNaN();
  });

  it('(QUIRK-2) fractional complexity 2.5 with expedited propagates NaN into expeditedFee', () => {
    const r = calculateFee(input({ complexity: 2.5, expedited: true }), '2024-01-15');
    expect(r.expeditedFee).toBeNaN();
    expect(r.total).toBeNaN();
  });

  it('(QUIRK-2) NaN complexity is silently treated as band 1 (no error)', () => {
    expect(calculateFee(input({ complexity: NaN }), '2024-01-15')).toEqual(plain('2019', 12000));
  });
});
```

Wait — `input({ complexity: NaN })` — but `input` merges `{...defaults, ...overrides}`; complexity NaN is fine.

Hmm, one issue: `expect(...).toEqual(plain('2019', 12000))` — plain returns {table, bandFee, urgencyFee, expeditedFee, total} — a full object ✓.

Unknown type:

```ts
describe('case type: silent fallback to STANDARD for unrecognized types', () => {
  it('(QUIRK-1) unknown type "BANKRUPTCY" is billed at STANDARD rates (2019, band 2)', () => {
    const r = calculateFee(input({ type: 'BANKRUPTCY', complexity: 2, openedAt: '2020-01-15' }), '2024-01-15');
    expect(r).toEqual(plain('2019', 18500));
  });

  it('(QUIRK-1) lookup is case-sensitive: "standard" (lowercase) falls back to STANDARD (2022, band 4)', () => {
    const r = calculateFee(input({ type: 'standard', complexity: 4, openedAt: '2023-03-01' }), '2024-01-15');
    expect(r).toEqual(plain('2022', 49000));
  });

  it('(QUIRK-1) empty-string type falls back to STANDARD (2021, band 1)', () => {
    const r = calculateFee(input({ type: '', complexity: 1, openedAt: '2021-06-15' }), '2024-01-15');
    expect(r).toEqual(plain('2021', 13500));
  });

  it('contrast: a known type uses its own column (COMMERCIAL band 2, 2019 -> 31500c, not STANDARD 18500c)', () => {
    const r = calculateFee(input({ type: 'COMMERCIAL', complexity: 2, openedAt: '2020-01-15' }), '2024-01-15');
    expect(r).toEqual(plain('2019', 31500));
  });
});
```

Also, unknown type + urgency: the fallback band still gets the table's urgencyPct — covered conceptually; skip.

I think the suite is complete and rich. Total tests ≈ 48 + 10 + 11 + 4 + 4 + 11 + 4 = 92.

Now, let me double-check `input({ type: '' ...})` — Partial allows `type: ''` ✓.

TS: `Object.entries(BASE_FEES[table])` — BASE_FEES[table]: Record<string, [number, number, number, number]>. entries: [string, [number,number,number,number]][] ✓. `bands[band - 1]`: index a 4-tuple with number → number ✓ (union of element types).

`plain(table, expected)` — table: '2019'|'2021'|'2022' ✓.

In the boundary describe, `probe` returns FeeBreakdown; toEqual with plain object ✓.

Potential lint: unused import CaseInput? I use it in `bare as CaseInput` and in the input() signature ✓.

Now, one more consideration: the `input` helper defaults `openedAt: '2020-01-15'` → 2019 table; complexity 1; type STANDARD. Most overrides set what they need. For the "no deadline" urgency test, I pass complexity 2, openedAt '2020-01-15' — fine.

Re-check the 'now' parameter name — the function signature `calculateFee(c: CaseInput, now?: string)` ✓.

Now, I'll write FINDINGS.md fully:

I'll include a mapping table: finding → test name (short). I'll also include the constraint statement. Let me write it.

Also mention: the suite never omits `now` on clock-sensitive calls; the `new Date()` fallback is intentionally not exercised (it would be nondeterministic), per the task.

Also note in FINDINGS: "production code untouched — no changes to feeCalculator.ts in this change."

Now, the final format: two files:

### FINDINGS.md
```md
...
```

### test/fee-calculator.spec.ts
```ts
...
```

Order: test first? Either. I'll go with FINDINGS.md first, then the suite. Actually, "Deliver: suite + FINDINGS.md" — suite first. Fine: test file first, then FINDINGS.

Hmm, "nothing outside the pattern is read" — so I must not add prose outside the headings/blocks. I'll start directly with the first `###`.

Let me finalize the FINDINGS.md text:

```md
# FINDINGS — `feeCalculator.ts` (characterization)

Companion to `test/fee-calculator.spec.ts`, which pins the module's current
behavior exactly, quirks included. Test names flagged `(BUG-n)` / `(QUIRK-n)`
map 1:1 to the entries below.

**Constraints honoured**
- Production code untouched: `feeCalculator.ts` is byte-identical.
- The fake clock is injected ONLY through the module's existing optional
  `now` parameter; the suite never omits `now` on clock-sensitive calls.
- Fully deterministic: no real dates, no randomness.
- The fixes below are **proposals only — none are applied.**

## BUG-1 — Cases opened exactly on 2022-07-01 are billed on the 2021 table

**Where.** `tableFor()`: the 2021 transition uses `openedAt >= REVISION_2021`
(inclusive) but the 2022 transition uses `openedAt > REVISION_2022` (strict).

**Reproducing input / output.**
```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' })
// -> { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }
```
The module header says `2022-07: rate revision (see RATE_TABLE_2022)`, i.e. the
2022 table (`bandFee: 15000`) was supposed to take effect on that day.

**Blast radius.** Every case opened on 2022-07-01 (one day) was billed at 2021
rates: under-billed in all 16 type×band cells (STANDARD band 1: -$15.00, up to
APPEAL band 4: -$100.00 on the base fee), and urgent cases additionally lost
the 15% -> 18% urgency bump introduced by the same revision. Stored, audited
historical fees for that day contradict the published rate schedule.

**Proposed fix (not applied).** `if (openedAt >= REVISION_2022)`. Requires
billing sign-off and a reconciliation of the affected day before shipping,
because it changes billed amounts.

## BUG-2 — The urgency surcharge applies when the deadline has already passed

**Where.** `daysBetween(ref, c.deadline) <= 7` is also true for negative day
counts (deadline in the past).

**Reproducing input / output.**
```ts
calculateFee(
  { type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-02-25' },
  '2023-03-10', // deadline 13 days in the past
)
// -> { table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 }
```
Intended reading: urgency = deadline within the next 0..7 days.

**Blast radius.** Any recomputation of a case whose deadline had already
passed at calculation time (audit reruns, corrections, rebilling) is inflated
by 15–18% of the band fee, plus compounded expedited on top. If billing ever
ran stored cases through this path with a late `now`, those historical outputs
are overstated. Combined with QUIRK-5, urgency silently depends on when the
fee is (re)calculated.

**Proposed fix (not applied).**
`const days = daysBetween(ref, c.deadline); if (days >= 0 && days <= 7) { ... }`

## QUIRK-1 — Unknown or misspelled case type silently falls back to STANDARD

**Where.** `if (!bands) bands = table.base['STANDARD'];` — the lookup is
case-sensitive, so `'standard'`, `'Commercial'`, whitespace variants, etc.,
all fall back.

**Reproducing input / output.**
```ts
calculateFee({ type: 'BANKRUPTCY', complexity: 2, openedAt: '2020-01-15' })
// -> { table: '2019', bandFee: 18500, ... } // STANDARD band 2, not an error
```

**Blast radius.** Legacy imports with bad type strings are silently under- or
over-billed with no error and no log. Example: a COMMERCIAL case recorded as
`'commercial'` pays the STANDARD band (2019 band 1: $120.00 instead of
$220.00) — invisible in audits.

**Proposed fix (not applied).** Throw on an unrecognized type (or, if the
old-system casing is known, an explicit legacy-alias map), plus an alert on
fallback.

## QUIRK-2 — Non-integer complexity escapes the band guard (NaN fee) or is silently coerced

**Where.** The guard handles `!band || band < 1` and `band > 4`, but not
non-integers: `bands[2.5 - 1]` reads index `1.5` -> `undefined`. Separately,
`NaN` is caught by `!band` and silently becomes band 1.

**Reproducing input / output.**
```ts
calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2020-01-15' })
// -> { table: '2019', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
calculateFee({ type: 'STANDARD', complexity: NaN, openedAt: '2020-01-15' })
// -> band 1 fee (12000), no error
```

**Blast radius.** `JSON.stringify(NaN)` is `null`: a single corrupted or
legacy fractional complexity writes a **null fee** into billing exports, and
any sum that includes the NaN poisons to NaN. The NaN-complexity path is
quieter: an intended band 3/4 is silently billed at band 1.

**Proposed fix (not applied).**
`if (!Number.isInteger(c.complexity) || c.complexity < 1 || c.complexity > 4) throw ...`
(reject, or clamp deliberately with a log — billing to decide).

## QUIRK-3 — Expedited surcharge compounds on (bandFee + urgencyFee); rounding is per-step, half-up

**Where.** `expeditedFee = pctOf(bandFee + urgencyFee, table.expeditedPct)`
with `pctOf = Math.round`. The comment "percent added when expedited" never
says whether the urgency fee is part of the base — the code includes it.

**Reproducing input / output.**
```ts
calculateFee(
  { type: 'STANDARD', complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17', expedited: true },
  '2020-06-10',
)
// bandFee 18500, urgencyFee 2775, then 10% of 21275 = 2127.5 -> 2128, total 23403
```
Without compounding the expedited fee would be 1850 and the total 23125.

**Blast radius.** Every urgent+expedited case in the stored history carries
the compounding and the per-step half-up rounding. Any "correction" re-prices
a large slice of historical fees; any re-implementation that rounds at a
different step (or uses a different rounding mode) will show unexplained
deltas against audited outputs. Note: with the current tables all band fees
are whole dollars, so only the expedited step actually rounds today — a future
sub-dollar table would make the urgency step round too.

**Proposed fix (not applied).** Billing to confirm the intended base; if
compounding is wrong, a reconciliation report over stored fees before any
rebilling.

## QUIRK-4 — Rate-table selection is a lexicographic string compare on `openedAt`

**Where.** `tableFor()` compares date strings directly. Correct for canonical
`YYYY-MM-DD`, wrong for other ISO spellings.

**Reproducing input / output.**
```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' })           // table '2021', 13500
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01T00:00:00Z' }) // table '2022', 15000
```
Same moment, different table, because `'2022-07-01T00:00:00Z' > '2022-07-01'`
as strings.

**Blast radius.** Any caller passing a datetime (the field comment says
"ISO date", and ISO also covers datetimes) silently switches rate tables
around the revision boundaries — including interacting with BUG-1 at the
2022-07-01 boundary.

**Proposed fix (not applied).** Normalize/validate `openedAt` to
`YYYY-MM-DD` at the entry point (or compare parsed dates).

## QUIRK-5 — `now` falls back to the real clock when omitted

**Where.** `const ref = now ? now : new Date().toISOString().slice(0, 10);`

**Behavior pinned.** The suite always injects `now`; the fallback is not
exercised (it is inherently non-deterministic). As written, the urgency fee of
a stored case depends on when the fee is (re)calculated, and a deadline aging
into the past flips the fee into the BUG-2 regime.

**Proposed fix (not applied).** Make the reference date an explicit,
required argument (or always pass it from the caller's transaction time).

## QUIRK-6 — Empty-string deadline is treated as "no deadline"

**Where.** `if (c.deadline && ...)` — any falsy deadline (`''`) skips the
urgency check.

**Reproducing input / output.**
```ts
calculateFee(
  { type: 'STANDARD', complexity: 2, openedAt: '2020-01-15', deadline: '' },
  '2020-06-10',
)
// -> urgencyFee 0 (no surcharge)
```

**Blast radius.** A case that truly had a near deadline but an empty string
recorded for it is billed without the urgency surcharge. Low likelihood,
silent, and un-auditable.

**Proposed fix (not applied).** Treat `deadline === ''` as invalid input
(reject or normalize upstream) rather than as absent.

## Note — header provenance mismatch (unresolved)

The header says `2020-03: added URGENT tier after the Silva case`, but
`CaseType` has no URGENT member and no table carries URGENT-specific rates;
urgency is modeled purely as deadline proximity. The comment and the code do
not describe the same feature — flag to billing before any restructuring;
the suite pins what the code actually does.

## Pinned as-is (assumed intended, no change proposed)

- Band clamping: `complexity` 0 / negative -> band 1; > 4 -> band 4.
- Opening dates before 2019 still select the 2019 table (no lower bound).
- 2021 transition lower edge inclusive (`2021-01-01` -> 2021 table).
- Urgency window inclusive at 7 days (`days <= 7`), 0 days included.
- `total` is the plain sum of the three parts — no final rounding step.
```

Wait — check "16 type×band cells" — 4 types × 4 bands = 16 ✓.

Also in BUG-1 I say "urgent cases additionally lost the 15% -> 18% urgency bump" ✓.

Now, verify the test file compiles in my head with strict TS:

- `import { calculateFee, type CaseInput } from '../feeCalculator';` — inline type import, TS ≥4.5 ✓ (the Node 20 era toolchain is fine).
- `type TableName = '2019' | '2021' | '2022';`
- BASE_FEES is Record<TableName, Record<string, [number, number, number, number]>> — the object literal: keys are string literals, values are 4-tuples — inferred as number[]? I annotate the whole const, so the literals are contextually typed as tuples ✓.
- `for (const table of ['2019', '2021', '2022'] as const)` ✓.
- `Object.entries(BASE_FEES[table])` — BASE_FEES[table]: Record<string, [number, number, number, number]>. entries: [string, [number,number,number,number]][] ✓.
- `bands[band - 1]` — indexing a 4-tuple with a number → `number` ✓.
- `plain(table, expected)` ✓.
- `input(overrides: Partial<CaseInput> = {})` returns CaseInput: `{ type: 'STANDARD', complexity: 1, openedAt: '2020-01-15', ...overrides }` — spreading Partial<CaseInput> over the required fields: the resulting type — TS: spreading a partial that may set complexity to `number | null | undefined`... Hmm! `Partial<CaseInput>` has `complexity?: number | null`. Spreading that: the resulting complexity type is `number | null | undefined`? TS spread typing: `{ type: string; complexity: number; openedAt: string; deadline?: string; expedited?: boolean } & Partial<CaseInput>` — the resulting type of a spread where the later spread may overwrite: TS models the resulting property type as the union of both, but for optional properties in the later spread, the resulting type is... TS behavior: the resulting type of a spread of an optional property that may be `undefined` — since `Partial<CaseInput>`'s properties are optional (potentially absent), the resulting type of `complexity` is `number | null` (the union of `number` and `number|null` minus undefined?). Actually, when the later operand's property is optional, TS's spread typing: the resulting property type = (earlier type) | (later type without undefined)? Let me recall: `{ a: string } & { a?: string | null }` as a spread → TS gives `a: string | null`. I think TS handles optional spreads by treating "absent" as retaining the earlier value, so the resulting type = the union of the earlier and later types, with undefined dropped when the later is optional. In modern TS: `const x = { a: 1, ...{ a: undefined } as {a?: number} }` → type of a is `number | undefined`? Hmm, I've seen `number | undefined` for `{ a: 1, ...y }` where y: `{a?: number}`. Let me think carefully.

TS spread: for a spread of an object type where the property is optional, the resulting property is the union of the source's property types, with the later spread's property type including undefined only if the property can be explicitly undefined... The rule (from the TS handbook implementation): for each property, if the later spread's property is optional (not required), the resulting type is `earlierType | laterType` where laterType has undefined removed? I think in practice `const o = { complexity: 1, ...overrides }` with `overrides: Partial<CaseInput>` yields type `complexity: number | null` — because Partial makes it `complexity?: number | null`, and the spread result for an optional property is the union minus undefined...

Hmm, I'm not 100% sure. If TS yields `number | null | undefined`, the return type annotation `: CaseInput` will complain (undefined not assignable to number|null). To be safe, I'll type the overrides parameter as `Omit<CaseInput, 'complexity'> & { complexity?: number | null }`? Same problem. Alternative: avoid the annotation problem:

```ts
function input(overrides: Partial<CaseInput> = {}): CaseInput {
  const base: CaseInput = { type: 'STANDARD', complexity: 1, openedAt: '2020-01-15' };
  return { ...base, ...overrides };
}
```

Same spread issue.

Honestly, I recall now: TS's spread of an optional property: `{ a: number, ...p }` where p is `{ a?: number | null }` → resulting type is `number | null` (TS drops undefined from the union when the property is optional in the later operand — since TS 3.2's improved spread typing). Yes — the improved object spread types in TS 3.2 handle optional properties correctly: an optional property in the later operand does not add `undefined` to the union. I'm fairly confident the result is `number | null`. And for `deadline?: string` and `expedited?: boolean` — those are optional in both; fine.

So the return type checks. And in any case, Vitest doesn't typecheck, but I want it clean for the reviewer.

- `expect(() => calculateFee(input({ complexity: null }), '2024-01-15')).toThrow('complexity is required');` ✓.
- `bare as CaseInput` — allowed as established ✓.
- `input({ complexity: NaN })` ✓; `input({ complexity: Infinity })` ✓; `input({ complexity: 2.5 })` ✓.
- `input({ type: 'BANKRUPTCY', ... })` — type is `string` ✓.
- `expect(r.bandFee).toBeUndefined()` ✓; `.toBeNaN()` ✓.

One more: in the matrix describe, the test name template uses `expected` — fine.

Now, the `plain` helper's name doesn't shadow anything ✓.

Also, in the boundaries describe, the describe title contains the probe values — a bit long but informative.

All set. Let me also double-check the 2021 APPEAL b1 urgency: 32500 * 15 / 100 = 4875 ✓ total 37375 ✓.

And the 2022 C b3 8-day test: plain('2022', 53500) ✓.

Now, the final check on the "no second request" format: I output exactly:

### test/fee-calculator.spec.ts
```ts
...
```

### FINDINGS.md
```md
...
```

Wait — the path heading must be "only the repo-relative path". `test/fee-calculator.spec.ts` ✓. `FINDINGS.md` ✓.

Fenced blocks: the test is ```ts; FINDINGS is ```md. Good.

One more consideration on the test file location: the convention layout shows `test/<feature>.spec.ts` ✓.

Should I add a note in the test file header that it's the variant A deliverable? Not needed.

Let me also reconsider whether to assert `table` in the clamping tests — `plain('2019', 12000)` includes table ✓.

Also, the requirement "every case type × complexity band" — the matrix covers all 48. "Urgency multipliers" — 3 tables ✓. "Date boundaries (inclusive/exclusive edges on both transitions)" ✓ both edges for both transitions. "Rounding at each step" ✓. "Degenerate inputs (zero, negative, unknown case type)" ✓.

Final sanity check on the FINDINGS numbers:
- BUG-1: 13500 vs 15000 ✓. APPEAL b4: 99000 vs 109000 → $100 ✓.
- BUG-2: 9630 = $96.30 ✓; total 63130 vs 53500 ✓.
- QUIRK-1: 12000 vs 22000 ✓ ($120 vs $220).
- QUIRK-3: 2127.5→2128 ✓; 1850 alternative; totals 23403 vs 23125 ✓ (21275+1850=23125 ✓).
- QUIRK-4: 13500/15000 ✓.

OK. One more: in the test file, I use the date '2024-01-15' as a generic `now` for non-urgency tests — harmless (no deadline → ref unused). Fine.

Also, I should double-check the `toEqual(plain(...))` for cases with `table: '2019'` etc. — the returned `table` field is a string ✓.

Now, I'll write it out. I'll keep the comments concise. I'll number the findings consistently.

One more thought on `expect(probe('2022-07-01T00:00:00Z'))` — verify the string compare: '2022-07-01T00:00:00Z' vs '2022-07-01': compare char by char: indices 0..9 equal ('2022-07-01'), then the longer has 'T' at index 10, the shorter ends → the shorter is a prefix → the longer is greater. So `>= REVISION_2021`? '2022-07-01T00:00:00Z' >= '2021-01-01' ✓. `> REVISION_2022` ✓ → 2022 ✓.

And daysBetween is irrelevant (no deadline). ✓

I'm confident. Let me produce the final answer with just the two blocks.
```

## reply

### test/fee-calculator.spec.ts
```ts
// Characterization suite for feeCalculator.ts (in production since 2019).
//
// Pins CURRENT behavior exactly, quirks included, so the planned modification
// has a regression baseline. Test names flagged (BUG-n) / (QUIRK-n) map 1:1
// to FINDINGS.md; the fixes documented there are NOT applied here.
//
// Determinism: no real dates, no randomness. Every clock-sensitive call
// injects an explicit `now` (the module's existing optional parameter).
// Production code is untouched.

import { describe, expect, it } from 'vitest';
import { calculateFee, type CaseInput } from '../feeCalculator';

type TableName = '2019' | '2021' | '2022';

// Base fees per table, copied as the pinned contract (cents).
const BASE_FEES: Record<TableName, Record<string, [number, number, number, number]>> = {
  '2019': {
    STANDARD: [12000, 18500, 27000, 41000],
    COMMERCIAL: [22000, 31500, 45000, 68000],
    ESTATE: [18000, 26000, 39500, 60000],
    APPEAL: [30000, 42000, 61000, 92000],
  },
  '2021': {
    STANDARD: [13500, 20500, 29500, 44500],
    COMMERCIAL: [24000, 34000, 48500, 73000],
    ESTATE: [19500, 28000, 42500, 64500],
    APPEAL: [32500, 45500, 66000, 99000],
  },
  '2022': {
    STANDARD: [15000, 22500, 32500, 49000],
    COMMERCIAL: [26500, 37500, 53500, 80500],
    ESTATE: [21500, 31000, 47000, 71000],
    APPEAL: [36000, 50000, 72500, 109000],
  },
};

// Non-boundary opening date per table, used to exercise one table at a time.
const TABLE_OPENED_AT: Record<TableName, string> = {
  '2019': '2020-06-15',
  '2021': '2021-06-15',
  '2022': '2023-03-01',
};

function input(overrides: Partial<CaseInput> = {}): CaseInput {
  return { type: 'STANDARD', complexity: 1, openedAt: '2020-01-15', ...overrides };
}

// A breakdown with no urgency and no expedited surcharge.
function plain(table: TableName, bandFee: number) {
  return { table, bandFee, urgencyFee: 0, expeditedFee: 0, total: bandFee };
}

describe('base fee: every case type x complexity band in every rate table', () => {
  for (const table of ['2019', '2021', '2022'] as const) {
    for (const [type, bands] of Object.entries(BASE_FEES[table])) {
      for (let band = 1; band <= 4; band += 1) {
        const expected = bands[band - 1];
        it(`${table} table / ${type} / band ${band} -> ${expected}c`, () => {
          const r = calculateFee(
            input({ type, complexity: band, openedAt: TABLE_OPENED_AT[table] }),
            '2024-01-15',
          );
          expect(r).toEqual(plain(table, expected));
        });
      }
    }
  }
});

describe('rate table selection: opening-date boundaries (STANDARD band 1 probe: 12000 / 13500 / 15000c)', () => {
  const probe = (openedAt: string) =>
    calculateFee(input({ type: 'STANDARD', complexity: 1, openedAt }), '2024-01-15');

  it('opened before 2019 still gets the 2019 table (no lower bound)', () => {
    expect(probe('2018-06-15')).toEqual(plain('2019', 12000));
  });

  it('2019-01-01 -> 2019 table', () => {
    expect(probe('2019-01-01')).toEqual(plain('2019', 12000));
  });

  it('2020-12-31 -> 2019 table', () => {
    expect(probe('2020-12-31')).toEqual(plain('2019', 12000));
  });

  it('2021-01-01 (2021 transition, lower edge) -> 2021 table: edge is INCLUSIVE', () => {
    expect(probe('2021-01-01')).toEqual(plain('2021', 13500));
  });

  it('2021-01-02 -> 2021 table', () => {
    expect(probe('2021-01-02')).toEqual(plain('2021', 13500));
  });

  it('2022-06-30 (day before the 2022 transition) -> 2021 table', () => {
    expect(probe('2022-06-30')).toEqual(plain('2021', 13500));
  });

  it('(BUG-1) 2022-07-01 (boundary day of the 2022 transition) -> 2021 table: edge is EXCLUSIVE', () => {
    expect(probe('2022-07-01')).toEqual(plain('2021', 13500));
  });

  it('2022-07-02 (day after the boundary) -> 2022 table', () => {
    expect(probe('2022-07-02')).toEqual(plain('2022', 15000));
  });

  it('2024-12-31 -> 2022 table', () => {
    expect(probe('2024-12-31')).toEqual(plain('2022', 15000));
  });

  it('(QUIRK-4) a datetime string for the boundary moment selects a different table than the date-only string', () => {
    // Lexicographic string compare: '2022-07-01T00:00:00Z' > '2022-07-01'.
    expect(probe('2022-07-01T00:00:00Z')).toEqual(plain('2022', 15000));
    expect(probe('2022-07-01')).toEqual(plain('2021', 13500));
  });
});

describe('urgency surcharge: deadline within 7 days of the injected `now`', () => {
  it('2019 table (+15%): deadline exactly 7 days out applies (inclusive edge)', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17' }),
      '2020-06-10',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 0, total: 21275 });
  });

  it('2019 table: deadline 8 days out does NOT apply (exclusive edge)', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-18' }),
      '2020-06-10',
    );
    expect(r).toEqual(plain('2019', 18500));
  });

  it('2019 table: deadline on the same day as `now` (0 days) applies', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-10' }),
      '2020-06-10',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 0, total: 21275 });
  });

  it('2021 table (+15%): deadline 7 days out applies', () => {
    const r = calculateFee(
      input({ type: 'APPEAL', complexity: 1, openedAt: '2021-06-15', deadline: '2021-06-27' }),
      '2021-06-20',
    );
    expect(r).toEqual({ table: '2021', bandFee: 32500, urgencyFee: 4875, expeditedFee: 0, total: 37375 });
  });

  it('2022 table (+18%: the 2022 revision raised the urgency pct too): deadline 7 days out applies', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-03-17' }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 });
  });

  it('2022 table: deadline 8 days out does NOT apply', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-03-18' }),
      '2023-03-10',
    );
    expect(r).toEqual(plain('2022', 53500));
  });

  it('no deadline -> no surcharge', () => {
    const r = calculateFee(input({ complexity: 2, openedAt: '2020-01-15' }), '2020-06-10');
    expect(r).toEqual(plain('2019', 18500));
  });

  it('(QUIRK-6) empty-string deadline is falsy -> no surcharge', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '' }),
      '2020-06-10',
    );
    expect(r).toEqual(plain('2019', 18500));
  });

  it('(BUG-2) a deadline 13 days in the PAST still earns the surcharge (days <= 7 is true for negatives)', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-02-25' }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 });
  });

  it('(BUG-2) a deadline years in the past still earns the surcharge', () => {
    const r = calculateFee(
      input({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2020-01-01' }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 });
  });

  it('`now` moves the urgency window but never the rate table (table follows openedAt)', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2024-05-07' }),
      '2024-05-01',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 0, total: 21275 });
  });
});

describe('expedited surcharge (pct of the band fee when not urgent)', () => {
  it('2019 table: +10%', () => {
    const r = calculateFee(input({ complexity: 1, openedAt: '2020-01-15', expedited: true }), '2024-01-15');
    expect(r).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 1200, total: 13200 });
  });

  it('2021 table: +12%', () => {
    const r = calculateFee(input({ complexity: 1, openedAt: '2021-06-15', expedited: true }), '2024-01-15');
    expect(r).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120 });
  });

  it('2022 table: +12%', () => {
    const r = calculateFee(input({ complexity: 3, openedAt: '2023-03-01', expedited: true }), '2024-01-15');
    expect(r).toEqual({ table: '2022', bandFee: 32500, urgencyFee: 0, expeditedFee: 3900, total: 36400 });
  });

  it('expedited: false is the same as omitting it', () => {
    const r = calculateFee(input({ complexity: 1, openedAt: '2020-01-15', expedited: false }), '2024-01-15');
    expect(r).toEqual(plain('2019', 12000));
  });
});

describe('rounding per step (Math.round, half up) and the expedited base', () => {
  it('(QUIRK-3) urgent + expedited: 10% of (18500 + 2775) = 2127.5c rounds UP to 2128c', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17', expedited: true }),
      '2020-06-10',
    );
    expect(r).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 });
  });

  it('(QUIRK-3) urgent + expedited (2022 table): 12% of (36000 + 6480) = 5097.6c rounds to 5098c', () => {
    const r = calculateFee(
      input({ type: 'APPEAL', complexity: 1, openedAt: '2023-03-01', deadline: '2023-03-17', expedited: true }),
      '2023-03-10',
    );
    expect(r).toEqual({ table: '2022', bandFee: 36000, urgencyFee: 6480, expeditedFee: 5098, total: 47578 });
  });

  it('(QUIRK-3) the expedited base INCLUDES the urgency fee (compounding): 2128c, not the 1850c a band-fee-only base would give', () => {
    const r = calculateFee(
      input({ complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17', expedited: true }),
      '2020-06-10',
    );
    expect(r.urgencyFee).toBe(2775); // urgency step is exact here; the per-step rounding is observable on the expedited step
    expect(r.expeditedFee).toBe(Math.round((18500 + 2775) * 10 / 100)); // 2128
    expect(r.expeditedFee).not.toBe(Math.round(18500 * 10 / 100)); // not 1850
    expect(r.total).toBe(18500 + 2775 + 2128);
  });

  it('expedited fee is computed on the already-rounded urgency fee (2021 table, exact values)', () => {
    const r = calculateFee(
      input({ type: 'ESTATE', complexity: 3, openedAt: '2021-06-15', deadline: '2021-06-27', expedited: true }),
      '2021-06-20',
    );
    expect(r).toEqual({ table: '2021', bandFee: 42500, urgencyFee: 6375, expeditedFee: 5865, total: 54740 });
  });
});

describe('complexity: required, clamped into bands 1..4', () => {
  it('complexity 0 clamps to band 1', () => {
    expect(calculateFee(input({ complexity: 0 }), '2024-01-15')).toEqual(plain('2019', 12000));
  });

  it('complexity -1 clamps to band 1', () => {
    expect(calculateFee(input({ complexity: -1 }), '2024-01-15')).toEqual(plain('2019', 12000));
  });

  it('complexity -42 clamps to band 1', () => {
    expect(calculateFee(input({ complexity: -42 }), '2024-01-15')).toEqual(plain('2019', 12000));
  });

  it('complexity 5 clamps to band 4', () => {
    expect(calculateFee(input({ complexity: 5 }), '2024-01-15')).toEqual(plain('2019', 41000));
  });

  it('complexity 100 clamps to band 4', () => {
    expect(calculateFee(input({ complexity: 100 }), '2024-01-15')).toEqual(plain('2019', 41000));
  });

  it('Infinity clamps to band 4', () => {
    expect(calculateFee(input({ complexity: Infinity }), '2024-01-15')).toEqual(plain('2019', 41000));
  });

  it('null throws "complexity is required"', () => {
    expect(() => calculateFee(input({ complexity: null }), '2024-01-15')).toThrow('complexity is required');
  });

  it('missing (undefined) complexity throws "complexity is required"', () => {
    // The declared type is number | null, but the code checks undefined too.
    const bare = { type: 'STANDARD', openedAt: '2020-01-15' };
    expect(() => calculateFee(bare as CaseInput, '2024-01-15')).toThrow('complexity is required');
  });

  it('(QUIRK-2) fractional complexity 2.5 escapes the band guard -> undefined band fee, NaN total', () => {
    const r = calculateFee(input({ complexity: 2.5 }), '2024-01-15');
    expect(r.table).toBe('2019');
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(0);
    expect(r.expeditedFee).toBe(0);
    expect(r.total).toBeNaN();
  });

  it('(QUIRK-2) fractional complexity 2.5 with expedited propagates NaN into expeditedFee', () => {
    const r = calculateFee(input({ complexity: 2.5, expedited: true }), '2024-01-15');
    expect(r.expeditedFee).toBeNaN();
    expect(r.total).toBeNaN();
  });

  it('(QUIRK-2) NaN complexity is silently treated as band 1 (no error)', () => {
    expect(calculateFee(input({ complexity: NaN }), '2024-01-15')).toEqual(plain('2019', 12000));
  });
});

describe('case type: silent fallback to STANDARD for unrecognized types', () => {
  it('(QUIRK-1) unknown type "BANKRUPTCY" is billed at STANDARD rates (2019 table, band 2)', () => {
    const r = calculateFee(input({ type: 'BANKRUPTCY', complexity: 2, openedAt: '2020-01-15' }), '2024-01-15');
    expect(r).toEqual(plain('2019', 18500));
  });

  it('(QUIRK-1) the lookup is case-sensitive: lowercase "standard" falls back to STANDARD (2022 table, band 4)', () => {
    const r = calculateFee(input({ type: 'standard', complexity: 4, openedAt: '2023-03-01' }), '2024-01-15');
    expect(r).toEqual(plain('2022', 49000));
  });

  it('(QUIRK-1) empty-string type falls back to STANDARD (2021 table, band 1)', () => {
    const r = calculateFee(input({ type: '', complexity: 1, openedAt: '2021-06-15' }), '2024-01-15');
    expect(r).toEqual(plain('2021', 13500));
  });

  it('contrast: a known type uses its own column (COMMERCIAL band 2, 2019 -> 31500c, not STANDARD 18500c)', () => {
    const r = calculateFee(input({ type: 'COMMERCIAL', complexity: 2, openedAt: '2020-01-15' }), '2024-01-15');
    expect(r).toEqual(plain('2019', 31500));
  });
});
```

### FINDINGS.md
```md
# FINDINGS — `feeCalculator.ts` (characterization)

Companion to `test/fee-calculator.spec.ts`, which pins the module's current
behavior exactly, quirks included. Test names flagged `(BUG-n)` / `(QUIRK-n)`
map 1:1 to the entries below.

**Constraints honoured**
- Production code untouched: `feeCalculator.ts` is unchanged.
- The fake clock is injected ONLY through the module's existing optional
  `now` parameter; the suite never omits `now` on clock-sensitive calls.
- Fully deterministic: no real dates, no randomness.
- The fixes below are **proposals only — none are applied.**

## BUG-1 — Cases opened exactly on 2022-07-01 are billed on the 2021 table

**Where.** `tableFor()`: the 2021 transition uses `openedAt >= REVISION_2021`
(inclusive) but the 2022 transition uses `openedAt > REVISION_2022` (strict).

**Reproducing input / output.**
```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' })
// -> { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }
```
The module header says `2022-07: rate revision (see RATE_TABLE_2022)`, i.e. the
2022 table (`bandFee: 15000`) was supposed to take effect on that day.

**Blast radius.** Every case opened on 2022-07-01 (one day) was billed at 2021
rates: under-billed in all 16 type×band cells (STANDARD band 1: -$15.00, up to
APPEAL band 4: -$100.00 on the base fee), and urgent cases additionally lost
the 15% -> 18% urgency bump introduced by the same revision. Stored, audited
historical fees for that day contradict the published rate schedule.

**Proposed fix (not applied).** `if (openedAt >= REVISION_2022)`. Requires
billing sign-off and a reconciliation of the affected day before shipping,
because it changes billed amounts.

## BUG-2 — The urgency surcharge applies when the deadline has already passed

**Where.** `daysBetween(ref, c.deadline) <= 7` is also true for negative day
counts, i.e. any deadline in the past.

**Reproducing input / output.**
```ts
calculateFee(
  { type: 'COMMERCIAL', complexity: 3, openedAt: '2023-03-01', deadline: '2023-02-25' },
  '2023-03-10', // `now`; the deadline is 13 days in the past
)
// -> { table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 0, total: 63130 }
```
Intended reading: urgency = deadline within the next 0..7 days.

**Blast radius.** Any recomputation of a case whose deadline had already
passed at calculation time (audit reruns, corrections, rebilling) is inflated
by 15–18% of the band fee, plus compounded expedited on top. If billing ever
ran stored cases through this path with a late `now`, those historical outputs
are overstated. Combined with QUIRK-5, the urgency fee silently depends on
when the fee is (re)calculated.

**Proposed fix (not applied).**
`const days = daysBetween(ref, c.deadline); if (days >= 0 && days <= 7) { ... }`

## QUIRK-1 — Unknown or misspelled case type silently falls back to STANDARD

**Where.** `if (!bands) bands = table.base['STANDARD'];` — the lookup is
case-sensitive, so `'standard'`, `'Commercial'`, whitespace variants, etc.,
all fall back as well.

**Reproducing input / output.**
```ts
calculateFee({ type: 'BANKRUPTCY', complexity: 2, openedAt: '2020-01-15' })
// -> { table: '2019', bandFee: 18500, ... } // STANDARD band 2, no error
```

**Blast radius.** Legacy imports with bad type strings are silently mispriced
with no error and no log. Example: a COMMERCIAL case recorded as
`'commercial'` pays the STANDARD band (2019 band 1: $120.00 instead of
$220.00) — invisible in audits.

**Proposed fix (not applied).** Throw on an unrecognized type (or, if the
old-system casing is known, an explicit legacy-alias map), plus an alert on
fallback.

## QUIRK-2 — Non-integer complexity escapes the band guard (NaN fee) or is silently coerced

**Where.** The guard handles `!band || band < 1` and `band > 4`, but not
non-integers: `bands[2.5 - 1]` reads index `1.5` -> `undefined`. Separately,
`NaN` is caught by `!band` and silently becomes band 1.

**Reproducing input / output.**
```ts
calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2020-01-15' })
// -> { table: '2019', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }
calculateFee({ type: 'STANDARD', complexity: NaN, openedAt: '2020-01-15' })
// -> band 1 fee (12000), no error
```

**Blast radius.** `JSON.stringify(NaN)` is `null`: a single corrupted or
legacy fractional complexity writes a **null fee** into billing exports, and
any sum that includes the NaN poisons to NaN. The NaN-complexity path is
quieter: an intended band 3/4 is silently billed at band 1.

**Proposed fix (not applied).**
`if (!Number.isInteger(c.complexity) || c.complexity < 1 || c.complexity > 4) throw ...`
(reject, or clamp deliberately with a log — billing to decide).

## QUIRK-3 — Expedited surcharge compounds on (bandFee + urgencyFee); rounding is per-step, half-up

**Where.** `expeditedFee = pctOf(bandFee + urgencyFee, table.expeditedPct)`
with `pctOf = Math.round`. The comment "percent added when expedited" never
says whether the urgency fee is part of the base — the code includes it.

**Reproducing input / output.**
```ts
calculateFee(
  { type: 'STANDARD', complexity: 2, openedAt: '2020-01-15', deadline: '2020-06-17', expedited: true },
  '2020-06-10',
)
// bandFee 18500, urgencyFee 2775, then 10% of 21275 = 2127.5 -> 2128, total 23403
```
Without compounding the expedited fee would be 1850 and the total 23125.

**Blast radius.** Every urgent+expedited case in the stored history carries
the compounding and the per-step half-up rounding. Any "correction" re-prices
a large slice of historical fees; a re-implementation that rounds at a
different step (or uses a different rounding mode) will show unexplained
deltas against audited outputs. Note: with the current tables all band fees
are whole dollars, so only the expedited step actually rounds today — a
future sub-dollar table would make the urgency step round too.

**Proposed fix (not applied).** Billing to confirm the intended base; if
compounding is wrong, run a reconciliation report over stored fees before any
rebilling.

## QUIRK-4 — Rate-table selection is a lexicographic string compare on `openedAt`

**Where.** `tableFor()` compares date strings directly. Correct for canonical
`YYYY-MM-DD`, wrong for other ISO spellings.

**Reproducing input / output.**
```ts
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' })           // table '2021', 13500
calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01T00:00:00Z' }) // table '2022', 15000
```
Same moment, different table, because `'2022-07-01T00:00:00Z' > '2022-07-01'`
as strings.

**Blast radius.** Any caller passing a datetime (the field comment says
"ISO date", and ISO also covers datetimes) silently switches rate tables
around the revision boundaries — including interacting with BUG-1 at the
2022-07-01 boundary.

**Proposed fix (not applied).** Normalize/validate `openedAt` to `YYYY-MM-DD`
at the entry point (or compare parsed dates).

## QUIRK-5 — `now` falls back to the real clock when omitted

**Where.** `const ref = now ? now : new Date().toISOString().slice(0, 10);`

**Behavior pinned.** The suite always injects `now`; the fallback is not
exercised (it is inherently non-deterministic). As written, the urgency fee of
a stored case depends on when the fee is (re)calculated, and a deadline aging
into the past flips the fee into the BUG-2 regime.

**Proposed fix (not applied).** Make the reference date an explicit, required
argument (or always pass it from the caller's transaction time).

## QUIRK-6 — Empty-string deadline is treated as "no deadline"

**Where.** `if (c.deadline && ...)` — any falsy deadline (`''`) skips the
urgency check entirely.

**Reproducing input / output.**
```ts
calculateFee(
  { type: 'STANDARD', complexity: 2, openedAt: '2020-01-15', deadline: '' },
  '2020-06-10',
)
// -> urgencyFee 0 (no surcharge)
```

**Blast radius.** A case that truly had a near deadline but an empty string
recorded for it is billed without the urgency surcharge. Low likelihood,
silent, and un-auditable.

**Proposed fix (not applied).** Treat `deadline === ''` as invalid input
(reject or normalize upstream) rather than as absent.

## Note — header provenance mismatch (unresolved)

The header says `2020-03: added URGENT tier after the Silva case`, but
`CaseType` has no URGENT member and no table carries URGENT-specific rates;
urgency is modeled purely as deadline proximity. The comment and the code do
not describe the same feature — flag to billing before any restructuring. The
suite pins what the code actually does.

## Pinned as-is (assumed intended, no change proposed)

- Band clamping: `complexity` 0 / negative -> band 1; > 4 -> band 4.
- Opening dates before 2019 still select the 2019 table (no lower bound).
- 2021 transition lower edge inclusive (`2021-01-01` -> 2021 table).
- Urgency window inclusive at 7 days (`days <= 7`), 0 days included.
- `total` is the plain sum of the three parts — no final rounding step.
```


---
