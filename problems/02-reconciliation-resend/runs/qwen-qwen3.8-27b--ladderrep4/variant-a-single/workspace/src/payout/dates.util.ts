/** Date helpers shared by the payout feature. All dates are handled in UTC. */

/** 'YYYY-MM-DD' key (the form getStatement takes) for a date. */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse a 'YYYY-MM-DD' key to the Date at UTC midnight. */
export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** The UTC midnight starting the day the argument falls on. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Inclusive list of UTC days from `from` to `to`; empty when `from` is after `to`. */
export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const end = startOfUtcDay(to).getTime();
  for (let cursor = startOfUtcDay(from).getTime(); cursor <= end; cursor += 86_400_000) {
    days.push(new Date(cursor));
  }
  return days;
}
