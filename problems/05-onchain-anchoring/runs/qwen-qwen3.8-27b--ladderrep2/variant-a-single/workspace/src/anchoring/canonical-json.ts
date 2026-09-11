import { createHash } from 'node:crypto';
import { CanonicalizationError } from './errors.js';

/**
 * Canonical JSON for anchoring — the normative spec is docs/canonical-json.md.
 *
 * The structured report JSON is the source of truth (the PDF is only a
 * rendering). Two documents with the same structured content must always
 * canonicalize to the same bytes, and therefore hash to the same value,
 * regardless of key order, number format, or whitespace in the original:
 *
 *   - objects: keys sorted by UTF-16 code unit order, no whitespace
 *   - arrays:  element order preserved
 *   - numbers: shortest round-trip form (1e5 == 100000, 1.10 == 1.1, -0 == 0)
 *   - strings: JSON escaping; other control chars as \uXXXX; else literal
 *   - booleans/null: true / false / null
 *
 * The hash is `sha256:` + lowercase hex of SHA-256 over the UTF-8 encoding of
 * the canonical string.
 */

const MAX_DEPTH = 200;

const SHORT_ESCAPES: ReadonlyMap<string, string> = new Map<string, string>([
  ['"', '\\"'],
  ['\\', '\\\\'],
  ['\b', '\\b'],
  ['\f', '\\f'],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
]);

export function canonicalize(value: unknown): string {
  return canonicalizeValue(value, 0);
}

function canonicalizeValue(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) {
    throw new CanonicalizationError('content exceeds the maximum nesting depth');
  }

  switch (typeof value) {
    case 'string':
      return canonicalizeString(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError('non-finite numbers cannot be anchored');
      }
      // String(-0) === '0', so both -0 and 0 normalize to '0'.
      return String(value);
    case 'object':
      if (value === null) {
        return 'null';
      }
      if (Array.isArray(value)) {
        return '[' + value.map((item) => canonicalizeValue(item, depth + 1)).join(',') + ']';
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const entries = keys.map((key) => canonicalizeString(key) + ':' + canonicalizeValue(record[key], depth + 1));
      return '{' + entries.join(',') + '}';
    default:
      throw new CanonicalizationError(`value of type "${typeof value}" is not valid JSON content`);
  }
}

function canonicalizeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const short = SHORT_ESCAPES.get(ch);
    if (short !== undefined) {
      out += short;
      continue;
    }
    const code = s.charCodeAt(i);
    if (code < 0x20) {
      out += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    out += ch;
  }
  return out + '"';
}

export function canonicalHash(value: unknown): string {
  const canonical = canonicalize(value);
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return 'sha256:' + hex;
}
