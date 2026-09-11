// Characterization suite for feeCalculator.ts.
//
// This module has run in production since 2019 with zero tests and its outputs are
// stored and audited. This suite pins WHAT THE CODE DOES today, not what it should
// do. Where current behaviour is surprising or believed wrong, the test asserts the
// current value and its name carries the finding id from FINDINGS.md (F1..F7) so a
// reader knows it is pinned deliberately, not because it is right. No fix is applied
// in this change; feeCalculator.ts is byte-identical.
//
// Determinism: every date in this file is a literal. The module's optional `now`
// parameter is the only clock seam and is always supplied (the real-clock default
// branch is intentionally never exercised — see FINDINGS.md OQ-3). No randomness,
// no dependence on the machine's timezone (all dates are UTC-parseable literals).

import { describe, expect, it } from 'vitest';
import { calculateFee, type CaseInput, type FeeBreakdown } from '../feeCalculator';

type EraTable = '2019' | '2021' | '2022';
type CaseTypeName = 'STANDARD' | 'COMMERCIAL' | 'ESTATE' | 'APPEAL';

// The frozen "today". The only clock value this suite ever uses.
const NOW = '2023-03-01';

// 7 days after NOW: inside the urgent window. 8 days: just outside. 3 days before:
// overdue (used to pin F3).
const DEADLINE_IN_WINDOW = '2023-03-08';
const DEADLINE_OUT_OF_WINDOW = '2023-03-09';
const DEADLINE_OVERDUE = '2023-02-26';

function calc(input: CaseInput, now: string = NOW): FeeBreakdown {
  return calculateFee(input, now);
}

function std(openedAt: string, complexity: number = 1): CaseInput {
  return { type: 'STANDARD', complexity, openedAt };
}

// ---------------------------------------------------------------------------
// Frozen expectations.
//
// These literals are hand-transcribed from the production rate tables and from the
// module's observed outputs (percentages hand-computed, then verified against a
// local run of the module). They are the contract this suite asserts against; do
// not re-derive them from feeCalculator.ts (that would make the suite
// tautological). If production rates change deliberately, these numbers are
// updated together with billing's sign-off.
// ---------------------------------------------------------------------------

