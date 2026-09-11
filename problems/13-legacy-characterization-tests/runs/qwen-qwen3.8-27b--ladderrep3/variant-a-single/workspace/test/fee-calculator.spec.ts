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
