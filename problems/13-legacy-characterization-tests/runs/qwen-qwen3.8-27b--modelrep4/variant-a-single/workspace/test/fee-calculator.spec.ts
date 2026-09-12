// Characterization suite for feeCalculator.ts (in production since 2019).
//
// This suite pins the module's CURRENT behavior, quirks and bugs included.
// Every expected value below was produced by running the module as-is.
// Values that are believed wrong (see FINDINGS.md, e.g. the 2022-07-01
// boundary) are pinned on purpose: a future fix must deliberately rewrite
// those expectations in a reviewed change, not drift into them.
//
// Determinism: the real clock is never used. Every call passes the module's
// existing optional `now` parameter a fixed fake date. The single test that
// exercises the empty-`now` fallback (F-9 in FINDINGS.md) is constructed so
// its outcome is identical no matter what the real clock reads.
//
// The production module is not modified by this suite.

import { describe, expect, it } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';

// Fixed fake "today" for tests where the urgency window does not matter.
const NOW = '2031-01-01';

const baseInput = (over: Partial<CaseInput> = {}): CaseInput => ({
  type: 'STANDARD',
  complexity: 1,
  openedAt: '2020-06-15',
  ...over,
});

function calc(over: Partial<CaseInput> = {}, now: string = NOW): FeeBreakdown {
  return calculateFee(baseInput(over), now);
}

// For inputs the public type does not admit (e.g. `complexity: undefined`),
// the runtime behavior is exactly what this suite pins.
function calcLoose(input: Record<string, unknown>, now: string = NOW): FeeBreakdown {
  return calculateFee(input as unknown as CaseInput, now);
}

