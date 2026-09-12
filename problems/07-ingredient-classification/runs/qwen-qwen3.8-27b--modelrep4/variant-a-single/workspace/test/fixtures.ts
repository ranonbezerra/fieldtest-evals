import { ClassificationService } from '../src/classification/classification.service.js';
import { FakeClassificationRepository, type SeedData } from './fake-repository.js';

export const NIGHT_CREAM = 'product-night-cream';
export const PEELING_GEL = 'product-peeling-gel';
export const SHUFFLED_NIGHT_CREAM = 'product-night-cream-shuffled';
export const V1 = 'version-2024.1';
export const CHILD_PROFILE = 'profile-child-under-3';
export const PREGNANCY_PROFILE = 'profile-pregnancy';

const INGREDIENTS = {
  aqua: 'ing-aqua',
  caffeine: 'ing-caffeine',
  limonene: 'ing-limonene',
  salicylic: 'ing-salicylic-acid',
  tocopherol: 'ing-tocopherol',
  retinyl: 'ing-retinyl-palmitate',
  benzoyl: 'ing-benzoyl-peroxide',
};

export const NIGHT_CREAM_INCI = [
  'Aqua',
  'Retinyl  Palmitate',
  'T0COPHEROL',
  'Limonene',
  'Caféine',
  'Mystery Butter X',
];

export interface SeedOptions {
  withActiveVersion?: boolean;
}

export function makeSeed(options: SeedOptions = {}): SeedData {
  const active = options.withActiveVersion !== false;
  return {
    ingredients: [
      { id: INGREDIENTS.aqua, name: 'Aqua', synonyms: ['water'] },
      { id: INGREDIENTS.caffeine, name: 'Caffeine', synonyms: ['cafeine'] },
      { id: INGREDIENTS.limonene, name: 'Limonene', synonyms: [] },
      { id: INGREDIENTS.salicylic, name: 'Salicylic acid', synonyms: ['salixylic acid', 'bha', 'beta-hydroxy acid'] },
      { id: INGREDIENTS.tocopherol, name: 'Tocopherol', synonyms: ['t0copherol', 'vitamin e'] },
      { id: INGREDIENTS.retinyl, name: 'Retinyl palmitate', synonyms: ['retinyl-palmitate'] },
      { id: INGREDIENTS.benzoyl, name: 'Benzoyl peroxide', synonyms: [] },
    ],
    versions: [
      {
        id: V1,
        code: '2024.1',
        status: active ? 'active' : 'retired',
        rules: [
          { ingredientId: INGREDIENTS.benzoyl, severity: 'restricted', source: 'EU Reg 1223/2009, Annex III, 315-1' },
          { ingredientId: INGREDIENTS.retinyl, severity: 'watch', source: 'Curated watch list, 2024-01' },
          { ingredientId: INGREDIENTS.salicylic, severity: 'watch', source: 'Curated watch list, 2024-01' },
        ],
      },
    ],
    profiles: [
      {
        id: CHILD_PROFILE,
        name: 'child_under_3',
        modifiers: [
          {
            profileId: CHILD_PROFILE,
            ingredientId: INGREDIENTS.limonene,
            severity: 'restricted',
            source: 'AAP position paper, 2023',
            reason: 'Strong fragrance; skin sensitivity in young children.',
          },
          {
            profileId: CHILD_PROFILE,
            ingredientId: INGREDIENTS.retinyl,
            severity: 'banned',
            source: 'FDA 2023 advisory on retinoids',
            reason: 'Retinoids are avoided for children.',
          },
        ],
      },
      {
        id: PREGNANCY_PROFILE,
        name: 'pregnancy',
        modifiers: [
          {
            profileId: PREGNANCY_PROFILE,
            ingredientId: INGREDIENTS.retinyl,
            severity: 'banned',
            source: 'FDA 2023 advisory on retinoids',
            reason: 'Retinoids are contraindicated in pregnancy.',
          },
        ],
      },
    ],
    products: [
      { id: NIGHT_CREAM, name: 'Night cream', ingredients: NIGHT_CREAM_INCI },
      { id: PEELING_GEL, name: 'Peeling gel', ingredients: ['Salixylic Acid', 'Aqua', 'T0COPHEROL'] },
      { id: SHUFFLED_NIGHT_CREAM, name: 'Night cream (re-entered)', ingredients: [...NIGHT_CREAM_INCI].reverse() },
    ],
  };
}

export function buildService(options: SeedOptions = {}): {
  service: ClassificationService;
  repository: FakeClassificationRepository;
} {
  const repository = new FakeClassificationRepository(makeSeed(options));
  return { service: new ClassificationService(repository), repository };
}
