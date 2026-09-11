/** Read a positive integer from an environment variable, falling back to a default. */
export function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
