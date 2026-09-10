const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Field → reason map accumulated by the parse helpers. */
export type Problems = Record<string, string>;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function parseUuid(value: string | undefined, field: string, problems: Problems): string | undefined {
  if (value === undefined || value === '') {
    problems[field] = 'is required and must be a UUID';
    return undefined;
  }
  if (!isUuid(value)) {
    problems[field] = 'must be a UUID';
    return undefined;
  }
  return value;
}

export function parseStatus(
  value: string | undefined,
  problems: Problems,
): 'pending' | 'approved' | 'rejected' | undefined {
  if (value === undefined || value === '') return undefined;
  if (value !== 'pending' && value !== 'approved' && value !== 'rejected') {
    problems.status = "must be one of 'pending', 'approved', 'rejected'";
    return undefined;
  }
  return value;
}

export function parseIsoDate(value: string | undefined, field: string, problems: Problems): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    problems[field] = 'must be an ISO 8601 date-time';
    return undefined;
  }
  return date;
}

export function parsePositiveInt(
  value: string | undefined,
  field: string,
  problems: Problems,
  fallback: number,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    problems[field] = 'must be a positive integer';
    return fallback;
  }
  return parsed;
}

export function parseBoundedInt(
  value: string | undefined,
  field: string,
  problems: Problems,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    problems[field] = `must be an integer between ${min} and ${max}`;
    return fallback;
  }
  return parsed;
}

export function parseAmountCents(value: unknown, problems: Problems): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2_000_000_000) {
    problems.amount_cents = 'must be a non-negative integer of cents';
    return undefined;
  }
  return value;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
