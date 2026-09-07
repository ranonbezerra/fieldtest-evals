import { describe, it, expect } from 'vitest';
import { calculateFee, FeeBreakdown, CaseInput } from '../feeCalculator';

// Helper to build a minimal case input
function makeCase(
  overrides: Partial<CaseInput> = {},
): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2020-01-01',
    deadline: undefined,
    expedited: false,
    ...overrides,
  };
}

// Mapping of expected base fees (cents) per table
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
};

function pctOf(amount: number, pct: number): number {
  return Math.round((amount * pct) / 100);
}

describe('calculateFee – table selection boundaries', () => {
  it('uses 2019 table for dates before 2021-01-01', () => {
    const input = makeCase({ openedAt: '2020-12-31' });
    const result = calculateFee(input);
    expect(result.table).toBe('2019');
  });

  it('uses 2021 table for dates on 2021-01-01', () => {
    const input = makeCase({ openedAt: '2021-01-01' });
    const result = calculateFee(input);
    expect(result.table).toBe('2021');
  });

  it('uses 2021 table for dates on 2022-07-01 (boundary bug)', () => {
    const input = makeCase({ openedAt: '2022-07-01' });
    const result = calculateFee(input);
    expect(result.table).toBe('2021');
  });

  it('uses 2022 table for dates after 2022-07-01', () => {
    const input = makeCase({ openedAt: '2022-07-02' });
    const result = calculateFee(input);
    expect(result.table).toBe('2022');
  });
});

describe('calculateFee – band fee lookup', () => {
  const caseTypes = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
  const tables = ['2019', '2021', '2022'] as const;

  for (const table of tables) {
    for (const type of caseTypes) {
      for (let band = 1; band <= 4; band++) {
        it(`returns correct bandFee for ${type} band ${band} using ${table} table`, () => {
          const openedAtMap: Record<string, string> = {
            '2019': '2020-06-15',
            '2021': '2021-06-15',
            '2022': '2022-08-01',
          };
          const input = makeCase({
            type,
            complexity: band,
            openedAt: openedAtMap[table],
          });
          const result = calculateFee(input);
          expect(result.table).toBe(table);
          expect(result.bandFee).toBe(BASE_FEES[table][type][band - 1]);
        });
      }
    }
  }
});

describe('calculateFee – urgency fee', () => {
  it('applies urgency fee when deadline is within 7 days', () => {
    const input = makeCase({
      openedAt: '2021-01-01',
      complexity: 2,
      deadline: '2021-01-07', // 6 days from reference
      now: '2021-01-01',
    });
    const result = calculateFee(input, '2021-01-01');
    const expectedBandFee = BASE_FEES['2021']['STANDARD'][1];
    const expectedUrgency = pctOf(expectedBandFee, 15); // 2021 table urgencyPct = 15
    expect(result.urgencyFee).toBe(expectedUrgency);
    expect(result.total).toBe(expectedBandFee + expectedUrgency);
  });

  it('does not apply urgency fee when deadline is more than 7 days away', () => {
    const input = makeCase({
      openedAt: '2021-01-01',
      complexity: 2,
      deadline: '2021-01-10',
      now: '2021-01-01',
    });
    const result = calculateFee(input, '2021-01-01');
    expect(result.urgencyFee).toBe(0);
  });

  it('applies urgency fee when deadline is exactly 7 days away', () => {
    const input = makeCase({
      openedAt: '2021-01-01',
      complexity: 3,
      deadline: '2021-01-08', // 7 days from reference
      now: '2021-01-01',
    });
    const result = calculateFee(input, '2021-01-01');
    const expectedBandFee = BASE_FEES['2021']['STANDARD'][2];
    const expectedUrgency = pctOf(expectedBandFee, 15);
    expect(result.urgencyFee).toBe(expectedUrgency);
  });
});

describe('calculateFee – expedited fee', () => {
  it('applies expedited fee based on band + urgency', () => {
    const input = makeCase({
      openedAt: '2021-01-01',
      complexity: 2,
      deadline: '2021-01-07', // triggers urgency
      expedited: true,
      now: '2021-01-01',
    });
    const result = calculateFee(input, '2021-01-01');
    const bandFee = BASE_FEES['2021']['STANDARD'][1];
    const urgency = pctOf(bandFee, 15);
    const expectedExpedited = pctOf(bandFee + urgency, 12); // 2021 expeditedPct = 12
    expect(result.expeditedFee).toBe(expectedExpedited);
    expect(result.total).toBe(bandFee + urgency + expectedExpedited);
  });

  it('applies expedited fee without urgency when deadline is far', () => {
    const input = makeCase({
      openedAt: '2021-01-01',
      complexity: 3,
      expedited: true,
      now: '2021-01-01',
    });
    const result = calculateFee(input, '2021-01-01');
    const bandFee = BASE_FEES['2021']['STANDARD'][2];
    const expectedExpedited = pctOf(bandFee, 12);
    expect(result.expeditedFee).toBe(expectedExpedited);
    expect(result.urgencyFee).toBe(0);
    expect(result.total).toBe(bandFee + expectedExpedited);
  });
});

describe('calculateFee – edge cases & quirks', () => {
  it('throws when complexity is null', () => {
    const input = makeCase({ complexity: null as any });
    expect(() => calculateFee(input)).toThrow('complexity is required');
  });

  it('treats zero or negative complexity as band 1', () => {
    const input = makeCase({ complexity: 0 });
    const result = calculateFee(input);
    expect(result.bandFee).toBe(BASE_FEES['2019']['STANDARD'][0]);
    const inputNeg = makeCase({ complexity: -5 });
    const resultNeg = calculateFee(inputNeg);
    expect(resultNeg.bandFee).toBe(BASE_FEES['2019']['STANDARD'][0]);
  });

  it('caps complexity above 4 to band 4', () => {
    const input = makeCase({ complexity: 9 });
    const result = calculateFee(input);
    expect(result.bandFee).toBe(BASE_FEES['2019']['STANDARD'][3]);
  });

  it('defaults unknown case type to STANDARD rates', () => {
    const input = makeCase({ type: 'UNKNOWN_TYPE' as any, complexity: 2 });
    const result = calculateFee(input);
    expect(result.bandFee).toBe(BASE_FEES['2019']['STANDARD'][1]);
  });
});
