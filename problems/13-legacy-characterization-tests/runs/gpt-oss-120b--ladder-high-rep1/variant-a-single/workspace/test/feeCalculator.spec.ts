import { describe, it, expect } from 'vitest';
import { calculateFee } from '../feeCalculator';

// Replicated rate‑table data (the source of truth for the tests)
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
};

/**
 * Helper to compute a percentage the same way the production code does.
 */
function pctOf(amount: number, pct: number): number {
  return Math.round((amount * pct) / 100);
}

/**
 * -------------------------------------------------------------------------
 * 1️⃣  Rate‑table selection edge cases
 * -------------------------------------------------------------------------
 */
describe('rate table selection boundaries', () => {
  it('uses 2019 table for a date before 2021‑01‑01', () => {
    const result = calculateFee(
      {
        type: 'STANDARD',
        complexity: 1,
        openedAt: '2020-12-31',
      },
      '2020-12-31',
    );
    expect(result.table).toBe('2019');
  });

  it('uses 2021 table for a date exactly on 2021‑01‑01 (inclusive)', () => {
    const result = calculateFee(
      {
        type: 'STANDARD',
        complexity: 1,
        openedAt: '2021-01-01',
      },
      '2021-01-01',
    );
    expect(result.table).toBe('2021');
  });

  it('uses 2021 table for a date exactly on 2022‑07‑01 (bug: exclusive boundary)', () => {
    const result = calculateFee(
      {
        type: 'STANDARD',
        complexity: 1,
        openedAt: '2022-07-01',
      },
      '2022-07-01',
    );
    // Current behaviour (bug) – the date should have switched to the 2022 table.
    expect(result.table).toBe('2021');
  });

  it('uses 2022 table for a date after 2022‑07‑01', () => {
    const result = calculateFee(
      {
        type: 'STANDARD',
        complexity: 1,
        openedAt: '2022-07-02',
      },
      '2022-07-02',
    );
    expect(result.table).toBe('2022');
  });
});

/**
 * -------------------------------------------------------------------------
 * 2️⃣  Full case‑type × complexity‑band matrix (no urgency, no expedited)
 * -------------------------------------------------------------------------
 */
type TableName = keyof typeof RATE_TABLES;

Object.entries(RATE_TABLES).forEach(([tableName, table]) => {
  // Pick a deterministic openedAt that selects the desired table.
  const openedAtMap: Record<TableName, string> = {
    '2019': '2020-06-15',
    '2021': '2021-06-15',
    '2022': '2022-07-03',
  };
  const openedAt = openedAtMap[tableName as TableName];

  describe(`full matrix for ${tableName} rates`, () => {
    (Object.keys(table.base) as Array<keyof typeof table.base>).forEach((caseType) => {
      const bands = table.base[caseType];
      bands.forEach((bandFee, idx) => {
        const band = idx + 1;
        it(`returns correct band fee for ${caseType} band ${band}`, () => {
          const result = calculateFee(
            {
              type: caseType,
              complexity: band,
              openedAt,
            },
            // deterministic reference date (irrelevant because no deadline)
            '2020-01-01',
          );
          expect(result.table).toBe(tableName);
          expect(result.bandFee).toBe(bandFee);
          expect(result.urgencyFee).toBe(0);
          expect(result.expeditedFee).toBe(0);
          expect(result.total).toBe(bandFee);
        });
      });
    });
  });
});

/**
 * -------------------------------------------------------------------------
 * 3️⃣  Urgency determination quirks
 * -------------------------------------------------------------------------
 */
describe('urgency fee determination', () => {
  const openedAt = '2022-01-01';
  const now = '2022-01-01';
  const caseType = 'STANDARD';
  const band = 1;
  const table = RATE_TABLES['2019']; // 2022‑01‑01 falls before the 2021 revision
  const bandFee = table.base[caseType][band - 1];
  const expectedUrgency = pctOf(bandFee, table.urgencyPct);

  it('applies urgency fee when deadline is exactly 7 days away (inclusive)', () => {
    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        deadline: '2022-01-08', // 7 days later
      },
      now,
    );
    expect(result.urgencyFee).toBe(expectedUrgency);
    expect(result.total).toBe(bandFee + expectedUrgency);
  });

  it('does NOT apply urgency fee when deadline is more than 7 days away', () => {
    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        deadline: '2022-01-09', // 8 days later
      },
      now,
    );
    expect(result.urgencyFee).toBe(0);
    expect(result.total).toBe(bandFee);
  });

  it('applies urgency fee even when deadline is in the past (quirk: <= 7 includes negatives)', () => {
    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        deadline: '2021-12-31', // past
      },
      now,
    );
    expect(result.urgencyFee).toBe(expectedUrgency);
    expect(result.total).toBe(bandFee + expectedUrgency);
  });

  it('applies urgency fee when deadline is 7.5 days ahead due to floor behaviour (quirk)', () => {
    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        deadline: '2022-01-08T12:00:00Z', // 7 days + 12 h
      },
      now,
    );
    expect(result.urgencyFee).toBe(expectedUrgency);
    expect(result.total).toBe(bandFee + expectedUrgency);
  });
});

