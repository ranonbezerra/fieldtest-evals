# repair1-set

## reasoning

```
Let me analyze the errors:

1. `src/classification/classification.repository.ts(226,19)` and `(229,63)`: Type 'JsonValue' is not assignable to type 'JsonNull | InputJsonValue | undefined'. The issue is that `Prisma.JsonValue` includes `null` but `InputJsonValue` doesn't directly. The fix is to cast `payload` as `Prisma.InputJsonValue` instead of `Prisma.JsonValue`.

2. `src/common/api-error.ts(32,24)`: Property 'getError' does not exist on type 'ArgumentsHost'. In NestJS, `ArgumentsHost` doesn't have `getError()`. The correct method is `host.getError()` — wait, actually it does exist. Let me think again. In NestJS, `ArgumentsHost` has `switchToHttp()`, `switchToWs()`, `switchToRpc()`, and `getError()`. Actually, looking at the NestJS source, `ArgumentsHost` does have `getError()`. But maybe the version being used doesn't expose it directly on the interface. The alternative is to use `ctx.getResponse()` after switching... no wait.

Actually, looking more carefully at NestJS types, `ArgumentsHost` does have `getError()`. But in some versions, the type definitions might not include it. The standard way to get the error from an exception filter is:

```ts
const exception = host.getError();
```

Wait, actually in NestJS, the `ExceptionFilter` interface's `catch` method receives `ArgumentsHost`. And `ArgumentsHost` has a `getError()` method. Let me check if maybe the issue is that the type is declared differently.

Actually, looking at this more carefully - in NestJS 10+, `ArgumentsHost` does have `getError()`. But the compiler is saying it doesn't exist. This could be a version issue. The safe alternative is to get the error from the host differently.

Wait, actually I recall now. In NestJS, the correct API is:
- `host.switchToHttp()` returns `HttpArgumentsHost`
- `host.getError()` returns the error

But `ArgumentsHost` itself... let me think. The `ArgumentsHost` class has:
- `switchToHttp(): HttpArgumentsHost`
- `switchToWs(): WsArgumentsHost`  
- `switchToRpc(): RpcArgumentsHost`
- `getError(): TException`

So `getError()` should be on `ArgumentsHost`. But the compiler says it's not. This might be a TypeScript version or NestJS version mismatch.

The fix would be to either:
- Cast: `(host as any).getError()`
- Or use a different approach

Actually, the simplest fix that the compiler requires: we can get the error by casting or by using the response approach. But the cleanest fix is probably to just declare the parameter type as `any` or to access it differently.

Wait, let me reconsider. The error says `Property 'getError' does not exist on type 'ArgumentsHost'`. The simplest fix that changes exactly what the compiler requires is to not call `host.getError()` but instead get the error some other way.

Actually, in NestJS the standard pattern in exception filters is:

```ts
catch(exception: Exception, host: ArgumentsHost) {
```

Wait no, the `ExceptionFilter` interface is:
```ts
interface ExceptionFilter<TException = unknown> {
  catch(exception: TException, host: ArgumentsHost): any;
}
```

So the exception is passed as the first parameter to `catch`! The method signature is `catch(exception, host)`. So the fix is to use the `exception` parameter directly instead of calling `host.getError()`.

Let me re-read the code:

```ts
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const error = host.getError();
```

The issue is that the method only takes `host` but the `ExceptionFilter` interface defines `catch(exception: TException, host: ArgumentsHost)`. So the fix is to add `exception` as the first parameter:

```ts
catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const error = exception;
```

That's the correct fix. The `ExceptionFilter` interface's `catch` method takes `(exception, host)` not just `(host)`.

3. `test/classification.spec.ts` lines 159, 161, 170, 177, 193, 226, 227, 228: Properties 'ingredients', 'synonyms', 'versions', 'rules', 'profiles' are private and only accessible within class 'InMemoryRepository'.

Looking at the test file, the `seed()` function accesses `repo.ingredients`, `repo.synonyms`, `repo.versions`, `repo.rules`, `repo.profiles` directly. These are declared as `private` in the class.

The fix: change `private` to something accessible. Since the tests need to access these, the simplest fix that the compiler requires is to make them not private. Options:
- Remove `private` (makes them public)
- Change to `public` explicitly
- Use a different access pattern

The simplest fix: remove the `private` keyword from those fields. They become public (the default).

Wait, but the instruction says "Change exactly what the compiler requires." The compiler requires these to be accessible outside the class. The minimal change is to remove `private` from those fields.

Let me look at the class definition:

```ts
class InMemoryRepository implements ClassificationRepositoryPort {
  private readonly products = new Map<string, ProductRow>();
  private readonly productIngredients = new Map<string, string[]>();
  private readonly ingredients: CanonicalIngredientRow[] = [];
  private readonly synonyms: SynonymRow[] = [];
  private readonly versions = new Map<string, MethodologyVersionRow>();
  private readonly rules: RuleRow[] = [];
  private readonly profiles = new Map<string, ProfileRow>();
  readonly results: StoredClassificationRow[] = [];
  private nextId = 1;
```

The fields that need to be accessible: `ingredients`, `synonyms`, `versions`, `rules`, `profiles`.

I should just remove `private` from those five fields. `products`, `productIngredients`, and `nextId` don't need to be accessed externally (they have public methods), so I'll leave them private.

Now let me write the complete files:

1. `src/classification/classification.repository.ts` - fix the JsonValue cast
2. `src/common/api-error.ts` - fix the catch method signature
3. `test/classification.spec.ts` - remove `private` from the five fields

Let me write them out completely.
```

## reply

I've identified three distinct mistakes:

1. **`classification.repository.ts`**: `Prisma.JsonValue` doesn't satisfy `Prisma.InputJsonValue` (it includes `null` directly). Cast to `Prisma.InputJsonValue` instead.
2. **`api-error.ts`**: `ExceptionFilter.catch` takes `(exception, host)` — the code only declares `host` and then calls `host.getError()` which doesn't exist. Use the `exception` parameter.
3. **`classification.spec.ts`**: The `seed()` helper accesses `ingredients`, `synonyms`, `versions`, `rules`, `profiles` outside the class, but they're `private`. Remove `private` from those five fields.

### src/classification/classification.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Domain values as stored in the database (mirror the Prisma enums). */
export type Severity = 'banned' | 'restricted' | 'watch';
export type RuleContext = 'base' | 'pregnancy' | 'child_under_3';
export type SynonymKind = 'synonym' | 'typo';
export type MethodologyVersionStatus = 'draft' | 'published';

export interface ProductRow {
  id: string;
  name: string;
}

export interface CanonicalIngredientRow {
  id: string;
  name: string;
}

export interface SynonymRow {
  id: string;
  ingredientId: string;
  alias: string;
  kind: SynonymKind;
}

export interface MethodologyVersionRow {
  id: string;
  version: number;
  label: string;
  status: MethodologyVersionStatus;
  /** ISO-8601 timestamp, null while the version is a draft. */
  publishedAt: string | null;
}

export interface RuleRow {
  id: string;
  methodologyVersionId: string;
  ingredientId: string;
  context: RuleContext;
  severity: Severity;
  sourceCitation: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  /** 'base' never appears here; it always applies. */
  contexts: RuleContext[];
}

export interface StoredClassificationRow {
  id: string;
  productId: string;
  methodologyVersionId: string;
  profileId: string | null;
  /** The ClassificationResultDto serialized as JSON. */
  payload: unknown;
}

export interface ProductProfilePair {
  productId: string;
  profileId: string | null;
}

export interface UpsertClassificationInput {
  productId: string;
  methodologyVersionId: string;
  profileId: string | null;
  payload: unknown;
}

/**
 * The contract the service depends on. The Prisma-backed implementation lives
 * in this same file; tests provide an in-memory implementation of the port.
 */
export interface ClassificationRepositoryPort {
  getProduct(id: string): Promise<ProductRow | null>;
  getProductIngredients(productId: string): Promise<string[]>;
  listIngredients(): Promise<CanonicalIngredientRow[]>;
  listSynonyms(): Promise<SynonymRow[]>;
  getMethodologyVersion(id: string): Promise<MethodologyVersionRow | null>;
  getActiveMethodologyVersion(): Promise<MethodologyVersionRow | null>;
  listRules(methodologyVersionId: string): Promise<RuleRow[]>;
  getProfile(id: string): Promise<ProfileRow | null>;
  markMethodologyVersionPublished(id: string): Promise<MethodologyVersionRow>;
  upsertClassification(input: UpsertClassificationInput): Promise<StoredClassificationRow>;
  getClassificationsForProduct(productId: string): Promise<StoredClassificationRow[]>;
  getClassification(
    productId: string,
    methodologyVersionId: string,
    profileId: string | null,
  ): Promise<StoredClassificationRow | null>;
  distinctProductProfilePairs(): Promise<ProductProfilePair[]>;
}

function toVersionRow(row: {
  id: string;
  version: number;
  label: string;
  status: MethodologyVersionStatus;
  publishedAt: Date | null;
}): MethodologyVersionRow {
  return {
    id: row.id,
    version: row.version,
    label: row.label,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

function toResultRow(row: {
  id: string;
  productId: string;
  methodologyVersionId: string;
  profileId: string | null;
  payload: unknown;
}): StoredClassificationRow {
  return {
    id: row.id,
    productId: row.productId,
    methodologyVersionId: row.methodologyVersionId,
    profileId: row.profileId,
    payload: row.payload,
  };
}

@Injectable()
export class ClassificationRepository implements ClassificationRepositoryPort {
  private readonly prisma = new PrismaClient();

  async getProduct(id: string): Promise<ProductRow | null> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    return row ? { id: row.id, name: row.name } : null;
  }

  async getProductIngredients(productId: string): Promise<string[]> {
    const rows = await this.prisma.productIngredient.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
    });
    return rows.map((row) => row.rawIncistring);
  }

  async listIngredients(): Promise<CanonicalIngredientRow[]> {
    const rows = await this.prisma.ingredient.findMany();
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async listSynonyms(): Promise<SynonymRow[]> {
    const rows = await this.prisma.ingredientSynonym.findMany();
    return rows.map((row) => ({
      id: row.id,
      ingredientId: row.ingredientId,
      alias: row.alias,
      kind: row.kind,
    }));
  }

  async getMethodologyVersion(id: string): Promise<MethodologyVersionRow | null> {
    const row = await this.prisma.methodologyVersion.findUnique({ where: { id } });
    return row ? toVersionRow(row) : null;
  }

  /** The most recently published version; null when nothing has been published. */
  async getActiveMethodologyVersion(): Promise<MethodologyVersionRow | null> {
    const row = await this.prisma.methodologyVersion.findFirst({
      where: { status: 'published' },
      orderBy: { version: 'desc' },
    });
    return row ? toVersionRow(row) : null;
  }

  async listRules(methodologyVersionId: string): Promise<RuleRow[]> {
    const rows = await this.prisma.rule.findMany({ where: { methodologyVersionId } });
    return rows.map((row) => ({
      id: row.id,
      methodologyVersionId: row.methodologyVersionId,
      ingredientId: row.ingredientId,
      context: row.context,
      severity: row.severity,
      sourceCitation: row.sourceCitation,
    }));
  }

  async getProfile(id: string): Promise<ProfileRow | null> {
    const row = await this.prisma.profile.findUnique({ where: { id } });
    if (!row) return null;
    // Stored as TEXT[] in the database; values are constrained to RuleContext at the write boundary.
    return { id: row.id, name: row.name, contexts: row.contexts as RuleContext[] };
  }

  /** Idempotent: a version that is already published is returned unchanged. */
  async markMethodologyVersionPublished(id: string): Promise<MethodologyVersionRow> {
    const row = await this.prisma.methodologyVersion.findUnique({ where: { id } });
    if (!row) {
      throw new Error(`methodology version not found: ${id}`);
    }
    if (row.status === 'published') {
      return toVersionRow(row);
    }
    const updated = await this.prisma.methodologyVersion.update({
      where: { id },
      data: { status: 'published', publishedAt: new Date() },
    });
    return toVersionRow(updated);
  }

  async upsertClassification(input: UpsertClassificationInput): Promise<StoredClassificationRow> {
    const { productId, methodologyVersionId, profileId, payload } = input;
    // Postgres treats NULLs as distinct inside unique indexes, so the profile-less
    // row is located with an explicit IS NULL match rather than relying on the
    // composite unique index alone.
    const existing = await this.prisma.classificationResult.findFirst({
      where: {
        productId,
        methodologyVersionId,
        ...(profileId === null ? { profileId: null } : { profileId }),
      },
    });
    const jsonPayload = payload as Prisma.InputJsonValue;
    const row = existing
      ? await this.prisma.classificationResult.update({
          where: { id: existing.id },
          data: { payload: jsonPayload },
        })
      : await this.prisma.classificationResult.create({
          data: { productId, methodologyVersionId, profileId, payload: jsonPayload },
        });
    return toResultRow(row);
  }

  async getClassificationsForProduct(productId: string): Promise<StoredClassificationRow[]> {
    const rows = await this.prisma.classificationResult.findMany({
      where: { productId },
      orderBy: { id: 'asc' },
    });
    return rows.map(toResultRow);
  }

  async getClassification(
    productId: string,
    methodologyVersionId: string,
    profileId: string | null,
  ): Promise<StoredClassificationRow | null> {
    const row = await this.prisma.classificationResult.findFirst({
      where: {
        productId,
        methodologyVersionId,
        ...(profileId === null ? { profileId: null } : { profileId }),
      },
    });
    return row ? toResultRow(row) : null;
  }

  async distinctProductProfilePairs(): Promise<ProductProfilePair[]> {
    const rows = await this.prisma.classificationResult.findMany({
      distinct: ['productId', 'profileId'],
      select: { productId: true, profileId: true },
    });
    return rows.map((row) => ({ productId: row.productId, profileId: row.profileId }));
  }
}
```

### src/common/api-error.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Application error carrying the stable snake_case `code` (the contract), a
 * developer-facing message, and structured details (always an object).
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly status: number = HttpStatus.UNPROCESSABLE_ENTITY,
  ) {
    super(message);
  }
}

const HTTP_STATUS_TO_CODE: Record<number, string> = {
  400: 'invalid_input',
  404: 'resource_not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  422: 'unprocessable_entity',
};

/** Shapes every response error into the single `{ error: { code, message, details } }` envelope. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const error = exception;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Unexpected server error.';
    let details: Record<string, unknown> = {};

    if (error instanceof ApiError) {
      status = error.status;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = HTTP_STATUS_TO_CODE[status] ?? 'request_error';
      const body = error.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const nested = (body as { message?: unknown }).message;
        if (typeof nested === 'string') {
          message = nested;
        }
      }
      details = {};
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
```

### test/classification.spec.ts
```ts
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
```
