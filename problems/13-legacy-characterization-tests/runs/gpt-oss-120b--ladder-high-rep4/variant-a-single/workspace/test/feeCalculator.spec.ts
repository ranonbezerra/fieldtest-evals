import { describe, expect, test } from 'vitest';
import { calculateFee, CaseInput, FeeBreakdown } from '../feeCalculator.ts';

/**
 * In‑test replica of the rate tables used by `feeCalculator.ts`.
 * This is *data only* – the calculation logic is reproduced in `computeExpected`
 * and is independent of the implementation under test.
 */
const RATE_TABLES = {
  '2019': {
    base: {
      STANDARD: [12000, 18500, 27000, 41000],
      COMMERCIAL: [22000, 31500, 45000, 68000],
      ESTATE: [18000, 26000, 39500, 60000],
      APPEAL: [30000, 42000, 61000, 92000],
    },
    urgencyPct: 15,
    expeditedPct: 10,
  },
  '2021': {
    base: {
      STANDARD: [13500, 20500, 29500, 44500],
      COMMERCIAL: [24000, 34000, 48500, 73000],
      ESTATE: [19500, 28000, 42500, 64500],
      APPEAL: [32500, 45500, 66000, 99000],
    },
    urgencyPct: 15,
    expeditedPct: 12,
  },
  '2022': {
    base: {
      STANDARD: [15000, 22500, 32500, 49000],
      COMMERCIAL: [26500, 37500, 53500, 80500],
      ESTATE: [21500, 31000, 47000, 71000],
      APPEAL: [36000, 50000, 72500, 109000],
    },
    urgencyPct: 18,
    expeditedPct: 12,
  },
} as const;

/**
 * Mirrors the date‑selection logic in `feeCalculator.ts`,
 * including the bug where the 2022 revision is exclusive.
 */
function selectTable(openedAt: string): '2019' | '2021' | '2022' {
  if (openedAt >= '2021-01-01') {
    if (openedAt > '2022-07-01') {
      return '2022';
    }
    return '2021';
  }
  return '2019';
}

/**
 * Re‑implements the fee‑breakdown calculation *using only the data above*.
 * This is used to generate the expected values for the assertions.
 */
function computeExpected(input: CaseInput, now: string): FeeBreakdown {
  const tableName = selectTable(input.openedAt);
  const table = RATE_TABLES[tableName];

  // Resolve band (clamped to 1‑4)
  let band = input.complexity!;
  if (!band || band < 1) band = 1;
  if (band > 4) band = 4;

  // Resolve base fees, falling back to STANDARD for unknown types
  let bands = (table.base as Record<string, number[]>)[input.type];
  if (!bands) {
    bands = table.base['STANDARD'];
  }
  const bandFee = bands[band - 1];

  // Urgency
  let urgencyFee = 0;
  if (input.deadline) {
    const days =
      Math.floor(
        (new Date(input.deadline).getTime() - new Date(now).getTime()) /
          86400000,
      );
    if (days <= 7) {
      // Note: this mirrors the original bug where past deadlines (negative days) also trigger urgency.
      urgencyFee = Math.round((bandFee * table.urgencyPct) / 100);
    }
  }

  // Expedited
  let expeditedFee = 0;
  if (input.expedited) {
    expeditedFee = Math.round(((bandFee + urgencyFee) * table.expeditedPct) / 100);
  }

  return {
    table: tableName,
    bandFee,
    urgencyFee,
    expeditedFee,
    total: bandFee + urgencyFee + expeditedFee,
  };
}

/* -------------------------------------------------------------------------- */
/*  Full case‑type × complexity‑band matrix (no urgency, no expedited)      */
/* -------------------------------------------------------------------------- */
describe('FeeCalculator – full matrix (base fees only)', () => {
  const openedAtByTable = {
    '2019': '2020-06-15',
    '2021': '2021-06-15',
    '2022': '2023-01-01',
  } as const;

  const caseTypes = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
  const bands = [1, 2, 3, 4] as const;

  for (const tableName of Object.keys(openedAtByTable) as (keyof typeof openedAtByTable)[]) {
    const openedAt = openedAtByTable[tableName];
    for (const caseType of caseTypes) {
      for (const band of bands) {
        const input: CaseInput = {
          type: caseType,
          complexity: band,
          openedAt,
        };
        test(`table ${tableName} – ${caseType} – band ${band}`, () => {
          const now = openedAt; // reference date does not matter when no deadline
          const expected = computeExpected(input, now);
          const result = calculateFee(input, now);
          expect(result).toStrictEqual(expected);
        });
      }
    }
  }
});

