export const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the UTC day containing `date` (UTC midnight). */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** A calendar day as YYYY-MM-DD in UTC. */
export function toUtcYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}
