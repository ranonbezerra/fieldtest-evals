const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar-day helper: "YYYY-MM-DD" maps to UTC midnight. */
export function dayMs(date: string): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) {
    throw new Error(`invalid date: ${date}`);
  }
  return t;
}

/** All calendar days in [from, to] (inclusive). */
export function* iterDays(from: string, to: string): Generator<string> {
  let t = dayMs(from);
  const end = dayMs(to);
  let i = 0;
  while (t <= end && i < 62) {
    yield new Date(t).toISOString().slice(0, 10);
    t += DAY_MS;
    i += 1;
  }
}

export function todayUtcDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
