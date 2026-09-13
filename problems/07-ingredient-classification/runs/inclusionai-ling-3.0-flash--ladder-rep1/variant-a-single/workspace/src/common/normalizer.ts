/**
 * Normalize an ingredient string for matching:
 * 1. NFD decomposition to separate accents from base characters
 * 2. Remove combining diacritical marks
 * 3. Lowercase
 * 4. Trim and collapse internal whitespace
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Parse a raw INCI ingredient list string into individual ingredients. */
export function parseIngredients(list: string): string[] {
  return list
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
