import { OrderStatus } from '@prisma/client';
import { ValidationError } from './errors.js';
import { ORDER_STATUSES } from './order-status.js';

export type ValidationErrors = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function finishValidation(errors: ValidationErrors): void {
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid request parameters', errors);
  }
}

export function parseUuid(value: unknown, field: string, errors: ValidationErrors): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    errors[field] = 'must be a valid UUID';
    return '';
  }
  return value;
}

export function parseOptionalUuid(value: unknown, field: string, errors: ValidationErrors): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = parseUuid(value, field, errors);
  return errors[field] !== undefined ? undefined : parsed;
}

export function requireUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError('Invalid request parameters', { [field]: 'must be a valid UUID' });
  }
}

export function parseStatus(value: unknown, field: string, errors: ValidationErrors): OrderStatus | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !(ORDER_STATUSES as readonly string[]).includes(value)) {
    errors[field] = `must be one of: ${ORDER_STATUSES.join(', ')}`;
    return undefined;
  }
  return value as OrderStatus;
}

export function parseOptionalIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return parseIsoDate(value, field, errors);
}

export function parseRequiredIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (value === undefined || value === null || value === '') {
    errors[field] = 'is required';
    return undefined;
  }
  return parseIsoDate(value, field, errors);
}

function parseIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (typeof value !== 'string') {
    errors[field] = 'must be an ISO-8601 date string';
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    errors[field] = 'must be a valid ISO-8601 date';
    return undefined;
  }
  return date;
}

export function parsePositiveInt(value: unknown, field: string, errors: ValidationErrors, max?: number): number | undefined {
  const n = toInt(value);
  if (!Number.isInteger(n) || n < 1 || (max !== undefined && n > max)) {
    errors[field] = max !== undefined ? `must be an integer between 1 and ${max}` : 'must be a positive integer';
    return undefined;
  }
  return n;
}

export function parseNonNegativeInt(value: unknown, field: string, errors: ValidationErrors): number | undefined {
  const n = toInt(value);
  if (!Number.isInteger(n) || n < 0) {
    errors[field] = 'must be an integer >= 0';
    return undefined;
  }
  return n;
}

function toInt(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value);
  }
  return NaN;
}

export function parseCurrency(value: unknown, field: string, errors: ValidationErrors): string | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) {
    errors[field] = 'must be a 3-letter ISO-4217 currency code';
    return undefined;
  }
  return value.toUpperCase();
}
