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
