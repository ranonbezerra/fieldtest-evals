/**
 * Normalizes an INCI-style label for matching: strips diacritics, lowercases,
 * collapses whitespace. Case and accent differences therefore never change
 * resolution; OCR typos are handled explicitly through synonym entries.
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
