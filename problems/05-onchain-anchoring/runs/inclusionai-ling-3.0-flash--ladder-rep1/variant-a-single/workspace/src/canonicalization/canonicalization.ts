import { createHash } from 'crypto';

export function canonicalHash(value: unknown): string {
  const normalized = normalize(value);
  const bytes: string = JSON.stringify(normalized) as string;
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) throw new Error('Cannot canonicalize undefined');
  const type = typeof value;

  if (type === 'boolean') return value;
  if (type === 'string') return value;
  if (type === 'number') return normalizeNumber(value);
  if (type === 'undefined') throw new Error('Cannot canonicalize undefined');

  if (Array.isArray(value)) return value.map(normalize);

  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const val = obj[key];
      if (val !== undefined) {
        sorted[key] = normalize(val);
      }
    }
    return sorted;
  }

  throw new Error(`Cannot canonicalize type: ${type}`);
}

function normalizeNumber(n: number): number {
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot canonicalize non-finite number: ${n}`);
  }
  return n;
}
