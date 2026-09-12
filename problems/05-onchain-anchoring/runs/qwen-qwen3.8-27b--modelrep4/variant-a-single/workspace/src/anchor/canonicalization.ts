import { createHash } from 'node:crypto';

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

/**
 * Canonical form of a report's structured content. Definition:
 *
 * - plain objects: keys sorted in ascending code-unit order, values
 *   canonicalized recursively
 * - arrays: elements kept in original order (positions are part of the
 *   report's meaning)
 * - strings/booleans/null: standard JSON encoding
 * - numbers: standard JSON encoding, with -0 normalized to 0
 * - undefined values: dropped (JSON.stringify semantics)
 * - no whitespace: compact encoding
 *
 * The PDF is a rendering of the structured content; only this canonical form
 * is anchored, so byte-level differences of any rendering are irrelevant.
 */
export function canonicalize(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (Object.is(value, -0)) return '0';
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`non-finite number is not canonicalizable: ${value}`);
      }
      return JSON.stringify(value);
    case 'object': {
      if (value instanceof Date) {
        throw new CanonicalizationError('Date values are not canonicalizable; serialize them to ISO strings');
      }
      if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stableStringify(entryValue)] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${entryValue}`).join(',')}}`;
    }
    default:
      throw new CanonicalizationError(`value of type ${typeof value} is not canonicalizable`);
  }
}

/**
 * The anchored hash. It binds the document identity, the version, and the
 * canonical content together (plus a payload scheme tag for future format
 * changes), so the same content anchored under a different document or
 * version is a different hash.
 */
export function computeAnchorHash(documentId: string, version: string, content: unknown): string {
  const payload = { scheme: 1, document: documentId, version, content };
  return createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
}
