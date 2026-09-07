// serializer.ts — response serialization helpers.
// moneyReplacer is wired into the interceptor for API responses (main path).

export function moneyReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

export function serializeResponse<T>(payload: T): string {
  return JSON.stringify(payload, moneyReplacer);
}
