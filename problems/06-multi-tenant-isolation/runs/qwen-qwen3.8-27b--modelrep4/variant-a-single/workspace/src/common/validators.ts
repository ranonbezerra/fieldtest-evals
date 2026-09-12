import { ValidationError } from './api-error.js';

/** The parsed JSON body of a request, guaranteed to be a plain object. */
export type Body = Record<string, unknown>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function bodyOf(rawBody: unknown): Body {
  if (rawBody === undefined || rawBody === null) {
    return {};
  }
  if (typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return rawBody as Body;
}

export function requireString(body: Body, field: string, options: { max?: number } = {}): string {
  const max = options.max ?? 500;
  const value = body[field];
  if (typeof value !== 'string') {
    throw new ValidationError(`"${field}" is required and must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`"${field}" is required and must not be empty`);
  }
  if (trimmed.length > max) {
    throw new ValidationError(`"${field}" must be at most ${max} characters long`);
  }
  return trimmed;
}

export function optionalString(body: Body, field: string, options: { max?: number } = {}): string | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  const max = options.max ?? 500;
  if (typeof value !== 'string') {
    throw new ValidationError(`"${field}" must be a string when provided`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`"${field}" must not be empty when provided`);
  }
  if (trimmed.length > max) {
    throw new ValidationError(`"${field}" must be at most ${max} characters long`);
  }
  return trimmed;
}

export function requireEmail(body: Body, field: string): string {
  const value = requireString(body, field, { max: 320 });
  if (!EMAIL_PATTERN.test(value)) {
    throw new ValidationError(`"${field}" must be a valid email address`);
  }
  return value;
}

export function requireNonNegativeInt(body: Body, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`"${field}" is required and must be an integer`);
  }
  if (value < 0) {
    throw new ValidationError(`"${field}" must be greater than or equal to 0`);
  }
  return value;
}
