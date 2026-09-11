// ASSUMPTION: the task refers to "provided" synonym/typo fixtures, but none were
// attached to this repo; the fixture data below is a stand-in, shaped to exercise
// every required behaviour (synonyms, OCR typos, profile modifiers, version changes).

export const PROFILE_CONTEXTS: readonly string[] = ['child_under_3', 'pregnancy'];

export interface IngredientFixture {
  name: string;
  synonyms: string[];
}

export interface RuleFixture {
  ingredient: string;
  kind: 'base' | 'context';
  severity: 'banned' | 'restricted' | 'watch';
  source: string;
  context?: string;
}

export interface MethodologyFixture {
  slug: string;
  name: string;
  rules: RuleFixture[];
}

export const INGREDIENT_FIXTURES: IngredientFixture[] = [
  { name: 'Aqua', synonyms: ['water', 'eau'] },
  { name: 'Fragrance', synonyms: ['parfum', 'parfume', 'fragrance oil'] }, // 'parfume' is an OCR typo variant
  { name: 'Methylparaben', synonyms: ['methyl paraben', 'metylparaben'] }, // spaced variant + OCR typo
  { name: 'Linalool', synonyms: ['linarool'] }, // OCR typo (a/l transposition)
  { name: 'Tocopherol', synonyms: ['vitamin e', 'vit e'] },
  { name: 'Citral', synonyms: [] },
  { name: 'Hydroquinone', synonyms: ['benzoquinol'] },
  { name: 'Methylchloroisothiazolinone', synonyms: ['mci', 'methylchloroisothiazolinon'] }, // trailing-letter OCR typo
  { name: 'Retinyl palmitate', synonyms: ['retinol palmitate'] },
  { name: 'Formaldehyde', synonyms: ['methanal'] },
];

export const METHODOLOGY_V1: MethodologyFixture = {
  slug: 'v1',
  name: 'Methodology v1 (regulator restricted list + curated watch list, 2025-Q1)',
  rules: [
    { ingredient: 'Hydroquinone', kind: 'base', severity: 'banned', source: 'EC 1223/2009, Annex II, 246' },
    { ingredient: 'Formaldehyde', kind: 'base', severity: 'restricted', source: 'EC 1223/2009, Annex III, 16' },
    {
      ingredient: 'Methylparaben',
      kind: 'base',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q1: paraben review pending',
    },
    { ingredient: 'Linalool', kind: 'base', severity: 'watch', source: 'EC 1223/2009, Annex III, 683' },
    {
      ingredient: 'Methylchloroisothiazolinone',
      kind: 'base',
      severity: 'restricted',
      source: 'EC 1223/2009, Annex V, 34',
    },
    {
      ingredient: 'Fragrance',
      kind: 'base',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q1: undisclosed allergens',
    },
    {
      ingredient: 'Methylchloroisothiazolinone',
      kind: 'context',
      context: 'child_under_3',
      severity: 'banned',
      source: 'EC 1223/2009, Annex V, 34.1 (children under 3)',
    },
    {
      ingredient: 'Fragrance',
      kind: 'context',
      context: 'child_under_3',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q1: fragrance for children under 3',
    },
    {
      ingredient: 'Retinyl palmitate',
      kind: 'context',
      context: 'child_under_3',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q1: retinoids for children under 3',
    },
    {
      ingredient: 'Citral',
      kind: 'context',
      context: 'pregnancy',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q1: citral in pregnancy',
    },
    {
      ingredient: 'Retinyl palmitate',
      kind: 'context',
      context: 'pregnancy',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q1: retinoids in pregnancy',
    },
    {
      ingredient: 'Fragrance',
      kind: 'context',
      context: 'pregnancy',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q1: fragrance in pregnancy',
    },
  ],
};

export const METHODOLOGY_V2: MethodologyFixture = {
  slug: 'v2',
  name: 'Methodology v2 (regulator restricted list + curated watch list, 2025-Q2)',
  rules: [
    { ingredient: 'Hydroquinone', kind: 'base', severity: 'banned', source: 'EC 1223/2009, Annex II, 246' },
    { ingredient: 'Formaldehyde', kind: 'base', severity: 'restricted', source: 'EC 1223/2009, Annex III, 16' },
    {
      ingredient: 'Methylparaben',
      kind: 'base',
      severity: 'restricted',
      source: 'EC 1223/2009, Annex III, 33 (revised 2025-Q2)',
    },
    { ingredient: 'Linalool', kind: 'base', severity: 'watch', source: 'EC 1223/2009, Annex III, 683' },
    {
      ingredient: 'Methylchloroisothiazolinone',
      kind: 'base',
      severity: 'restricted',
      source: 'EC 1223/2009, Annex V, 34',
    },
    {
      ingredient: 'Fragrance',
      kind: 'base',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q2: undisclosed allergens',
    },
    {
      ingredient: 'Citral',
      kind: 'base',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q2: sensitization',
    },
    {
      ingredient: 'Methylchloroisothiazolinone',
      kind: 'context',
      context: 'child_under_3',
      severity: 'banned',
      source: 'EC 1223/2009, Annex V, 34.1 (children under 3)',
    },
    {
      ingredient: 'Fragrance',
      kind: 'context',
      context: 'child_under_3',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q2: fragrance for children under 3',
    },
    {
      ingredient: 'Retinyl palmitate',
      kind: 'context',
      context: 'child_under_3',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q2: retinoids for children under 3',
    },
    {
      ingredient: 'Citral',
      kind: 'context',
      context: 'pregnancy',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q2: citral in pregnancy',
    },
    {
      ingredient: 'Retinyl palmitate',
      kind: 'context',
      context: 'pregnancy',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q2: retinoids in pregnancy',
    },
    {
      ingredient: 'Fragrance',
      kind: 'context',
      context: 'pregnancy',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q2: fragrance in pregnancy',
    },
  ],
};
