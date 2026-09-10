import { ApiError } from './api-error';
import { STATUSES } from './types';
import type { Status } from './types';

export function parsePositiveInt(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, 'validation_failed', `${field} must be a positive integer`, { field, received: String(value) });
  }
  return n;
}

export function parseRequiredPositiveInt(value: unknown, field: string): number {
  if (value === undefined || value === '') {
    throw new ApiError(400, 'validation_failed', `${field} is required`, { field });
  }
  return parsePositiveInt(value, field);
}

export function parseOptionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(400, 'validation_failed', `${field} must be an ISO-8601 date`, { field, received: String(value) });
  }
  return d;
}

export function parseStatuses(value: string | string[] | undefined): Status[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  for (const s of list) {
    if (!STATUSES.includes(s as Status)) {
      throw new ApiError(400, 'validation_failed', `status must be one of: ${STATUSES.join(', ')}`, { received: s });
    }
  }
  return [...new Set(list as Status[])];
}
