import { describe, expect, test } from 'vitest';
import { calculateFee, FeeBreakdown, CaseInput } from '../feeCalculator';

// Base fees for the 2019 rate table – used for the full matrix tests.
const BASE_2019: Record<string, number[]> = {
  STANDARD: [12000, 18500, 27000, 41000],
  COMMERCIAL: [22000, 31500, 45000, 68000],
  ESTATE: [18000, 26000, 39500, 60000],
  APPEAL: [30000, 42000, 61000, 92000],
};

describe('calculateFee – full case‑type × band matrix (2019 table)', () => {
  const openedAt = '2020-06-01'; // before 2021 revision → 2019 table
  const now = '2020-06-01';

  const matrix: Array<{
    type: string;
    band: number;
    expectedFee: FeeBreakdown;
  }> = [];

  // build all 4×4 combinations
  for (const type of Object.keys(BASE_2019) as Array<keyof typeof BASE_2019>) {
    const bands = BASE_2019[type];
    for (let i = 1; i <= 4; i++) {
      matrix.push({
        type,
        band: i,
        expectedFee: {
          table: '2019',
          bandFee: bands[i - 1],
          urgencyFee: 0,
          expeditedFee: 0,
          total: bands[i - 1],
        },
      });
    }
  }

  test.each(matrix)(
    'calculates fee for type $type, band $band',
    ({ type, band, expectedFee }) => {
      const input: CaseInput = {
        type,
        complexity: band,
        openedAt,
      };
      const result = calculateFee(input, now);
      expect(result).toEqual(expectedFee);
    },
  );
});

describe('calculateFee – edge‑case behaviours', () => {
  test('unknown case type falls back to STANDARD fees', () => {
    const input: CaseInput = {
      type: 'UNKNOWN_TYPE',
      complexity: 2,
      openedAt: '2020-06-01',
    };
    const result = calculateFee(input, '2020-06-01');
    // STANDARD band 2 in 2019 table = 18500
    expect(result).toMatchObject({
      table: '2019',
      bandFee: 18500,
      urgencyFee: 0,
      expeditedFee: 0,
      total: 18500,
    });
  });

  test('complexity null throws', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: null,
      openedAt: '2020-06-01',
    };
    expect(() => calculateFee(input)).toThrow('complexity is required');
  });

  test('complexity undefined throws', () => {
    const input: any = {
      type: 'STANDARD',
      // @ts-expect-error intentionally missing
      openedAt: '2020-06-01',
    };
    expect(() => calculateFee(input)).toThrow('complexity is required');
  });

  test('complexity zero is treated as band 1', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 0,
      openedAt: '2020-06-01',
    };
    const result = calculateFee(input, '2020-06-01');
    expect(result.bandFee).toBe(12000);
    expect(result.total).toBe(12000);
  });

  test('negative complexity is treated as band 1', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: -5,
      openedAt: '2020-06-01',
    };
    const result = calculateFee(input, '2020-06-01');
    expect(result.bandFee).toBe(12000);
    expect(result.total).toBe(12000);
  });

  test('complexity > 4 is treated as band 4', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 9,
      openedAt: '2020-06-01',
    };
    const result = calculateFee(input, '2020-06-01');
    expect(result.bandFee).toBe(41000);
    expect(result.total).toBe(41000);
  });
});

describe('calculateFee – urgency handling', () => {
  const now = '2021-06-01';

  test('urgency applies when deadline is exactly 7 days away (inclusive)', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2020-06-01',
      deadline: '2021-06-08', // 7 days after now
    };
    const result = calculateFee(input, now);
    expect(result.urgencyFee).toBe(1800); // 15 % of 12000
    expect(result.total).toBe(12000 + 1800);
  });

  test('urgency does NOT apply when deadline is 8 days away', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2020-06-01',
      deadline: '2021-06-09', // 8 days after now
    };
    const result = calculateFee(input, now);
    expect(result.urgencyFee).toBe(0);
    expect(result.total).toBe(12000);
  });

  test('urgency fee is still applied when deadline is in the past (bug)', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2020-06-01',
      deadline: '2021-05-30', // 2 days before now
    };
    const result = calculateFee(input, now);
    expect(result.urgencyFee).toBe(1800); // still applied → bug
    expect(result.total).toBe(12000 + 1800);
  });
});

describe('calculateFee – expedited handling', () => {
  const now = '2021-06-01';

  test('expedited fee is calculated on the base band fee when no urgency', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2020-06-01',
      expedited: true,
    };
    const result = calculateFee(input, now);
    expect(result.urgencyFee).toBe(0);
    expect(result.expeditedFee).toBe(1200); // 10 % of 12000
    expect(result.total).toBe(12000 + 1200);
  });

  test('expedited fee uses (band + urgency) when urgency also applies', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 2,
      openedAt: '2020-06-01',
      deadline: '2021-06-08', // urgent (<= 7 days)
      expedited: true,
    };
    const result = calculateFee(input, now);
    // 2019 table: band 2 = 18500, urgency = 2775 (15 %),
    // sum = 21275, expedited = round(21275 * 10 %) = 2128
    expect(result.bandFee).toBe(18500);
    expect(result.urgencyFee).toBe(2775);
    expect(result.expeditedFee).toBe(2128);
    expect(result.total).toBe(18500 + 2775 + 2128);
  });
});

describe('calculateFee – rate‑table selection edges', () => {
  test('date exactly on 2021‑01‑01 uses 2021 table', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2021-01-01',
    };
    const result = calculateFee(input, '2021-01-01');
    expect(result.table).toBe('2021');
    expect(result.bandFee).toBe(13500); // 2021 table, STANDARD band 1
  });

  test('date before 2021‑01‑01 uses 2019 table', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2020-12-31',
    };
    const result = calculateFee(input, '2020-12-31');
    expect(result.table).toBe('2019');
    expect(result.bandFee).toBe(12000);
  });

  test('date exactly on 2022‑07‑01 uses 2021 table (exclusive upper bound)', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-01',
    };
    const result = calculateFee(input, '2022-07-01');
    expect(result.table).toBe('2021');
    expect(result.bandFee).toBe(13500);
  });

  test('date after 2022‑07‑01 uses 2022 table', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-02',
    };
    const result = calculateFee(input, '2022-07-02');
    expect(result.table).toBe('2022');
    expect(result.bandFee).toBe(15000);
  });
});

describe('calculateFee – 2022 table percentages', () => {
  const now = '2022-07-02';
  test('urgency uses 18 % on 2022 table', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-02',
      deadline: '2022-07-09', // 7 days after now
    };
    const result = calculateFee(input, now);
    expect(result.table).toBe('2022');
    expect(result.urgencyFee).toBe(2700); // 18 % of 15000
    expect(result.total).toBe(15000 + 2700);
  });

  test('expedited uses 12 % on 2022 table', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-02',
      expedited: true,
    };
    const result = calculateFee(input, now);
    expect(result.expeditedFee).toBe(1800); // 12 % of 15000
    expect(result.total).toBe(15000 + 1800);
  });

  test('both urgency and expedited on 2022 table (no rounding needed)', () => {
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 1,
      openedAt: '2022-07-02',
      deadline: '2022-07-09',
      expedited: true,
    };
    const result = calculateFee(input, now);
    // band =15000, urgency =2700, sum =17700, expedited = round(17700 * 12 %) = 2124
    expect(result.urgencyFee).toBe(2700);
    expect(result.expeditedFee).toBe(2124);
    expect(result.total).toBe(15000 + 2700 + 2124);
  });
});
