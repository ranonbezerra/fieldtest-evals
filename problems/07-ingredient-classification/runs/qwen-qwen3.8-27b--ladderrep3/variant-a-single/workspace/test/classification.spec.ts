import { describe, expect, it } from 'vitest';
import type {
  CanonicalIngredientRow,
  ClassificationRepositoryPort,
  MethodologyVersionRow,
  ProductProfilePair,
  ProductRow,
  ProfileRow,
  RuleRow,
  StoredClassificationRow,
  SynonymRow,
  UpsertClassificationInput,
} from '../src/classification/classification.repository.js';
import { INCI_FIXTURES } from '../src/classification/inci-fixtures.js';
import { ClassificationService, type ClassificationResultDto, type IngredientResult } from '../src/classification/classification.service.js';

const V1 = 'ver-1';
const V2 = 'ver-2';
const LOTION = 'prod-suntouch-lotion';
const GEL = 'prod-plain-gel';
const CHILD_PROFILE = 'prof-child-under-3';
const PREGNANCY_PROFILE = 'prof-pregnancy';
const FAMILY_PROFILE = 'prof-family';

const LOTION_INGREDIENTS = [
  'AQUA',
  'OCTINOXATE',
  'Oxybonzone',
  'retinol',
  'Limonene',
  'METHYLPARBEN',
  'Glycerine',
  'Sclerotium glucan',
];

/** In-memory stand-in for the Prisma repository; implements the same port the service uses. */
class InMemoryRepository implements ClassificationRepositoryPort {
  private readonly products = new Map<string, ProductRow>();
  private readonly productIngredients = new Map<string, string[]>();
  readonly ingredients: CanonicalIngredientRow[] = [];
  readonly synonyms: SynonymRow[] = [];
  readonly versions = new Map<string, MethodologyVersionRow>();
  readonly rules: RuleRow[] = [];
  readonly profiles = new Map<string, ProfileRow>();
  readonly results: StoredClassificationRow[] = [];
  private nextId = 1;

  addProduct(row: ProductRow, rawStrings: string[]): void {
    this.products.set(row.id, row);
    this.productIngredients.set(row.id, [...rawStrings]);
  }

  setProductIngredients(productId: string, rawStrings: string[]): void {
    if (!this.products.has(productId)) throw new Error(`unknown product: ${productId}`);
    this.productIngredients.set(productId, [...rawStrings]);
  }

  async getProduct(id: string): Promise<ProductRow | null> {
    return this.products.get(id) ?? null;
  }

  async getProductIngredients(productId: string): Promise<string[]> {
    return [...(this.productIngredients.get(productId) ?? [])];
  }

  async listIngredients(): Promise<CanonicalIngredientRow[]> {
    return [...this.ingredients];
  }

  async listSynonyms(): Promise<SynonymRow[]> {
    return [...this.synonyms];
  }

  async getMethodologyVersion(id: string): Promise<MethodologyVersionRow | null> {
    return this.versions.get(id) ?? null;
  }

  async getActiveMethodologyVersion(): Promise<MethodologyVersionRow | null> {
    const published = [...this.versions.values()].filter((version) => version.status === 'published');
    published.sort((a, b) => b.version - a.version);
    return published[0] ?? null;
  }

  async listRules(methodologyVersionId: string): Promise<RuleRow[]> {
    return this.rules.filter((rule) => rule.methodologyVersionId === methodologyVersionId);
  }

  async getProfile(id: string): Promise<ProfileRow | null> {
    return this.profiles.get(id) ?? null;
  }

  async markMethodologyVersionPublished(id: string): Promise<MethodologyVersionRow> {
    const version = this.versions.get(id);
    if (!version) throw new Error(`unknown methodology version: ${id}`);
    if (version.status !== 'published') {
      const updated: MethodologyVersionRow = {
        ...version,
        status: 'published',
        publishedAt: '2025-04-01T00:00:00.000Z',
      };
      this.versions.set(id, updated);
      return updated;
    }
    return version;
  }

  async upsertClassification(input: UpsertClassificationInput): Promise<StoredClassificationRow> {
    const existing = this.results.find(
      (row) =>
        row.productId === input.productId &&
        row.methodologyVersionId === input.methodologyVersionId &&
        row.profileId === input.profileId,
    );
    if (existing) {
      existing.payload = input.payload;
      return existing;
    }
    const row: StoredClassificationRow = { id: `res-${this.nextId++}`, ...input };
    this.results.push(row);
    return row;
  }

