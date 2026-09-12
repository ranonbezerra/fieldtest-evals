import { calculateFee } from '../feeCalculator.ts';

type RateTableKey = '2019' | '2021' | '2022';

interface ExpectedTable {
  [caseType: string]: number[];
}

/**
 * Expected base fees (in cents) for each rate table.
 * Copied from feeCalculator.ts.
 */
const EXPECTED_BASE: Record<RateTableKey, ExpectedTable> = {
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

/**
 * Representative openedAt dates that trigger each rate table.
 * The entry for 2022-07-01 demonstrates the exclusive‑boundary bug.
 */
const TABLE_DATES = [
  { openedAt: '2020-06-15', expected: '2019' },
  { openedAt: '2020-12-31', expected: '2019' },
  { openedAt: '2021-01-01', expected: '2021' },
  { openedAt: '2021-06-01', expected: '2021' },
  { openedAt: '2022-07-01', expected: '2021' }, // exclusive bug (should be 2022)
  { openedAt: '2022-07-02', expected: '2022' },
  { openedAt: '2023-01-01', expected: '2022' },
];

const CASE_TYPES = ['STANDARD', 'COMMERCIAL', 'ESTATE', 'APPEAL'] as const;

/**
 * ----------------------------------------------------------------------
 * Band‑fee matrix across all rate tables
 * ----------------------------------------------------------------------
 */
describe('calculateFee – band fee matrix across rate tables', () => {
  for (const { openedAt, expected: expectedTable } of TABLE_DATES) {
    describe(`openedAt = ${openedAt} (table ${expectedTable})`, () => {
      for (const caseType of CASE_TYPES) {
        for (let band = 1; band <= 4; band++) {
          it(`returns correct bandFee for ${caseType} band ${band}`, () => {
            const input = {
              type: caseType,
              complexity: band,
              openedAt,
            };
            const result = calculateFee(input);
            expect(result.table).toBe(expectedTable);
            const expectedBandFee =
              EXPECTED_BASE[expectedTable][caseType][band - 1];
            expect(result.bandFee).toBe(expectedBandFee);
            // No urgency or expedited => fees should be zero
            expect(result.urgencyFee).toBe(0);
            expect(result.expeditedFee).toBe(0);
            expect(result.total).toBe(expectedBandFee);
          });
        }
      }
    });
  }
});

/**
 * ----------------------------------------------------------------------
 * Urgency‑fee handling (including the past‑deadline bug)
 * ----------------------------------------------------------------------
 */
describe('calculateFee – urgency fee handling', () => {
  const refDate = '2022-01-01';
  const caseType = 'STANDARD';
  const band = 2; // band 2 in 2021 table = 20500 cents
  const openedAt = '2021-03-15'; // selects the 2021 table
  const bandFee = EXPECTED_BASE['2021'][caseType][band - 1];

  it('applies urgency fee when deadline is within 7 days (inclusive)', () => {
    const deadline = '2022-01-08'; // exactly 7 days after refDate
    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        deadline,
      },
      refDate,
    );
    const expectedUrgency = Math.round((bandFee * 15) / 100); // 15% for 2021
    expect(result.urgencyFee).toBe(expectedUrgency);
    expect(result.expeditedFee).toBe(0);
    expect(result.total).toBe(bandFee + expectedUrgency);
  });

  it('does NOT apply urgency fee when deadline is more than 7 days away', () => {
    const deadline = '2022-01-09'; // 8 days after refDate
    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        deadline,
      },
      refDate,
    );
    expect(result.urgencyFee).toBe(0);
    expect(result.expeditedFee).toBe(0);
    expect(result.total).toBe(bandFee);
  });

  it('applies urgency fee even when deadline is before the reference date (bug)', () => {
    const deadline = '2021-12-20'; // before refDate
    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        deadline,
      },
      refDate,
    );
    const expectedUrgency = Math.round((bandFee * 15) / 100);
    expect(result.urgencyFee).toBe(expectedUrgency);
    // This behaviour is unexpected – see FINDINGS.md
  });
});

