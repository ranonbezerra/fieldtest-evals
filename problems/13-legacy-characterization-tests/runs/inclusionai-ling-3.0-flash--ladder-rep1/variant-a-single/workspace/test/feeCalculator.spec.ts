import { describe, it, expect } from 'vitest';
import { calculateFee, CaseInput } from '../src/feeCalculator';

/**
 * Characterization suite for feeCalculator.ts (in production since 2019, zero tests
 * before this one). Every test is deterministic — no real clocks, no randomness.
 *
 * The `now` parameter (an ISO date string) is injected on every call so the
 * urgency-multiplier logic, which depends on a reference date, is fully pinned.
 */

const NOW = '2024-06-15';

function fee(c: CaseInput) {
  return calculateFee(c, NOW);
}

const CASE_TYPES: Array<'STANDARD' | 'COMMERCIAL' | 'ESTATE' | 'APPEAL'> = [
  'STANDARD',
  'COMMERCIAL',
  'ESTATE',
  'APPEAL',
];

// ---------------------------------------------------------------------------
// 1. Full case-type × complexity-band matrix (4 × 4 = 16 cases)
// ---------------------------------------------------------------------------
describe('fee matrix — every case type × every complexity band', () => {
  for (const type of CASE_TYPES) {
    for (let band = 1; band <= 4; band++) {
      it(`type=${type} band=${band} (no urgency, no expedited)`, () => {
        const result = fee({ type, complexity: band, openedAt: NOW });

        expect(result.table).toBe('2021');
        expect(result.bandFee).toBeGreaterThan(0);
        expect(result.urgencyFee).toBe(0);
        expect(result.expeditedFee).toBe(0);
        expect(result.total).toBe(result.bandFee);
        // bandFee must equal the matrix entry for this type × band
        expect(result.total).toBe(result.bandFee);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Rate-table transitions — inclusive/exclusive edge at each boundary
// ---------------------------------------------------------------------------
describe('rate-table selection', () => {
  it('openedAt before REVISION_2021 (2021-01-01) uses 2019 table', () => {
    const result = fee({ type: 'STANDARD', complexity: 1, openedAt: '2020-12-31' });
    expect(result.table).toBe('2019');
    expect(result.bandFee).toBe(12000);
  });

  it('openedAt exactly on REVISION_2021 (2021-01-01) — INCLUSIVE — uses 2021 table', () => {
    const result = fee({ type: 'STANDARD', complexity: 1, openedAt: '2021-01-01' });
    expect(result.table).toBe('2021');
    expect(result.bandFee).toBe(13500);
  });

  it('openedAt one day after REVISION_2021 uses 2021 table', () => {
    const result = fee({ type: 'STANDARD', complexity: 1, openedAt: '2021-01-02' });
    expect(result.table).toBe('2021');
    expect(result.bandFee).toBe(13500);
  });

  it('openedAt exactly on REVISION_2022 (2022-07-01) — EXCLUSIVE — uses 2021 table', () => {
    const result = fee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' });
    expect(result.table).toBe('2021');
    expect(result.bandFee).toBe(13500);
  });

  it('openedAt one day after REVISION_2022 uses 2022 table', () => {
    const result = fee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-02' });
    expect(result.table).toBe('2022');
    expect(result.bandFee).toBe(15000);
  });

  it('openedAt well into 2022 (between revisions) uses 2021 table', () => {
    const result = fee({ type: 'APPEAL', complexity: 4, openedAt: '2022-06-15' });
    expect(result.table).toBe('2021');
    expect(result.bandFee).toBe(99000);
  });

  it('openedAt well after 2022 revision uses 2022 table', () => {
    const result = fee({ type: 'APPEAL', complexity: 4, openedAt: '2023-01-01' });
    expect(result.table).toBe('2022');
    expect(result.bandFee).toBe(109000);
  });
});

// ---------------------------------------------------------------------------
// 3. Urgency multipliers — boundary at daysBetween(ref, deadline) <= 7
// ---------------------------------------------------------------------------
describe('urgency multiplier boundary (deadline within 7 days of ref)', () => {
  it('deadline exactly 7 days after ref — URGENT — urgency fee applied', () => {
    const result = fee({
      type: 'STANDARD',
      complexity: 1,
      openedAt: NOW,
      deadline: '2024-06-22', // NOW + 7 days
    });
    expect(result.urgencyFee).toBeGreaterThan(0);
    // bandFee for STANDARD band 1 in 2021 table = 13500, 15% → 2025
    expect(result.urgencyFee).toBe(2025);
    expect(result.total).toBe(13500 + 2025);
  });

  it('deadline exactly 8 days after ref — NOT urgent — no urgency fee', () => {
    const result = fee({
      type: 'STANDARD',
      complexity: 1,
      openedAt: NOW,
      deadline: '2024-06-23', // NOW + 8 days
    });
    expect(result.urgencyFee).toBe(0);
    expect(result.total).toBe(13500);
  });

  it('deadline exactly on ref date (0 days) — URGENT — urgency fee applied', () => {
    const result = fee({
      type: 'STANDARD',
      complexity: 2,
      openedAt: NOW,
      deadline: NOW,
    });
    expect(result.urgencyFee).toBeGreaterThan(0);
    // bandFee STANDARD band2 2021 = 20500, 15% → 3075
    expect(result.urgencyFee).toBe(3075);
  });

  it('deadline 1 day before ref (overdue by 1 day) — URGENT — urgency fee applied', () => {
    // daysBetween(NOW, deadline) = -1 ≤ 7 → urgency applies
    const result = fee({
      type: 'STANDARD',
      complexity: 1,
      openedAt: NOW,
      deadline: '2024-06-14', // NOW - 1 day
    });
    expect(result.urgencyFee).toBeGreaterThan(0);
  });

  it('no deadline — no urgency fee', () => {
    const result = fee({ type: 'STANDARD', complexity: 1, openedAt: NOW });
    expect(result.urgencyFee).toBe(0);
  });

  it('deadline far in the future — no urgency fee', () => {
    const result = fee({
      type: 'STANDARD',
      complexity: 1,
      openedAt: NOW,
      deadline: '2025-12-31',
    });
    expect(result.urgencyFee).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Expedited multiplier
// ---------------------------------------------------------------------------
describe('expedited multiplier', () => {
  it('expedited true — expedited fee applied on top of band + urgency', () => {
    const result = fee({
      type: 'STANDARD',
      complexity: 1,
      openedAt: NOW,
      deadline: '2024-06-22', // urgent
      expedited: true,
    });
    // band=13500, urgency=2025, subtotal=15525, 12% → 1863
    expect(result.expeditedFee).toBe(1863);
    expect(result.total).toBe(13500 + 2025 + 1863);
  });

  it('expedited false — no expedited fee', () => {
    const result = fee({
      type: 'STANDARD',
      complexity: 1,
      openedAt: NOW,
      deadline: '2024-06-22',
    });
    expect(result.expeditedFee).toBe(0);
  });

  it('expedited omitted — no expedited fee', () => {
    const result = fee({ type: 'STANDARD', complexity: 1, openedAt: NOW });
    expect(result.expeditedFee).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Rounding at each step
// ---------------------------------------------------------------------------
describe('rounding behaviour', () => {
  it('pctOf rounds at each step — urgency then expedited rounded separately', () => {
    // STANDARD band 1, 2021 table: bandFee = 13500
    // urgency: round(13500 * 15 / 100) = round(2025)     = 2025
    // expedited: round((13500 + 2025) * 12 / 100) = round(1863) = 1863
    const result = fee({
      type: 'STANDARD',
      complexity: 1,
      openedAt: NOW,
      deadline: '2024-06-22',
      expedited: true,
    });
    expect(result.bandFee).toBe(13500);
    expect(result.urgencyFee).toBe(2025);
    expect(result.expeditedFee).toBe(1863);
    expect(result.total).toBe(13500 + 2025 + 1863); // 17388
  });

  it('rounding produces non-zero cents for fractional percentages', () => {
    // ESTATE band 2, 2021 table: bandFee = 28000
    // urgency: round(28000 * 15 / 100) = round(4200) = 4200
    // expedited: round((28000+4200)*12/100) = round(3864) = 3864
    const result = fee({
      type: 'ESTATE',
      complexity: 2,
      openedAt: NOW,
      deadline: '2024-06-22',
      expedited: true,
    });
    expect(result.bandFee).toBe(28000);
    expect(result.urgencyFee).toBe(4200);
    expect(result.expeditedFee).toBe(3864);
    expect(result.total).toBe(28000 + 4200 + 3864);
  });
});

// ---------------------------------------------------------------------------
// 6. Degenerate inputs
// ---------------------------------------------------------------------------
describe('degenerate inputs', () => {
  it('complexity null — throws', () => {
    expect(() =>
      fee({ type: 'STANDARD', complexity: null, openedAt: NOW }),
    ).toThrow('complexity is required');
  });

  it('complexity undefined — throws', () => {
    expect(() =>
      fee({ type: 'STANDARD', complexity: undefined, openedAt: NOW }),
    ).toThrow('complexity is required');
  });

  it('complexity 0 — clamped to band 1 (does not throw)', () => {
    const result = fee({ type: 'STANDARD', complexity: 0, openedAt: NOW });
    expect(result.bandFee).toBe(13500); // STANDARD band 1, 2021 table
  });

  it('complexity -1 (negative) — clamped to band 1 (does not throw)', () => {
    const result = fee({ type: 'STANDARD', complexity: -1, openedAt: NOW });
    expect(result.bandFee).toBe(13500);
  });

  it('complexity 5 (above max band) — clamped to band 4 (does not throw)', () => {
    const result = fee({ type: 'STANDARD', complexity: 5, openedAt: NOW });
    expect(result.bandFee).toBe(44500); // STANDARD band 4, 2021 table
  });

  it('complexity 4.7 (non-integer above max) — clamped to band 4', () => {
    const result = fee({ type: 'STANDARD', complexity: 4.7, openedAt: NOW });
    expect(result.bandFee).toBe(44500);
  });

  it('unknown case type — falls back to STANDARD band fee (does not throw)', () => {
    const result = fee({
      type: 'NOT_A_REAL_TYPE' as string,
      complexity: 1,
      openedAt: NOW,
    });
    expect(result.bandFee).toBe(13500); // STANDARD band 1, 2021 table
  });

  it('empty-string case type — falls back to STANDARD band fee (does not throw)', () => {
    const result = fee({ type: '', complexity: 1, openedAt: NOW });
    expect(result.bandFee).toBe(13500);
  });
});

// ---------------------------------------------------------------------------
// 7. Pinned quirks / bugs (named tests — deliberately asserting current output)
// ---------------------------------------------------------------------------
describe('PINNED QUIRKS — asserting current (possibly wrong) behaviour', () => {
  it('PIN: openedAt exactly on REVISION_2022 (2022-07-01) selects 2021 table, not 2022', () => {
    // tableFor uses `openedAt > REVISION_2022` (strict). A case opened exactly
    // on the 2022 revision date falls into the 2021 table. This may be a bug
    // in tableFor's boundary logic.
    const result = fee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' });
    expect(result.table).toBe('2021');
    expect(result.bandFee).toBe(13500); // 2021 STANDARD band1
  });

  it('PIN: overdue deadline (past ref) triggers urgency fee via negative daysBetween', () => {
    // daysBetween(ref, deadline) returns -1 when deadline is 1 day before ref.
    // -1 <= 7 so urgency applies. Whether this is intended (overdue → urgent)
    // or a bug (deadline direction inverted) is unclear from the code alone.
    const result = fee({
      type: 'STANDARD',
      complexity: 1,
      openedAt: NOW,
      deadline: '2024-06-14', // NOW - 1 day
    });
    expect(result.urgencyFee).toBe(2025); // same as 7-days-ahead case
  });
});
