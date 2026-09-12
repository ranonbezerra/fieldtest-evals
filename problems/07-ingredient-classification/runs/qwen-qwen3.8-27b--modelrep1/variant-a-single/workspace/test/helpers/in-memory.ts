import { randomUUID } from 'node:crypto';
import type {
  BaseResult,
  ProfileRef,
  ProductRecord,
  ScoringContext,
  Severity,
  StoredResult,
  VersionSummary,
} from '../../src/classification/classification.types.js';
import type { IClassificationRepository } from '../../src/classification/classification.repository.js';
import type { CreateVersionInput, IMethodologyRepository } from '../../src/methodology/methodology.repository.js';
import type { IProductsRepository } from '../../src/products/products.repository.js';
import type { PersistProfileInput, IProfilesRepository } from '../../src/profiles/profiles.repository.js';
import type { SeedIngredient } from '../../prisma/seed-data.js';

interface DbIngredient {
  id: string;
  name: string;
}

interface DbProduct {
  id: string;
  name: string;
  ingredients: string[];
}

interface DbRule {
  ingredientId: string;
  severity: Severity;
  source: string;
  note: string | null;
}

interface DbVersion {
  id: string;
  version: number;
  name: string;
  status: 'draft' | 'active' | 'superseded';
  isActive: boolean;
  rules: DbRule[];
}

interface DbModifier {
  ingredientId: string;
  severity: Severity;
  source: string;
  note: string | null;
}

interface DbProfile {
  id: string;
  name: string;
  description: string | null;
  modifiers: DbModifier[];
}

export class InMemoryDb {
  ingredients = new Map<string, DbIngredient>();
  ingredientNameToId = new Map<string, string>();
  synonymFormToId = new Map<string, string>();
  products = new Map<string, DbProduct>();
  versions = new Map<string, DbVersion>();
  profiles = new Map<string, DbProfile>();
  results = new Map<string, StoredResult>();

  seedIngredients(list: SeedIngredient[]): void {
    for (const entry of list) {
      const id = `ing:${entry.name}`;
      this.ingredients.set(id, { id, name: entry.name });
      this.ingredientNameToId.set(entry.name, id);
      for (const form of [entry.name, ...entry.synonyms]) {
        this.synonymFormToId.set(form, id);
      }
    }
  }

  findIngredientByName(name: string): { id: string; name: string } | null {
    const id = this.ingredientNameToId.get(name);
    return id ? { id, name } : null;
  }

  addProduct(name: string, ingredients: string[]): DbProduct {
    if ([...this.products.values()].some((product) => product.name === name)) {
      throw new Error(`products name conflict: ${name}`);
    }
    const product: DbProduct = { id: randomUUID(), name, ingredients: [...new Set(ingredients)] };
    this.products.set(product.id, product);
    return product;
  }

  addProfile(name: string, description: string | null, modifiers: DbModifier[]): DbProfile {
    const profile: DbProfile = { id: randomUUID(), name, description, modifiers };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  addVersion(version: number, name: string, rules: DbRule[]): DbVersion {
    if ([...this.versions.values()].some((existing) => existing.version === version)) {
      throw new Error(`methodology version conflict: ${version}`);
    }
    const row: DbVersion = { id: randomUUID(), version, name, status: 'draft', isActive: false, rules };
    this.versions.set(row.id, row);
    return row;
  }

  setVersionActive(id: string): void {
    for (const version of this.versions.values()) {
      if (version.id !== id && version.isActive) {
        version.isActive = false;
        version.status = 'superseded';
      }
    }
    const target = this.versions.get(id);
    if (target) {
      target.isActive = true;
      target.status = 'active';
    }
  }

  findResult(productId: string, methodologyVersionId: string): StoredResult | null {
    const row = this.results.get(`${productId}|${methodologyVersionId}`);
    return row ? copyResult(row) : null;
  }
}

function copyResult(row: StoredResult): StoredResult {
  return {
    ...row,
    findings: row.findings.map((finding) => ({ ...finding })),
    unknowns: [...row.unknowns],
    classifiedAt: new Date(row.classifiedAt),
  };
}

function toSummary(version: DbVersion): VersionSummary {
  return { id: version.id, version: version.version, name: version.name, status: version.status, isActive: version.isActive };
}

function toProfileRef(profile: DbProfile): ProfileRef {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    modifiers: profile.modifiers.map((modifier) => ({ ...modifier })),
  };
}

export class FakeClassificationRepository implements IClassificationRepository {
  constructor(private readonly db: InMemoryDb) {}