const FROZEN_BASE: Record<EraTable, Record<CaseTypeName, readonly number[]>> = {
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

// Frozen expected breakdowns for the fully-loaded case: deadline inside the urgent
// window and expedited = true. Rows per band: [bandFee, urgencyFee, expeditedFee, total].
// Includes every half-up .5 rounding cell (see FINDINGS.md F7).
const FROZEN_URGENT_EXPEDITED: Record<
  EraTable,
  Record<CaseTypeName, readonly (readonly number[])[]>
> = {
  '2019': {
    STANDARD: [
      [12000, 1800, 1380, 15180],
      [18500, 2775, 2128, 23403],
      [27000, 4050, 3105, 34155],
      [41000, 6150, 4715, 51865],
    ],
    COMMERCIAL: [
      [22000, 3300, 2530, 27830],
      [31500, 4725, 3623, 39848],
      [45000, 6750, 5175, 56925],
      [68000, 10200, 7820, 86020],
    ],
    ESTATE: [
      [18000, 2700, 2070, 22770],
      [26000, 3900, 2990, 32890],
      [39500, 5925, 4543, 49968],
      [60000, 9000, 6900, 75900],
    ],
    APPEAL: [
      [30000, 4500, 3450, 37950],
      [42000, 6300, 4830, 53130],
      [61000, 9150, 7015, 77165],
      [92000, 13800, 10580, 116380],
    ],
  },
  '2021': {
    STANDARD: [
      [13500, 2025, 1863, 17388],
      [20500, 3075, 2829, 26404],
      [29500, 4425, 4071, 37996],
      [44500, 6675, 6141, 57316],
    ],
    COMMERCIAL: [
      [24000, 3600, 3312, 30912],
      [34000, 5100, 4692, 43792],
      [48500, 7275, 6693, 62468],
      [73000, 10950, 10074, 93024],
    ],
    ESTATE: [
      [19500, 2925, 2691, 25116],
      [28000, 4200, 3864, 36064],
      [42500, 6375, 5865, 54740],
      [64500, 9675, 8901, 83076],
    ],
    APPEAL: [
      [32500, 4875, 4485, 41860],
      [45500, 6825, 6279, 58604],
      [66000, 9900, 9108, 85008],
      [99000, 14850, 13662, 127512],
    ],
  },
  '2022': {
    STANDARD: [
      [15000, 2700, 2124, 19824],
      [22500, 4050, 3186, 29736],
      [32500, 5850, 4602, 42952],
      [49000, 8820, 6938, 64758],
    ],
    COMMERCIAL: [
      [26500, 4770, 3752, 35022],
      [37500, 6750, 5310, 49560],
      [53500, 9630, 7576, 70336],
      [80500, 14490, 11399, 106389],
    ],
    ESTATE: [
      [21500, 3870, 3044, 28414],
      [31000, 5580, 4390, 40970],
      [47000, 8460, 6655, 62115],
      [71000, 12780, 10054, 93834],
    ],
    APPEAL: [
      [36000, 6480, 5098, 47578],
      [50000, 9000, 7080, 66080],
      [72500, 13050, 10266, 95816],
      [109000, 19620, 15434, 144054],
    ],
  },
};

const TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
const BANDS = [1, 2, 3, 4] as const;

// One representative opening date per era, deliberately away from both boundaries.
const ERAS: readonly { table: EraTable; openedAt: string }[] = [
  { table: '2019', openedAt: '2020-06-15' },
  { table: '2021', openedAt: '2021-06-15' },
  { table: '2022', openedAt: '2023-06-15' },
];

const baseMatrix = ERAS.flatMap((era) =>
  TYPES.flatMap((type) =>
    BANDS.map((band) => ({
      table: era.table,
      openedAt: era.openedAt,
      type,
      band,
      bandFee: FROZEN_BASE[era.table][type][band - 1],
    })),
  ),
);

const loadedMatrix = ERAS.flatMap((era) =>
  TYPES.flatMap((type) =>
    BANDS.map((band) => {
      const [bandFee, urgencyFee, expeditedFee, total] =
        FROZEN_URGENT_EXPEDITED[era.table][type][band - 1];
      return {
        table: era.table,
        openedAt: era.openedAt,
        type,
        band,
        bandFee,
        urgencyFee,
        expeditedFee,
        total,
      };
    }),
  ),
);

describe('case type x complexity band, full matrix, base fee only (no deadline, no expedite)', () => {
  it.each(baseMatrix)(
    'pins $bandFee for $type band $band on the $table table (opened $openedAt)',
    (m) => {
      expect(calc({ type: m.type, complexity: m.band, openedAt: m.openedAt })).toEqual({
        table: m.table,
        bandFee: m.bandFee,
        urgencyFee: 0,
        expeditedFee: 0,
        total: m.bandFee,
      });
    },
  );
});

describe('case type x complexity band, full matrix, urgent (deadline 2023-03-08) and expedited', () => {
  it.each(loadedMatrix)(
    'pins total $total for $type band $band on the $table table (opened $openedAt, deadline 2023-03-08, expedited)',
    (m) => {
      expect(
        calc({
          type: m.type,
          complexity: m.band,
          openedAt: m.openedAt,
          deadline: DEADLINE_IN_WINDOW,
          expedited: true,
        }),
      ).toEqual({
        table: m.table,
        bandFee: m.bandFee,
        urgencyFee: m.urgencyFee,
        expeditedFee: m.expeditedFee,
        total: m.total,
      });
    },
  );
});

describe('rate-table date boundaries (inclusive/exclusive edges)', () => {
  it('pins: opened 2020-12-31 (day before the 2021 revision) uses the 2019 table', () => {
    expect(calc(std('2020-12-31'))).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('pins: opened 2015-05-05 (before the module existed) still uses the 2019 table - no earlier table exists', () => {
    expect(calc(std('2015-05-05'))).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('pins: opened exactly 2021-01-01 (the 2021 revision day) uses the 2021 table - the 2021 edge is inclusive', () => {
    expect(calc(std('2021-01-01'))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('pins: opened 2021-01-02 (day after the 2021 revision) uses the 2021 table', () => {
    expect(calc(std('2021-01-02'))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('pins: opened 2022-06-30 (day before the 2022 revision) uses the 2021 table', () => {
    expect(calc(std('2022-06-30'))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('pins F1 as-is (suspected bug): opened exactly 2022-07-01 (the 2022 revision day) uses the 2021 table - the 2022 edge is exclusive', () => {
    expect(calc(std('2022-07-01'))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('pins: opened 2022-07-02 (day after the 2022 revision) uses the 2022 table', () => {
    expect(calc(std('2022-07-02'))).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });

  it('pins: opened 2030-01-01 stays on the 2022 table - no later table exists', () => {
    expect(calc(std('2030-01-01'))).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });
});

describe('F2 as-is: table selection compares date STRINGS, not dates', () => {
  it('pins F2: date-only 2022-07-01 and the same instant written as a UTC datetime fall on opposite sides of the 2022 edge', () => {
    expect(calc(std('2022-07-01'))).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
    expect(calc(std('2022-07-01T00:00:00.000Z'))).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });

  it('pins: the 2021 edge is inclusive for both date-only and datetime formats', () => {
    expect(calc(std('2021-01-01')).table).toBe('2021');
    expect(calc(std('2021-01-01T00:00:00.000Z')).table).toBe('2021');
  });
});

describe('urgency boundary: the deadline window relative to now (now = 2023-03-01, 2021 table, STANDARD band 1 = 13500)', () => {
  it('pins: a deadline on the day of now (0 days out) is urgent', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: NOW })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });

  it('pins: a deadline 7 days out is still urgent (inclusive upper bound)', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: DEADLINE_IN_WINDOW })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });

  it('pins: a deadline 8 days out is not urgent (exclusive upper bound)', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: DEADLINE_OUT_OF_WINDOW })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('pins F3 as-is (surprising): a deadline 3 days in the past is still urgent - the window has no lower bound', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: DEADLINE_OVERDUE })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });

  it('pins: no deadline means no urgency', () => {
    expect(calc(std('2021-06-15')).urgencyFee).toBe(0);
  });

  it('pins: an empty-string deadline is falsy, so no urgency', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: '' }).urgencyFee).toBe(0);
  });
});

describe('urgency percentage per rate table (deadline in window, no expedite)', () => {
  it('pins: the 2019 table urgency is 15% of the base fee (12000 -> 1800)', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2020-06-15', deadline: DEADLINE_IN_WINDOW })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 0, total: 13800,
    });
  });

  it('pins: the 2021 table urgency is 15% of the base fee (13500 -> 2025)', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: DEADLINE_IN_WINDOW })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 0, total: 15525,
    });
  });

  it('pins: the 2022 table urgency is 18% of the base fee (15000 -> 2700)', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2023-06-15', deadline: DEADLINE_IN_WINDOW })).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 2700, expeditedFee: 0, total: 17700,
    });
  });
});

