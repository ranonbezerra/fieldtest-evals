/**
 * feeCalculator.ts — procedural fee calculator, case-management system.
 *
 * Running unmodified since 2019. Billing calls it once per case at fee
 * generation; every output is stored and feeds the annual fee audit, so
 * historical outputs are part of the record.
 *
 * The rate table is selected by the case OPENING date (two scheduled
 * revisions). The optional `now` parameter is the module's only clock
 * injection point.
 *
 * KNOWN-AS-IS BANNER — 2025 characterization cycle:
 *   This file is frozen on purpose. The characterization suite in
 *   test/fee-calculator.spec.ts pins its current behavior, quirks and
 *   defects verbatim, and FINDINGS.md reproduces each one with input,
 *   blast radius and a proposed (NOT APPLIED) fix. Do not "clean up"
 *   lines here ahead of that work: every change is gated on the suite.
 */

export type CaseType =
  | 'criminal'
  | 'civil'
  | 'family'
  | 'probate'
  | 'traffic'
  | 'tenant';

export type ComplexityBand = 'low' | 'medium' | 'high' | 'critical';

export interface FeeInput {
  caseType: CaseType;
  complexity: ComplexityBand;
  /** Base amount in dollars, as entered in the case record. Not validated here. */
  baseAmount: number;
  /** ISO date of the claim filing. */
  filedAt: string;
  /** ISO date the case was opened. Drives the rate-table selection. */
  openedAt: string;
  /**
   * Optional injected clock. Present since the 2021 audit work; the
   * 2019 original hardcoded `new Date()`. Only consumed by urgency
   * (and only when both dates parse — otherwise the real clock is
   * used), which is why urgency below looks the way it does.
   */
  now?: Date;
}

export interface FeeResult {
  fee: number;
}

/**
 * Fee tables, one per era. Values are whole dollars and match the
 * billing-kept history sheet (do not reformat).
 *
 *   2019 table — original, unchanged to date.
 *   2021 table — scheduled increase effective 2021-01-01 (criminal,
 *                civil, traffic moved; family, probate, tenant held).
 *   2024 table — scheduled revision effective 2024-03-15 (civil up,
 *                probate and tenant up; criminal, family, traffic held).
 *
 * Probate "critical" never received a 2019 cell and has kept 0 since;
 * nobody back-filled it because it never alarmed. Left exactly as shipped.
 */
const RATE_2019: Record<CaseType, Record<ComplexityBand, number>> = {
  criminal: { low: 90, medium: 105, high: 130, critical: 180 },
  civil:    { low: 60, medium: 105, high: 127.5, critical: 160 },
  family:   { low: 50, medium: 62.5, high: 80, critical: 110 },
  probate:  { low: 80, medium: 112.5, high: 150, critical: 0 },
  traffic:  { low: 40, medium: 52.5, high: 75, critical: 95 },
  tenant:   { low: 35, medium: 45, high: 60, critical: 75 },
};

const RATE_2021: Record<CaseType, Record<ComplexityBand, number>> = {
  criminal: { low: 100, medium: 112.5, high: 150, critical: 210 },
  civil:    { low: 67.5, medium: 112.5, high: 142.5, critical: 180 },
  family:   { low: 50, medium: 62.5, high: 80, critical: 110 },
  probate:  { low: 80, medium: 112.5, high: 150, critical: 0 },
  traffic:  { low: 44, medium: 58.5, high: 82.5, critical: 105 },
  tenant:   { low: 35, medium: 45, high: 60, critical: 75 },
};

const RATE_2024: Record<CaseType, Record<ComplexityBand, number>> = {
  criminal: { low: 100, medium: 112.5, high: 150, critical: 210 },
  civil:    { low: 72, medium: 120, high: 150, critical: 189 },
  family:   { low: 50, medium: 62.5, high: 80, critical: 110 },
  probate:  { low: 88, medium: 120, high: 165, critical: 0 },
  traffic:  { low: 44, medium: 58.5, high: 82.5, critical: 105 },
  tenant:   { low: 38, medium: 49.5, high: 66, critical: 82.5 },
};

/** Table revision dates. Both are compared with `<=` below. */
const TABLE_TRANSITIONS = [
  { date: '2021-01-01', table: RATE_2021 },
  { date: '2024-03-15', table: RATE_2024 },
] as const;

/** Complexity bands multiply the table value. */
const COMPLEXITY_MULTIPLIER: Record<ComplexityBand, number> = {
  low: 1,
  medium: 2.5,
  high: 3,
  critical: 4,
};

/**
 * Urgency tiers, documented in the 2019 runbook:
 *   immediate  — same filing date (1.5x)
 *   expedited  — 1..3 calendar days after filing (1.2x)
 *   standard   — anything else (1.0x)
 */
const URGENCY_TIERS = [
  { days: 0, multiplier: 1.5 },   // immediate
  { days: 3, multiplier: 1.2 },   // expedited
] as const;
const STANDARD_MULTIPLIER = 1.0;

/**
 * Whole-dollar rounding helper.
 *
 * NOTE (pre-existing, keep as-is): `Math.round` rounds .5 ties TOWARD
 * +infinity (12.5 -> 13, -12.5 -> -12). It is applied at BOTH steps
 * below — after complexity and again after urgency — because that is
 * what the 2019 code did. See FINDINGS.md, "double rounding".
 */
function roundWhole(value: number): number {
  return Math.round(value);
}

/**
 * Compute the procedural fee for a case.
 *
 * Steps, in order:
 *   1. pick the fee table from the case opening date;
 *   2. multiply the table value by the complexity band, round;
 *   3. multiply by the urgency multiplier, round.
 *
 * Returns `{ fee }` in whole dollars.
 */
export function calculateFee(input: FeeInput): FeeResult {
  const opened = new Date(input.openedAt);

  // 1) Rate table by opening date: first transition whose date is
  //    >= the opening date wins; otherwise the original table.
  let table = RATE_2019;
  for (const { date, table: candidate } of TABLE_TRANSITIONS) {
    if (opened.getTime() <= new Date(date).getTime()) {
      table = candidate;
    }
  }
  const base = table[input.caseType]?.[input.complexity];

  // 2) Complexity. `base` is deliberately unguarded: an unknown type or a
  //    missing table cell yields `undefined` here and propagates as NaN.
  const afterComplexity = roundWhole(base * COMPLEXITY_MULTIPLIER[input.complexity]);

  // 3) Urgency.
  const clock = input.now ?? new Date();
  const filed = new Date(input.filedAt);
  let urgency = STANDARD_MULTIPLIER;
  if (!Number.isNaN(filed.getTime()) && !Number.isNaN(clock.getTime())) {
    const days = Math.floor((clock.getTime() - filed.getTime()) / 86_400_000);
    for (const tier of URGENCY_TIERS) {
      if (days <= tier.days) {
        urgency = tier.multiplier;
        break;
      }
    }
  }

  // 4) Final rounding (second of two — see the note on roundWhole).
  return { fee: roundWhole(afterComplexity * urgency) };
}

/** Which table a given opening date would select (first match wins). */
export function tableFor(openedAt: string): '2019' | '2021' | '2024' {
  const opened = new Date(openedAt);
  for (const { date } of TABLE_TRANSITIONS) {
    if (opened.getTime() <= new Date(date).getTime()) {
      return date.startsWith('2021') ? '2021' : '2024';
    }
  }
  return '2019';
}
