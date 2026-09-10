import { ApiError } from './api-error.js';

/** Controller-level shape validation for JSON request bodies. */

export function asBodyObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'validation_error', 'request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'validation_error', `body field "${field}" is required and must be a non-empty string`, {
      field,
    });
  }
  return value;
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'validation_error', `body field "${field}" must be a non-empty string`, { field });
  }
  return value;
}

export function optionalQueryDate(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, 'validation_error', `query parameter "${field}" must be an ISO-8601 date`, { field });
  }
  return parsed;
}

export function optionalPositiveInt(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new ApiError(400, 'validation_error', `query parameter "${field}" must be a positive integer`, { field });
  }
  return Number(value);
}
