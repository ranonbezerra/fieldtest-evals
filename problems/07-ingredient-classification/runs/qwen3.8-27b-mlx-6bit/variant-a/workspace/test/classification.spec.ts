import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClassificationService } from '../src/classification/classification.service';
import { ProductRepository } from '../src/product/product.repository';
import { IngredientRepository } from '../src/ingredient/ingredient.repository';
import { MethodologyRepository } from '../src/methodology/methodology.repository';
import { ProfileRepository } from '../src/profile/profile.repository';
import { ClassificationRepository } from '../src/classification/classification.repository';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeProduct(
  id: number,
  name: string,
  ingredients: { rawText: string; position: number }[],
) {
  return { id, name, ingredients };
}

function makeFinding(
  rawText: string,
  resolvedName: string | null,
  ingredientId: number | null,
  isUnknown: boolean,
  flag: string | null,
  severity: string | null,
  sourceCitation: string | null,
) {
  return { rawText, resolvedName, ingredientId, isUnknown, flag, severity, sourceCitation };
}

// ─── Test suite ─────────────────────────────────────────────────────────────────

describe('ClassificationService', () => {
  let service: ClassificationService;
  let productRepo: ReturnType<typeof vi.fn>;
  let ingredientRepo: ReturnType<typeof vi.fn>;
  let methodologyRepo: ReturnType<typeof vi.fn>;
  let profileRepo: ReturnType<typeof vi.fn>;
  let classificationRepo: ReturnType<typeof vi.fn>;

  // Shared fixture data
  const activeVersion = { id: 1, version: 1, name: 'Base', isActive: true };
  const v2Version = { id: 2, version: 2, name: 'Updated', isActive: false };

  const rulesV1 = [
    { id: 1, methodologyVersionId: 1, ingredientId: 10, severity: 'watch', flag: 'irritant', sourceCitation: 'EC 1223/2009 Annex II' },
    { id: 2, methodologyVersionId: 1, ingredientId: 20, severity: 'banned', flag: 'carcinogen', sourceCitation: 'EC 1223/2009 Annex II' },
    { id: 3, methodologyVersionId: 1, ingredientId: 30, severity: 'restricted', flag: 'sensitizer', sourceCitation: 'EC 1223/2009 Annex III' },
  ];

  const rulesV2 = [
    { id: 4, methodologyVersionId: 2, ingredientId: 10, severity: 'restricted', flag: 'irritant-strong', sourceCitation: 'EC 1223/2009 Annex II (rev)' },
    { id: 5, methodologyVersionId: 2, ingredientId: 20, severity: 'banned', flag: 'carcinogen', sourceCitation: 'EC 1223/2009 Annex II' },
    { id: 6, methodologyVersionId: 2, ingredientId: 30, severity: 'restricted', flag: 'sensitizer', sourceCitation: 'EC 1223/2009 Annex III' },
  ];

  const modifiersP1 = [
    { id: 1, profileId: 1, ingredientId: 10, severity: 'banned', flag: 'irritant-child', sourceCitation: 'Child safety guideline 2024' },
  ];

  beforeEach(() => {
    vi.resetAllMocks();

    productRepo = vi.fn().mockImplementation((fn: (repo: any) => any) => fn({
      findById: vi.fn(),
      listWithIngredients: vi.fn(),
      list: vi.fn(),
      create: vi.fn(),
    }));

    ingredientRepo = vi.fn().mockImplementation((fn: (repo: any) => any) => fn({
      findById: vi.fn(),
      findByName: vi.fn(),
      resolve: vi.fn(),
      list: vi.fn(),
    }));

    methodologyRepo = vi.fn().mockImplementation((fn: (repo: any) => any) => fn({
      getActive: vi.fn(),
      getById: vi.fn(),
      getRules: vi.fn(),
      create: vi.fn(),
      publish: vi.fn(),
    }));

    profileRepo = vi.fn().mockImplementation((fn: (repo: any) => any) => fn({
      findById: vi.fn(),
      getModifiers: vi.fn(),
    }));

    classificationRepo = vi.fn().mockImplementation((fn: (repo: any) => any) => fn({
      upsert: vi.fn(),
      findByProductAndVersion: vi.fn(),
      findByProductId: vi.fn(),
    }));

    service = new ClassificationService(
      productRepo() as any,
      ingredientRepo() as any,
      methodologyRepo() as any,
      profileRepo() as any,
      classificationRepo() as any,
    );
  });

  // ── Test 1: Profile flips a finding ──────────────────────────────────────────

  describe('profile escalates severity', () => {
    it('escalates a watch finding to banned when profile modifier has higher severity', async () => {
      const productId = 1;
      const profileId = 1;

      (productRepo() as any).findById.mockResolvedValue(
        makeProduct(1, 'Test Cream', [
          { rawText: 'Linalool', position: 1 },
        ]),
      );

      (ingredientRepo() as any).resolve.mockImplementation((normalized: string) => {
        if (normalized === 'linalool') {
          return Promise.resolve({ ingredient: { id: 10, canonicalName: 'linalool', displayName: 'Linalool' }, matchedVia: 'canonical' });
        }
        return Promise.resolve(null);
      });

      (methodologyRepo() as any).getActive.mockResolvedValue(activeVersion);
      (methodologyRepo() as any).getRules.mockImplementation((versionId: number) => {
        if (versionId === 1) return Promise.resolve(rulesV1);
        return Promise.resolve([]);
      });

      (profileRepo() as any).findById.mockResolvedValue({ id: 1, name: 'Child under 3', description: null });
      (profileRepo() as any).getModifiers.mockResolvedValue(modifiersP1);

      (classificationRepo() as any).upsert.mockImplementation((result: any, findings: any) => {
        return Promise.resolve({ id: 100, ...result, findings });
      });

      const response = await service.classify(productId, profileId) as any;

      expect(response.profileId).toBe(1);
      expect(response.findings).toHaveLength(1);

      const linaloolFinding = response.findings.find((f: any) => f.rawText === 'Linalool');
      expect(linaloolFinding).toBeDefined();
      expect(linaloolFinding.severity).toBe('banned');
      expect(linaloolFinding.flag).toBe('irritant-child');
      expect(linaloolFinding.sourceCitation).toBe('Child safety guideline 2024');
    });
  });

  // ── Test 2: Unknown ingredient lowers confidence and is visible ─────────────

  describe('unknown ingredient handling', () => {
    it('lowers confidence and lists the unknown ingredient', async () => {
      const productId = 2;

      (productRepo() as any).findById.mockResolvedValue(
        makeProduct(2, 'Unknown Product', [
          { rawText: 'Aqua', position: 1 },
          { rawText: 'Glycerin', position: 2 },
          { rawText: 'Cetearyl Alcohol', position: 3 },
          { rawText: 'Phenoxyethanol', position: 4 },
          { rawText: 'ZincOxideUnknow', position: 5 },
        ]),
      );

      (ingredientRepo() as any).resolve.mockImplementation((normalized: string) => {
        const known: Record<string, { id: number; canonicalName: string; displayName: string }> = {
          aqua: { id: 40, canonicalName: 'aqua', displayName: 'Aqua' },
          glycerin: { id: 50, canonicalName: 'glycerol', displayName: 'Glycerin' },
          cetearylalcohol: { id: 60, canonicalName: 'cetearyl alcohol', displayName: 'Cetearyl Alcohol' },
          phenoxyethanol: { id: 70, canonicalName: 'phenoxyethanol', displayName: 'Phenoxyethanol' },
        };
        const match = known[normalized];
        if (match) return Promise.resolve({ ingredient: match, matchedVia: 'canonical' });
        return Promise.resolve(null);
      });

      (methodologyRepo() as any).getActive.mockResolvedValue(activeVersion);
      (methodologyRepo() as any).getRules.mockResolvedValue([]);

      (classificationRepo() as any).upsert.mockImplementation((result: any, findings: any) => {
        return Promise.resolve({ id: 101, ...result, findings });
      });

      const response = await service.classify(productId) as any;

      expect(response.unknownIngredients).toContain('ZincOxideUnknow');
      expect(response.overallConfidence).toBeCloseTo(0.8, 5);

      const unknownFinding = response.findings.find((f: any) => f.rawText === 'ZincOxideUnknow');
      expect(unknownFinding).toBeDefined();
      expect(unknownFinding.isUnknown).toBe(true);
      expect(unknownFinding.resolvedName).toBeNull();
    });
  });

  // ── Test 3: Synonym/typo resolves ───────────────────────────────────────────

  describe('synonym and typo resolution', () => {
    it('resolves an OCR typo to the canonical ingredient and applies its rule', async () => {
      const productId = 3;

      (productRepo() as any).findById.mockResolvedValue(
        makeProduct(3, 'Typo Product', [
          { rawText: 'gyceryl', position: 1 },
        ]),
      );

      // Simulate: normalization of "gyceryl" → "gyceryl", then synonym lookup matches
      (ingredientRepo() as any).resolve.mockImplementation((normalized: string) => {
        if (normalized === 'gyceryl') {
          return Promise.resolve({
            ingredient: { id: 50, canonicalName: 'glycerol', displayName: 'Glycerin' },
            matchedVia: 'synonym',
          });
        }
        return Promise.resolve(null);
      });

      (methodologyRepo() as any).getActive.mockResolvedValue(activeVersion);
      // Glycerol (id 50) has no rule in v1 → recognized but unflagged
      (methodologyRepo() as any).getRules.mockResolvedValue([]);

      (classificationRepo() as any).upsert.mockImplementation((result: any, findings: any) => {
        return Promise.resolve({ id: 102, ...result, findings });
      });

      const response = await service.classify(productId) as any;

      expect(response.findings).toHaveLength(1);
      const finding = response.findings[0];
      expect(finding.resolvedName).toBe('glycerol');
      expect(finding.isUnknown).toBe(false);
    });

    it('resolves a typo to an ingredient that has a rule and applies the rule', async () => {
      const productId = 4;

      (productRepo() as any).findById.mockResolvedValue(
        makeProduct(4, 'Typo Product 2', [
          { rawText: 'linnaloool', position: 1 },
        ]),
      );

      (ingredientRepo() as any).resolve.mockImplementation((normalized: string) => {
        if (normalized === 'linnaloool') {
          return Promise.resolve({
            ingredient: { id: 10, canonicalName: 'linalool', displayName: 'Linalool' },
            matchedVia: 'synonym',
          });
        }
        return Promise.resolve(null);
      });

      (methodologyRepo() as any).getActive.mockResolvedValue(activeVersion);
      (methodologyRepo() as any).getRules.mockResolvedValue(rulesV1);

      (classificationRepo() as any).upsert.mockImplementation((result: any, findings: any) => {
        return Promise.resolve({ id: 103, ...result, findings });
      });

      const response = await service.classify(productId) as any;

      expect(response.findings).toHaveLength(1);
      const finding = response.findings[0];
      expect(finding.resolvedName).toBe('linalool');
      expect(finding.severity).toBe('watch');
      expect(finding.flag).toBe('irritant');
    });
  });

  // ── Test 4: Identical across reruns ─────────────────────────────────────────

  describe('determinism across reruns', () => {
    it('produces identical responses when classify is called twice for the same product', async () => {
      const productId = 5;

      (productRepo() as any).findById.mockResolvedValue(
        makeProduct(5, 'Stable Product', [
          { rawText: 'Linalool', position: 1 },
          { rawText: 'Aqua', position: 2 },
          { rawText: 'MysteryStuff', position: 3 },
        ]),
      );

      (ingredientRepo() as any).resolve.mockImplementation((normalized: string) => {
        if (normalized === 'linalool') {
          return Promise.resolve({ ingredient: { id: 10, canonicalName: 'linalool', displayName: 'Linalool' }, matchedVia: 'canonical' });
        }
        if (normalized === 'aqua') {
          return Promise.resolve({ ingredient: { id: 40, canonicalName: 'aqua', displayName: 'Aqua' }, matchedVia: 'canonical' });
        }
        return Promise.resolve(null);
      });

      (methodologyRepo() as any).getActive.mockResolvedValue(activeVersion);
      (methodologyRepo() as any).getRules.mockResolvedValue(rulesV1);

      (classificationRepo() as any).upsert.mockImplementation((result: any, findings: any) => {
        return Promise.resolve({ id: 104, ...result, findings });
      });

      const first = await service.classify(productId) as any;
      const second = await service.classify(productId) as any;

      expect(second).toEqual(first);
    });
  });

  // ── Test 5: Shuffled ingredient order produces same findings set ────────────

  describe('order independence', () => {
    it('produces the same set of findings regardless of ingredient position order', async () => {
      const productIdA = 6;
      const productIdB = 7;

      (productRepo() as any).findById.mockImplementation((id: number) => {
        if (id === productIdA) {
          return Promise.resolve(
            makeProduct(6, 'Order A', [
              { rawText: 'Linalool', position: 1 },
              { rawText: 'Aqua', position: 2 },
              { rawText: 'Glycerin', position: 3 },
            ]),
          );
        }
        if (id === productIdB) {
          return Promise.resolve(
            makeProduct(7, 'Order B', [
              { rawText: 'Glycerin', position: 1 },
              { rawText: 'Linalool', position: 2 },
              { rawText: 'Aqua', position: 3 },
            ]),
          );
        }
        return Promise.resolve(null);
      });

      (ingredientRepo() as any).resolve.mockImplementation((normalized: string) => {
        if (normalized === 'linalool') {
          return Promise.resolve({ ingredient: { id: 10, canonicalName: 'linalool', displayName: 'Linalool' }, matchedVia: 'canonical' });
        }
        if (normalized === 'aqua') {
          return Promise.resolve({ ingredient: { id: 40, canonicalName: 'aqua', displayName: 'Aqua' }, matchedVia: 'canonical' });
        }
        if (normalized === 'glycerin') {
          return Promise.resolve({ ingredient: { id: 50, canonicalName: 'glycerol', displayName: 'Glycerin' }, matchedVia: 'canonical' });
        }
        return Promise.resolve(null);
      });

      (methodologyRepo() as any).getActive.mockResolvedValue(activeVersion);
      (methodologyRepo() as any).getRules.mockResolvedValue(rulesV1);

      (classificationRepo() as any).upsert.mockImplementation((result: any, findings: any) => {
        return Promise.resolve({ id: 105, ...result, findings });
      });

      const respA = await service.classify(productIdA) as any;
      const respB = await service.classify(productIdB) as any;

      // Same set of resolved names
      const namesA = respA.findings.map((f: any) => f.resolvedName).sort();
      const namesB = respB.findings.map((f: any) => f.resolvedName).sort();
      expect(namesB).toEqual(namesA);

      // Same confidence
      expect(respB.overallConfidence).toBeCloseTo(respA.overallConfidence, 5);

      // Same set of severities
      const sevsA = respA.findings.map((f: any) => f.severity).sort();
      const sevsB = respB.findings.map((f: any) => f.severity).sort();
      expect(sevsB).toEqual(sevsA);
    });
  });

  // ── Test 6: Both versions coexist ───────────────────────────────────────────

  describe('methodology version coexistence', () => {
    it('preserves results from previous version after publishing a new one', async () => {
      const productId = 8;

      // Phase 1: classify under v1
      (productRepo() as any).findById.mockResolvedValue(
        makeProduct(8, 'Version Product', [
          { rawText: 'Linalool', position: 1 },
        ]),
      );

      (ingredientRepo() as any).resolve.mockImplementation((normalized: string) => {
        if (normalized === 'linalool') {
          return Promise.resolve({ ingredient: { id: 10, canonicalName: 'linalool', displayName: 'Linalool' }, matchedVia: 'canonical' });
        }
        return Promise.resolve(null);
      });

      // Initially v1 is active
      (methodologyRepo() as any).getActive.mockResolvedValue(activeVersion);
      (methodologyRepo() as any).getRules.mockImplementation((versionId: number) => {
        if (versionId === 1) return Promise.resolve(rulesV1);
        if (versionId === 2) return Promise.resolve(rulesV2);
        return Promise.resolve([]);
      });

      (classificationRepo() as any).upsert.mockImplementation((result: any, findings: any) => {
        return Promise.resolve({ id: 106, ...result, findings });
      });

      const respV1 = await service.classify(productId) as any;
      expect(respV1.methodologyVersionId).toBe(1);
      expect(respV1.findings[0].severity).toBe('watch');
      expect(respV1.findings[0].flag).toBe('irritant');

      // Phase 2: switch active to v2
      (methodologyRepo() as any).getActive.mockResolvedValue({ ...activeVersion, id: 2, version: 2, name: 'Updated' });

      const respV2 = await service.classify(productId) as any;
      expect(respV2.methodologyVersionId).toBe(2);
      // v2 escalates linalool from watch → restricted
      expect(respV2.findings[0].severity).toBe('restricted');
      expect(respV2.findings[0].flag).toBe('irritant-strong');

      // Phase 3: verify both stored results are retrievable
      (classificationRepo() as any).findByProductId.mockResolvedValue([
        {
          id: 106,
          productId: 8,
          methodologyVersionId: 1,
          overallConfidence: 1.0,
          disclaimer: 'This classification is informational only and does not constitute safety advice.',
          findings: [
            {
              id: 1,
              classificationResultId: 106,
              rawText: 'Linalool',
              resolvedName: 'linalool',
              ingredientId: 10,
              isUnknown: false,
              flag: 'irritant',
              severity: 'watch',
              sourceCitation: 'EC 1223/2009 Annex II',
            },
          ],
        },
        {
          id: 107,
          productId: 8,
          methodologyVersionId: 2,
          overallConfidence: 1.0,
          disclaimer: 'This classification is informational only and does not constitute safety advice.',
          findings: [
            {
              id: 2,
              classificationResultId: 107,
              rawText: 'Linalool',
              resolvedName: 'linalool',
              ingredientId: 10,
              isUnknown: false,
              flag: 'irritant-strong',
              severity: 'restricted',
              sourceCitation: 'EC 1223/2009 Annex II (rev)',
            },
          ],
        },
      ]);

      const allResults = await (classificationRepo() as any).findByProductId(productId);
      expect(allResults).toHaveLength(2);

      const v1Result = allResults.find((r: any) => r.methodologyVersionId === 1);
      const v2Result = allResults.find((r: any) => r.methodologyVersionId === 2);

      expect(v1Result).toBeDefined();
      expect(v2Result).toBeDefined();

      // v1 findings are unchanged
      expect(v1Result.findings[0].severity).toBe('watch');
      expect(v1Result.findings[0].flag).toBe('irritant');

      // v2 findings reflect new rules
      expect(v2Result.findings[0].severity).toBe('restricted');
      expect(v2Result.findings[0].flag).toBe('irritant-strong');
    });
  });
});
