import type { Severity } from '@prisma/client';
import { InvalidInputException } from './exceptions.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SEVERITIES: readonly Severity[] = ['watch', 'restricted', 'banned'];

export function assertUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new InvalidInputException(`Field "${field}" must be a UUID string.`, { field });
  }
  return value;
}

export function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidInputException(`Field "${field}" must be a non-empty string.`, { field });
  }
  return value;
}

export function assertSeverity(value: unknown, field: string): Severity {
  if (typeof value !== 'string' || !(SEVERITIES as readonly string[]).includes(value)) {
    throw new InvalidInputException(`Field "${field}" must be one of: ${SEVERITIES.join(', ')}.`, {
      field,
    });
  }
  return value as Severity;
}

export function assertObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidInputException(`Field "${field}" must be an object.`, { field });
  }
  return value as Record<string, unknown>;
}