  async getClassificationsForProduct(productId: string): Promise<StoredClassificationRow[]> {
    return this.results.filter((row) => row.productId === productId);
  }

  async getClassification(
    productId: string,
    methodologyVersionId: string,
    profileId: string | null,
  ): Promise<StoredClassificationRow | null> {
    return (
      this.results.find(
        (row) =>
          row.productId === productId &&
          row.methodologyVersionId === methodologyVersionId &&
          row.profileId === profileId,
      ) ?? null
    );
  }

  async distinctProductProfilePairs(): Promise<ProductProfilePair[]> {
    const seen = new Map<string, ProductProfilePair>();
    for (const row of this.results) {
      seen.set(`${row.productId}\u0000${row.profileId ?? ''}`, {
        productId: row.productId,
        profileId: row.profileId,
      });
    }
    return [...seen.values()];
  }
}

function seed(): InMemoryRepository {
  const repo = new InMemoryRepository();

  for (const entry of INCI_FIXTURES) {
    const ingredientId = `ing-${entry.canonical}`;
    repo.ingredients.push({ id: ingredientId, name: entry.canonical });
    entry.aliases.forEach((alias, index) => {
      repo.synonyms.push({
        id: `syn-${entry.canonical}-${index}`,
        ingredientId,
        alias: alias.text,
        kind: alias.kind,
      });
    });
  }

  repo.versions.set(V1, {
    id: V1,
    version: 1,
    label: 'Baseline (March 2025)',
    status: 'published',
    publishedAt: '2025-03-01T00:00:00.000Z',
  });
  repo.versions.set(V2, {
    id: V2,
    version: 2,
    label: 'Watch list update (April 2025)',
    status: 'draft',
    publishedAt: null,
  });

  let ruleSeq = 0;
  const rule = (
    methodologyVersionId: string,
    ingredient: string,
    context: RuleRow['context'],
    severity: RuleRow['severity'],
    sourceCitation: string,
  ): void => {
    repo.rules.push({
      id: `rule-${ruleSeq++}`,
      methodologyVersionId,
      ingredientId: `ing-${ingredient}`,
      context,
      severity,
      sourceCitation,
    });
  };

  // v1: base rules and contextual modifiers
  rule(V1, 'benzophenone-3', 'base', 'watch', 'Curated watch list, entry WL-14 (UV filter; photostability)');
  rule(V1, 'oxybenzone', 'base', 'restricted', 'EC Regulation (EU) No 1223/2009, Annex III, entry 209');
  rule(V1, 'limonene', 'base', 'restricted', 'EC Regulation (EU) No 1223/2009, Annex III, entry 227 (sensitiser; max 0.2%)');
  rule(V1, 'methylparaben', 'base', 'watch', 'Curated watch list, entry WL-02 (parabens)');
  rule(V1, 'benzophenone-3', 'child_under_3', 'restricted', 'Curated watch list, entry WL-14a (children under 3)');
  rule(V1, 'retinol', 'pregnancy', 'restricted', 'Curated guidance, entry PRG-03 (avoid retinoids in pregnancy)');
  rule(V1, 'limonene', 'pregnancy', 'restricted', 'Curated guidance, entry PRG-05 (fragrance allergens in pregnancy)');
  rule(V1, 'methylparaben', 'pregnancy', 'watch', 'Curated guidance, entry PRG-01 (parabens in pregnancy)');
  rule(V1, 'methylparaben', 'child_under_3', 'watch', 'Curated watch list, entry WL-02a (children under 3)');

  // v2: benzophenone-3 escalated in base; oxybenzone banned for pregnancy
  rule(V2, 'benzophenone-3', 'base', 'restricted', 'Curated watch list, entry WL-14 (UV filter; elevated concentration reports)');
  rule(V2, 'oxybenzone', 'base', 'restricted', 'EC Regulation (EU) No 1223/2009, Annex III, entry 209');
  rule(V2, 'limonene', 'base', 'restricted', 'EC Regulation (EU) No 1223/2009, Annex III, entry 227 (sensitiser; max 0.2%)');
  rule(V2, 'methylparaben', 'base', 'watch', 'Curated watch list, entry WL-02 (parabens)');
  rule(V2, 'benzophenone-3', 'child_under_3', 'restricted', 'Curated watch list, entry WL-14a (children under 3)');
  rule(V2, 'retinol', 'pregnancy', 'restricted', 'Curated guidance, entry PRG-03 (avoid retinoids in pregnancy)');
  rule(V2, 'limonene', 'pregnancy', 'restricted', 'Curated guidance, entry PRG-05 (fragrance allergens in pregnancy)');
  rule(V2, 'methylparaben', 'pregnancy', 'watch', 'Curated guidance, entry PRG-01 (parabens in pregnancy)');
  rule(V2, 'methylparaben', 'child_under_3', 'watch', 'Curated watch list, entry WL-02a (children under 3)');
  rule(V2, 'oxybenzone', 'pregnancy', 'banned', 'EC Regulation (EU) No 1223/2009, Annex III, entry 209; ACOG guidance PRG-07 (systemic uptake in pregnancy)');

  repo.profiles.set(CHILD_PROFILE, { id: CHILD_PROFILE, name: 'child under 3', contexts: ['child_under_3'] });
  repo.profiles.set(PREGNANCY_PROFILE, { id: PREGNANCY_PROFILE, name: 'pregnancy', contexts: ['pregnancy'] });
  repo.profiles.set(FAMILY_PROFILE, {
    id: FAMILY_PROFILE,
    name: 'family (pregnancy + child under 3)',
    contexts: ['pregnancy', 'child_under_3'],
  });

  repo.addProduct({ id: LOTION, name: 'Suntouch Day Lotion' }, LOTION_INGREDIENTS);
  repo.addProduct({ id: GEL, name: 'Plain Gel' }, ['Aqua', 'Glycerin']);

  return repo;
}

