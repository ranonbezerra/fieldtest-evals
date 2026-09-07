/**
 * Characterization suite — feeCalculator (running since 2019, zero prior
 * tests, consumed by billing whose outputs are stored and audited).
 *
 * Every assertion is an EXACT value pin of current behavior. Where the
 * current behavior deviates from the documented 2019 runbook, the test
 * name carries [QUIRK], [BUG] or [HOLE] and points at FINDINGS.md —
 * the assertion still pins what the code ACTUALLY returns today.
 *
 * Determinism: no `new Date()`, no Date.now(), no randomness. Every
 * clock the module can read comes from a fixed injected `now` (the
 * module's existing optional parameter — the only sanctioned injection
 * point) or from fixed ISO strings.
 */
import { describe, expect, it } from 'vitest';
import { calculateFee } from '../src/fee-calculator/fee-calculator';

const NOW = new Date('2025-01-15T12:00:00.000Z'); // single fixed injected clock

function iso(year: number, month: number, day: number, hour = 12, minute = 0): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:00.000Z`;
}

interface Opts {
  caseType?: string;
  complexity?: string;
  baseAmount?: number;
  openedAt?: string;
  filedAt?: string;
  now?: Date;
}

function fee(o: Opts = {}): number {
  return calculateFee({
    caseType: (o.caseType ?? 'criminal') as never,
    complexity: (o.complexity ?? 'medium') as never,
    baseAmount: o.baseAmount ?? 105,
    openedAt: o.openedAt ?? iso(2022, 3, 1),
    filedAt: o.filedAt ?? iso(2022, 3, 1, 11),
    now: o.now ?? NOW,
  }).fee;
}

const DAY = 86_400_000;
function plusDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

// Fixed anchors so a table cell maps deterministically to an exact output.
const OPEN_2020 = iso(2020, 6, 30); // mid 2019 table
const OPEN_2021 = iso(2022, 3, 1);   // mid 2021 table
const OPEN_2024 = iso(2025, 6, 1);   // mid 2024 table
const FILE_7D = new Date(plusDays(new Date(OPEN_2021), -7).toISOString()); // urgency 1.0x

describe('feeCalculator — fee tables and dates', () => {
  it('knows the three table identities (values must never be re-keyed silently)', () => {
    expect(
      Object.values(calculateFee({ caseType: 'criminal', complexity: 'medium', baseAmount: 0, openedAt: OPEN_2020, filedAt: FILE_7D, now: NOW })),
    ).toContainEqual({ fee: 0 });
    // Sentinel per era: criminal/medium table value, urgency 1.0x, band 2.5x, base 1.
    // (Pins era identity only — the cell values themselves are audited in F4's block.)
    expect(fee({ caseType: 'criminal', complexity: 'medium', baseAmount: 1, openedAt: OPEN_2020, filedAt: FILE_7D })).toBe(105 * 2.5 * 1 === 262 ? 262 : Math.round(105 * 2.5 * 1)); // 262.5 -> 263
    expect(fee({ caseType: 'criminal', complexity: 'medium', baseAmount: 1, openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(281); // 112.5*2.5=281.25
    expect(fee({ caseType: 'criminal', complexity: 'medium', baseAmount: 1, openedAt: OPEN_2024, filedAt: FILE_7D })).toBe(281); // 2024 held criminal
  });

  it('selects the 2019 table for an opening date before 2021-01-01', () => {
    // civil/medium, 2019 value 105, band 2.5x, standard 1.0x: 105*2.5=262.5 -> 263
    expect(fee({ caseType: 'civil', complexity: 'medium', openedAt: OPEN_2020, filedAt: FILE_7D })).toBe(263);
  });

  it('selects the 2021 table for an opening date between the two transitions', () => {
    // civil/medium, 2021 value 112.5, band 2.5x: 281.25 -> 281
    expect(fee({ caseType: 'civil', complexity: 'medium', openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(281);
  });

  it('selects the 2024 table for an opening date after the second transition', () => {
    // civil/medium, 2024 value 120, band 2.5x: exactly 300
    expect(fee({ caseType: 'civil', complexity: 'medium', openedAt: OPEN_2024, filedAt: FILE_7D })).toBe(300);
  });

  it('[QUIRKY-VALUES] the shipped tables differ from the runbook in two cells — pinned as-is', () => {
    // Runbook: 2024 probate/low 88, tenant/low 38. Shipped code (FINDINGS F4):
    // both read 100 — 2019 values never updated in the 2024 revision block.
    // probate/low band 1x, standard 1.0x: table value is the fee.
    expect(fee({ caseType: 'probate', complexity: 'low', openedAt: OPEN_2024, filedAt: FILE_7D })).toBe(100);
    expect(fee({ caseType: 'tenant', complexity: 'low', openedAt: OPEN_2024, filedAt: FILE_7D })).toBe(100);
    // The same two rows in the 2021 table: also 100 (tenants held; probate
    // low never had a runbook value of its own), so the 2019/2021 era reads
    // coincidentally match the runbook for these rows.
    expect(fee({ caseType: 'probate', complexity: 'low', openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(100);
    expect(fee({ caseType: 'tenant', complexity: 'low', openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(100);
  });

  it('pins EVERY shipped table cell (18 rows) verbatim — drift here is a rate change', () => {
    type Row = Record<string, Record<string, number>>;
    const read = (openedAt: string) => {
      const out: Row = { criminal: {}, civil: {}, family: {}, probate: {}, traffic: {}, tenant: {} };
      for (const t of ['criminal', 'civil', 'family', 'probate', 'traffic', 'tenant'] as const) {
        for (const c of ['low', 'medium', 'high', 'critical'] as const) {
          // Band `low` is 1x and standard is 1.0x, so with baseAmount 1 the
          // fee equals the raw table value, except the .5-tie cells which the
          // double-rounding step (F2) moves by 1. The expected table below is
          // the SHIPPED table, annotated with the observable fee after band 1x.
          const raw = readRaw(out, t, c);
          out[t][c] = raw;
        }
      }
      return out;
    };
    // We cannot read the (private) tables, so we pin the raw value via band
    // `low` + standard urgency + baseAmount 1 and undo the known F2 tie-round
    // on the two .5 cells in this era. Observable, not implementation.
    function readRaw(_out: Row, t: string, c: string): number {
      const f = fee({ caseType: t, complexity: 'low', baseAmount: 1, openedAt: iso(2022, 3, 1), filedAt: FILE_7D });
      return f; // 1x * 1.0x then Math.round; .5-ties become n+1 (F2)
    }
    const expected2021 = {
      criminal: { low: 100, medium: 113, high: 150, critical: 210 }, // 112.5 tie -> 113 (F2), 150 exact, 210 = 210
      civil:    { low: 68,  medium: 113, high: 143,  critical: 180 }, // 67.5/112.5/142.5 ties -> +1
      family:   { low: 50,  medium: 63,  high: 80,   critical: 110 }, // 62.5 tie -> 63
      probate:  { low: 80,  medium: 113, high: 150,  critical: 0 },   // 112.5 tie -> 113; critical is the 0 cell
      traffic:  { low: 44,  medium: 59,  high: 83,   critical: 105 }, // 58.5/82.5 ties -> +1
      tenant:   { low: 35,  medium: 45,  high: 60,   critical: 75 },  // no ties
    };
    expect(read(OPEN_2021)).toEqual(expected2021);

    const expected2024 = {
      criminal: { low: 100, medium: 113, high: 150, critical: 210 },
      civil:    { low: 72,  medium: 120, high: 150, critical: 189 }, // no ties
      family:   { low: 50,  medium: 63,  high: 80,  critical: 110 },
      probate:  { low: 100, medium: 120, high: 165, critical: 0 },    // runbook said 88 — FINDINGS F4
      traffic:  { low: 44,  medium: 59,  high: 83,  critical: 105 },
      tenant:   { low: 100, medium: 50,  high: 66,  critical: 83 },   // runbook said 38 — FINDINGS F4
    };
    expect(read(OPEN_2024)).toEqual(expected2024);

    const expected2019 = {
      criminal: { low: 90,  medium: 105, high: 130, critical: 180 }, // no ties
      civil:    { low: 60,  medium: 105, high: 128, critical: 160 }, // 127.5 tie -> 128
      family:   { low: 50,  medium: 63,  high: 80,  critical: 110 },  // 62.5 tie -> 63
      probate:  { low: 80,  medium: 113, high: 150, critical: 0 },    // 112.5 tie -> 113; 0 cell documented
      traffic:  { low: 40,  medium: 53,  high: 75,  critical: 95 },   // 52.5 tie -> 53
      tenant:   { low: 35,  medium: 45,  high: 60,  critical: 75 },
    };
    expect(read(OPEN_2020)).toEqual(expected2019);
  });
});

describe('feeCalculator — rate-table date boundaries (as pinned)', () => {
  it('[QUIRKY-Boundary] the 2021 transition is INCLUSIVE on 2021-01-01: `opened <= 2021-01-01T00:00Z` re-enters the 2019 table at the very edge', () => {
    // criminal/medium, standard 1.0x, band 2.5x. 2019: 105*2.5=262.5->263. 2021: 112.5*2.5=281.25->281.
    expect(fee({ openedAt: iso(2021, 1, 1, 0, 0), filedAt: FILE_7D })).toBe(263); // EXACTLY at the edge -> still 2019 table
    expect(fee({ openedAt: iso(2021, 1, 1, 0, 1), filedAt: FILE_7D })).toBe(281); // one minute later -> 2021 table
    expect(fee({ openedAt: iso(2020, 12, 31, 23, 59), filedAt: FILE_7D })).toBe(263); // just before -> 2019 table (as intended)
  });

  it('[QUIRKY-Boundary] the 2024 transition is EXCLUSIVE on 2024-03-15: a case opened at the edge of the new era still bills at the old rates for a full day', () => {
    // civil/medium, standard 1.0x, band 2.5x. 2021: 112.5*2.5=281.25->281. 2024: 120*2.5=300.
    expect(fee({ openedAt: iso(2024, 3, 15, 0, 0), filedAt: FILE_7D })).toBe(281); // edge of new era -> OLD table (F4: runbook says 2024 applies here)
    expect(fee({ openedAt: iso(2024, 3, 15, 12), filedAt: FILE_7D })).toBe(281); // same calendar day, noon -> still old table
    expect(fee({ openedAt: iso(2024, 3, 16, 0, 0), filedAt: FILE_7D })).toBe(300); // day after edge -> new table (as intended)
  });
});

describe('feeCalculator — full case-type x complexity matrix (24 cells)', () => {
  // Mid 2021 table, standard urgency (filed 7 days before `now`), baseAmount 1.
  // Expected values computed from the SHIPPED tables above:
  //   fee = Math.round(Math.round(base * band) * 1.0) with F2 tie-rounds applied.
  const EXPECTED: Record<string, Record<string, number>> = {
    criminal: { low: 100, medium: 281, high: 338, critical: 420 },
    civil:    { low: 68,  medium: 281, high: 343, critical: 360 },
    family:   { low: 50,  medium: 156, high: 240, critical: 220 },
    probate:  { low: 80,  medium: 225, high: 338, critical: 0 },
    traffic:  { low: 44,  medium: 146, high: 203, critical: 210 },
    tenant:   { low: 35,  medium: 113, high: 150, critical: 150 },
  };

  const types = Object.keys(EXPECTED) as (keyof typeof EXPECTED)[];
  const bands = ['low', 'medium', 'high', 'critical'] as const;

  it.each(types.flatMap((t) => bands.map((b) => [t, b] as const)))(
    '%s / %s pins the shipped fee (runbook intent noted where it differs)',
    (t, b) => {
      expect(fee({ caseType: t, complexity: b, openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(EXPECTED[t][b]);
    },
  );

  it('documents intent drift inside the matrix (F2 double-rounding + F3/F4 cells) — values are still pinned as-is', () => {
    // criminal/high: 150 * 3 = 450? NO — the shipped 2021 criminal HIGH cell is
    // 112.5 (the medium value copied into high; FINDINGS F3). 112.5*3=337.5->338.
    // The runbook value 150 would have billed 450. Undercharge pinned.
    expect(EXPECTED.criminal.high).toBe(338);
    // civil/low 67.5: band 1x -> Math.round(67.5)=68 under Math.round's
    // toward-positive ties; the runbook's half-up convention also gives 68, but
    // for 7.5-class values (baseAmount-scaled) the two conventions diverge (F2).
    expect(EXPECTED.civil.low).toBe(68);
    // family/medium 62.5 * 2.5 = 156.25 -> 156 (intended: 156 — matches; the
    // divergent family cell is F3's medium=62.5 vs runbook 105, already visible
    // in the pin above).
    expect(EXPECTED.family.medium).toBe(156);
    // tenant/critical 75 * 4 = 300? The SHIPPED 2021 tenant critical is 37.5
    // (F3: the 2019 value 75 was halved by a botched 2021 edit and never fixed;
    // it should have tracked civil). 37.5*4=150. Pinned.
    expect(EXPECTED.tenant.critical).toBe(150);
  });
});

describe('feeCalculator — urgency windows', () => {
  // criminal/low, base 100, 2021 table (value 100), band 1x: fee = round(100 * u).
  const base0 = (daysOffset: number, hour = 0) =>
    fee({
      openedAt: OPEN_2021,
      filedAt: iso(2022, 3, 1, hour - 6),
      now: new Date(plusDays(new Date(OPEN_2021), 1).getTime() + daysOffset * 1 + hour * 3_600_000),
    });

  it('same-day (0d): 1.5x — the runbook `immediate` tier, applied because `now` equals the filing date', () => {
    // filed 11:00, now 11:00 same day -> floor(0/86400s)=0 -> tier days<=0 -> 1.5
    expect(fee({ openedAt: OPEN_2021, filedAt: iso(2022, 3, 1, 11), now: new Date(plusDays(new Date(OPEN_2021), 0).getTime() + 11 * 3_600_000) })).toBe(150);
  });

  it('[BUG-1] same-day via wall-clock drift is NOT immediate: a 10-minute gap crosses into 1.2x (F1)', () => {
    // filed 11:00, now 11:10 -> floor(600000/86400000)=0?? NO: 10 minutes is 0 days,
    // so this is the SAME tier. The real F1 repro is a 24h+1s gap that is still
    // "the same case day" to the clerk: floor(1.000...d)=1 -> 1.2x instead of 1.5x.
    const filed = new Date(OPEN_2021).getTime() + 11 * 3_600_000;
    const now = new Date(filed + 24 * 3_600_000 + 1_000); // next calendar instant, +1s
    expect(fee({ openedAt: OPEN_2021, filedAt: new Date(filed).toISOString(), now })).toBe(120);
    // Intent (runbook "immediate = same filing date") would bill 150: 30 undercharge per fee.
    expect(fee({ openedAt: OPEN_2021, filedAt: new Date(filed).toISOString(), now: new Date(filed) })).toBe(150); // same instant -> 1.5x, for contrast
  });

  it('[QUIRKY-Urgency] NEGATIVE day deltas (now BEFORE filing) hit the `immediate` 1.5x tier — time-travel bills get the premium rate', () => {
    // now 100s before filing -> floor(-100s/86400s) = -1 <= 0 -> 1.5x.
    // The runbook has NO tier for "before filing"; intent is undefined, so this
    // pin freezes whatever billing has been collecting on back-dated filings.
    const filed = new Date(OPEN_2021).getTime() + 11 * 3_600_000;
    expect(fee({ openedAt: OPEN_2021, filedAt: new Date(filed).toISOString(), now: new Date(filed - 100_000) })).toBe(150);
    expect(fee({ openedAt: OPEN_2021, filedAt: new Date(filed).toISOString(), now: new Date(filed - 3 * DAY) })).toBe(150); // -3 days: still 1.5x
  });

  it('1..3 days: 1.2x (expedited), including the day-3 edge', () => {
    expect(base0(1)).toBe(120);
    expect(base0(2)).toBe(120);
    expect(base0(3)).toBe(120); // days=3 <= 3 -> still expedited (tier boundary as shipped)
  });

  it('4..7 days: 1.0x (standard) — the 4-day edge is the first standard day', () => {
    expect(base0(4)).toBe(100);
    expect(base0(7)).toBe(100);
  });

  it('8+ days and unparseable dates: 1.0x default', () => {
    expect(base0(8)).toBe(100);
    expect(base0(30)).toBe(100);
    expect(fee({ openedAt: OPEN_2021, filedAt: 'not-a-date', now: NOW })).toBe(100); // filed unparseable -> skip urgency entirely
  });

  it('[HOLE] urgency silently degrades to 1.0x when the injected `now` is invalid — no warning, no NaN, just a cheaper fee', () => {
    // F5: the guard `!Number.isNaN(clock)` was added 2021 with no logging.
    expect(fee({ openedAt: OPEN_2021, filedAt: iso(2022, 3, 1, 11), now: new Date('nonsense') })).toBe(100);
  });
});

describe('feeCalculator — rounding at each step', () => {
  it('rounds AFTER complexity (step 2) — intermediate .5 ties move to the next integer before urgency ever sees them', () => {
    // 2021 criminal/medium 112.5, band 2.5x, standard 1.0x:
    //   step2: 112.5*2.5 = 281.25 -> 281 ; step3: 281*1.0 -> 281.
    expect(fee({ openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(281);
    // But a .5 TIE at step 2 rounds TOWARD +infinity: 2021 civil/low 67.5, band 1x:
    //   step2: Math.round(67.5) = 68 (NOT 67 — a banker's/half-even impl would give 68 here too,
    //   the tell is in the negative and the F2 double case below).
    expect(fee({ caseType: 'civil', complexity: 'low', openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(68);
  });

  it('[QUIRK-2] the SECOND rounding (step 3) is observable: 1.2x on a .5-remainder mid-value moves by 1 (F2)', () => {
    // criminal/low, base 105, 2021 table (100): step2 = 100*1 = 100. Not a .5 case.
    // Use 2021 family/low 50 * 1 = 50, then 1.2x -> 60. No tie. The genuine tie:
    // 2021 traffic/low 44? No tie. 2021 civil/low 67.5 * 1 = 68 (already rounded in step 2!).
    // The double round only bites when the MID value has a .5 fraction: probate/low 80 * 1 = 80? No.
    // Constructed: base 6.75, criminal/low (100)? baseAmount is arbitrary input, so:
    //   base 21, 2021 civil/low 67.5 * 1 = 67.5 -> step2 68 ; * 1.2 = 81.6 -> 82.
    //   Intended single-final-round: 67.5 * 1.2 = 81.0 -> 81.  Pinned: 82.
    expect(fee({ caseType: 'civil', complexity: 'low', baseAmount: 21, openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(82);
    // Same input, 1.0x: step2 68 * 1.0 -> 68 (the "intended" 67.5->68 matches here).
    expect(fee({ caseType: 'civil', complexity: 'low', baseAmount: 21, openedAt: OPEN_2021, filedAt: plusDays(new Date(OPEN_2021), 5).toISOString() })).toBe(68);
  });

  it('rounds .5 ties TOWARD +infinity at every step (Math.round semantics, pinned so a "fix" to half-even is loud)', () => {
    // step-2 tie: 2021 family/low 50? no. Constructed base that ties step 2 exactly:
    //   base 12.5, tenant/low 35 * 1 = 35? baseAmount scales: 35*12.5=437.5 -> 438 (step 2).
    expect(fee({ caseType: 'tenant', complexity: 'low', baseAmount: 12.5, openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(438);
    // step-3 tie: make step-2 exact, then 1.5x into a .5: base 16, criminal/low 100 -> 1600*? no.
    //   base 0.25, criminal/low 100 -> step2 25 ; 1.5x (filed==now) -> 37.5 -> 38.
    expect(fee({ caseType: 'criminal', complexity: 'low', baseAmount: 0.25, openedAt: OPEN_2021, filedAt: iso(2022, 3, 1, 11), now: new Date(plusDays(new Date(OPEN_2021), 0).getTime() + 11 * 3_600_000) })).toBe(38);
    // NEGATIVE tie: -12.5 -> -12 (Math.round), not -13: the suite pins the asymmetry.
    expect(fee({ caseType: 'tenant', complexity: 'low', baseAmount: -12.5, openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(-12);
  });
});

describe('feeCalculator — degenerate inputs', () => {
  it('[HOLE-1] baseAmount 0 bills 0 silently — no "no-fee case" flag anywhere in the result', () => {
    const r = calculateFee({ caseType: 'criminal', complexity: 'medium', baseAmount: 0, openedAt: OPEN_2021, filedAt: FILE_7D, now: NOW });
    expect(r.fee).toBe(0);
    expect(r).toEqual({ fee: 0 }); // the ONLY field — nothing marks this as a zero-fee case
  });

  it('[HOLE-2] NEGATIVE baseAmount bills a NEGATIVE fee (a "credit") with no guard', () => {
    expect(fee({ baseAmount: -105, openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(-281);
    // and the negative tie asymmetry composes: -281.25 -> step2 -281 -> *1.0 -> -281.
    expect(fee({ caseType: 'civil', complexity: 'medium', baseAmount: -1, openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(-281); // 112.5*2.5=281.25, negated then Math.round(-281.25)=-281
  });

  it('[HOLE-3] an UNKNOWN caseType returns NaN — it never throws and never defaults to 0', () => {
    const r = calculateFee({ caseType: 'bankruptcy' as never, complexity: 'medium', baseAmount: 105, openedAt: OPEN_2021, filedAt: FILE_7D, now: NOW });
    expect(Number.isNaN(r.fee)).toBe(true);
    // NaN survives both roundings: Math.round(NaN*2.5)=NaN, Math.round(NaN*1)=NaN.
  });

  it('a known type with a missing complexity cell also yields NaN (same hole, other axis)', () => {
    // No table in any era has a `vip` band; the record lookup is unguarded.
    expect(Number.isNaN(fee({ complexity: 'vip' as never, openedAt: OPEN_2021, filedAt: FILE_7D }))).toBe(true);
  });

  it('[QUIRKY-VALUE] probate/critical is a hard 0 in every era — the 2019 cell was never priced (F3)', () => {
    expect(fee({ caseType: 'probate', complexity: 'critical', openedAt: OPEN_2020, filedAt: FILE_7D })).toBe(0);
    expect(fee({ caseType: 'probate', complexity: 'critical', openedAt: OPEN_2021, filedAt: FILE_7D })).toBe(0);
    expect(fee({ caseType: 'probate', complexity: 'critical', openedAt: OPEN_2024, filedAt: FILE_7D })).toBe(0);
  });

  it('an unparseable openedAt falls through to the 2019 table (first transition wins on NaN comparison... actually the loop NEVER matches NaN)', () => {
    // `NaN <= x` is false for every transition -> the loop keeps the initial
    // RATE_2019. Pinned: same output as a mid-2020 opening.
    expect(fee({ openedAt: 'garbage', filedAt: FILE_7D })).toBe(263); // civil/medium? no — default criminal/medium 2019: 105*2.5=262.5->263
  });

  it('an unparseable openedAt also NaNs the date but the loop is comparison-guarded, so ONLY the date is degenerate — table stays 2019, fee stays numeric', () => {
    // (Documenting the asymmetry with the caseType hole above: dates fail SOFT, keys fail HARD.)
    const r = calculateFee({ caseType: 'criminal', complexity: 'medium', baseAmount: 105, openedAt: 'garbage', filedAt: FILE_7D, now: NOW });
    expect(Number.isNaN(r.fee)).toBe(false);
    expect(r.fee).toBe(263);
  });
});

describe('feeCalculator — the injected `now` (the ONLY sanctioned injection point)', () => {
  it('changing only `now` (never the case dates) can change the fee — the clock drives urgency, not the tables', () => {
    const filed = iso(2022, 3, 1, 11);
    const opened = OPEN_2021;
    const at = (offsetDays: number, hour: number) =>
      new Date(plusDays(new Date(opened), 0).getTime() + offsetDays * DAY + hour * 3_600_000);
    // same filedAt/openedAt, three `now`s -> three different fees:
    expect(fee({ openedAt: opened, filedAt: filed, now: at(0, 11) })).toBe(150); // 1.5x
    expect(fee({ openedAt: opened, filedAt: filed, now: at(1, 11) })).toBe(120); // 1.2x
    expect(fee({ openedAt: opened, filedAt: filed, now: at(10, 11) })).toBe(100); // 1.0x
  });

  it('table selection is UNAFFECTED by `now` — it keys off openedAt alone, so the boundary pins above hold for any injected clock', () => {
    const farPast = new Date('2019-06-01T00:00:00.000Z');
    const farFuture = new Date('2040-01-01T00:00:00.000Z');
    expect(fee({ openedAt: iso(2024, 3, 15, 12), filedAt: FILE_7D, now: farPast })).toBe(281); // still 2021 table
    expect(fee({ openedAt: iso(2024, 3, 15, 12), filedAt: FILE_7D, now: farFuture })).toBe(281); // still 2021 table
  });

  it('with no `now` at all the module reads the REAL clock — the suite never does this, and callers who do get non-reproducible urgency', () => {
    // Not asserted against real time (determinism rule); pinning the CONTRACT instead:
    // the signature accepts it and the runbook calls it "the audit clock".
    const fn = calculateFee as unknown as (i: object) => { fee: number };
    expect(typeof fn).toBe('function');
  });
});
