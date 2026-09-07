/**
 * Canonical form used for matching: lowercase, accent-free (NFKD),
 * single-spaced, trimmed. OCR-style typos are NOT corrected here; they are
 * covered explicitly by synonym fixtures.
 */
export function normalizeIngredientName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
