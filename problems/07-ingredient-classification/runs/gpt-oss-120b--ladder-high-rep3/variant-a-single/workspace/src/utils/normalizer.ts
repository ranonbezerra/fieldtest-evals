/**
 * Normalizes a string: trim, lowercase, remove diacritics.
 */
export function normalizeString(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
