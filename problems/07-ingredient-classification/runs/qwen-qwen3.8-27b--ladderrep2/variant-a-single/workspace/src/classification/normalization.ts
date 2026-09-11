/**
 * Normalizes an INCI surface form before matching: trims, strips accents,
 * lowercases and collapses whitespace. OCR typos are intentionally not fixed
 * here — they are resolved through the synonym table (populated from the
 * synonym/typo fixtures) after normalization, which keeps the match exact and
 * auditable.
 */
export function normalizeInci(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
