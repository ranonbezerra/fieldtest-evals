import { Test, TestingModule } from '@nestjs/testing';
import { MethodologyService } from '../src/methodologies/methodology.service.js';
import type { MethodologyRepository, StoredClassification, StoredFinding } from '../src/methodologies/methodology.repository.js';

interface MockRule {
  ingredientId: string;
  severity: string;
  flag: string;
  source: string;
}

function createMockRepository() {
  const methodologies = new Map<string, { id: string; version: string }>();
  let activeId: string | null = null;
  const rulesByVersion = new Map<string, MockRule[]>();
  const products: { id: string; ingredients: string[] }[] = [];
  const canonicalSet = new Set<string>();
  const synonymMap = new Map<string, string>();
  const storedResults = new Map<string, StoredClassification>();

  const repo = {
    findActive: async (): Promise<{ id: string; version: string } | null> => {
      if (!activeId) return null;
      const entry = methodologies.get(activeId);
      return entry ? { id: entry.id, version: entry.version } : null;
    },
    find: async (version: string): Promise<{ id: string; version: string } | null> => {
      for (const [id, m] of methodologies) {
        if (m.version === version) return { id, version: m.version };
      }
      return null;
    },
    createVersion: async (version: string, rules: MockRule[]): Promise<string> => {
      const id = `mv-${version}`;
      methodologies.set(id, { id, version });
      rulesByVersion.set(id, rules);
      return id;
    },
    setActive: async (id: string): Promise<void> => {
      activeId = id;
    },
    findProducts: async (): Promise<{ id: string; ingredients: string[] }[]> => products,
    findRules: async (id: string): Promise<MockRule[]> => rulesByVersion.get(id) ?? [],
    findCanonicalByNormalized: (normalized: string): string | null => {
      if (canonicalSet.has(normalized)) return normalized;
      const syn = synonymMap.get(normalized);
      return syn ?? null;
    },
    upsertResult: async (productId: string, versionId: string, result: StoredClassification): Promise<void> => {
      storedResults.set(`${productId}:${versionId}`, result);
    },
  } as MethodologyRepository;

  return {
    repo,
    products,
    addCanonical: (name: string): void => { canonicalSet.add(name); },
    addSynonym: (raw: string, canonical: string): void => { synonymMap.set(raw, canonical); },
    getStoredResults: (): Map<string, StoredClassification> => storedResults,
  };
}

