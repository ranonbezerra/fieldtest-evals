import { InvalidRequestError } from './errors.js';

/** Input-validation helpers: the controller's only job, no business logic. */

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidRequestError(`${label} must be a JSON object.`, { field: label });
  }
  return value as Record<string, unknown>;
}

export function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidRequestError(`'${field}' is required and must be a non-empty string.`, { field });
  }
  return value;
}

export function optionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidRequestError(`'${field}' must be a non-empty string when provided.`, { field });
  }
  return value;
}

export function requiredPositiveInt(record: Record<string, unknown>, field: string): number {
  const raw = record[field];
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new InvalidRequestError(`'${field}' is required and must be a positive integer.`, { field });
  }
  return value;
}

export function optionalPositiveInt(record: Record<string, unknown>, field: string): number | undefined {
  const raw = record[field];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new InvalidRequestError(`'${field}' must be a positive integer when provided.`, { field });
  }
  return value;
}
