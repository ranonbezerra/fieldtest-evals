import 'reflect-metadata';
import { ClassificationService } from '../../src/classification/classification.service.js';
import { MethodologyService } from '../../src/methodology/methodology.service.js';
import { ProductsService } from '../../src/products/products.service.js';
import { ProfilesService } from '../../src/profiles/profiles.service.js';
import { INGREDIENTS, METHODOLOGY_VERSIONS, PRODUCTS, PROFILES } from '../../prisma/seed-data.js';
import {
  FakeClassificationRepository,
  FakeMethodologyRepository,
  FakeProductsRepository,
  FakeProfilesRepository,
  InMemoryDb,
} from './in-memory.js';

export interface World {
  db: InMemoryDb;
  classification: ClassificationService;
  methodology: MethodologyService;
  products: ProductsService;
  profiles: ProfilesService;
  classificationRepo: FakeClassificationRepository;
  methodologyRepo: FakeMethodologyRepository;
  versionIds: Record<number, string>;
  profileIds: Record<string, string>;
  productIds: Record<string, string>;
}

/**
 * Builds the full domain (catalog, versions, profiles, products) on in-memory
 * fakes and wires the real services against it, mirroring the Prisma seed.
 */
export async function createWorld(): Promise<World> {
  const db = new InMemoryDb();
  db.seedIngredients(INGREDIENTS);

  const classificationRepo = new FakeClassificationRepository(db);
  const methodologyRepo = new FakeMethodologyRepository(db);
  const productsRepo = new FakeProductsRepository(db);
  const profilesRepo = new FakeProfilesRepository(db);

  const classification = new ClassificationService(classificationRepo);
  const methodology = new MethodologyService(methodologyRepo, classification);
  const products = new ProductsService(productsRepo);
  const profiles = new ProfilesService(profilesRepo);

  const versionIds: Record<number, string> = {};
  for (const seed of METHODOLOGY_VERSIONS) {
    const created = await methodology.create({
      version: seed.version,
      name: seed.name,
      rules: seed.rules.map((rule) => ({
        ingredient: rule.ingredient,
        severity: rule.severity,
        source: rule.source,
        note: rule.note ?? undefined,
      })),
    });
    versionIds[seed.version] = created.id;
  }

  const profileIds: Record<string, string> = {};
  for (const seed of PROFILES) {
    const created = await profiles.create({
      name: seed.name,
      description: seed.description,
      modifiers: seed.modifiers.map((modifier) => ({
        ingredient: modifier.ingredient,
        severity: modifier.severity,
        source: modifier.source,
        note: modifier.note ?? undefined,
      })),
    });
    profileIds[seed.name] = created.id;
  }

  const productIds: Record<string, string> = {};
  for (const seed of PRODUCTS) {
    const created = await products.create({ name: seed.name, ingredients: seed.ingredients });
    productIds[seed.name] = created.id;
  }

  // Establish a published baseline before the tests run.
  await methodology.publish(versionIds[1]);

  return {
    db,
    classification,
    methodology,
    products,
    profiles,
    classificationRepo,
    methodologyRepo,
    versionIds,
    profileIds,
    productIds,
  };
}
