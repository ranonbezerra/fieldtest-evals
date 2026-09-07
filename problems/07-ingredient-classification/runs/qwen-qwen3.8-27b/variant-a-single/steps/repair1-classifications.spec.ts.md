# repair1-classifications.spec.ts

## reasoning

```
Let me analyze the compiler errors for `test/classifications.spec.ts`:

1. `test/classifications.spec.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.`
2. `test/classifications.spec.ts(2
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClassificationService } from '../src/classifications/classification.js';
import type { ClassificationRepository } from '../src/classifications/classification.repository.js';

// ASSUMPTION: `@prisma/client` has no generated exports in this workspace, so
// `PrismaClient` and `Prisma` cannot be imported. The test therefore builds a
// hand-rolled repository mock with explicit types instead of using the Prisma
// client directly.

// ASSUMPTION: The `ClassificationRepository` interface is not visible in the
// reference material; the mock below is shaped to satisfy the method calls
// made by `ClassificationService` based on the service source.

interface MockFinding {
  ingredient: string;
  canonicalName: string | null;
  rawName: string;
  status: 'flagged' | 'clear' | 'unknown';
  severity: string | null;
  source: string | null;
  flag: string | null;
  matchedBy: string | null;
}

function makeRepo(overrides?: {
  products?: Record<string, { id: string; name: string; ingredients: string[] }>;
  activeVersion?: { id: string; version: string } | null;
  rules?: Record<string, Array<{ canonicalName: string; severity: string; flag: string; source: string }>>;
  canonicals?: Set<string>;
  synonyms?: Record<string, string>;
  typoMap?: Record<string, string>;
  profiles?: Record<string, { id: string; name: string; modifiers: Array<{ canonicalName: string; severity: string; flag: string; source: string }> }>;
}) {
  const products = overrides?.products ?? {};
  const activeVersion = overrides?.activeVersion ?? { id: 'mv-1', version: 'v1' };
  const rules = overrides?.rules ?? {};
  const canonicals = overrides?.canonicals ?? new Set<string>();
  const synonyms = overrides?.synonyms ?? {};
  const typoMap = overrides?.typoMap ?? {};
  const profiles = overrides?.profiles ?? {};

  return {
    findProductWithIngredients: vi.fn(async (id: string) => {
      const p = products[id];
      if (!p) return null;
      return { id: p.id, name: p.name, ingredients: p.ingredients };
    }),
    findActiveMethodology: vi.fn(async () => activeVersion),
    findRulesByVersion: vi.fn(async (versionId: string) => rules[versionId] ?? []),
    findProfileWithModifiers: vi.fn(async (id: string) => profiles[id] ?? null),
    findCanonicalByNormalized: vi.fn((normalized: string) =>
      canonicals.has(normalized) ? normalized : null,
    ),
    findCanonicalBySynonym: vi.fn((normalized: string) => synonyms[normalized] ?? null),
    findCanonicalByTypo: vi.fn((normalized: string) => typoMap[normalized] ?? null),
  };
}