/**
 * -------------------------------------------------------------------------
 * 4️⃣  Expedited fee rounding
 * -------------------------------------------------------------------------
 */
describe('expedited fee rounding', () => {
  it('rounds correctly for STANDARD band 2 in the 2019 table (expedited fee = 2128 cents)', () => {
    const openedAt = '2020-06-15'; // 2019 table
    const now = '2020-01-01';
    const caseType = 'STANDARD';
    const band = 2;
    const table = RATE_TABLES['2019'];
    const bandFee = table.base[caseType][band - 1];
    const urgencyFee = pctOf(bandFee, table.urgencyPct);
    const expeditedFee = pctOf(bandFee + urgencyFee, table.expeditedPct); // 2128

    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        deadline: now, // urgent (deadline == now)
        expedited: true,
      },
      now,
    );

    expect(result.urgencyFee).toBe(urgencyFee);
    expect(result.expeditedFee).toBe(expeditedFee);
    expect(result.total).toBe(bandFee + urgencyFee + expeditedFee);
  });

  it('rounds correctly for STANDARD band 4 in the 2022 table (expedited fee = 6938 cents)', () => {
    const openedAt = '2022-07-03'; // 2022 table
    const now = '2022-01-01';
    const caseType = 'STANDARD';
    const band = 4;
    const table = RATE_TABLES['2022'];
    const bandFee = table.base[caseType][band - 1];
    const urgencyFee = pctOf(bandFee, table.urgencyPct);
    const expeditedFee = pctOf(bandFee + urgencyFee, table.expeditedPct); // 6938

    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        deadline: now, // urgent
        expedited: true,
      },
      now,
    );

    expect(result.urgencyFee).toBe(urgencyFee);
    expect(result.expeditedFee).toBe(expeditedFee);
    expect(result.total).toBe(bandFee + urgencyFee + expeditedFee);
  });
});

/**
 * -------------------------------------------------------------------------
 * 5️⃣  Unknown case‑type fallback
 * -------------------------------------------------------------------------
 */
describe('unknown case type fallback', () => {
  it('defaults to STANDARD fees when the case type is unrecognised', () => {
    const openedAt = '2020-06-15';
    const result = calculateFee(
      {
        type: 'UNKNOWN_TYPE',
        complexity: 2,
        openedAt,
      },
      '2020-01-01',
    );

    const expectedBandFee = RATE_TABLES['2019'].base['STANDARD'][1]; // band 2
    expect(result.table).toBe('2019');
    expect(result.bandFee).toBe(expectedBandFee);
    expect(result.total).toBe(expectedBandFee);
  });
});

/**
 * -------------------------------------------------------------------------
 * 6️⃣  Complexity normalisation
 * -------------------------------------------------------------------------
 */
describe('complexity normalisation', () => {
  const openedAt = '2020-06-15';
  const now = '2020-01-01';
  const caseType = 'ESTATE';

  it('treats complexity 0 as band 1', () => {
    const result = calculateFee(
      {
        type: caseType,
        complexity: 0,
        openedAt,
      },
      now,
    );
    const expectedBandFee = RATE_TABLES['2019'].base[caseType][0];
    expect(result.bandFee).toBe(expectedBandFee);
  });

  it('treats negative complexity as band 1', () => {
    const result = calculateFee(
      {
        type: caseType,
        complexity: -5,
        openedAt,
      },
      now,
    );
    const expectedBandFee = RATE_TABLES['2019'].base[caseType][0];
    expect(result.bandFee).toBe(expectedBandFee);
  });

  it('caps complexity above 4 to band 4', () => {
    const result = calculateFee(
      {
        type: caseType,
        complexity: 10,
        openedAt,
      },
      now,
    );
    const expectedBandFee = RATE_TABLES['2019'].base[caseType][3];
    expect(result.bandFee).toBe(expectedBandFee);
  });
});

/**
 * -------------------------------------------------------------------------
 * 7️⃣  Missing complexity validation
 * -------------------------------------------------------------------------
 */
describe('missing complexity validation', () => {
  it('throws an error when complexity is null', () => {
    const openedAt = '2020-06-15';
    expect(() =>
      calculateFee(
        {
          type: 'STANDARD',
          complexity: null,
          openedAt,
        },
        '2020-01-01',
      ),
    ).toThrowError('complexity is required');
  });
});

/**
 * -------------------------------------------------------------------------
 * 8️⃣  Expedited fee without urgency
 * -------------------------------------------------------------------------
 */
describe('expedited fee without urgency', () => {
  it('applies only the expedited percentage when the case is not urgent', () => {
    const openedAt = '2020-06-15';
    const now = '2020-01-01';
    const caseType = 'COMMERCIAL';
    const band = 1;
    const table = RATE_TABLES['2019'];
    const bandFee = table.base[caseType][band - 1];
    const expectedExpedited = pctOf(bandFee, table.expeditedPct);

    const result = calculateFee(
      {
        type: caseType,
        complexity: band,
        openedAt,
        // No deadline → not urgent
        expedited: true,
      },
      now,
    );

    expect(result.urgencyFee).toBe(0);
    expect(result.expeditedFee).toBe(expectedExpedited);
    expect(result.total).toBe(bandFee + expectedExpedited);
  });
});
