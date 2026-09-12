import { createHash } from 'crypto';

/**
 * Deterministic canonicalization:
 * - Recursively sort object keys alphabetically.
 * - Serialize numbers using JSON.stringify (preserves value).
 * - No whitespace.
 * - UTF‑8 encoding of resulting string.
 */
export function canonicalize(value: any): string {
  if (value === null || typeof value !== 'object') {
    // primitives
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((v) => canonicalize(v));
    return `[${items.join(',')}]`;
  }

  // object
  const keys = Object.keys(value).sort();
  const props = keys.map((k) => `"${k}":${canonicalize(value[k])}`);
  return `{${props.join(',')}}`;
}

/**
 * SHA‑256 hash of UTF‑8 bytes, returned as hex string.
 */
export function sha256(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
