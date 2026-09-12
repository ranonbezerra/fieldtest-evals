import { createHash } from 'node:crypto';

/**
 * Canonical serialization of report content — the written spec is
 * docs/canonicalization.md; this is the reference implementation an auditor
 * can diff against.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`non-finite number cannot be canonically serialized: ${value}`);
      }
      // Shortest round-trip decimal representation (JSON.stringify semantics).
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      // Keys sorted lexicographically (UTF-16 code unit order); undefined values omitted.
      const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
    }
    default:
      throw new Error(`unsupported value type in report content: ${typeof value}`);
  }
}

/** SHA-256 of the canonical UTF-8 bytes, 64 lowercase hex characters. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
