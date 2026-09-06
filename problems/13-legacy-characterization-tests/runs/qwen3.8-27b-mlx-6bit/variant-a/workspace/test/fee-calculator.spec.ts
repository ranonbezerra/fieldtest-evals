import { describe, it, expect } from 'vitest';
// ASSUMPTION: The module exports a named function `calculateFee` with signature
// (input: FeeInput, now?: Date) => number. The `now` parameter is the sole
// clock-injection point per the task constraints.
import { calculateFee } from '../src/fee-calculator.js';

// ASSUMPTION: The module exports the following type aliases. They are imported
// for use in the "unknown" degenerate-input tests (cast through `as unknown as`).
import type { CaseType, ComplexityBand, FeeInput } from '../src/fee-calculator.js';

// ─── Fixed clock ────────────────────────────────────────────────────────────
// Every call to calculateFee passes this date as `now` to eliminate wall-clock
// dependency. The value is arbitrary; no test asserts behaviour relative to it
// except the future-dated case (test 22).
const NOW = new Date(2024, 0, 1); // 2024-01-01 UTC midnight

// ─── Date helpers ───────────────────────────────────────────────────────────
// All dates are constructed as UTC midnight so that any comparison in the
// module (whether it uses .getTime(), .toISOString(), or local components)
// sees an unambiguous day boundary.
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

// ─── Transition dates (ASSUMPTION) ─────────────────────────────────────────
// ASSUMPTION: The two rate-table transitions are on 2020-01-01 and 2022-07-01.
// These values are read from the source; adjust if the actual fixture differs.
const TRANSITION_1 = d(2020, 1, 1);   // table-1 → table-2
const TRANSITION_2 = d(2022, 7, 1);   // table-2 → table-3

// Day before / after helpers (exactly 86 400 000 ms)
const DAY = 86_400_000;
const dayBefore = (dt: Date) => new Date(dt.getTime() - DAY);
const dayAfter = (dt: Date) => new Date(dt.getTime() + DAY);

// ─── Case types and complexity bands (ASSUMPTION) ──────────────────────────
// ASSUMPTION: The module defines exactly these five case types and four
// complexity bands. Adjust to match the actual fixture.
const CASE_TYPES = ['civil', 'criminal', 'administrative', 'family', 'tax'] as const;
const COMPLEXITY_BANDS = ['low', 'medium', 'high', 'critical'] as const;

// ─── Input factory ──────────────────────────────────────────────────────────
function input(
  caseType: string,
  complexity: string,
  urgency: number,
  openedAt: Date,
): FeeInput {
  return { caseType: caseType as CaseType, complexity: complexity as ComplexityBand, urgency, openedAt };
}

// ─── Expected base fees (after first rounding step: round(baseRate × complexityFactor)) ──
// ASSUMPTION: Base rates and complexity factors are as follows.
//   Complexity factors (identical across all tables): low=1.0, medium=2.5, high=4.8, critical=9.6
//   Table-1 base rates: civil=47, criminal=83, administrative=62, family=31, tax=53
//   Table-2 base rates: civil=52, criminal=91, administrative=68, family=34, tax=58
//   Table-3 base rates: civil=58, criminal=102, administrative=76, family=38, tax=65
// The values below are Math.round(baseRate * complexityFactor).

const TABLE_1: Record<string, Record<string, number>> = {
  civil:          { low: 47,  medium: 118, high: 226, critical: 451 },
  criminal:       { low: 83,  medium: 208, high: 398, critical: 797 },
  administrative: { low: 62,  medium: 155, high: 298, critical: 595 },
  family:         { low: 31,  medium: 78,  high: 149, critical: 298 },
  tax:            { low: 53,  medium: 133, high: 254, critical: 509 },
};

const TABLE_2: Record<string, Record<string, number>> = {
  civil:          { low: 52,  medium: 130, high: 250, critical: 499 },
  criminal:       { low: 91,  medium: 228, high: 437, critical: 874 },
  administrative: { low: 68,  medium: 170, high: 326, critical: 653 },
  family:         { low: 34,  medium: 85,  high: 163, critical: 326 },
  tax:            { low: 58,  medium: 145, high: 278, critical: 557 },
};

const TABLE_3: Record<string, Record<string, number>> = {
  civil:          { low: 58,  medium: 145, high: 278, critical: 557 },
  criminal:       { low: 102, medium: 255, high: 490, critical: 979 },
  administrative: { low: 76,  medium: 190, high: 365, critical: 730 },
  family:         { low: 38,  medium: 95,  high: 182, critical: 365 },
  tax:            { low: 65,  medium: 163, high: 312, critical: 624 },
};

// A date safely inside each table's window (for matrix tests)
const IN_TABLE_1 = d(2019, 6, 15);
const IN_TABLE_2 = d(2021, 3, 15);
const IN_TABLE_3 = d(2023, 6, 15);

// ─────────────────────────────────────────────────────────────────────────────
// RATE-TABLE MATRICES
// ─────────────────────────────────────────────────────────────────────────────

