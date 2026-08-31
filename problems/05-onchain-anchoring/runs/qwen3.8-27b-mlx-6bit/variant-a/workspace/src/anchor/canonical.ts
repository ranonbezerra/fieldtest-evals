import { createHash } from 'node:crypto';

/**
 * Raised when a value cannot be represented in canonical JSON form
 * (e.g. circular references, BigInts, non-finite numbers).
 */
export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Canonical JSON form of a structured value: object keys sorted
 * lexicographically at every level, arrays preserved in order, no
 * whitespace, UTF-8. Throws {@link CanonicalizationError} for values that
 * JSON cannot represent.
 */
export function canonicalize(value: unknown): string {
  const normalized = normalize(value, new Set<object>());
  try {
    return JSON.stringify(normalized);
  } catch (err) {
    throw new CanonicalizationError(
      `Value is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * SHA-256 hex digest of the canonical form of a structured value.
 */
export function hashContent(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Recursively rebuilds the value in canonical order, rejecting anything JSON
 * cannot represent. Shared (non-circular) references are allowed; true cycles
 * are not.
 */
function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError('Non-finite numbers are not JSON-serializable');
      }
      return value;
    case 'bigint':
      throw new CanonicalizationError('BigInt values are not JSON-serializable');
    case 'function':
      throw new CanonicalizationError('Functions are not JSON-serializable');
    case 'symbol':
      throw new CanonicalizationError('Symbols are not JSON-serializable');
    case 'undefined':
      throw new CanonicalizationError('Undefined values are not JSON-serializable');
    case 'object':
      break;
  }

  const record = value as object;
  if (seen.has(record)) {
    throw new CanonicalizationError('Circular structure is not JSON-serializable');
  }
  seen.add(record);

  let result: unknown;
  if (Array.isArray(record)) {
    // Arrays preserve order.
    result = record.map((item) => normalize(item, seen));
  } else {
    // Objects: keys sorted lexicographically at every level.
    const source = record as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalize(source[key], seen);
    }
    result = out;
  }

  // Drop only after children are done so shared references (DAGs) serialize
  // again while true cycles still throw.
  seen.delete(record);
  return result;
}
