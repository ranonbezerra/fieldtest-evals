import { ApiError } from './api-error.js';

/** Input-validation helpers used by controllers (controllers own validation). */

export function readObject(body: unknown, field = 'body'): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'validation_error', 'Request body must be a JSON object.', { field });
  }
  return body as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'validation_error', `${field} must be a non-empty string.`, { field });
  }
  return value.trim();
}

export function requireStringArray(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ApiError(400, 'validation_error', `${field} must be an array of strings.`, { field });
  }
  return value;
}