// ---------------------------------------------------------------------------
// Band fee: every case type x complexity band x rate table (48 combinations).
// No deadline, no expedited flag: the breakdown must be just the band fee.
// ---------------------------------------------------------------------------
describe('band fee: every case type x complexity band x rate table', () => {
  // [openedAt, type, band, expected table, expected bandFee (cents)]
  const MATRIX: Array<[string, string, number, '2019' | '2021' | '2022', number]> = [
    // 2019 table (opened before 2021-01-01)
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
    // 2021 table (opened 2021-01-01 .. 2022-07-01; note F-1 in FINDINGS.md)
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
    // 2022 table (opened strictly after 2022-07-01; note F-1 in FINDINGS.md)
    ['2022-12-15', 'STANDARD', 1, '2022', 15000],
    ['2022-12-15', 'STANDARD', 2, '2022', 22500],
    ['2022-12-15', 'STANDARD', 3, '2022', 32500],
    ['2022-12-15', 'STANDARD', 4, '2022', 49000],
    ['2022-12-15', 'COMMERCIAL', 1, '2022', 26500],
    ['2022-12-15', 'COMMERCIAL', 2, '2022', 37500],
    ['2022-12-15', 'COMMERCIAL', 3, '2022', 53500],
    ['2022-12-15', 'COMMERCIAL', 4, '2022', 80500],
    ['2022-12-15', 'ESTATE', 1, '2022', 21500],
    ['2022-12-15', 'ESTATE', 2, '2022', 31000],
    ['2022-12-15', 'ESTATE', 3, '2022', 47000],
    ['2022-12-15', 'ESTATE', 4, '2022', 71000],
    ['2022-12-15', 'APPEAL', 1, '2022', 36000],
    ['2022-12-15', 'APPEAL', 2, '2022', 50000],
    ['2022-12-15', 'APPEAL', 3, '2022', 72500],
    ['2022-12-15', 'APPEAL', 4, '2022', 109000],
  ];

  it.each(MATRIX)(
    'openedAt %s / type %s / band %s -> table %s, bandFee %s cents, total unchanged',
    (openedAt, type, band, table, bandFee) => {
      const bd = calc({ openedAt, type, complexity: band });
      expect(bd).toEqual({
        table,
        bandFee,
        urgencyFee: 0,
        expeditedFee: 0,
        total: bandFee,
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Urgency surcharge: deadline within 7 days (inclusive) of `now`.
// ---------------------------------------------------------------------------
describe('urgency surcharge (deadline vs `now`)', () => {
  // 2022 table, STANDARD band 1 = 15000 cents, urgency 18% -> 2700.
  it('deadline on `now` itself (0 days apart): urgent', () => {
    expect(calc({ openedAt: '2022-12-15', deadline: '2023-06-15' }, '2023-06-15')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 2700,
      expeditedFee: 0,
      total: 17700,
    });
  });

  it('deadline 6 days out: urgent', () => {
    expect(calc({ openedAt: '2022-12-15', deadline: '2023-06-21' }, '2023-06-15')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 2700,
      expeditedFee: 0,
      total: 17700,
    });
  });

  it('deadline exactly 7 days out: still urgent (inclusive upper edge)', () => {
    expect(calc({ openedAt: '2022-12-15', deadline: '2023-06-22' }, '2023-06-15')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 2700,
      expeditedFee: 0,
      total: 17700,
    });
  });

  it('deadline 8 days out: not urgent (just outside the window)', () => {
    expect(calc({ openedAt: '2022-12-15', deadline: '2023-06-23' }, '2023-06-15')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('no deadline: never urgent, regardless of `now`', () => {
    expect(calc({ openedAt: '2022-12-15' }, '2030-01-01')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('the urgency percent depends on the rate table: 15% (2019), 15% (2021), 18% (2022)', () => {
    expect(calc({ openedAt: '2020-06-15', deadline: '2020-06-22' }, '2020-06-15')).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 1800,
      expeditedFee: 0,
      total: 13800,
    });
    expect(calc({ openedAt: '2021-06-15', deadline: '2021-06-22' }, '2021-06-15')).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 0,
      total: 15525,
    });
    expect(calc({ openedAt: '2022-12-15', deadline: '2022-12-22' }, '2022-12-15')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 2700,
      expeditedFee: 0,
      total: 17700,
    });
  });

  it('QUIRK: an overdue deadline (in the past) still triggers the surcharge', () => {
    // -14 days <= 7, so a deadline two weeks BEFORE `now` is "urgent".
    expect(calc({ openedAt: '2022-12-15', deadline: '2023-06-01' }, '2023-06-15')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 2700,
      expeditedFee: 0,
      total: 17700,
    });
  });
});

// ---------------------------------------------------------------------------
// Expedited surcharge.
// ---------------------------------------------------------------------------
describe('expedited surcharge', () => {
  it('applies the table expedited percent to the band fee: 10% (2019), 12% (2021), 12% (2022)', () => {
    expect(calc({ openedAt: '2020-06-15', expedited: true })).toEqual({
      table: '2019',
      bandFee: 12000,
      urgencyFee: 0,
      expeditedFee: 1200,
      total: 13200,
    });
    expect(calc({ openedAt: '2021-06-15', expedited: true })).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 1620,
      total: 15120,
    });
    expect(calc({ openedAt: '2022-12-15', expedited: true })).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 1800,
      total: 16800,
    });
  });

  it('expedited: false behaves like absent (no surcharge)', () => {
    expect(calc({ openedAt: '2022-12-15', expedited: false })).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('QUIRK: when urgent too, the expedited percent is applied to bandFee + urgencyFee (compounded, not additive)', () => {
    // 29500 + 4425 = 33925; 12% of 33925 = 4071.
    // (A flat 12% of the band fee alone would be 3540.)
    expect(
      calc({ openedAt: '2021-06-15', complexity: 3, deadline: '2021-06-22', expedited: true }, '2021-06-15'),
    ).toEqual({
      table: '2021',
      bandFee: 29500,
      urgencyFee: 4425,
      expeditedFee: 4071,
      total: 37996,
    });
  });
});

// ---------------------------------------------------------------------------
// Rounding at each step: every surcharge is rounded to integer cents on its
// own (half-up) before the parts are summed.
// ---------------------------------------------------------------------------
describe('per-step rounding: each surcharge is rounded to integer cents independently (half-up)', () => {
  it('QUIRK: 2127.5 rounds UP to 2128 (2019 STANDARD band 2, urgent + expedited)', () => {
    // 18500 + 2775 = 21275; 10% = 2127.5 -> Math.round -> 2128.
    expect(
      calc({ openedAt: '2020-06-15', complexity: 2, deadline: '2020-06-22', expedited: true }, '2020-06-15'),
    ).toEqual({
      table: '2019',
      bandFee: 18500,
      urgencyFee: 2775,
      expeditedFee: 2128,
      total: 23403,
    });
  });

  it('QUIRK: 6938.4 rounds DOWN to 6938 (2022 STANDARD band 4, urgent + expedited)', () => {
    // 49000 + 8820 = 57820; 12% = 6938.4 -> Math.round -> 6938.
    expect(
      calc({ openedAt: '2022-12-15', complexity: 4, deadline: '2022-12-22', expedited: true }, '2022-12-15'),
    ).toEqual({
      table: '2022',
      bandFee: 49000,
      urgencyFee: 8820,
      expeditedFee: 6938,
      total: 64758,
    });
  });
});

// ---------------------------------------------------------------------------
// Rate-table selection boundaries: inclusive/exclusive edges on both
// transitions. APPEAL band 4 is used because its rate gap between tables is
// the largest (92000 / 99000 / 109000), making any mis-selection maximal.
// ---------------------------------------------------------------------------
describe('rate-table boundaries (inclusive/exclusive edges on both transitions)', () => {
  const appealBand4 = (openedAt: string): FeeBreakdown =>
    calc({ type: 'APPEAL', complexity: 4, openedAt });

  it('the day before the 2021 revision (2020-12-31) stays on the 2019 table', () => {
    expect(appealBand4('2020-12-31')).toEqual({
      table: '2019',
      bandFee: 92000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 92000,
    });
  });

  it('the 2021 revision day itself (2021-01-01) is on the 2021 table (inclusive edge)', () => {
    expect(appealBand4('2021-01-01')).toEqual({
      table: '2021',
      bandFee: 99000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 99000,
    });
  });

  it('the day before the 2022 revision (2022-06-30) stays on the 2021 table', () => {
    expect(appealBand4('2022-06-30')).toEqual({
      table: '2021',
      bandFee: 99000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 99000,
    });
  });

  it('BUG: the 2022 revision day itself (2022-07-01) STAYS on the 2021 table (exclusive edge, unlike 2021-01-01)', () => {
    expect(appealBand4('2022-07-01')).toEqual({
      table: '2021',
      bandFee: 99000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 99000,
    });
  });

  it('the day after the 2022 revision (2022-07-02) is on the 2022 table', () => {
    expect(appealBand4('2022-07-02')).toEqual({
      table: '2022',
      bandFee: 109000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 109000,
    });
  });
});

// ---------------------------------------------------------------------------
// Lexicographic string comparison in table selection.
// ---------------------------------------------------------------------------
describe('QUIRK: table selection compares date strings lexicographically, not chronologically', () => {
  it("unpadded month '2022-6-15' sorts after '2022-07-01' and picks the 2022 table although June 15 precedes it", () => {
    expect(calc({ openedAt: '2022-6-15' })).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('a time suffix makes the same calendar day as the 2022-07-01 bug case pick the 2022 table', () => {
    expect(calc({ openedAt: '2022-07-01T00:00:00Z' })).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });
});

// ---------------------------------------------------------------------------
// Complexity: degenerate inputs.
// ---------------------------------------------------------------------------
describe('complexity: degenerate inputs', () => {
  it('complexity 0 is coerced to band 1 (lowest fee) instead of being rejected', () => {
    expect(calc({ openedAt: '2022-12-15', complexity: 0 })).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('negative complexity is coerced to band 1', () => {
    expect(calc({ openedAt: '2022-12-15', complexity: -7 })).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });

  it('complexity 5 clamps to band 4 (highest fee)', () => {
    expect(calc({ openedAt: '2022-12-15', complexity: 5 })).toEqual({
      table: '2022',
      bandFee: 49000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 49000,
    });
  });

  it('complexity 99 clamps to band 4', () => {
    expect(calc({ openedAt: '2022-12-15', complexity: 99 })).toEqual({
      table: '2022',
      bandFee: 49000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 49000,
    });
  });

  it('QUIRK: fractional complexity (2.5) is not a valid array index: bandFee undefined, total NaN', () => {
    const bd = calc({ openedAt: '2022-12-15', complexity: 2.5 });
    expect(bd.table).toBe('2022');
    expect(bd.bandFee).toBeUndefined();
    expect(bd.urgencyFee).toBe(0);
    expect(bd.expeditedFee).toBe(0);
    expect(bd.total).toBeNaN();
  });

  it('complexity null throws "complexity is required"', () => {
    expect(() => calc({ complexity: null })).toThrow('complexity is required');
  });

  it('complexity undefined (outside the declared type) also throws "complexity is required"', () => {
    expect(() =>
      calcLoose({ type: 'STANDARD', openedAt: '2022-12-15', complexity: undefined }),
    ).toThrow('complexity is required');
  });
});

// ---------------------------------------------------------------------------
// Case type: unknown / unrecognized types.
// ---------------------------------------------------------------------------
describe('case type: unknown / unrecognized types fall back to the STANDARD fee', () => {
  it('an unknown type (LIEN) is billed at the STANDARD rate of its table', () => {
    expect(calc({ openedAt: '2022-12-15', type: 'LIEN', complexity: 2 })).toEqual({
      table: '2022',
      bandFee: 22500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 22500,
    });
  });

  it('an empty-string type is also billed as STANDARD', () => {
    expect(calc({ openedAt: '2022-12-15', type: '', complexity: 2 })).toEqual({
      table: '2022',
      bandFee: 22500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 22500,
    });
  });

  it('the lookup is case-sensitive: "standard" (lowercase) misses the key and falls back to the STANDARD rate', () => {
    expect(calc({ openedAt: '2022-12-15', type: 'standard', complexity: 2 })).toEqual({
      table: '2022',
      bandFee: 22500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 22500,
    });
  });

  it('the fallback follows the table selected by the opening date (2021 here)', () => {
    expect(calc({ openedAt: '2021-06-15', type: 'TRUST' })).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 13500,
    });
  });
});

// ---------------------------------------------------------------------------
// Semantics of `now`: urgency reference only, never a table selector.
// ---------------------------------------------------------------------------
describe('`now` is the urgency reference only; the rate table always comes from openedAt', () => {
  it('the same case gives the same breakdown for wildly different `now` values (no deadline)', () => {
    const a = calc({ openedAt: '2022-09-15', complexity: 2 }, '2020-01-01');
    const b = calc({ openedAt: '2022-09-15', complexity: 2 }, '2030-01-01');
    expect(a).toEqual({
      table: '2022',
      bandFee: 22500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 22500,
    });
    expect(b).toEqual(a);
  });

  it('the urgency window is measured from `now`, not from openedAt, and a later `now` never moves the table', () => {
    // Opened in the 2021-table era; `now` is almost a year later.
    // Deadline 6 days from `now` -> urgent at the 2021 percent (15%).
    expect(calc({ openedAt: '2022-01-10', deadline: '2022-12-26' }, '2022-12-20')).toEqual({
      table: '2021',
      bandFee: 13500,
      urgencyFee: 2025,
      expeditedFee: 0,
      total: 15525,
    });
  });

  it('QUIRK: an empty-string `now` is falsy, so the real clock is consulted; pinned date-independently via a far-future deadline', () => {
    // daysBetween(any realistic run date, '2100-01-01') is far more than 7,
    // so this outcome holds no matter when the suite runs.
    expect(calc({ openedAt: '2022-12-15', deadline: '2100-01-01' }, '')).toEqual({
      table: '2022',
      bandFee: 15000,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 15000,
    });
  });
});
