// ASSUMPTION: the task refers to "provided synonym fixtures" but none was attached
// to this task; this minimal curated set stands in for it and is the seed source
// for the ingredients/synonyms tables (used by the tests).

export interface InciAlias {
  text: string;
  kind: 'synonym' | 'typo';
}

export interface InciFixtureEntry {
  /** Canonical INCI name. */
  canonical: string;
  /** Known aliases: curated synonyms and common OCR typos. */
  aliases: InciAlias[];
}

export const INCI_FIXTURES: InciFixtureEntry[] = [
  {
    canonical: 'water',
    aliases: [{ text: 'aqua', kind: 'synonym' }],
  },
  {
    canonical: 'glycerin',
    aliases: [{ text: 'glycerine', kind: 'synonym' }],
  },
  {
    canonical: 'benzophenone-3',
    aliases: [
      { text: 'octinoxate', kind: 'synonym' },
      { text: 'benzophenon-3', kind: 'typo' },
    ],
  },
  {
    canonical: 'oxybenzone',
    aliases: [
      { text: 'benzophenone-1', kind: 'synonym' },
      { text: 'oxybonzone', kind: 'typo' },
    ],
  },
  {
    canonical: 'retinol',
    aliases: [{ text: 'retinol', kind: 'typo' }],
  },
  {
    canonical: 'limonene',
    aliases: [
      { text: 'd-limonene', kind: 'synonym' },
      { text: 'Iimonene', kind: 'typo' },
    ],
  },
  {
    canonical: 'methylparaben',
    aliases: [{ text: 'methylparben', kind: 'typo' }],
  },
  {
    canonical: 'fragrance',
    aliases: [{ text: 'perfume', kind: 'synonym' }],
  },
];
