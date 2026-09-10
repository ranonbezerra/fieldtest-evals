import type { OrderStatus } from '@prisma/client';
import { AppError } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(value: string): boolean {
  return UUID_RE.test(value);
}

export const ORDER_STATUSES: OrderStatus[] = ['pending', 'approved', 'rejected'];

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw AppError.validation(`${what} must be a JSON object`, { what });
  }
  return value as Record<string, unknown>;
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUUID(value)) {
    throw AppError.validation(`${field} must be a UUID`, { field, value });
  }
  return value;
}

export function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  return requireUuid(value, field);
}

export function requireStatus(value: unknown, field: string): OrderStatus {
  if (typeof value === 'string' && ORDER_STATUSES.includes(value as OrderStatus)) {
    return value as OrderStatus;
  }
  throw AppError.validation(`${field} must be one of: ${ORDER_STATUSES.join(', ')}`, { field, value });
}

export function optionalStatus(value: unknown, field: string): OrderStatus | undefined {
  if (value === undefined || value === '') return undefined;
  return requireStatus(value, field);
}

export function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw AppError.validation(`${field} must be a non-empty string of at most ${maxLength} characters`, {
      field,
      value,
      maxLength,
    });
  }
  return value;
}

export function requirePositiveInt(value: unknown, field: string, max?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw AppError.validation(`${field} must be a positive integer`, { field, value });
  }
  if (max !== undefined && value > max) {
    throw AppError.validation(`${field} must not exceed ${max}`, { field, value, max });
  }
  return value;
}

export function optionalIntQuery(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  return requirePositiveInt(typeof value === 'string' ? Number(value) : value, field, max);
}

export function requireIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value === '') {
    throw AppError.validation(`${field} must be an ISO-8601 timestamp`, { field, value });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw AppError.validation(`${field} is not a valid ISO-8601 timestamp`, { field, value });
  }
  return parsed;
}

export function optionalIsoDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  return requireIsoDate(value, field);
}