function makeService(): { repo: InMemoryRepository; service: ClassificationService } {
  const repo = seed();
  return { repo, service: new ClassificationService(repo) };
}

const entry = (result: ClassificationResultDto, raw: string): IngredientResult => {
  const found = result.ingredients.find((candidate) => candidate.raw === raw);
  if (!found) throw new Error(`no ingredient entry for ${raw}`);
  return found;
};

function collectKeys(value: unknown): string[] {
  const keys: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        keys.push(key);
        walk(child);
      }
    }
  };
  walk(value);
  return keys;
}

describe('classify()', () => {
  it('resolves synonyms, case variants and OCR typos to the canonical ingredient', async () => {
    const { service } = makeService();
    const result = await service.classify(LOTION);
    expect(entry(result, 'AQUA').canonical).toBe('water');
    expect(entry(result, 'OCTINOXATE').canonical).toBe('benzophenone-3');
    expect(entry(result, 'Oxybonzone').canonical).toBe('oxybenzone');
    expect(entry(result, 'retinol').canonical).toBe('retinol');
    expect(entry(result, 'METHYLPARBEN').canonical).toBe('methylparaben');
    expect(entry(result, 'Glycerine').canonical).toBe('glycerin');
  });

  it('attaches severity and source citation to each flagged ingredient', async () => {
    const { service } = makeService();
    const result = await service.classify(LOTION);
    const bp3 = entry(result, 'OCTINOXATE');
    expect(bp3.flagged).toBe(true);
    expect(bp3.severity).toBe('watch');
    expect(bp3.sourceCitation).toBe('Curated watch list, entry WL-14 (UV filter; photostability)');
    const oxybenzone = entry(result, 'Oxybonzone');
    expect(oxybenzone.severity).toBe('restricted');
    expect(oxybenzone.sourceCitation).toBe('EC Regulation (EU) No 1223/2009, Annex III, entry 209');
    const water = entry(result, 'AQUA');
    expect(water.flagged).toBe(false);
    expect(water.severity).toBeNull();
    expect(water.sourceCitation).toBeNull();
  });

  it('lists unknown ingredients and lowers confidence; a fully recognised list keeps it at 1', async () => {
    const { service } = makeService();
    const withUnknown = await service.classify(LOTION);
    expect(withUnknown.unknownIngredients).toEqual(['Sclerotium glucan']);
    const unknown = entry(withUnknown, 'Sclerotium glucan');
    expect(unknown.unknown).toBe(true);
    expect(unknown.canonical).toBeNull();
    expect(unknown.flagged).toBe(false);
    expect(withUnknown.confidence).toBe(0.875);
    const clean = await service.classify(GEL);
    expect(clean.unknownIngredients).toEqual([]);
    expect(clean.confidence).toBe(1);
  });

  it('never exposes a binary safe/toxic verdict field', async () => {
    const { service } = makeService();
    const result = await service.classify(LOTION);
    const keys = collectKeys(result);
    expect(keys.some((key) => /^(is[_-])?(safe|safety|toxic|toxicity|verdict|rating)$/i.test(key))).toBe(false);
  });

  it('lets a profile flip a finding the base rules alone would not flag', async () => {
    const { service } = makeService();
    const base = await service.classify(LOTION);
    expect(entry(base, 'retinol').flagged).toBe(false);
    const pregnancy = await service.classify(LOTION, PREGNANCY_PROFILE);
    const retinol = entry(pregnancy, 'retinol');
    expect(retinol.flagged).toBe(true);
    expect(retinol.severity).toBe('restricted');
    expect(retinol.sourceCitation).toBe('Curated guidance, entry PRG-03 (avoid retinoids in pregnancy)');
  });

  it('resolves modifier precedence deterministically: max severity, then child_under_3 > pregnancy > base', async () => {
    const { service } = makeService();
    const child = await service.classify(LOTION, CHILD_PROFILE);
    const bp3 = entry(child, 'OCTINOXATE');
    expect(bp3.severity).toBe('restricted');
    expect(bp3.sourceCitation).toBe('Curated watch list, entry WL-14a (children under 3)');

    const family = await service.classify(LOTION, FAMILY_PROFILE);
    const paraben = entry(family, 'METHYLPARBEN');
    expect(paraben.severity).toBe('watch');
    expect(paraben.sourceCitation).toBe('Curated watch list, entry WL-02a (children under 3)');
    expect(paraben.findings.map((finding) => finding.context)).toEqual(['child_under_3', 'pregnancy', 'base']);
    const limonene = entry(family, 'Limonene');
    expect(limonene.sourceCitation).toBe('Curated guidance, entry PRG-05 (fragrance allergens in pregnancy)');
  });

  it('is identical across reruns and under shuffled ingredient order', async () => {
    const { repo, service } = makeService();
    const first = await service.classify(LOTION);
    const second = await service.classify(LOTION);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(repo.results.filter((row) => row.productId === LOTION)).toHaveLength(1);

    repo.setProductIngredients(LOTION, [...LOTION_INGREDIENTS].reverse());
    const shuffled = await service.classify(LOTION);
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(first));
    expect(repo.results.filter((row) => row.productId === LOTION)).toHaveLength(1);
  });

  it('rejects unknown products and profiles with resource_not_found', async () => {
    const { service } = makeService();
    await expect(service.classify('no-such-product')).rejects.toMatchObject({ code: 'resource_not_found' });
    await expect(service.classify(LOTION, 'no-such-profile')).rejects.toMatchObject({ code: 'resource_not_found' });
  });
});