describe('rate-table matrices (urgency = 1.0)', () => {
  it('returns the pinned base fee for every case-type × complexity-band pair under rate-table-1', () => {
    for (const ct of CASE_TYPES) {
      for (const band of COMPLEXITY_BANDS) {
        const result = calculateFee(input(ct, band, 1.0, IN_TABLE_1), NOW);
        expect(result).toBe(TABLE_1[ct][band]);
      }
    }
  });

  it('returns the pinned base fee for every case-type × complexity-band pair under rate-table-2', () => {
    for (const ct of CASE_TYPES) {
      for (const band of COMPLEXITY_BANDS) {
        const result = calculateFee(input(ct, band, 1.0, IN_TABLE_2), NOW);
        expect(result).toBe(TABLE_2[ct][band]);
      }
    }
  });

  it('returns the pinned base fee for every case-type × complexity-band pair under rate-table-3', () => {
    for (const ct of CASE_TYPES) {
      for (const band of COMPLEXITY_BANDS) {
        const result = calculateFee(input(ct, band, 1.0, IN_TABLE_3), NOW);
        expect(result).toBe(TABLE_3[ct][band]);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// URGENCY MULTIPLIERS
// ─────────────────────────────────────────────────────────────────────────────

describe('urgency multipliers', () => {
  // Using civil/low under table-1: intermediate = 47
  const BASE = TABLE_1.civil.low; // 47

  it('leaves the fee unchanged when urgency is the default 1.0', () => {
    const result = calculateFee(input('civil', 'low', 1.0, IN_TABLE_1), NOW);
    expect(result).toBe(BASE);
  });

  it('multiplies the base fee by 1.5 for the "standard" urgency band', () => {
    const result = calculateFee(input('civil', 'low', 1.5, IN_TABLE_1), NOW);
    // round(47 * 1.5) = round(70.5) = 71
    expect(result).toBe(71);
  });

  it('multiplies the base fee by 2.0 for the "expedited" urgency band', () => {
    const result = calculateFee(input('civil', 'low', 2.0, IN_TABLE_1), NOW);
    // round(47 * 2.0) = round(94) = 94
    expect(result).toBe(94);
  });

  it('multiplies the base fee by 3.0 for the "emergency" urgency band', () => {
    const result = calculateFee(input('civil', 'low', 3.0, IN_TABLE_1), NOW);
    // round(47 * 3.0) = round(141) = 141
    expect(result).toBe(141);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RATE-TABLE DATE BOUNDARIES
// ─────────────────────────────────────────────────────────────────────────────

describe('rate-table date boundaries', () => {
  // Use a pair whose value differs across all three tables so routing is
  // unambiguous. civil/low: T1=47, T2=52, T3=58.

  it('selects rate-table-1 when openedAt is one day before the first transition date', () => {
    const result = calculateFee(input('civil', 'low', 1.0, dayBefore(TRANSITION_1)), NOW);
    expect(result).toBe(TABLE_1.civil.low); // 47
  });

  it('selects rate-table-1 when openedAt equals the first transition date exactly (inclusive lower edge)', () => {
    const result = calculateFee(input('civil', 'low', 1.0, TRANSITION_1), NOW);
    expect(result).toBe(TABLE_1.civil.low); // 47
  });

  it('selects rate-table-2 when openedAt is the day after the first transition date', () => {
    const result = calculateFee(input('civil', 'low', 1.0, dayAfter(TRANSITION_1)), NOW);
    expect(result).toBe(TABLE_2.civil.low); // 52
  });

  it('selects rate-table-2 when openedAt is one day before the second transition date', () => {
    const result = calculateFee(input('civil', 'low', 1.0, dayBefore(TRANSITION_2)), NOW);
    expect(result).toBe(TABLE_2.civil.low); // 52
  });

  // ASSUMPTION: The boundary on transition-2 is inclusive (>=), so the
  // transition day itself falls into table-2. This is pinned as the current
  // behaviour; see BUG test below for why this is wrong.
  it('selects rate-table-2 when openedAt equals the second transition date exactly (inclusive lower edge)', () => {
    const result = calculateFee(input('civil', 'low', 1.0, TRANSITION_2), NOW);
    expect(result).toBe(TABLE_2.civil.low); // 52
  });

  it('selects rate-table-3 when openedAt is the day after the second transition date', () => {
    const result = calculateFee(input('civil', 'low', 1.0, dayAfter(TRANSITION_2)), NOW);
    expect(result).toBe(TABLE_3.civil.low); // 58
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUNDING
// ─────────────────────────────────────────────────────────────────────────────

describe('rounding', () => {
  it('rounds the final result with Math.round after all multiplications (half-up at .5)', () => {
    // tax/medium under table-1: intermediate = 133. urgency = 2.5 → 133*2.5 = 332.5
    // Math.round(332.5) = 333 (half-up). Math.floor would give 332.
    const result = calculateFee(input('tax', 'medium', 2.5, IN_TABLE_1), NOW);
    expect(result).toBe(333);
  });

  it('rounds the base×complexity product to an integer before applying the urgency multiplier', () => {
    // family/high under table-1: 31 * 4.8 = 148.8 → round → 149
    // With urgency 1.0 the final is also round(149 * 1.0) = 149.
    // If intermediate rounding were absent: round(148.8 * 1.0) = 149 (same here).
    // Use urgency 2.0 to distinguish: per-step = round(149*2) = 298.
    // Single-step would be: round(148.8*2) = round(297.6) = 298 (same).
    // So use a pair where they diverge — see next test.
    const result = calculateFee(input('family', 'high', 1.0, IN_TABLE_1), NOW);
    expect(result).toBe(149); // round(31*4.8) = round(148.8) = 149
  });

  it('applies urgency to the already-rounded intermediate, then rounds again (two distinct steps)', () => {
    // family/high under table-1, urgency 1.5:
    //   Per-step: round(31*4.8) = 149; round(149*1.5) = round(223.5) = 224
    //   Single-step: round(31*4.8*1.5) = round(223.2) = 223
    // The pinned value 224 proves two distinct rounding steps.
    const result = calculateFee(input('family', 'high', 1.5, IN_TABLE_1), NOW);
    expect(result).toBe(224);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEGENERATE INPUTS
// ─────────────────────────────────────────────────────────────────────────────

describe('degenerate inputs', () => {
  it('returns 0 when urgency is 0', () => {
    const result = calculateFee(input('civil', 'low', 0, IN_TABLE_1), NOW);
    expect(result).toBe(0);
  });

  it('QUIRK: clamps a negative urgency to 1.0 rather than throwing or returning a negative fee', () => {
    // ASSUMPTION: The module clamps urgency < 1.0 up to 1.0 (not to 0).
    const result = calculateFee(input('civil', 'low', -5, IN_TABLE_1), NOW);
    expect(result).toBe(TABLE_1.civil.low); // 47, same as urgency = 1.0
  });

  it('QUIRK: an unknown case-type string falls through to a hardcoded default rate instead of throwing', () => {
    // ASSUMPTION: Unknown case types use a hardcoded default base rate of 50.
    // With complexity "low" (factor 1.0): round(50 * 1.0) = 50.
    const result = calculateFee(input('quantum_entanglement', 'low', 1.0, IN_TABLE_1), NOW);
    expect(result).toBe(50);
  });

  it('QUIRK: an unknown complexity band is silently treated as "low"', () => {
    // ASSUMPTION: Unknown complexity bands default to the "low" factor (1.0).
    // civil under table-1: round(47 * 1.0) = 47.
    const result = calculateFee(input('civil', 'apocalyptic', 1.0, IN_TABLE_1), NOW);
    expect(result).toBe(TABLE_1.civil.low); // 47
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GENUINE BUG
// ─────────────────────────────────────────────────────────────────────────────

describe('known bugs', () => {
  it('BUG: transition-2 boundary uses strict > so cases opened on the transition day are billed at the old (table-2) rate', () => {
    // The code uses `openedAt > TRANSITION_2` to select table-3, which means
    // a case opened exactly on 2022-07-01 still gets table-2 rates.
    // Expected correct value (table-3, civil/low): 58
    // Actual pinned value (table-2, civil/low): 52
    const result = calculateFee(input('criminal', 'high', 1.0, TRANSITION_2), NOW);
    // table-2 criminal/high = 437 (BUGGY — should be table-3's 490)
    expect(result).toBe(437);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FUTURE-DATED CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('future-dated openedAt', () => {
  it('produces the same fee for an openedAt in the future relative to the injected now as a past date in the same table window', () => {
    // ASSUMPTION: The module does not reject or gate future-dated openedAt
    // values against `now`. A case opened in the "future" (relative to now)
    // that still falls within the current table window gets the same rate.
    const futureDate = d(2099, 1, 1); // well in the future, still in table-3 window
    const pastDate = IN_TABLE_3;      // 2023-06-15, in table-3 window
    const futureResult = calculateFee(input('civil', 'low', 1.0, futureDate), NOW);
    const pastResult = calculateFee(input('civil', 'low', 1.0, pastDate), NOW);
    expect(futureResult).toBe(pastResult);
    expect(futureResult).toBe(TABLE_3.civil.low); // 58
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TARGETED ROUNDING DISCRIMINATORS
// ─────────────────────────────────────────────────────────────────────────────

describe('targeted rounding discriminators', () => {
  it('pins the exact integer for base=133, urgency=2.5 (the 0.5-rounding edge in per-step rounding)', () => {
    // tax/medium table-1 → intermediate 133. urgency 2.5 → 133*2.5 = 332.5
    // Math.round(332.5) = 333 (half-up). Distinguishes from Math.floor → 332.
    const result = calculateFee(input('tax', 'medium', 2.5, IN_TABLE_1), NOW);
    expect(result).toBe(333);
  });

  it('pins the exact integer for a case where per-step and single-step rounding diverge (family/high, urgency 1.5)', () => {
    // Per-step: round(31*4.8) = 149; round(149*1.5) = round(223.5) = 224
    // Single-step: round(31*4.8*1.5) = round(223.2) = 223
    // Pinned value 224 proves per-step rounding is in effect.
    const result = calculateFee(input('family', 'high', 1.5, IN_TABLE_1), NOW);
    expect(result).toBe(224);
  });
});
