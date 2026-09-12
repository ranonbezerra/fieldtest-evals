import { describe, expect, it } from 'vitest';
import { calculateFee, FeeBreakdown, CaseInput } from '../feeCalculator.ts';

// Helper to build a minimal case input
function baseCase(overrides: Partial<CaseInput> = {}): CaseInput {
  return {
    type: 'STANDARD',
    complexity: 1,
    openedAt: '2020-06-15', // default to a 2019‑rate date
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Matrix tests – every case type × every complexity band (2019 rates)
// ---------------------------------------------------------------------------
const caseTypes = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;
const complexities = [1, 2, 3, 4] as const;

describe('feeCalculator – full type × band matrix (2019 rates)', () => {
  for (const type of caseTypes) {
    for (const band of complexities) {
      it(`calculates correct band fee for type=${type}, band=${band}`, () => {
        const input = baseCase({ type, complexity: band, openedAt: '2020-03-01' });
        const result = calculateFee(input, '2020-03-01');
        // bandFee should match the static table
        const expectedBandFeeMap: Record<string, number[]> = {
          STANDARD: [12000, 18500, 27000, 41000],
          COMMERCIAL: [22000, 31500, 45000, 68000],
          ESTATE: [18000, 26000, 39500, 60000],
          APPEAL: [30000, 42000, 61000, 92000],
        };
        const expectedBandFee = expectedBandFeeMap[type][band - 1];
        expect(result.bandFee).toBe(expectedBandFee);
        // No urgency or expedited flags => fees should be zero
        expect(result.urgencyFee).toBe(0);
        expect(result.expeditedFee).toBe(0);
        expect(result.total).toBe(expectedBandFee);
        expect(result.table).toBe('2019');
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Urgency multiplier edge cases
// ---------------------------------------------------------------------------
describe('feeCalculator – urgency multiplier', () => {
  const openedAt = '2021-02-15';
  const now = '2021-02-10';

  it('applies urgency when deadline is exactly 7 days away (inclusive edge)', () => {
    const deadline = '2021-02-17'; // 7 days after now
    const input = baseCase({ openedAt, deadline, now });
    const result = calculateFee({ ...input, deadline }, now);
    expect(result.urgencyFee).toBeGreaterThan(0);
  });

  it('does NOT apply urgency when deadline is 8 days away', () => {
    const deadline = '2021-02-18'; // 8 days after now
    const input = baseCase({ openedAt, deadline });
    const result = calculateFee(input, now);
    expect(result.urgencyFee).toBe(0);
  });

  it('BUG – urgency is applied even when deadline is in the past', () => {
    const pastDeadline = '2021-02-05'; // 5 days BEFORE now
    const input = baseCase({ openedAt, deadline: pastDeadline });
    const result = calculateFee(input, now);
    // Current implementation uses daysBetween(now, deadline) <= 7, which is true for past dates
    expect(result.urgencyFee).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Expedited multiplier rounding behavior
// ---------------------------------------------------------------------------
describe('feeCalculator – expedited multiplier rounding', () => {
  it('rounds expedited fee correctly (example where rounding .5 occurs)', () => {
    // Using 2019 STANDARD band 2 (18500) with urgency (15%) and expedited (10%)
    const input: CaseInput = {
      type: 'STANDARD',
      complexity: 2,
      openedAt: '2020-06-01',
      deadline: '2020-06-05', // within 7 days => urgency
      expedited: true,
    };
    const result = calculateFee(input, '2020-06-01');
    // bandFee = 18500
    // urgencyFee = round(18500 * 15 / 100) = 2775
    // expeditedFee = round((18500 + 2775) * 10 / 100) = round(2127.5) = 2128
    expect(result.bandFee).toBe(18500);
    expect(result.urgencyFee).toBe(2775);
    expect(result.expeditedFee).toBe(2128);
    expect(result.total).toBe(18500 + 2775 + 2128);
  });
});

// ---------------------------------------------------------------------------
// Rate‑table transition boundaries (inclusive / exclusive)
// ---------------------------------------------------------------------------
describe('feeCalculator – rate table selection boundaries', () => {
  const testCases = [
    { openedAt: '2020-12-31', expectedTable: '2019' },
    { openedAt: '2021-01-01', expectedTable: '2021' }, // inclusive lower bound
    { openedAt: '2022-07-01', expectedTable: '2021' }, // exclusive upper bound
    { openedAt: '2022-07-02', expectedTable: '2022' }, // first day of 2022 table
  ];

  for (const { openedAt, expectedTable } of testCases) {
    it(`uses table ${expectedTable} for openedAt=${openedAt}`, () => {
      const input = baseCase({ openedAt });
      const result = calculateFee(input, openedAt);
      expect(result.table).toBe(expectedTable);
    });
  }
});

// ---------------------------------------------------------------------------
// Degenerate / edge inputs
// ---------------------------------------------------------------------------
describe('feeCalculator – degenerate inputs', () => {
  it('throws when complexity is null', () => {
    const input = baseCase({ complexity: null as any });
    expect(() => calculateFee(input)).toThrow('complexity is required');
  });

  it('clamps negative complexity to band 1', () => {
    const input = baseCase({ complexity: -5 });
    const result = calculateFee(input);
    expect(result.bandFee).toBe(12000); // STANDARD band 1
  });

  it('clamps zero complexity to band 1', () => {
    const input = baseCase({ complexity: 0 });
    const result = calculateFee(input);
    expect(result.bandFee).toBe(12000);
  });

  it('clamps complexity >4 to band 4', () => {
    const input = baseCase({ complexity: 10 });
    const result = calculateFee(input);
    expect(result.bandFee).toBe(41000); // STANDARD band 4
  });

  it('defaults unknown case type to STANDARD rates', () => {
    const input = baseCase({ type: 'UNKNOWN', complexity: 2 });
    const result = calculateFee(input);
    // UNKNOWN falls back to STANDARD band 2 fee (18500)
    expect(result.bandFee).toBe(18500);
    expect(result.table).toBe('2019');
  });
});
