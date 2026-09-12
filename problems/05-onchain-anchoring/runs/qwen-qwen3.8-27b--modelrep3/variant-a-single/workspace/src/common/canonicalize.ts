import { createHash } from 'node:crypto';

/**
 * Canonical form of structured report content.
 *
 * The PDF is a rendering; the structured JSON is the source of truth.
 * Canonicalization is the single definition of "the same content":
 *  - object keys are sorted recursively (UTF-16 code unit order, i.e. the
 *    default Array.prototype.sort on strings)
 *  - array element order is preserved (position is meaningful in a report)
 *  - output is compact JSON with no insignificant whitespace
 *
 * canonicalHash is SHA-256 over the UTF-8 bytes of that canonical form,
 * lowercase hex. It is the value embedded in the on-chain anchor.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      ordered[key] = canonicalValue(source[key]);
    }
    return ordered;
  }
  return value;
}

export function canonicalHash(content: unknown): string {
  return createHash('sha256').update(canonicalize(content), 'utf8').digest('hex');
}
