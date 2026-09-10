import { Prisma } from '@prisma/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_AMOUNT_RE = /^\d+(\.\d{1,4})?$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Coerces an unknown request body to a plain object. */
export function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Parses a positive integer from a query string. Returns the fallback when the
 * value is absent; null when present but invalid (the caller records the error).
 */
export function parsePositiveInt(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function parseBoundedPositiveInt(
  value: string | undefined,
  min: number,
  max: number,
  fallback: number,
  errors: Record<string, string>,
  field: string,
): number | null {
  const parsed = parsePositiveInt(value, fallback);
  if (parsed === null) {
    errors[field] = 'must be a positive integer';
    return null;
  }
  if (parsed < min || parsed > max) {
    errors[field] = `must be between ${min} and ${max}`;
    return null;
  }
  return parsed;
}

/** Accepts a positive number or a decimal string with at most 4 fractional digits. */
export function parseAmount(value: unknown): Prisma.Decimal | null {
  let source: string | null = null;
  if (typeof value === 'string' && POSITIVE_AMOUNT_RE.test(value)) {
    source = value;
  } else if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const fixed = value.toFixed(4);
    if (!POSITIVE_AMOUNT_RE.test(fixed)) return null;
    source = fixed;
  }
  if (source === null) return null;
  const decimal = new Prisma.Decimal(source);
  return decimal.greaterThan(0) ? decimal : null;
}
