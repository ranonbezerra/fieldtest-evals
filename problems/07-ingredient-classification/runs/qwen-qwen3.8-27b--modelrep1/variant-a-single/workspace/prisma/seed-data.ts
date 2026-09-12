// ASSUMPTION: the task references a "provided synonym fixture" (canonical
// ingredients, synonym/OCR-typo forms, rule sources, family profiles); no
// fixture was included with the task, so this file is the canonical dataset,
// used by the Prisma seed (prisma/seed.ts) and by the test suite.

export type SeedSeverity = 'banned' | 'restricted' | 'watch';

export interface SeedIngredient {
  name: string;
  synonyms: string[];
}

export interface SeedRule {
  ingredient: string;
  severity: SeedSeverity;
  source: string;
  note: string | null;
}

export interface SeedMethodologyVersion {
  version: number;
  name: string;
  rules: SeedRule[];
}

export interface SeedProfileModifier {
  ingredient: string;
  severity: SeedSeverity;
  source: string;
  note: string | null;
}

export interface SeedProfile {
  name: string;
  description: string;
  modifiers: SeedProfileModifier[];
}

export interface SeedProduct {
  name: string;
  ingredients: string[];
}

const EU_REGULATION = 'EU Cosmetics Regulation (EC) No 1223/2009';

export const INGREDIENTS: SeedIngredient[] = [
  { name: 'glycerin', synonyms: ['glycerol', 'glycerine'] },
  { name: 'tocopherol', synonyms: ['vitamin e'] },
  { name: 'methylparaben', synonyms: ['methyl paraben', 'methyparaben', 'e218'] },
  { name: 'retinol', synonyms: ['vitamin a', 'vitaamin a'] },
  { name: 'hydroquinone', synonyms: ['hydroquionone'] },
  { name: 'formaldehyde', synonyms: ['formaldhyde', 'methanal'] },
  { name: 'trolamine', synonyms: ['trolamin'] },
  { name: 'salicylic acid', synonyms: ['beta hydroxy acid', 'silicylic acid'] },
  { name: 'limonene', synonyms: ['lmonene'] },
];

const BASELINE_RULES: SeedRule[] = [
  {
    ingredient: 'formaldehyde',
    severity: 'banned',
    source: `${EU_REGULATION}, Annex II, point 1`,
    note: null,
  },
  {
    ingredient: 'hydroquinone',
    severity: 'banned',
    source: `${EU_REGULATION}, Annex II, point 230`,
    note: null,
  },
  {
    ingredient: 'trolamine',
    severity: 'banned',
    source: `${EU_REGULATION}, Annex II, point 240`,
    note: 'Known to cause cancer in animals.',
  },
  {
    ingredient: 'methylparaben',
    severity: 'restricted',
    source: `${EU_REGULATION}, Annex V, point 20`,
    note: 'Limited to 0.4% in leave-on products.',
  },
  {
    ingredient: 'retinol',
    severity: 'watch',
    source: 'Curated watch list v1',
    note: 'Retinoids: monitor systemic absorption reports.',
  },
  {
    ingredient: 'limonene',
    severity: 'watch',
    source: 'Curated watch list v1',
    note: 'Fragrance allergen; must be declared above 0.001%.',
  },
];

export const METHODOLOGY_VERSIONS: SeedMethodologyVersion[] = [
  {
    version: 1,
    name: 'Baseline restricted list v1',
    rules: [...BASELINE_RULES],
  },
  {
    version: 2,
    name: 'Baseline restricted list v2',
    rules: [
      ...BASELINE_RULES,
      {
        ingredient: 'salicylic acid',
        severity: 'restricted',
        source: 'Curated restricted list v2',
        note: 'High-concentration BHA not recommended for sensitive groups.',
      },
    ],
  },
];

export const PROFILES: SeedProfile[] = [
  {
    name: 'pregnancy',
    description: 'Pregnancy / lactation',
    modifiers: [
      {
        ingredient: 'retinol',
        severity: 'restricted',
        source: 'Curated obstetric guidance: retinoids are contraindicated during pregnancy.',
        note: null,
      },
    ],
  },
  {
    name: 'child-under-3',
    description: 'Child under 3 years',
    modifiers: [
      {
        ingredient: 'salicylic acid',
        severity: 'restricted',
        source: 'Curated paediatric guidance: BHA not recommended for children under 3.',
        note: null,
      },
      {
        ingredient: 'limonene',
        severity: 'restricted',
        source: 'Curated paediatric guidance: fragrance allergens are discouraged for infants.',
        note: null,
      },
    ],
  },
];

export const PRODUCTS: SeedProduct[] = [
  {
    name: 'Moisturizing Cream',
    ingredients: ['Aqua', 'Glycerin', 'Methyl Paraben', 'Tocopherol', 'Limonene'],
  },
  {
    name: 'Anti-Aging Serum',
    ingredients: ['Aqua', 'Retinol', 'Silicylic Acid', 'Tocopherol'],
  },
];
