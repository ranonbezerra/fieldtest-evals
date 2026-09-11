/**
 * INCI normalization: case, accents, and whitespace are collapsed to a stable key.
 * Pure and deterministic — the same input always yields the same key.
 *
 * OCR typos and synonyms are deliberately NOT handled here: they are data, not
 * text transforms, and are resolved through the synonym fixtures (see fixtures.ts).
 */
export function normalizeInci(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
