// Registered globally in main.ts. Every response body passes through it.
// Added 2024-03 after the BigInt incident: JSON.stringify throws on BigInt, so
// every money field in the API was 500ing until this existed.
export function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, serialize(v)]),
    );
  }
  return value;
}
