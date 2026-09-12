import { createHash } from 'node:crypto';
import { InvalidInputError } from '../errors.js';

/**
 * Canonicalization (the anchoring contract).
 *
 * The structured JSON report is the source of truth; the PDF is only a
 * rendering of it and is never hashed. A value is canonicalized as follows:
 *  - objects: keys sorted by UTF-16 code unit order, no insignificant whitespace;
 *  - arrays: element order preserved (order is semantic);
 *  - strings: JSON-escaped (UTF-8);
 *  - numbers: finite only, rendered in the shortest round-trip decimal form
 *    (Number.prototype.toString), so 100 and 1e2 canonicalize identically;
 *  - non-JSON values (undefined, NaN/Infinity, BigInt, functions) and non-plain
 *    objects (Date, class instances, ...) are rejected.
 *
 * hashContent is the lowercase SHA-256 hex digest of the canonical JSON's
 * UTF-8 bytes.
 */
export function canonicalizeJson(value: unknown): string {
  return encode(value, '$');
}

export function hashContent(content: unknown): string {
  return createHash('sha256').update(canonicalizeJson(content), 'utf8').digest('hex');
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new InvalidInputError({ path }, 'Content contains a non-finite number');
      }
      return value.toString();
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map((item, index) => encode(item, `${path}[${index}]`)).join(',') + ']';
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== null && proto !== Object.prototype) {
        throw new InvalidInputError(
          { path },
          'Content contains a non-plain object; only JSON values are canonicalizable',
        );
      }
      const record = value as Record<string, unknown>;
      const pairs = Object.keys(record)
        .sort()
        .map((key) => {
          const child = record[key];
          if (child === undefined) {
            throw new InvalidInputError({ path: `${path}.${key}` }, 'Content contains an undefined value');
          }
          return JSON.stringify(key) + ':' + encode(child, `${path}.${key}`);
        });
      return '{' + pairs.join(',') + '}';
    }
    default:
      throw new InvalidInputError({ path }, `Content contains a non-JSON value of type ${typeof value}`);
  }
}
