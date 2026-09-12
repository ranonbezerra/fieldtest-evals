import { createHash } from 'crypto';

/**
 * Recursively sorts object keys to ensure deterministic ordering.
 * Numbers are normalized to their minimal decimal representation.
 * Arrays preserve element order.
 */
function canonicalize(value: any): any {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  } else if (value && typeof value === 'object' && !(value instanceof Date)) {
    const sortedKeys = Object.keys(value).sort();
    const result: any = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize(value[key]);
    }
    return result;
  } else if (typeof value === 'number') {
    // Normalized numeric representation
    return Number(value);
  } else {
    return value;
  }
}

/**
 * Canonicalization specification (for auditors):
 * - Objects: keys sorted lexicographically (deeply).
 * - Arrays: order preserved.
 * - Numbers: represented in decimal without unnecessary trailing zeros.
 * - No whitespace; JSON stringified.
 * - UTF-8 encoding of the JSON string.
 * - Hash algorithm: SHA-256; output hex-encoded string.
 */
export function computeCanonicalHash(content: any): string {
  const canonical = canonicalize(content);
  const json = JSON.stringify(canonical);
  const hash = createHash('sha256').update(json, 'utf8').digest('hex');
  return hash;
}
