import { createHash } from 'node:crypto';
import { ApiError } from '../common/api-error';

/**
 * A plain JSON value — the shape of a report's structured content.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Canonical form of a report's structured content. This is the defined
 * canonicalization the anchor hash is computed over; the PDF is a rendering
 * of this content and is never the source of truth.
 *
 * Rules (RFC 8785 / JCS core):
 *  - object keys are sorted by UTF-16 code unit order, recursively;
 *  - array order is preserved (positions are meaningful in a report);
 *  - no insignificant whitespace;
 *  - strings use JSON escaping and numbers use the JSON number grammar via
 *    this runtime's deterministic serialization.
 *
 * Note: keys are compared after JSON parsing, so duplicate keys in a request
 * are collapsed by the parser before canonicalization sees them.
 */
export function canonicalize(value: JsonValue): string {
  return serialize(value);
}

function serialize(value: JsonValue): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new ApiError(400, 'invalid_request', 'content contains a non-finite number');
      }
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object': {
      if (value === null) return 'null';
      if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
      const keys = Object.keys(value).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(',')}}`;
    }
    default:
      throw new ApiError(400, 'invalid_request', `value of type '${typeof value}' is not valid JSON`);
  }
}

/**
 * The anchor hash: 'sha256:' + hex digest of the UTF-8 bytes of the
 * canonical form.
 */
export function hashContent(content: unknown): string {
  assertJsonValue(content);
  const digest = createHash('sha256').update(canonicalize(content), 'utf8').digest('hex');
  return `sha256:${digest}`;
}

/**
 * Rejects anything that is not a plain JSON value (functions, symbols,
 * class instances, non-finite numbers, ...).
 */
export function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (value === null) return;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (Number.isFinite(value)) return;
      throw new ApiError(400, 'invalid_request', 'content contains a non-finite number');
    case 'object': {
      if (Array.isArray(value)) {
        for (const item of value) assertJsonValue(item);
        return;
      }
      const proto: object | null = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new ApiError(400, 'invalid_request', 'content must be plain JSON (class instances are not allowed)');
      }
      for (const item of Object.values(value)) assertJsonValue(item);
      return;
    }
    default:
      throw new ApiError(400, 'invalid_request', `content contains a value of unsupported type '${typeof value}'`);
  }
}