  async loadScoringContext(versionId: string): Promise<ScoringContext | null> {
    const version = this.db.versions.get(versionId);
    if (!version) return null;
    return {
      version: toSummary(version),
      rules: version.rules.map((rule) => ({ ...rule })),
      ingredientNameById: Object.fromEntries([...this.db.ingredients.values()].map((ingredient) => [ingredient.id, ingredient.name])),
      synonymFormToIngredientId: Object.fromEntries(this.db.synonymFormToId),
      canonicalNameToIngredientId: Object.fromEntries(this.db.ingredientNameToId),
      products: [...this.db.products.values()].map((product) => ({
        id: product.id,
        name: product.name,
        listedIngredients: [...product.ingredients],
      })),
    };
  }

  async findVersion(id: string): Promise<VersionSummary | null> {
    const version = this.db.versions.get(id);
    return version ? toSummary(version) : null;
  }

  async findActiveVersion(): Promise<VersionSummary | null> {
    const version = [...this.db.versions.values()].find((candidate) => candidate.isActive);
    return version ? toSummary(version) : null;
  }

  async findProfile(profileId: string): Promise<ProfileRef | null> {
    const profile = this.db.profiles.get(profileId);
    return profile ? toProfileRef(profile) : null;
  }

  async findResult(productId: string, methodologyVersionId: string): Promise<StoredResult | null> {
    return this.db.findResult(productId, methodologyVersionId);
  }

  async upsertResult(input: { productId: string; methodologyVersionId: string } & BaseResult): Promise<StoredResult> {
    const key = `${input.productId}|${input.methodologyVersionId}`;
    const existing = this.db.results.get(key);
    const row: StoredResult = {
      id: existing?.id ?? randomUUID(),
      productId: input.productId,
      methodologyVersionId: input.methodologyVersionId,
      findings: input.findings.map((finding) => ({ ...finding })),
      unknowns: [...input.unknowns],
      confidence: input.confidence,
      disclaimer: input.disclaimer,
      classifiedAt: new Date(),
    };
    this.db.results.set(key, row);
    return this.db.findResult(input.productId, input.methodologyVersionId)!;
  }

  resultCount(): number {
    return this.db.results.size;
  }
}

export class FakeMethodologyRepository implements IMethodologyRepository {
  constructor(private readonly db: InMemoryDb) {}

  async findVersion(id: string): Promise<VersionSummary | null> {
    const version = this.db.versions.get(id);
    return version ? toSummary(version) : null;
  }

  async findVersionByNumber(version: number): Promise<VersionSummary | null> {
    const row = [...this.db.versions.values()].find((candidate) => candidate.version === version);
    return row ? toSummary(row) : null;
  }

  async findIngredientByName(name: string): Promise<{ id: string; name: string } | null> {
    return this.db.findIngredientByName(name);
  }

  async createVersion(input: CreateVersionInput): Promise<VersionSummary> {
    const row = this.db.addVersion(input.version, input.name, input.rules.map((rule) => ({ ...rule })));
    return toSummary(row);
  }

  async setActive(versionId: string): Promise<void> {
    this.db.setVersionActive(versionId);
  }
}

export class FakeProductsRepository implements IProductsRepository {
  constructor(private readonly db: InMemoryDb) {}

  async create(name: string, ingredients: string[]): Promise<ProductRecord> {
    const product = this.db.addProduct(name, ingredients);
    return { id: product.id, name: product.name, listedIngredients: [...product.ingredients] };
  }

  async find(id: string): Promise<ProductRecord | null> {
    const product = this.db.products.get(id);
    return product ? { id: product.id, name: product.name, listedIngredients: [...product.ingredients] } : null;
  }

  async list(): Promise<ProductRecord[]> {
    return [...this.db.products.values()].map((product) => ({
      id: product.id,
      name: product.name,
      listedIngredients: [...product.ingredients],
    }));
  }
}

export class FakeProfilesRepository implements IProfilesRepository {
  constructor(private readonly db: InMemoryDb) {}

  async findByName(name: string): Promise<ProfileRef | null> {
    const profile = [...this.db.profiles.values()].find((candidate) => candidate.name === name);
    return profile ? toProfileRef(profile) : null;
  }

  async find(id: string): Promise<ProfileRef | null> {
    const profile = this.db.profiles.get(id);
    return profile ? toProfileRef(profile) : null;
  }

  async list(): Promise<ProfileRef[]> {
    return [...this.db.profiles.values()].map(toProfileRef);
  }

  async create(input: PersistProfileInput): Promise<ProfileRef> {
    const profile = this.db.addProfile(input.name, input.description, input.modifiers.map((modifier) => ({ ...modifier })));
    return toProfileRef(profile);
  }

  async findIngredientByName(name: string): Promise<{ id: string; name: string } | null> {
    return this.db.findIngredientByName(name);
  }
}
