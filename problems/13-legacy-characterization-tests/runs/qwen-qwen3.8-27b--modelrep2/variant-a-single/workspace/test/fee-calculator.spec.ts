// Characterization suite for feeCalculator.ts (case fee calculator, in
// production since 2019; historical outputs are stored and audited).
//
// Purpose: pin current behaviour -- quirks and bugs included -- so the planned
// modification is provably behaviour-preserving. This suite passes on the
// unmodified module today; after any change it must still pass (or, for a
// finding the team has explicitly decided to fix, the corresponding tagged
// test is updated deliberately, never silently).
//
// Determinism: the module reads the wall clock only when `now` is falsy.
// Every call below injects a fixed `now` through the module's existing
// optional `now` parameter -- the only injection point allowed. No real
// dates, no randomness.
//
// [F-n] tags in test names refer to findings in FINDINGS.md. [BUG] marks
// genuine defects, [QUIRK] marks surprising-but-pinned behaviour. All are
// pinned AS THEY ARE; no fix is applied here.

import { describe, expect, it } from 'vitest';
import { calculateFee } from '../feeCalculator';
import type { CaseInput, FeeBreakdown } from '../feeCalculator';

type TableName = '2019' | '2021' | '2022';
const TABLES = ['2019', '2021', '2022'] as const;
const TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;

// Fixed fake clock.
const NOW = '2024-01-15';

// Representative opening date per rate table (mid-period, away from edges).
const OPENED_AT: Record<TableName, string> = {
  '2019': '2019-06-15',
  '2021': '2021-06-15',
  '2022': '2023-03-15',
};

// Deadline exactly 7 days after NOW: the inclusive urgency edge.
const DEADLINE_AT_EDGE = '2024-01-22';
// Deadline 8 days after NOW: just outside the urgency window.
const DEADLINE_OUTSIDE = '2024-01-23';

// ---------------------------------------------------------------------------
// Pinned literals (cents). These transcribe the historical rate tables and the
// per-step surcharges; they ARE the pin. Any change to the shipped rate data
// or to the arithmetic fails the suite.
//
// Reference rules pinned here:
//   urgency%   = 15 (2019, 2021) | 18 (2022),  of bandFee
//   expedited% = 10 (2019)       | 12 (2021, 2022), of bandFee + urgencyFee
//   rounding   = Math.round (half-up) at each surcharge step
// ---------------------------------------------------------------------------

