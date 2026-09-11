import type { Severity as PrismaSeverity } from '@prisma/client';

/** Public severity vocabulary (lowercase), as exposed by the API. */
export type Severity = 'banned' | 'restricted' | 'watch';

export const SEVERITIES: readonly Severity[] = ['banned', 'restricted', 'watch'];

const TO_PRISMA: Record<Severity, PrismaSeverity> = {
  banned: 'BANNED',
  restricted: 'RESTRICTED',
  watch: 'WATCH',
};

const FROM_PRISMA: Record<PrismaSeverity, Severity> = {
  BANNED: 'banned',
  RESTRICTED: 'restricted',
  WATCH: 'watch',
};

const RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

export function toPrismaSeverity(severity: Severity): PrismaSeverity {
  return TO_PRISMA[severity];
}

export function fromPrismaSeverity(severity: PrismaSeverity): Severity {
  return FROM_PRISMA[severity];
}

/** banned > restricted > watch; drives the deterministic precedence. */
export function severityRank(severity: Severity): number {
  return RANK[severity];
}