/**
 * ----------------------------------------------------------------------
 * Expedited‑fee handling (stand‑alone and combined with urgency)
 * ----------------------------------------------------------------------
 */
describe('calculateFee – expedited fee handling', () => {
  const refDate = '2022-01-01';
  const caseType = 'COMMERCIAL';
  const band = 3; // band 3 in 2022 table = 53500 cents
  const openedAt = '2022-08-01'; // selects the 2022 table
  const bandFee = EXPECTED_BASE['2022'][caseType][band - 1];

  it('applies expedited fee when expedited flag is true and no urgency', () => {
    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        expedited: true,
      },
      refDate,
    );
    const expectedExpedited = Math.round((bandFee * 12) / 100); // 12% for 2022
    expect(result.expeditedFee).toBe(expectedExpedited);
    expect(result.urgencyFee).toBe(0);
    expect(result.total).toBe(bandFee + expectedExpedited);
  });

  it('applies both urgency and expedited fees correctly', () => {
    const deadline = '2022-01-05'; // within 7 days => urgent
    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        deadline,
        expedited: true,
      },
      refDate,
    );
    const urgencyPct = 18; // from 2022 table
    const expeditedPct = 12;
    const urgencyFee = Math.round((bandFee * urgencyPct) / 100);
    const expeditedFee = Math.round(((bandFee + urgencyFee) * expeditedPct) / 100);
    expect(result.urgencyFee).toBe(urgencyFee);
    expect(result.expeditedFee).toBe(expeditedFee);
    expect(result.total).toBe(bandFee + urgencyFee + expeditedFee);
  });
});

/**
 * ----------------------------------------------------------------------
 * Edge cases & input validation
 * ----------------------------------------------------------------------
 */
describe('calculateFee – edge cases and input validation', () => {
  const openedAt = '2021-04-01';

  it('throws when complexity is missing', () => {
    // @ts-expect-error intentionally missing complexity
    const input = { type: 'STANDARD', openedAt };
    expect(() => calculateFee(input as any)).toThrow('complexity is required');
  });

  it('throws when complexity is null', () => {
    const input = { type: 'STANDARD', complexity: null, openedAt };
    expect(() => calculateFee(input as any)).toThrow('complexity is required');
  });

  it('treats zero or negative complexity as band 1', () => {
    const inputZero = { type: 'ESTATE', complexity: 0, openedAt };
    const resultZero = calculateFee(inputZero);
    const expectedBandFeeZero = EXPECTED_BASE['2019']['ESTATE'][0];
    expect(resultZero.bandFee).toBe(expectedBandFeeZero);
    expect(resultZero.total).toBe(expectedBandFeeZero);

    const inputNeg = { type: 'ESTATE', complexity: -3, openedAt };
    const resultNeg = calculateFee(inputNeg);
    const expectedBandFeeNeg = EXPECTED_BASE['2019']['ESTATE'][0];
    expect(resultNeg.bandFee).toBe(expectedBandFeeNeg);
    expect(resultNeg.total).toBe(expectedBandFeeNeg);
  });

  it('treats complexity greater than 4 as band 4', () => {
    const input = { type: 'APPEAL', complexity: 10, openedAt };
    const result = calculateFee(input);
    const expectedBandFee = EXPECTED_BASE['2019']['APPEAL'][3];
    expect(result.bandFee).toBe(expectedBandFee);
    expect(result.total).toBe(expectedBandFee);
  });

  it('falls back to STANDARD rates for unknown case type', () => {
    const input = { type: 'UNKNOWN_TYPE', complexity: 2, openedAt };
    const result = calculateFee(input);
    const expectedBandFee = EXPECTED_BASE['2019']['STANDARD'][1];
    expect(result.bandFee).toBe(expectedBandFee);
    expect(result.table).toBe('2019');
  });
});
