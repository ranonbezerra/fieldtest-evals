/**
 * Normalizes a string for comparison:
 * - Lower‑case
 * - Trim whitespace
 * - Remove diacritics (accents)
 * - Collapse multiple spaces
 */
export function normalizeString(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\s+/g, ' ');
}