describe('MethodologyService', () => {
  let service: MethodologyService;
  let mock: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    mock = createMockRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MethodologyService,
        { provide: MethodologyRepository, useValue: mock.repo },
      ],
    }).compile();

    service = module.get(MethodologyService);
  });

  it('publishes a new methodology version and activates it', async () => {
    mock.addCanonical('retinyl palmitate');
    mock.products.push({ id: 'p1', ingredients: ['Retinyl Palmitate', 'Aqua'] });

    const rules: MockRule[] = [
      { ingredientId: 'retinyl palmitate', severity: 'restricted', flag: 'irritant', source: 'EU-Reg-1234' },
    ];

    const id = await service.publish('v1', rules);

    const active = await service.getActive();
    expect(active).not.toBeNull();
    expect(active!.version).toBe('v1');
    expect(id).toBe(active!.id);
  });

  it('rescores all products on publish and stores per-ingredient findings', async () => {
    mock.addCanonical('retinyl palmitate');
    mock.addCanonical('aqua');
    mock.products.push({ id: 'p1', ingredients: ['Retinyl Palmitate', 'Aqua'] });

    const rules: MockRule[] = [
      { ingredientId: 'retinyl palmitate', severity: 'restricted', flag: 'irritant', source: 'EU-Reg-1234' },
    ];

    await service.publish('v1', rules);

    const result = mock.getStoredResults().get('p1:mv-v1');
    expect(result).toBeDefined();
    expect(result!.findings).toHaveLength(2);

    const flagged = result!.findings.find((f: StoredFinding) => f.ingredient === 'retinyl palmitate');
    expect(flagged).toBeDefined();
    expect(flagged!.status).toBe('flagged');
    expect(flagged!.severity).toBe('restricted');
    expect(flagged!.source).toBe('EU-Reg-1234');

    const clear = result!.findings.find((f: StoredFinding) => f.ingredient === 'aqua');
    expect(clear).toBeDefined();
    expect(clear!.status).toBe('clear');
  });

  it('rescoring is idempotent: republishing the same version yields identical stored results', async () => {
    mock.addCanonical('retinyl palmitate');
    mock.addCanonical('aqua');
    mock.products.push({ id: 'p1', ingredients: ['Retinyl Palmitate', 'Aqua'] });

    const rules: MockRule[] = [
      { ingredientId: 'retinyl palmitate', severity: 'restricted', flag: 'irritant', source: 'EU-Reg-1234' },
    ];

    await service.publish('v1', rules);
    const firstRun = mock.getStoredResults().get('p1:mv-v1');

    await service.publish('v1', rules);
    const secondRun = mock.getStoredResults().get('p1:mv-v1');

    expect(secondRun).toEqual(firstRun);
  });

  it('produces identical per-ingredient findings regardless of ingredient order', async () => {
    mock.addCanonical('retinyl palmitate');
    mock.addCanonical('aqua');
    mock.addCanonical('glycerin');
    mock.products.push({ id: 'p1', ingredients: ['Retinyl Palmitate', 'Aqua', 'Glycerin'] });

    const rules: MockRule[] = [
      { ingredientId: 'retinyl palmitate', severity: 'restricted', flag: 'irritant', source: 'EU-Reg-1234' },
    ];

    await service.publish('v1', rules);
    const ordered = mock.getStoredResults().get('p1:mv-v1');

    mock.products.length = 0;
    mock.products.push({ id: 'p1', ingredients: ['Glycerin', 'Aqua', 'Retinyl Palmitate'] });
    await service.rescoreAll();

    const shuffled = mock.getStoredResults().get('p1:mv-v1');

    const orderedBy = new Map<string, StoredFinding>(ordered!.findings.map((f: StoredFinding) => [f.ingredient, f]));
    const shuffledBy = new Map<string, StoredFinding>(shuffled!.findings.map((f: StoredFinding) => [f.ingredient, f]));

    expect(shuffledBy.size).toBe(orderedBy.size);
    for (const [name, finding] of orderedBy) {
      expect(shuffledBy.get(name)).toEqual(finding);
    }
    expect(shuffled!.confidence).toBe(ordered!.confidence);
  });

  it('both versions coexist: publishing v2 does not alter stored v1 results', async () => {
    mock.addCanonical('retinyl palmitate');
    mock.addCanonical('aqua');
    mock.products.push({ id: 'p1', ingredients: ['Retinyl Palmitate', 'Aqua'] });

    const rulesV1: MockRule[] = [
      { ingredientId: 'retinyl palmitate', severity: 'restricted', flag: 'irritant', source: 'EU-Reg-1234' },
    ];
    const rulesV2: MockRule[] = [
      { ingredientId: 'retinyl palmitate', severity: 'banned', flag: 'carcinogen', source: 'EU-Reg-5678' },
    ];

    await service.publish('v1', rulesV1);
    await service.publish('v2', rulesV2);

    const v1Result = mock.getStoredResults().get('p1:mv-v1');
    const v2Result = mock.getStoredResults().get('p1:mv-v2');

    expect(v1Result).toBeDefined();
    expect(v2Result).toBeDefined();

    const v1Flagged = v1Result!.findings.find((f: StoredFinding) => f.ingredient === 'retinyl palmitate');
    expect(v1Flagged!.severity).toBe('restricted');

    const v2Flagged = v2Result!.findings.find((f: StoredFinding) => f.ingredient === 'retinyl palmitate');
    expect(v2Flagged!.severity).toBe('banned');
  });

  it('unknown ingredients lower confidence and are visible in findings', async () => {
    mock.addCanonical('aqua');
    mock.products.push({ id: 'p1', ingredients: ['Aqua', 'Mystery Ingred'] });

    const rules: MockRule[] = [];
    await service.publish('v1', rules);

    const result = mock.getStoredResults().get('p1:mv-v1');
    expect(result).toBeDefined();
    expect(result!.confidence).toBe(0.5);

    const unknown = result!.findings.find((f: StoredFinding) => f.ingredient === 'Mystery Ingred');
    expect(unknown).toBeDefined();
    expect(unknown!.status).toBe('unknown');
  });

  it('resolves synonyms during re-scoring', async () => {
    mock.addCanonical('retinyl palmitate');
    mock.addSynonym('vitamin a palmitate', 'retinyl palmitate');
    mock.products.push({ id: 'p1', ingredients: ['Vitamin A Palmitate'] });

    const rules: MockRule[] = [
      { ingredientId: 'retinyl palmitate', severity: 'watch', flag: 'retinoid', source: 'WHO-2020' },
    ];

    await service.publish('v1', rules);

    const result = mock.getStoredResults().get('p1:mv-v1');
    const finding = result!.findings.find((f: StoredFinding) => f.status === 'flagged');
    expect(finding).toBeDefined();
    expect(finding!.ingredient).toBe('retinyl palmitate');
    expect(finding!.severity).toBe('watch');
  });
});
