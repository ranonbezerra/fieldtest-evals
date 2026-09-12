/**
 * Path-level differences between the stored report content and supplied
 * content. Only called when the canonical hashes differ, so at least one
 * difference is always produced.
 */
export interface ContentDifference {
  /** JSON path: `$`, `$.a.b`, `$.a[0].c`. */
  path: string;
  kind: 'value' | 'missing_in_supplied' | 'missing_in_stored';
  stored?: unknown;
  supplied?: unknown;
}

export function diffJson(stored: unknown, supplied: unknown): ContentDifference[] {
  const differences: ContentDifference[] = [];
  walk(stored, supplied, '$', differences);
  return differences;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(stored: unknown, supplied: unknown, path: string, out: ContentDifference[]): void {
  if (Array.isArray(stored) && Array.isArray(supplied)) {
    const shared = Math.min(stored.length, supplied.length);
    for (let i = 0; i < shared; i++) walk(stored[i], supplied[i], `${path}[${i}]`, out);
    for (let i = shared; i < stored.length; i++) {
      out.push({ path: `${path}[${i}]`, kind: 'missing_in_supplied', stored: stored[i] });
    }
    for (let i = shared; i < supplied.length; i++) {
      out.push({ path: `${path}[${i}]`, kind: 'missing_in_stored', supplied: supplied[i] });
    }
    return;
  }
  if (isPlainObject(stored) && isPlainObject(supplied)) {
    const keys = Array.from(new Set([...Object.keys(stored), ...Object.keys(supplied)])).sort();
    for (const key of keys) {
      const child = `${path}.${key}`;
      if (!(key in stored)) out.push({ path: child, kind: 'missing_in_stored', supplied: supplied[key] });
      else if (!(key in supplied)) out.push({ path: child, kind: 'missing_in_supplied', stored: stored[key] });
      else walk(stored[key], supplied[key], child, out);
    }
    return;
  }
  if (leavesDiffer(stored, supplied)) out.push({ path, kind: 'value', stored, supplied });
}

function leavesDiffer(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a !== b;
  if (typeof a === 'object' || typeof b === 'object') return true; // mixed shapes (object vs primitive)
  return a !== b;
}