/* -------------------------------------------------------------------------- */
/*  Urgency detection                                                       */
/* -------------------------------------------------------------------------- */
describe('FeeCalculator – urgency handling', () => {
  const baseInput: Omit<CaseInput, 'deadline' | 'expedited'> = {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2021-06-15',
  };
  const now = '2021-06-15';

  test('applies urgency fee when deadline is within 7 days (inclusive)', () => {
    const input: CaseInput = {
      ...baseInput,
      deadline: '2021-06-22', // exactly 7 days later
    };
    const expected = computeExpected(input, now);
    expect(expected.urgencyFee).toBeGreaterThan(0);
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('does NOT apply urgency fee when deadline is beyond 7 days', () => {
    const input: CaseInput = {
      ...baseInput,
      deadline: '2021-06-23', // 8 days later
    };
    const expected = computeExpected(input, now);
    expect(expected.urgencyFee).toBe(0);
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('urgency fee applied even when deadline is in the past (bug)', () => {
    const input: CaseInput = {
      ...baseInput,
      deadline: '2021-06-10', // 5 days BEFORE now
    };
    const expected = computeExpected(input, now);
    expect(expected.urgencyFee).toBeGreaterThan(0); // current buggy behavior
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });
});

/* -------------------------------------------------------------------------- */
/*  Expedited fee (with and without urgency)                                 */
/* -------------------------------------------------------------------------- */
describe('FeeCalculator – expedited handling', () => {
  const now = '2021-06-15';
  const baseInput: Omit<CaseInput, 'deadline' | 'expedited'> = {
    type: 'STANDARD',
    complexity: 1,
    openedAt: now,
  };

  test('expedited fee based on band fee only when not urgent', () => {
    const input: CaseInput = {
      ...baseInput,
      expedited: true,
    };
    const expected = computeExpected(input, now);
    expect(expected.urgencyFee).toBe(0);
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('expedited fee based on band + urgency when urgent', () => {
    const input: CaseInput = {
      ...baseInput,
      deadline: '2021-06-20', // within 7 days
      expedited: true,
    };
    const expected = computeExpected(input, now);
    expect(expected.urgencyFee).toBeGreaterThan(0);
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });
});

/* -------------------------------------------------------------------------- */
/*  Rounding quirks (expedited fee)                                         */
/* -------------------------------------------------------------------------- */
describe('FeeCalculator – rounding quirks (expedited fee)', () => {
  test('STANDARD band 2 in 2019 rounds expedited fee up (2128 cents)', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 2,
      openedAt: '2020-06-15', // 2019 table
      deadline: '2020-06-20', // urgent
      expedited: true,
    };
    const now = '2020-06-15';
    const expected = computeExpected(input, now);
    expect(expected.expeditedFee).toBe(2128);
    expect(expected.total).toBe(18500 + 2775 + 2128);
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('COMMERCIAL band 2 in 2019 rounds expedited fee up (3623 cents)', () => {
    const input: CaseInput = {
      type: 'COMMERCIAL',
      complexity: 2,
      openedAt: '2020-06-15',
      deadline: '2020-06-20',
      expedited: true,
    };
    const now = '2020-06-15';
    const expected = computeExpected(input, now);
    expect(expected.expeditedFee).toBe(3623);
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('ESTATE band 3 in 2019 rounds expedited fee up (4543 cents)', () => {
    const input: CaseInput = {
      type: 'ESTATE',
      complexity: 3,
      openedAt: '2020-06-15',
      deadline: '2020-06-20',
      expedited: true,
    };
    const now = '2020-06-15';
    const expected = computeExpected(input, now);
    expect(expected.expeditedFee).toBe(4543);
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });
});

/* -------------------------------------------------------------------------- */
/*  Edge‑case handling (rate‑table boundaries, unknown types, complexity)    */
/* -------------------------------------------------------------------------- */
describe('FeeCalculator – edge‑case handling', () => {
  test('selects 2021 table for openedAt exactly on 2021-01-01', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2021-01-01',
    };
    const now = '2021-01-01';
    const expected = computeExpected(input, now);
    expect(expected.table).toBe('2021');
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('selects 2021 table for openedAt exactly on 2022-07-01 (bug)', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-01',
    };
    const now = '2022-07-01';
    const expected = computeExpected(input, now);
    // The bug means the table is still 2021
    expect(expected.table).toBe('2021');
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('selects 2022 table for openedAt after 2022-07-01', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-02',
    };
    const now = '2022-07-02';
    const expected = computeExpected(input, now);
    expect(expected.table).toBe('2022');
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('unknown case type falls back to STANDARD base', () => {
    const input: CaseInput = {
      type: 'UNKNOWN',
      complexity: 1,
      openedAt: '2021-06-15',
    };
    const now = '2021-06-15';
    const expected = computeExpected(input, now);
    expect(expected.bandFee).toBe(13500); // STANDARD band 1 in 2021
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('complexity 0 treated as band 1', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 0,
      openedAt: '2021-06-15',
    };
    const now = '2021-06-15';
    const expected = computeExpected(input, now);
    expect(expected.bandFee).toBe(13500);
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('negative complexity treated as band 1', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: -5,
      openedAt: '2021-06-15',
    };
    const now = '2021-06-15';
    const expected = computeExpected(input, now);
    expect(expected.bandFee).toBe(13500);
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });

  test('complexity above 4 capped at band 4', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 10,
      openedAt: '2021-06-15',
    };
    const now = '2021-06-15';
    const expected = computeExpected(input, now);
    expect(expected.bandFee).toBe(44500); // STANDARD band 4 in 2021
    const result = calculateFee(input, now);
    expect(result).toStrictEqual(expected);
  });
});

/* -------------------------------------------------------------------------- */
/*  Validation of required fields                                            */
/* -------------------------------------------------------------------------- */
describe('FeeCalculator – validation', () => {
  test('throws when complexity is null', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: null,
      openedAt: '2021-06-15',
    };
    expect(() => calculateFee(input)).toThrow('complexity is required');
  });

  test('throws when complexity is undefined', () => {
    // Intentionally omit the property to get `undefined`
    const input = {
      type: 'STANDARD',
      openedAt: '2021-06-15',
    } as unknown as CaseInput;
    expect(() => calculateFee(input)).toThrow('complexity is required');
  });
});