describe('the now parameter is the reference for the deadline window, not openedAt', () => {
  it('pins: a 2020 case with a deadline 4 days after now is urgent - openedAt is not the reference', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2020-01-15', deadline: '2023-03-05' })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 0, total: 13800,
    });
  });

  it('pins: changing now does not change the rate table or any fee (no deadline)', () => {
    const a = calc({ type: 'STANDARD', complexity: 2, openedAt: '2022-08-01' }, '2022-09-01');
    const b = calc({ type: 'STANDARD', complexity: 2, openedAt: '2022-08-01' }, '2035-12-31');
    expect(a).toEqual({ table: '2022', bandFee: 22500, urgencyFee: 0, expeditedFee: 0, total: 22500 });
    expect(b).toEqual(a);
  });
});

describe('expedited percentage per rate table (no urgency)', () => {
  it('pins: the 2019 table expedited fee is 10% of the base fee (12000 -> 1200)', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2020-06-15', expedited: true })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 1200, total: 13200,
    });
  });

  it('pins: the 2021 table expedited fee is 12% of the base fee (13500 -> 1620)', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', expedited: true })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120,
    });
  });

  it('pins: the 2022 table expedited fee is 12% of the base fee (15000 -> 1800)', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2023-06-15', expedited: true })).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 1800, total: 16800,
    });
  });

  it('pins: expedited = false adds nothing', () => {
    expect(calc({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', expedited: false })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });
});

describe('F4 as-is (quirk): the expedited fee compounds on base + urgency, not on base alone', () => {
  it('pins F4: with urgency, the 2021 expedited fee is 12% of (13500 + 2025) = 1863, not 12% of base alone (1620)', () => {
    expect(
      calc({ type: 'STANDARD', complexity: 1, openedAt: '2021-06-15', deadline: DEADLINE_IN_WINDOW, expedited: true }),
    ).toEqual({ table: '2021', bandFee: 13500, urgencyFee: 2025, expeditedFee: 1863, total: 17388 });
  });

  it('pins F4: with urgency, the 2019 expedited fee is 10% of (12000 + 1800) = 1380, not 10% of base alone (1200)', () => {
    expect(
      calc({ type: 'STANDARD', complexity: 1, openedAt: '2020-06-15', deadline: DEADLINE_IN_WINDOW, expedited: true }),
    ).toEqual({ table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 1380, total: 15180 });
  });
});

describe('rounding at each step (pctOf uses Math.round)', () => {
  it('pins F7: a .5 at the expedited step rounds HALF UP - 2019 STANDARD band 2, 10% of 21275 = 2127.5 -> 2128', () => {
    expect(
      calc({ type: 'STANDARD', complexity: 2, openedAt: '2020-06-15', deadline: DEADLINE_IN_WINDOW, expedited: true }),
    ).toEqual({ table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403 });
  });

  it('pins F7: the other current .5 cells - 2019 COMMERCIAL band 2 (10% of 36225 = 3622.5 -> 3623) and ESTATE band 3 (10% of 45425 = 4542.5 -> 4543)', () => {
    expect(
      calc({ type: 'COMMERCIAL', complexity: 2, openedAt: '2020-06-15', deadline: DEADLINE_IN_WINDOW, expedited: true }),
    ).toEqual({ table: '2019', bandFee: 31500, urgencyFee: 4725, expeditedFee: 3623, total: 39848 });
    expect(
      calc({ type: 'ESTATE', complexity: 3, openedAt: '2020-06-15', deadline: DEADLINE_IN_WINDOW, expedited: true }),
    ).toEqual({ table: '2019', bandFee: 39500, urgencyFee: 5925, expeditedFee: 4543, total: 49968 });
  });

  it('pins F7: non-.5 fractions round to nearest - 2022 APPEAL band 4 (12% of 128620 = 15434.4 -> 15434) and COMMERCIAL band 3 (12% of 63130 = 7575.6 -> 7576)', () => {
    expect(
      calc({ type: 'APPEAL', complexity: 4, openedAt: '2023-06-15', deadline: DEADLINE_IN_WINDOW, expedited: true }),
    ).toEqual({ table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 15434, total: 144054 });
    expect(
      calc({ type: 'COMMERCIAL', complexity: 3, openedAt: '2023-06-15', deadline: DEADLINE_IN_WINDOW, expedited: true }),
    ).toEqual({ table: '2022', bandFee: 53500, urgencyFee: 9630, expeditedFee: 7576, total: 70336 });
  });

  it('pins F7: the urgency step is exact for every current band fee (15%/18% of a multiple of 500 is integral) - 18% of 109000 = 19620', () => {
    expect(
      calc({ type: 'APPEAL', complexity: 4, openedAt: '2023-06-15', deadline: DEADLINE_IN_WINDOW }),
    ).toEqual({ table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 0, total: 128620 });
  });
});

describe('degenerate complexity inputs (pinned as-is; 2021 table, STANDARD = [13500, 20500, 29500, 44500])', () => {
  const OPENED = '2021-06-15';

  it('pins: complexity null throws "complexity is required"', () => {
    expect(() => calc({ type: 'STANDARD', complexity: null, openedAt: OPENED })).toThrow('complexity is required');
  });

  it('pins: missing complexity (undefined) throws "complexity is required"', () => {
    expect(() => calc({ type: 'STANDARD', openedAt: OPENED } as CaseInput)).toThrow('complexity is required');
  });

  it('pins: complexity NaN is caught by the `!band` check and falls back to band 1 (13500)', () => {
    expect(calc({ type: 'STANDARD', complexity: Number.NaN, openedAt: OPENED })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('pins: complexity 0 falls back to band 1 (13500)', () => {
    expect(calc({ type: 'STANDARD', complexity: 0, openedAt: OPENED })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('pins: negative complexity (-7) falls back to band 1 (13500)', () => {
    expect(calc({ type: 'STANDARD', complexity: -7, openedAt: OPENED })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('pins: complexity 5 clamps to band 4 (44500)', () => {
    expect(calc({ type: 'STANDARD', complexity: 5, openedAt: OPENED })).toEqual({
      table: '2021', bandFee: 44500, urgencyFee: 0, expeditedFee: 0, total: 44500,
    });
  });

  it('pins: fractional complexity 4.7 clamps to band 4 (44500)', () => {
    expect(calc({ type: 'STANDARD', complexity: 4.7, openedAt: OPENED })).toEqual({
      table: '2021', bandFee: 44500, urgencyFee: 0, expeditedFee: 0, total: 44500,
    });
  });

  it('pins: Infinity complexity clamps to band 4 (44500)', () => {
    expect(calc({ type: 'STANDARD', complexity: Number.POSITIVE_INFINITY, openedAt: OPENED })).toEqual({
      table: '2021', bandFee: 44500, urgencyFee: 0, expeditedFee: 0, total: 44500,
    });
  });

  it('pins F5 as-is (sharp edge): fractional in-band complexity 1.5 slips past the clamps - bandFee undefined, total NaN', () => {
    const out = calc({ type: 'STANDARD', complexity: 1.5, openedAt: OPENED });
    expect(out.table).toBe('2021');
    expect(out.bandFee).toBeUndefined();
    expect(out.urgencyFee).toBe(0);
    expect(out.expeditedFee).toBe(0);
    expect(out.total).toBeNaN();
  });

  it('pins F5 as-is: with a deadline in the window, complexity 1.5 also makes urgencyFee NaN', () => {
    const out = calc({ type: 'STANDARD', complexity: 1.5, openedAt: OPENED, deadline: '2023-03-05' });
    expect(out.bandFee).toBeUndefined();
    expect(out.urgencyFee).toBeNaN();
    expect(out.expeditedFee).toBe(0);
    expect(out.total).toBeNaN();
  });
});

describe('unknown case types (pinned as-is)', () => {
  it('pins F6 as-is: unknown type BANKRUPTCY falls back to STANDARD pricing (2021 table, band 3 -> 29500)', () => {
    expect(calc({ type: 'BANKRUPTCY', complexity: 3, openedAt: '2021-06-15' })).toEqual({
      table: '2021', bandFee: 29500, urgencyFee: 0, expeditedFee: 0, total: 29500,
    });
  });

  it('pins F6 as-is: lookup is case-sensitive - lowercase "standard" also falls back to STANDARD (band 1 -> 13500)', () => {
    expect(calc({ type: 'standard', complexity: 1, openedAt: '2021-06-15' })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('pins F6 as-is: empty-string type falls back to STANDARD (band 2 -> 20500)', () => {
    expect(calc({ type: '', complexity: 2, openedAt: '2021-06-15' })).toEqual({
      table: '2021', bandFee: 20500, urgencyFee: 0, expeditedFee: 0, total: 20500,
    });
  });

  it('pins F6 as-is: "COMMERCIAL " (trailing space) is unrecognized and falls back to STANDARD (band 4 -> 44500)', () => {
    expect(calc({ type: 'COMMERCIAL ', complexity: 4, openedAt: '2021-06-15' })).toEqual({
      table: '2021', bandFee: 44500, urgencyFee: 0, expeditedFee: 0, total: 44500,
    });
  });

  it('pins F6 as-is: the fallback follows the era - BANKRUPTCY on the 2022 table gets 2022 STANDARD band 1 (15000)', () => {
    expect(calc({ type: 'BANKRUPTCY', complexity: 1, openedAt: '2023-06-15' })).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });
});