describe('publishing a methodology version', () => {
  it('re-scores affected products idempotently and keeps both versions retrievable', async () => {
    const { repo, service } = makeService();
    const v1Base = await service.classify(LOTION);
    const v1Pregnancy = await service.classify(LOTION, PREGNANCY_PROFILE);

    const firstPublish = await service.publishMethodologyVersion(V2);
    expect(firstPublish.publishedAt).toBe('2025-04-01T00:00:00.000Z');
    expect(firstPublish.reScored).toBe(2);

    // v1 results are retrievable exactly as they were
    const v1Again = await service.getStoredResult(LOTION, V1);
    expect(JSON.stringify(v1Again)).toBe(JSON.stringify(v1Base));
    const v1PregnancyAgain = await service.getStoredResult(LOTION, V1, PREGNANCY_PROFILE);
    expect(JSON.stringify(v1PregnancyAgain)).toBe(JSON.stringify(v1Pregnancy));

    // v2 results exist for the same product and reflect the new rules
    const v2Base = await service.getStoredResult(LOTION, V2);
    expect(entry(v2Base, 'OCTINOXATE').severity).toBe('restricted');
    expect(entry(v2Base, 'OCTINOXATE').sourceCitation).toBe(
      'Curated watch list, entry WL-14 (UV filter; elevated concentration reports)',
    );
    const v2Pregnancy = await service.getStoredResult(LOTION, V2, PREGNANCY_PROFILE);
    expect(entry(v2Pregnancy, 'Oxybonzone').severity).toBe('banned');
    expect(entry(v2Pregnancy, 'Oxybonzone').sourceCitation).toContain('PRG-07');
    expect(JSON.stringify(v1Pregnancy)).not.toBe(JSON.stringify(v2Pregnancy));

    // both versions coexist for the same product
    expect(await service.getStoredResults(LOTION)).toHaveLength(4);

    // publishing again is idempotent: same rows, no duplicates
    const before = JSON.stringify(repo.results);
    const secondPublish = await service.publishMethodologyVersion(V2);
    expect(secondPublish.reScored).toBe(2);
    expect(JSON.stringify(repo.results)).toBe(before);
    expect(repo.results).toHaveLength(4);
  });
});
