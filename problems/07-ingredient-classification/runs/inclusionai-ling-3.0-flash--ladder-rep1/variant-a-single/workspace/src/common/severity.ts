/** Severity ordering used for deterministic precedence. Higher number = more severe. */
export const SEVERITY_ORDER: Record<string, number> = {
  watch: 1,
  restricted: 2,
  banned: 3,
};

/** Return the more severe of two severities. Deterministic — precedence is max-severity. */
export function maxSeverity(a: string, b: string): string {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}