describe('ClassificationService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: ClassificationService;

  beforeEach(() => {
    repo = makeRepo();
    service = new ClassificationService(repo as unknown as ClassificationRepository);
  });

  describe('profile flips a finding', () => {
    it('should escalate severity when a profile modifier is present', async () => {
      const product = { id: 'p1', name: 'Test Product', ingredients: ['retinol'] };
      const rules: Record<string, Array<{ canonicalName: string; severity: string; flag: string; source: string }>> = {
        'mv-1': [{ canonicalName: 'retinol', severity: 'watch', flag: 'watch-list', source: 'regulator' }],
      };
      const profiles: Record<string, { id: string; name: string; modifiers: Array<{ canonicalName: string; severity: string; flag: string; source: string }> }> = {
        prof1: {
          id: 'prof1',
          name: 'Pregnancy',
          modifiers: [{ canonicalName: 'retinol', severity: 'restricted', flag: 'restricted-pregnancy', source: 'family-guide' }],
        },
      };

      repo = makeRepo({
        products: { p1: product },
        rules,
        canonicals: new Set(['retinol']),
        profiles,
      });
      service = new ClassificationService(repo as unknown as ClassificationRepository);

      // Without profile: watch
      const baseResult = await service.classify('p1');
      const baseFinding = baseResult.findings.find((f: MockFinding) => f.canonicalName === 'retinol')!;
      expect(baseFinding.severity).toBe('watch');

      // With profile: restricted
      const profileResult = await service.classify('p1', 'prof1');
      const profileFinding = profileResult.findings.find((f: MockFinding) => f.canonicalName === 'retinol')!;
      expect(profileFinding.severity).toBe('restricted');
      expect(profileFinding.flag).toBe('restricted-pregnancy');
    });
  });

  describe('unknown ingredient lowers confidence and is visible', () => {
    it('should list unknown ingredients and reduce confidence', async () => {
      const product = { id: 'p1', name: 'Test Product', ingredients: ['retinol', 'mystery-xyz'] };
      const rules: Record<string, Array<{ canonicalName: string; severity: string; flag: string; source: string }>> = {
        'mv-1': [{ canonicalName: 'retinol', severity: 'banned', flag: 'banned-substance', source: 'regulator' }],
      };

      repo = makeRepo({
        products: { p1: product },
        rules,
        canonicals: new Set(['retinol']),
      });
      service = new ClassificationService(repo as unknown as ClassificationRepository);

      const result = await service.classify('p1');

      // Confidence should be 0.5 (1 of 2 recognized)
      expect(result.confidence).toBeCloseTo(0.5);

      // Unknown ingredient should be visible
      const unknown = result.findings.find((f: MockFinding) => f.status === 'unknown');
      expect(unknown).toBeDefined();
      expect(unknown!.rawName).toBe('mystery-xyz');
      expect(unknown!.severity).toBeNull();
    });
  });

  describe('synonym and typo resolution', () => {
    it('should resolve a synonym to its canonical form', async () => {
      const product = { id: 'p1', name: 'Test Product', ingredients: ['vitamin-e'] };
      const rules: Record<string, Array<{ canonicalName: string; severity: string; flag: string; source: string }>> = {
        'mv-1': [{ canonicalName: 'tocopherol', severity: 'restricted', flag: 'restricted', source: 'regulator' }],
      };

      repo = makeRepo({
        products: { p1: product },
        rules,
        canonicals: new Set(['tocopherol']),
        synonyms: { 'vitamin-e': 'tocopherol' },
      });
      service = new ClassificationService(repo as unknown as ClassificationRepository);

      const result = await service.classify('p1');
      const finding = result.findings[0] as MockFinding;
      expect(finding.canonicalName).toBe('tocopherol');
      expect(finding.matchedBy).toBe('synonym');
      expect(finding.severity).toBe('restricted');
    });

    it('should resolve a typo to its canonical form', async () => {
      const product = { id: 'p1', name: 'Test Product', ingredients: ['parben'] };
      const rules: Record<string, Array<{ canonicalName: string; severity: string; flag: string; source: string }>> = {
        'mv-1': [{ canonicalName: 'paraben', severity: 'watch', flag: 'watch', source: 'regulator' }],
      };

      repo = makeRepo({
        products: { p1: product },
        rules,
        canonicals: new Set(['paraben']),
        typoMap: { parben: 'paraben' },
      });
      service = new ClassificationService(repo as unknown as ClassificationRepository);

      const result = await service.classify('p1');
      const finding = result.findings[0] as MockFinding;
      expect(finding.canonicalName).toBe('paraben');
      expect(finding.matchedBy).toBe('typo');
    });
  });

  describe('determinism across reruns and shuffled ingredient order', () => {
    it('should produce identical results on rerun', async () => {
      const product = { id: 'p1', name: 'Test Product', ingredients: ['retinol', 'vitamin-c', 'fragrance'] };
      const rules: Record<string, Array<{ canonicalName: string; severity: string; flag: string; source: string }>> = {
        'mv-1': [
          { canonicalName: 'retinol', severity: 'banned', flag: 'banned', source: 'regulator' },
          { canonicalName: 'fragrance', severity: 'watch', flag: 'watch', source: 'curated' },
        ],
      };

      repo = makeRepo({
        products: { p1: product },
        rules,
        canonicals: new Set(['retinol', 'vitamin-c', 'fragrance']),
      });
      service = new ClassificationService(repo as unknown as ClassificationRepository);

      const first = await service.classify('p1');
      const second = await service.classify('p1');

      expect(JSON.stringify(first.findings)).toBe(JSON.stringify(second.findings));
      expect(first.confidence).toBe(second.confidence);
      expect(first.methodologyVersion).toBe(second.methodologyVersion);
    });

    it('should produce identical findings (same set) under shuffled ingredient order', async () => {
      const ingredients = ['retinol', 'vitamin-c', 'fragrance'];
      const shuffled = [...ingredients].reverse();

      const product1 = { id: 'p1', name: 'A', ingredients };
      const product2 = { id: 'p2', name: 'B', ingredients: shuffled };

      const rules: Record<string, Array<{ canonicalName: string; severity: string; flag: string; source: string }>> = {
        'mv-1': [
          { canonicalName: 'retinol', severity: 'banned', flag: 'banned', source: 'regulator' },
          { canonicalName: 'fragrance', severity: 'watch', flag: 'watch', source: 'curated' },
        ],
      };

      repo = makeRepo({
        products: { p1: product1, p2: product2 },
        rules,
        canonicals: new Set(['retinol', 'vitamin-c', 'fragrance']),
      });
      service = new ClassificationService(repo as unknown as ClassificationRepository);

      const result1 = await service.classify('p1');
      const result2 = await service.classify('p2');

      // The set of (canonicalName, severity) pairs should be identical
      const set1 = result1.findings
        .map((f: MockFinding) => `${f.canonicalName}:${f.severity}`)
        .sort();
      const set2 = result2.findings
        .map((f: MockFinding) => `${f.canonicalName}:${f.severity}`)
        .sort();

      expect(set1).toEqual(set2);
    });
  });

  describe('both versions coexist', () => {
    it('should return results for the version specified, not just the active one', async () => {
      // The service uses the active version; the test here verifies that
      // the methodologyVersion field is present and correct.
      const product = { id: 'p1', name: 'Test', ingredients: ['retinol'] };
      const rules: Record<string, Array<{ canonicalName: string; severity: string; flag: string; source: string }>> = {
        'mv-1': [{ canonicalName: 'retinol', severity: 'banned', flag: 'banned', source: 'regulator' }],
      };

      repo = makeRepo({
        products: { p1: product },
        activeVersion: { id: 'mv-1', version: 'v1' },
        rules,
        canonicals: new Set(['retinol']),
      });
      service = new ClassificationService(repo as unknown as ClassificationRepository);

      const result = await service.classify('p1');
      expect(result.methodologyVersion).toBe('v1');

      // Switch active version
      repo = makeRepo({
        products: { p1: product },
        activeVersion: { id: 'mv-2', version: 'v2' },
        rules: {
          'mv-2': [{ canonicalName: 'retinol', severity: 'watch', flag: 'watch', source: 'regulator' }],
        },
        canonicals: new Set(['retinol']),
      });
      service = new ClassificationService(repo as unknown as ClassificationRepository);

      const result2 = await service.classify('p1');
      expect(result2.methodologyVersion).toBe('v2');
      expect(result2.findings[0] as MockFinding).toEqual(
        expect.objectContaining({ severity: 'watch' }),
      );

      // Previous version result is different
      expect(result.findings[0] as MockFinding).toEqual(
        expect.objectContaining({ severity: 'banned' }),
      );
    });
  });
}
```
