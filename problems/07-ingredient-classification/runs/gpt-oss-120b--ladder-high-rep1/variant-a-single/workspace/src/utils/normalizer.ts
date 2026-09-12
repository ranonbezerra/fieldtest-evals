export function normalizeIngredient(input: string): string {
  // Lowercase
  let str = input.toLowerCase();
  // Unicode normalize and strip diacritics
  str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Remove punctuation (commas, hyphens, etc.) except spaces
  str = str.replace(/[.,;:()\-_/]/g, ' ');
  // Collapse whitespace
  str = str.replace(/\s+/g, ' ').trim();
  return str;
}