const BASE_FEES: Record<TableName, Record<string, number[]>> = {
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

interface ModifierRow {
  urgency: number;
  expedited: number;
  total: number;
}
type ModifierTable = Record<TableName, Record<string, ModifierRow[]>>;

// urgency only: deadline exactly 7 days after now.
const URGENT_ONLY: ModifierTable = {
  '2019': {
    STANDARD: [
      { urgency: 1800, expedited: 0, total: 13800 },
      { urgency: 2775, expedited: 0, total: 21275 },
      { urgency: 4050, expedited: 0, total: 31050 },
      { urgency: 6150, expedited: 0, total: 47150 },
    ],
    COMMERCIAL: [
      { urgency: 3300, expedited: 0, total: 25300 },
      { urgency: 4725, expedited: 0, total: 36225 },
      { urgency: 6750, expedited: 0, total: 51750 },
      { urgency: 10200, expedited: 0, total: 78200 },
    ],
    ESTATE: [
      { urgency: 2700, expedited: 0, total: 20700 },
      { urgency: 3900, expedited: 0, total: 29900 },
      { urgency: 5925, expedited: 0, total: 45425 },
      { urgency: 9000, expedited: 0, total: 69000 },
    ],
    APPEAL: [
      { urgency: 4500, expedited: 0, total: 34500 },
      { urgency: 6300, expedited: 0, total: 48300 },
      { urgency: 9150, expedited: 0, total: 70150 },
      { urgency: 13800, expedited: 0, total: 105800 },
    ],
  },
  '2021': {
    STANDARD: [
      { urgency: 2025, expedited: 0, total: 15525 },
      { urgency: 3075, expedited: 0, total: 23575 },
      { urgency: 4425, expedited: 0, total: 33925 },
      { urgency: 6675, expedited: 0, total: 51175 },
    ],
    COMMERCIAL: [
      { urgency: 3600, expedited: 0, total: 27600 },
      { urgency: 5100, expedited: 0, total: 39100 },
      { urgency: 7275, expedited: 0, total: 55775 },
      { urgency: 10950, expedited: 0, total: 83950 },
    ],
    ESTATE: [
      { urgency: 2925, expedited: 0, total: 22425 },
      { urgency: 4200, expedited: 0, total: 32200 },
      { urgency: 6375, expedited: 0, total: 48875 },
      { urgency: 9675, expedited: 0, total: 74175 },
    ],
    APPEAL: [
      { urgency: 4875, expedited: 0, total: 37375 },
      { urgency: 6825, expedited: 0, total: 52325 },
      { urgency: 9900, expedited: 0, total: 75900 },
      { urgency: 14850, expedited: 0, total: 113850 },
    ],
  },
  '2022': {
    STANDARD: [
      { urgency: 2700, expedited: 0, total: 17700 },
      { urgency: 4050, expedited: 0, total: 26550 },
      { urgency: 5850, expedited: 0, total: 38350 },
      { urgency: 8820, expedited: 0, total: 57820 },
    ],
    COMMERCIAL: [
      { urgency: 4770, expedited: 0, total: 31270 },
      { urgency: 6750, expedited: 0, total: 44250 },
      { urgency: 9630, expedited: 0, total: 63130 },
      { urgency: 14490, expedited: 0, total: 94990 },
    ],
    ESTATE: [
      { urgency: 3870, expedited: 0, total: 25370 },
      { urgency: 5580, expedited: 0, total: 36580 },
      { urgency: 8460, expedited: 0, total: 55460 },
      { urgency: 12780, expedited: 0, total: 83780 },
    ],
    APPEAL: [
      { urgency: 6480, expedited: 0, total: 42480 },
      { urgency: 9000, expedited: 0, total: 59000 },
      { urgency: 13050, expedited: 0, total: 85550 },
      { urgency: 19620, expedited: 0, total: 128620 },
    ],
  },
};

// expedited only: no deadline.
const EXPEDITED_ONLY: ModifierTable = {
  '2019': {
    STANDARD: [
      { urgency: 0, expedited: 1200, total: 13200 },
      { urgency: 0, expedited: 1850, total: 20350 },
      { urgency: 0, expedited: 2700, total: 29700 },
      { urgency: 0, expedited: 4100, total: 45100 },
    ],
    COMMERCIAL: [
      { urgency: 0, expedited: 2200, total: 24200 },
      { urgency: 0, expedited: 3150, total: 34650 },
      { urgency: 0, expedited: 4500, total: 49500 },
      { urgency: 0, expedited: 6800, total: 74800 },
    ],
    ESTATE: [
      { urgency: 0, expedited: 1800, total: 19800 },
      { urgency: 0, expedited: 2600, total: 28600 },
      { urgency: 0, expedited: 3950, total: 43450 },
      { urgency: 0, expedited: 6000, total: 66000 },
    ],
    APPEAL: [
      { urgency: 0, expedited: 3000, total: 33000 },
      { urgency: 0, expedited: 4200, total: 46200 },
      { urgency: 0, expedited: 6100, total: 67100 },
      { urgency: 0, expedited: 9200, total: 101200 },
    ],
  },
  '2021': {
    STANDARD: [
      { urgency: 0, expedited: 1620, total: 15120 },
      { urgency: 0, expedited: 2460, total: 22960 },
      { urgency: 0, expedited: 3540, total: 33040 },
      { urgency: 0, expedited: 5340, total: 49840 },
    ],
    COMMERCIAL: [
      { urgency: 0, expedited: 2880, total: 26880 },
      { urgency: 0, expedited: 4080, total: 38080 },
      { urgency: 0, expedited: 5820, total: 54320 },
      { urgency: 0, expedited: 8760, total: 81760 },
    ],
    ESTATE: [
      { urgency: 0, expedited: 2340, total: 21840 },
      { urgency: 0, expedited: 3360, total: 31360 },
      { urgency: 0, expedited: 5100, total: 47600 },
      { urgency: 0, expedited: 7740, total: 72240 },
    ],
    APPEAL: [
      { urgency: 0, expedited: 3900, total: 36400 },
      { urgency: 0, expedited: 5460, total: 50960 },
      { urgency: 0, expedited: 7920, total: 73920 },
      { urgency: 0, expedited: 11880, total: 110880 },
    ],
  },
  '2022': {
    STANDARD: [
      { urgency: 0, expedited: 1800, total: 16800 },
      { urgency: 0, expedited: 2700, total: 25200 },
      { urgency: 0, expedited: 3900, total: 36400 },
      { urgency: 0, expedited: 5880, total: 54880 },
    ],
    COMMERCIAL: [
      { urgency: 0, expedited: 3180, total: 29680 },
      { urgency: 0, expedited: 4500, total: 42000 },
      { urgency: 0, expedited: 6420, total: 59920 },
      { urgency: 0, expedited: 9660, total: 90160 },
    ],
    ESTATE: [
      { urgency: 0, expedited: 2580, total: 24080 },
      { urgency: 0, expedited: 3720, total: 34720 },
      { urgency: 0, expedited: 5640, total: 52640 },
      { urgency: 0, expedited: 8520, total: 79520 },
    ],
    APPEAL: [
      { urgency: 0, expedited: 4320, total: 40320 },
      { urgency: 0, expedited: 6000, total: 56000 },
      { urgency: 0, expedited: 8700, total: 81200 },
      { urgency: 0, expedited: 13080, total: 122080 },
    ],
  },
};

// urgent + expedited: deadline exactly 7 days after now AND expedited flag.
const URGENT_AND_EXPEDITED: ModifierTable = {
  '2019': {
    STANDARD: [
      { urgency: 1800, expedited: 1380, total: 15180 },
      { urgency: 2775, expedited: 2128, total: 23403 },
      { urgency: 4050, expedited: 3105, total: 34155 },
      { urgency: 6150, expedited: 4715, total: 51865 },
    ],
    COMMERCIAL: [
      { urgency: 3300, expedited: 2530, total: 27830 },
      { urgency: 4725, expedited: 3623, total: 39848 },
      { urgency: 6750, expedited: 5175, total: 57925 },
      { urgency: 10200, expedited: 7820, total: 86020 },
    ],
    ESTATE: [
      { urgency: 2700, expedited: 2070, total: 22770 },
      { urgency: 3900, expedited: 2990, total: 32890 },
      { urgency: 5925, expedited: 4543, total: 49968 },
      { urgency: 9000, expedited: 6900, total: 77900 },
    ],
    APPEAL: [
      { urgency: 4500, expedited: 3450, total: 37950 },
      { urgency: 6300, expedited: 4830, total: 53130 },
      { urgency: 9150, expedited: 7015, total: 77165 },
      { urgency: 13800, expedited: 10580, total: 119380 },
    ],
  },
  '2021': {
    STANDARD: [
      { urgency: 2025, expedited: 1863, total: 17388 },
      { urgency: 3075, expedited: 2829, total: 26404 },
      { urgency: 4425, expedited: 4071, total: 37996 },
      { urgency: 6675, expedited: 6141, total: 57316 },
    ],
    COMMERCIAL: [
      { urgency: 3600, expedited: 3312, total: 30912 },
      { urgency: 5100, expedited: 4692, total: 43792 },
      { urgency: 7275, expedited: 6693, total: 62468 },
      { urgency: 10950, expedited: 10074, total: 94024 },
    ],
    ESTATE: [
      { urgency: 2925, expedited: 2691, total: 25116 },
      { urgency: 4200, expedited: 3864, total: 36064 },
      { urgency: 6375, expedited: 5865, total: 54740 },
      { urgency: 9675, expedited: 8901, total: 83076 },
    ],
    APPEAL: [
      { urgency: 4875, expedited: 4485, total: 41860 },
      { urgency: 6825, expedited: 6279, total: 58604 },
      { urgency: 9900, expedited: 9108, total: 85008 },
      { urgency: 14850, expedited: 13662, total: 127512 },
    ],
  },
  '2022': {
    STANDARD: [
      { urgency: 2700, expedited: 2124, total: 19824 },
      { urgency: 4050, expedited: 3186, total: 29736 },
      { urgency: 5850, expedited: 4602, total: 42952 },
      { urgency: 8820, expedited: 6938, total: 64758 },
    ],
    COMMERCIAL: [
      { urgency: 4770, expedited: 3752, total: 35022 },
      { urgency: 6750, expedited: 5310, total: 49560 },
      { urgency: 9630, expedited: 7576, total: 70706 },
      { urgency: 14490, expedited: 11399, total: 106389 },
    ],
    ESTATE: [
      { urgency: 3870, expedited: 3044, total: 28414 },
      { urgency: 5580, expedited: 4390, total: 40970 },
      { urgency: 8460, expedited: 6655, total: 62115 },
      { urgency: 12780, expedited: 10054, total: 93834 },
    ],
    APPEAL: [
      { urgency: 6480, expedited: 5098, total: 47578 },
      { urgency: 9000, expedited: 7080, total: 66080 },
      { urgency: 13050, expedited: 10266, total: 95816 },
      { urgency: 19620, expedited: 15434, total: 144054 },
    ],
  },
};

/**
 * Every call injects a fixed `now`; the suite never lets the module fall back
 * to the wall clock (that fallback is FINDINGS.md F-9 and is documented in
 * prose only, because pinning it would require a real date).
 */
function fee(over: Partial<CaseInput> = {}, now: string = NOW): FeeBreakdown {
  return calculateFee(
    { type: 'STANDARD', complexity: 1, openedAt: '2019-06-15', ...over },
    now,
  );
}

interface MatrixCase {
  table: TableName;
  openedAt: string;
  type: string;
  band: number;
  urgency: number;
  expedited: number;
  total: number;
}

function rowsOf(source: ModifierTable): MatrixCase[] {
  const out: MatrixCase[] = [];
  for (const table of TABLES) {
    for (const type of TYPES) {
      source[table][type].forEach((row, i) => {
        out.push({ table, openedAt: OPENED_AT[table], type, band: i + 1, ...row });
      });
    }
  }
  return out;
}

const baseCases = TABLES.flatMap((table) =>
  TYPES.flatMap((type) =>
    BASE_FEES[table][type].map((bandFee, i) => ({ table, type, band: i + 1, bandFee })),
  ),
);

// ---------------------------------------------------------------------------
// Rate-table selection by openedAt
// ---------------------------------------------------------------------------

describe('rate-table selection by openedAt', () => {
  it('opened 2019-06-15 (mid-2019) -> 2019 table', () => {
    expect(fee({ openedAt: '2019-06-15' })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('opened 2020-12-31 (day before the 2021 revision) -> 2019 table', () => {
    expect(fee({ openedAt: '2020-12-31' })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('opened 2021-01-01 (the 2021 revision day, inclusive edge) -> 2021 table', () => {
    expect(fee({ openedAt: '2021-01-01' })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('opened 2022-06-30 (day before the 2022 revision) -> 2021 table', () => {
    expect(fee({ openedAt: '2022-06-30' })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('[F-1 / BUG] opened 2022-07-01 (the 2022 revision day itself) still bills at 2021 rates', () => {
    // tableFor() compares `openedAt > REVISION_2022` (strict), unlike the
    // inclusive `>=` of the 2021 transition. A 2022 table would bill
    // STANDARD band 1 at 15000, not 13500.
    expect(fee({ openedAt: '2022-07-01' })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500,
    });
  });

  it('opened 2022-07-02 (first day under the 2022 table) -> 2022 table', () => {
    expect(fee({ openedAt: '2022-07-02' })).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });

  it('[F-10 / QUIRK] non-ISO openedAt compares lexicographically: "January 5, 2021" -> 2022 table', () => {
    expect(fee({ openedAt: 'January 5, 2021' })).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });

  it('[F-10 / QUIRK] non-padded "2022-7-1" (same day as F-1) -> 2022 table, unlike padded "2022-07-01"', () => {
    expect(fee({ openedAt: '2022-7-1' })).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });

  it('[F-10 / QUIRK] empty openedAt -> 2019 table', () => {
    expect(fee({ openedAt: '' })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });
});

// ---------------------------------------------------------------------------
// Base band fees: every case type x complexity band, no surcharges
// ---------------------------------------------------------------------------

describe('base band fees: every case type x complexity band, no surcharges (48 pins)', () => {
  it.each(baseCases)('$table $type band $band -> $bandFee cents', (c) => {
    expect(fee({ openedAt: OPENED_AT[c.table], type: c.type, complexity: c.band })).toEqual({
      table: c.table,
      bandFee: c.bandFee,
      urgencyFee: 0,
      expeditedFee: 0,
      total: c.bandFee,
    });
  });
});

// ---------------------------------------------------------------------------
// Urgency surcharge
// ---------------------------------------------------------------------------

describe('urgency surcharge: deadline measured against the injected now', () => {
  it('no deadline -> no urgency', () => {
    expect(fee({}).urgencyFee).toBe(0);
  });

  it('deadline 8 days after now (2024-01-23) -> no urgency (exclusive edge)', () => {
    expect(fee({ deadline: DEADLINE_OUTSIDE })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('deadline exactly 7 days after now (2024-01-22) -> urgency (inclusive edge)', () => {
    expect(fee({ deadline: DEADLINE_AT_EDGE })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 0, total: 13800,
    });
  });

  it('deadline 8 days after now, stated with a time (2024-01-23T00:00:00Z) -> no urgency', () => {
    expect(fee({ deadline: '2024-01-23T00:00:00Z' }).urgencyFee).toBe(0);
  });

  it('deadline the same day as now -> urgency (0 <= 7)', () => {
    expect(fee({ deadline: NOW }).urgencyFee).toBe(1800);
  });

  it('[F-3 / QUIRK] deadline in the past (-14 days) -> urgency still applies', () => {
    expect(fee({ deadline: '2024-01-01' })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 0, total: 13800,
    });
  });

  it('[F-3 / QUIRK] deadline a year and a half in the past -> urgency still applies', () => {
    expect(fee({ deadline: '2022-07-15' }).urgencyFee).toBe(1800);
  });

  it('deadline "" (falsy) -> no urgency', () => {
    expect(fee({ deadline: '' }).urgencyFee).toBe(0);
  });

  it('[F-8 / QUIRK] deadline 7d + 12h after now -> floor(7.5) = 7 -> urgency', () => {
    expect(fee({ deadline: '2024-01-22T12:00:00Z' }).urgencyFee).toBe(1800);
  });

  it('[F-8 / QUIRK] deadline 7d + 23h59m59s after now -> floor(7.9997) = 7 -> urgency', () => {
    expect(fee({ deadline: '2024-01-22T23:59:59Z' }).urgencyFee).toBe(1800);
  });

  it('urgency is measured against the injected now, not openedAt', () => {
    expect(fee({ deadline: '2024-01-20' }, '2024-01-13').urgencyFee).toBe(1800); // 7 days
    expect(fee({ deadline: '2024-01-20' }, '2024-01-12').urgencyFee).toBe(0); // 8 days
  });

  it('urgencyFee is the table pct of bandFee alone (never of bandFee + expeditedFee)', () => {
    // 15% of 18500 = 2775. (15% of 18500 + 1850 would be 3053.)
    const r = fee({ complexity: 2, deadline: DEADLINE_AT_EDGE, expedited: true });
    expect(r).toEqual({
      table: '2019', bandFee: 18500, urgencyFee: 2775, expeditedFee: 2128, total: 23403,
    });
  });
});

// ---------------------------------------------------------------------------
// Expedited surcharge
// ---------------------------------------------------------------------------

describe('expedited surcharge', () => {
  it('expedited, no urgency: 2019 table -> 10% of bandFee', () => {
    expect(fee({ expedited: true })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 1200, total: 13200,
    });
  });

  it('expedited, no urgency: 2021 table -> 12% of bandFee', () => {
    expect(fee({ openedAt: '2021-06-15', expedited: true })).toEqual({
      table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 1620, total: 15120,
    });
  });

  it('expedited, no urgency: 2022 table -> 12% of bandFee', () => {
    expect(fee({ openedAt: '2023-03-15', expedited: true })).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 1800, total: 16800,
    });
  });

  it('[F-4 / QUIRK] with urgency, expedited% compounds on (bandFee + urgencyFee), not on bandFee', () => {
    // 10% of 13800 = 1380, NOT 10% of 12000 = 1200.
    const r = fee({ deadline: DEADLINE_AT_EDGE, expedited: true });
    expect(r).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 1800, expeditedFee: 1380, total: 15180,
    });
  });

  it('expedited: false is identical to the flag being absent', () => {
    expect(fee({ expedited: false })).toEqual(fee({}));
  });
});

// ---------------------------------------------------------------------------
// Full modifier matrices (type x band per table)
// ---------------------------------------------------------------------------

describe('urgent only: full type x band matrix per table (48 pins)', () => {
  it.each(rowsOf(URGENT_ONLY))('$table $type band $band -> $urgency urgency, $total total', (c) => {
    expect(fee({ openedAt: c.openedAt, type: c.type, complexity: c.band, deadline: DEADLINE_AT_EDGE })).toEqual({
      table: c.table,
      bandFee: BASE_FEES[c.table][c.type][c.band - 1],
      urgencyFee: c.urgency,
      expeditedFee: 0,
      total: c.total,
    });
  });
});

describe('expedited only: full type x band matrix per table (48 pins)', () => {
  it.each(rowsOf(EXPEDITED_ONLY))('$table $type band $band -> $expedited expedited, $total total', (c) => {
    expect(fee({ openedAt: c.openedAt, type: c.type, complexity: c.band, expedited: true })).toEqual({
      table: c.table,
      bandFee: BASE_FEES[c.table][c.type][c.band - 1],
      urgencyFee: 0,
      expeditedFee: c.expedited,
      total: c.total,
    });
  });
});

describe('urgent + expedited: full type x band matrix per table (48 pins)', () => {
  it.each(rowsOf(URGENT_AND_EXPEDITED))('$table $type band $band -> $urgency + $expedited, $total total', (c) => {
    expect(
      fee({ openedAt: c.openedAt, type: c.type, complexity: c.band, deadline: DEADLINE_AT_EDGE, expedited: true }),
    ).toEqual({
      table: c.table,
      bandFee: BASE_FEES[c.table][c.type][c.band - 1],
      urgencyFee: c.urgency,
      expeditedFee: c.expedited,
      total: c.total,
    });
  });
});

// ---------------------------------------------------------------------------
// Rounding at each step
// ---------------------------------------------------------------------------

describe('rounding at each step (Math.round, half-up, per component)', () => {
  it('2019 half-cent expedited fees round UP: 2127.5 -> 2128, 3622.5 -> 3623, 4542.5 -> 4543', () => {
    const halfCases = [
      { type: 'STANDARD', band: 2, expedited: 2128, total: 23403 }, // 10% of 21275
      { type: 'COMMERCIAL', band: 2, expedited: 3623, total: 39848 }, // 10% of 36225
      { type: 'ESTATE', band: 3, expedited: 4543, total: 49968 }, // 10% of 45425
    ];
    for (const c of halfCases) {
      const r = fee({ type: c.type, complexity: c.band, deadline: DEADLINE_AT_EDGE, expedited: true });
      expect(r.expeditedFee).toBe(c.expedited);
      expect(r.total).toBe(c.total);
    }
  });

  it('2022 fractional expedited fees round to nearest, in both directions', () => {
    const down = [
      { type: 'STANDARD', band: 4, expedited: 6938, total: 64758 }, // 6938.4
      { type: 'COMMERCIAL', band: 1, expedited: 3752, total: 35022 }, // 3752.4
      { type: 'ESTATE', band: 1, expedited: 3044, total: 28414 }, // 3044.4
      { type: 'ESTATE', band: 3, expedited: 6655, total: 62115 }, // 6655.2
      { type: 'APPEAL', band: 4, expedited: 15434, total: 144054 }, // 15434.4
    ];
    const up = [
      { type: 'COMMERCIAL', band: 3, expedited: 7576, total: 70706 }, // 7575.6
      { type: 'COMMERCIAL', band: 4, expedited: 11399, total: 106389 }, // 11398.8
      { type: 'ESTATE', band: 2, expedited: 4390, total: 40970 }, // 4389.6
      { type: 'ESTATE', band: 4, expedited: 10054, total: 93834 }, // 10053.6
      { type: 'APPEAL', band: 1, expedited: 5098, total: 47578 }, // 5097.6
    ];
    for (const c of [...down, ...up]) {
      const r = fee({
        openedAt: '2023-03-15',
        type: c.type,
        complexity: c.band,
        deadline: DEADLINE_AT_EDGE,
        expedited: true,
      });
      expect(r.expeditedFee).toBe(c.expedited);
      expect(r.total).toBe(c.total);
    }
  });

  it('whole-cent invariant: every emitted amount is an integer and total is exactly bandFee + urgencyFee + expeditedFee, for every valid type x band x modifier state', () => {
    for (const table of TABLES) {
      for (const type of TYPES) {
        for (let band = 1; band <= 4; band += 1) {
          for (const deadline of [undefined, DEADLINE_AT_EDGE]) {
            for (const expedited of [false, true]) {
              const r = fee({ openedAt: OPENED_AT[table], type, complexity: band, deadline, expedited });
              expect(Number.isInteger(r.bandFee)).toBe(true);
              expect(Number.isInteger(r.urgencyFee)).toBe(true);
              expect(Number.isInteger(r.expeditedFee)).toBe(true);
              expect(r.total).toBe(r.bandFee + r.urgencyFee + r.expeditedFee);
            }
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Degenerate complexity
// ---------------------------------------------------------------------------

describe('degenerate complexity inputs', () => {
  it('null complexity -> throws "complexity is required"', () => {
    expect(() => fee({ complexity: null })).toThrow('complexity is required');
  });

  it('undefined complexity -> throws "complexity is required"', () => {
    expect(() => fee({ complexity: undefined })).toThrow('complexity is required');
  });

  it('[F-7 / QUIRK] zero complexity -> silently billed at band 1', () => {
    expect(fee({ complexity: 0 })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('[F-7 / QUIRK] negative complexity -> silently billed at band 1', () => {
    for (const c of [-1, -3, -100]) {
      expect(fee({ complexity: c }).bandFee).toBe(12000);
    }
  });

  it('[F-7 / QUIRK] 0 < complexity < 1 -> silently billed at band 1', () => {
    expect(fee({ complexity: 0.5 }).bandFee).toBe(12000);
    expect(fee({ complexity: 0.99 }).bandFee).toBe(12000);
  });

  it('[F-7 / QUIRK] NaN complexity -> silently billed at band 1 (via !band)', () => {
    expect(fee({ complexity: NaN })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
  });

  it('complexity above band 4 -> clamped to band 4', () => {
    for (const c of [4.5, 5, 10, 999]) {
      expect(fee({ complexity: c }).bandFee).toBe(41000);
    }
  });

  it('[F-2 / BUG] fractional complexity strictly inside (1,4) slips past both clamps -> bandFee undefined, total NaN', () => {
    for (const c of [1.1, 1.5, 2.5, 3.99]) {
      const r = fee({ complexity: c });
      expect(r.table).toBe('2019');
      expect(r).toHaveProperty('bandFee');
      expect(r.bandFee).toBeUndefined();
      expect(r.urgencyFee).toBe(0);
      expect(r.expeditedFee).toBe(0);
      expect(r.total).toBe(NaN);
    }
  });

  it('[F-2 / BUG] fractional complexity + urgent deadline -> urgencyFee and total are also NaN', () => {
    const r = fee({ complexity: 2.5, deadline: DEADLINE_AT_EDGE });
    expect(r.bandFee).toBeUndefined();
    expect(r.urgencyFee).toBe(NaN);
    expect(r.total).toBe(NaN);
  });

  it('[F-2 / BUG] fractional complexity + expedited -> expeditedFee and total are NaN', () => {
    const r = fee({ complexity: 2.5, expedited: true });
    expect(r.expeditedFee).toBe(NaN);
    expect(r.total).toBe(NaN);
  });
});

// ---------------------------------------------------------------------------
// Degenerate case types (type is an unvalidated string)
// ---------------------------------------------------------------------------

describe('degenerate case types', () => {
  it('[F-5 / QUIRK] unknown type silently falls back to the selected table STANDARD rates', () => {
    expect(fee({ type: 'MUNICIPAL' })).toEqual({
      table: '2019', bandFee: 12000, urgencyFee: 0, expeditedFee: 0, total: 12000,
    });
    expect(fee({ type: 'MUNICIPAL', openedAt: '2023-03-15' })).toEqual({
      table: '2022', bandFee: 15000, urgencyFee: 0, expeditedFee: 0, total: 15000,
    });
  });

  it('[F-5 / QUIRK] type lookup is case-sensitive: "commercial" -> STANDARD', () => {
    expect(fee({ type: 'commercial' }).bandFee).toBe(12000);
  });

  it('[F-5 / QUIRK] "COMMERCIAL " (trailing space) -> STANDARD', () => {
    expect(fee({ type: 'COMMERCIAL ' }).bandFee).toBe(12000);
  });

  it('[F-5 / QUIRK] empty type -> STANDARD', () => {
    expect(fee({ type: '' }).bandFee).toBe(12000);
  });

  it('[F-6 / QUIRK] type "constructor" resolves to Object.prototype.constructor (truthy) -> bandFee undefined, total NaN', () => {
    const r = fee({ type: 'constructor' });
    expect(r.table).toBe('2019');
    expect(r).toHaveProperty('bandFee');
    expect(r.bandFee).toBeUndefined();
    expect(r.total).toBe(NaN);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism (fixed injected clock, no randomness)', () => {
  it('repeating an identical call yields an identical breakdown', () => {
    const args: Partial<CaseInput> = {
      openedAt: '2022-07-02',
      type: 'APPEAL',
      complexity: 4,
      deadline: DEADLINE_AT_EDGE,
      expedited: true,
    };
    const a = fee(args);
    const b = fee({ ...args });
    expect(a).toEqual(b);
    expect(a).toEqual({
      table: '2022', bandFee: 109000, urgencyFee: 19620, expeditedFee: 15434, total: 144054,
    });
  });

  it('changing now (with no deadline) does not change the breakdown', () => {
    expect(fee({ openedAt: '2021-06-15' }, '2020-06-01')).toEqual(fee({ openedAt: '2021-06-15' }, '2030-06-01'));
  });
});
