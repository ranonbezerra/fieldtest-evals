# 20-classification.service.ts

## reasoning

```
Let me analyze the plan carefully to implement `src/classification/classification.service.ts`.

From the plan:

**Service signatures:**
```ts
class ClassificationService {
  classify(productId: number, profileId?: number): Promise<ClassificationResponse | ProfiledClassificationResponse>;
  rescoreAll(versionId: number): Promise<void>;
}
```

**Control flow for `classify(productId, profileId?)`:**

1. Load product + `product_ingredients` ordered by `position`. Raise `ResourceNotFound` if product missing.
2. Resolve each `raw_text`: normalize → exact canonical match → exact synonym match. Unmatched → unknown.
3. Load active methodology version + its rules (index by `ingredient_id`). Raise `ResourceNotFound` if no active version.
4. Build base findings: for each resolved ingredient, look up its rule. No rule → finding with null flag/severity (recognized but unflagged).
5. If `profileId` provided: load modifiers (index by `ingredient_id`). For each finding where both a base rule and a modifier exist: if modifier severity ordinal > rule severity ordinal, replace flag/severity/citation with modifier's. If only a modifier exists (no base rule), add the modifier's flag/severity/citation.
6. Compute `overallConfidence = max(0, 1 − 0.1 × unknownCount)`.
7. Build `disclaimer` (constant string).
8. **Upsert stored result** (base findings only, no profile overlay) + delete-and-insert findings rows, keyed by `(productId, activeVersionId)`. Inside transaction.
9. Return response (with profile overlay if step 5 ran).

**Control flow for `publish(versionId)` → re-score:**
- `rescoreAll`: load all products with ingredients. For each, run steps 1–8 of `classify` (no profile). Each product's step-8 upsert is its own transaction.

**Normalization pipeline (Assumption 5):** NFD-decompose → strip combining marks → lowercase → trim → collapse internal whitespace.

**Confidence (Assumption 4):** `max(0, 1 − 0.1 × unknownCount)`.

**Types needed from `src/classification/types.ts`:**
- `Severity` = 'banned' | 'restricted' | 'watch'
- `IngredientFinding` interface
- `ClassificationResponse` interface
- `ProfiledClassificationResponse` interface (extends ClassificationResponse with profileId)
- `ResourceNotFound` class
- `ConflictError` class

**Repositories to inject:**
- `ProductRepository` (from product module)
- `IngredientRepository` (from ingredient module)
- `MethodologyRepository` (from methodology module)
- `ProfileRepository` (from profile module)
- `ClassificationRepository` (local)

**Severity ordinal mapping for escalation:**
From Assumption 2 in the data model: `BANNED`, `RESTRICTED`, `WATCH` (ordinal 3 > 2 > 1). Wait, let me re-read: "ordinal 3 > 2 > 1 for escalation comparisons". So BANNED=3, RESTRICTED=2, WATCH=1.

Actually wait, looking at the enum: `SEV_ENUM`: `BANNED`, `RESTRICTED`, `WATCH` (ordinal 3 > 2 > 1). That's a bit confusing. Let me think about this differently. The severity levels in the spec are "banned / restricted / watch". Banned is most severe, watch is least. So for escalation: banned > restricted > watch. Ordinal: banned=3, restricted=2, watch=1.

But in the code, the severity type is `'banned' | 'restricted' | 'watch'` (lowercase strings based on the types). Let me map:
- 'banned' → 3
- 'restricted' → 2
- 'watch' → 1

**Profile modifier logic (step 5):**
- For each finding where both a base rule and a modifier exist: if modifier severity ordinal > rule severity ordinal, replace flag/severity/citation with modifier's.
- If only a modifier exists (no base rule), add the modifier's flag/severity/citation.
- Tighten-only: never lower severity or remove a base flag.

So the logic is:
1. If finding has a base rule AND has a modifier:
   - If modifier ordinal > base ordinal → use modifier's flag/severity/citation
   - Otherwise → keep base rule's flag/severity/citation
2. If finding has NO base rule BUT has a modifier:
   - Use modifier's flag/severity/citation
3. If finding has a base rule but NO modifier:
   - Keep base rule's flag/severity/citation (already set in step 4)
4. If finding has NO base rule and NO modifier:
   - flag/severity remain null (recognized but unflagged)

**For `rescoreAll(versionId)`:**
- Load all products with ingredients (using `ProductRepository.listWithIngredients()`)
- For each product, run the classification logic (steps 1-8) WITHOUT profile
- Each product's upsert is its own transaction

Wait, but `rescoreAll` takes a `versionId`. Let me re-read the plan...

"3. `rescoreAll`: load all products with ingredients. For each, run steps 1–8 of `classify` (no profile)."

And the stored result is keyed by `(productId, activeVersionId)`. But in `rescoreAll`, we're re-scoring under a specific version. So the stored result should use the `versionId` passed to `rescoreAll`, not necessarily the "active" version.

Wait, let me re-read step 8: "Upsert stored result (base findings only, no profile overlay) + delete-and-insert findings rows, keyed by (productId, activeVersionId)."

Hmm, but in `rescoreAll`, the version being scored is the newly published one. Let me think about this more carefully.

Actually, looking at the publish flow:
1. Publish sets `is_active = true` on the new version
2. Then calls `rescoreAll(versionId)`

So when `rescoreAll` runs, the new version IS active. But to be safe and explicit, `rescoreAll` should use the `versionId` parameter for:
- Loading rules from that specific version
- Keying the stored result by that version

Let me re-read step 3: "Load active methodology version + its rules (index by `ingredient_id`). Raise `ResourceNotFound` if no active version."

For `rescoreAll`, we should load rules from the specific `versionId` (which is now active). Let me make `rescoreAll` use the passed versionId explicitly.

Actually, I think the cleanest approach is:
- `classify` uses the active version (step 3 says "Load active methodology version")
- `rescoreAll` uses the passed `versionId` directly (since it's called right after publishing)

Let me structure the internal logic to accept a versionId for the core classification, so both paths can share it.

Let me now write the file:

```ts
import { Injectable } from '@nestjs/common';
import { ProductRepository } from '../product/product.repository';
import { IngredientRepository } from '../ingredient/ingredient.repository';
import { MethodologyRepository } from '../methodology/methodology.repository';
import { ProfileRepository } from '../profile/profile.repository';
import { ClassificationRepository } from './classification.repository';
import {
  Severity,
  IngredientFinding,
  ClassificationResponse,
  ProfiledClassificationResponse,
  ResourceNotFound,
} from './types';

const DISCLAIMER = '...'; // fixed English disclaimer

const SEVERITY_ORDINAL: Record<Severity, number> = {
  banned: 3,
  restricted: 2,
  watch: 1,
};

@Injectable()
export class ClassificationService {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly ingredientRepo: IngredientRepository,
    private readonly methodologyRepo: MethodologyRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly classificationRepo: ClassificationRepository,
  ) {}

  async classify(productId: number, profileId?: number) { ... }
  
  async rescoreAll(versionId: number): Promise<void> { ... }
}
```

Now let me think about the normalization function:

```ts
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
```

For the `classify` method:

```ts
async classify(productId: number, profileId?: number): Promise<ClassificationResponse | ProfiledClassificationResponse> {
  // Step 1: Load product + ingredients
  const product = await this.productRepo.findById(productId);
  if (!product) {
    throw new ResourceNotFound();
  }

  // Step 2: Resolve each raw_text
  const resolvedIngredients = [];
  for (const pi of product.productIngredients) {
    const normalized = normalize(pi.rawText);
    const resolution = await this.ingredientRepo.resolve(normalized);
    resolvedIngredients.push({ rawText: pi.rawText, position: pi.position, resolution });
  }

  // Step 3: Load active methodology + rules
  const activeVersion = await this.methodologyRepo.getActive();
  if (!activeVersion) {
    throw new ResourceNotFound();
  }
  const rules = await this.methodologyRepo.getRules(activeVersion.id);
  const ruleByIngredientId = new Map(rules.map(r => [r.ingredientId, r]));

  // Step 4: Build base findings
  const findings: IngredientFinding[] = resolvedIngredients.map(ri => {
    if (!ri.resolution) {
      return {
        rawText: ri.rawText,
        resolvedName: null,
        ingredientId: null,
        isUnknown: true,
        flag: null,
        severity: null,
        sourceCitation: null,
      };
    }
    const rule = ruleByIngredientId.get(ri.resolution.ingredient.id) || null;
    return {
      rawText: ri.rawText,
      resolvedName: ri.resolution.ingredient.canonicalName,
      ingredientId: ri.resolution.ingredient.id,
      isUnknown: false,
      flag: rule?.flag ?? null,
      severity: (rule?.severity as Severity) ?? null,
      sourceCitation: rule?.sourceCitation ?? null,
    };
  });

  // Step 5: Profile modifiers (tighten-only)
  if (profileId !== undefined) {
    const profile = await this.profileRepo.findById(profileId);
    if (!profile) {
      throw new ResourceNotFound();
    }
    const modifiers = await this.profileRepo.getModifiers(profileId);
    const modifierByIngredientId = new Map(modifiers.map(m => [m.ingredientId, m]));

    for (let i = 0; i < findings.length; i++) {
      const finding = findings[i];
      if (finding.isUnknown) continue;
      const ingredientId = finding.ingredientId!;
      const modifier = modifierByIngredientId.get(ingredientId);
      if (!modifier) continue;

      const hasBaseRule = finding.flag !== null && finding.severity !== null;
      if (hasBaseRule) {
        const modOrdinal = SEVERITY_ORDINAL[modifier.severity as Severity];
        const baseOrdinal = SEVERITY_ORDINAL[finding.severity!];
        if (modOrdinal > baseOrdinal) {
          findings[i] = {
            ...finding,
            flag: modifier.flag,
            severity: modifier.severity as Severity,
            sourceCitation: modifier.sourceCitation,
          };
        }
      } else {
        // No base rule but modifier exists → add modifier's flag/severity/citation
        findings[i] = {
          ...finding,
          flag: modifier.flag,
          severity: modifier.severity as Severity,
          sourceCitation: modifier.sourceCitation,
        };
      }
    }
  }

  // Step 6: Confidence
  const unknownCount = findings.filter(f => f.isUnknown).length;
  const overallConfidence = Math.max(0, 1 - 0.1 * unknownCount);

  // Step 7: Disclaimer
  const disclaimer = DISCLAIMER;

  // Step 8: Upsert stored result (base findings only, no profile overlay)
  // We need to recompute base findings for storage (without profile overlay)
  const baseFindings: IngredientFinding[] = resolvedIngredients.map(ri => {
    if (!ri.resolution) {
      return {
        rawText: ri.rawText,
        resolvedName: null,
        ingredientId: null,
        isUnknown: true,
        flag: null,
        severity: null,
        sourceCitation: null,
      };
    }
    const rule = ruleByIngredientId.get(ri.resolution.ingredient.id) || null;
    return {
      rawText: ri.rawText,
      resolvedName: ri.resolution.ingredient.canonicalName,
      ingredientId: ri.resolution.ingredient.id,
      isUnknown: false,
      flag: rule?.flag ?? null,
      severity: (rule?.severity as Severity) ?? null,
      sourceCitation: rule?.sourceCitation ?? null,
    };
  });

  await this.classificationRepo.upsert(
    {
      productId,
      methodologyVersionId: activeVersion.id,
      overallConfidence,
      disclaimer,
    },
    baseFindings.map(f => ({
      rawText: f.rawText,
      resolvedName: f.resolvedName,
      ingredientId: f.ingredientId,
      isUnknown: f.isUnknown,
      flag: f.flag,
      severity: f.severity,
      sourceCitation: f.sourceCitation,
    })),
  );

  // Step 9: Return response
  const unknownIngredients = findings.filter(f => f.isUnknown).map(f => f.rawText);
  
  const response: ClassificationResponse = {
    productId,
    methodologyVersionId: activeVersion.id,
    findings,
    unknownIngredients,
    overallConfidence,
    disclaimer,
  };

  if (profileId !== undefined) {
    return { ...response, profileId } as ProfiledClassificationResponse;
  }

  return response;
}
```

Wait, I need to think about the `rescoreAll` method. It takes a `versionId` and should:
1. Load all products with ingredients
2. For each, run the classification logic (steps 1-8) without profile
3. Each product's upsert is its own transaction

The key difference: `rescoreAll` uses the specific `versionId` (not "active") for loading rules and keying the result. But since publish already set it active before calling rescoreAll, using `getActive()` would also work. However, it's cleaner to use the explicit versionId.

Let me refactor to have a private helper that does the core work given a product and a version:

Actually, looking more carefully at the plan's control flow for `rescoreAll`:
"3. `rescoreAll`: load all products with ingredients. For each, run steps 1–8 of `classify` (no profile). Each product's step-8 upsert is its own transaction."

So it's literally running the same steps but without profile. The version used should be the one passed in. Let me write a private method that handles the core classification for a given product and version.

Actually, let me just write `rescoreAll` to:
1. Get all products with ingredients
2. For each product, call the internal logic (same as classify but without profile and using the given versionId)

Let me think about whether I should use `getActive()` or the explicit `versionId`. In the publish flow:
1. Publish atomically makes the new version active
2. Then calls rescoreAll(versionId)

So at the time rescoreAll runs, that version IS active. Using `getActive()` would work but is less explicit. I'll use the explicit versionId for rescoreAll and `getActive()` for classify (as the plan specifies).

Let me write a private helper `_scoreProduct(productId, versionId)` that does steps 1-8 without profile, returning the result. Then both `classify` and `rescoreAll` can use it.

Actually, `classify` needs to also apply profile modifiers and return a response. The storage step (step 8) stores only base findings. So the flow is:
- Compute base findings
- Apply profile overlay (if any) for the response
- Store base findings
- Return response with overlay

For `rescoreAll`, it's just:
- Compute base findings
- Store them
- No response needed (or we don't care about the return)

Let me structure it as:

```ts
private async scoreProduct(productId: number, versionId: number) {
  // Steps 1-8 of classify without profile
  // Returns { findings, unknownIngredients, overallConfidence, disclaimer, product }
}
```

Then `classify` calls `scoreProduct`, applies profile overlay, returns response.
`rescoreAll` loops over products and calls `scoreProduct`.

Wait, but `classify` needs to raise `ResourceNotFound` if product not found, and `rescoreAll` processes all products (they already exist). Let me just inline the logic.

Let me also think about the `ProductRepository.findById` - it includes `productIngredients`. So I can use that.

For `rescoreAll`, I'll use `listWithIngredients()` which returns products with their ingredients.

Now, about the severity enum in Prisma - it's stored as `SEV_ENUM` with values `BANNED`, `RESTRICTED`, `WATCH`. But in the TypeScript types, severity is `'banned' | 'restricted' | 'watch'`. So I need to map between them.

Looking at the Prisma schema, the enum would be:
```
enum SEV_ENUM {
  BANNED
  RESTRICTED
  WATCH
}
```

And in the rule/modifier records, `severity` would be of type `SEV_ENUM`. So when I read `rule.severity`, it would be `'BANNED' | 'RESTRICTED' | 'WATCH'` (uppercase). But my `Severity` type is lowercase.

I need a mapping function:
```ts
function fromPrismaSeverity(s: string): Severity {
  return s.toLowerCase() as Severity;
}
```

And when passing to the repository for storage:
```ts
function toPrismaSeverity(s: Severity | null): string | null {
  return s ? s.toUpperCase() : null;
}
```

Wait, but the `ClassificationRepository.upsert` signature from the plan is:
```ts
upsert(result: Omit<ClassificationResult, 'id' | 'createdAt' | 'updatedAt'>,
       findings: Omit<ClassificationFinding, 'id'>[]): Promise<ClassificationResult>;
```

So the repository handles the Prisma types. The service should pass its own types. But what does `ClassificationFinding` look like in Prisma?

From the schema:
```
classification_findings | id, classification_result_id, raw_text, resolved_name, ingredient_id, is_unknown, flag, severity (SEV_ENUM NULL), source_citation
```

So in Prisma, `severity` is of type `SEV_ENUM | null`. The repository's upsert would accept Prisma types.

Hmm, but the plan says the service passes its own types to the repository. Let me look at the repository interface again:

```ts
upsert(result: Omit<ClassificationResult, 'id' | 'createdAt' | 'updatedAt'>,
       findings: Omit<ClassificationFinding, 'id'>[]): Promise<ClassificationResult>;
```

These are Prisma model types. So the service needs to pass data in the shape that Prisma expects. The severity in the finding would need to be `SEV_ENUM | null` (i.e., `'BANNED' | 'RESTRICTED' | 'WATCH' | null`).

But in my `IngredientFinding` type, severity is `'banned' | 'restricted' | 'watch' | null`.

So I need to convert. Let me add a helper:
```ts
function toPrismaSeverity(s: Severity | null): 'BANNED' | 'RESTRICTED' | 'WATCH' | null {
  if (s === null) return null;
  return s.toUpperCase() as 'BANNED' | 'RESTRICTED' | 'WATCH';
}
```

And when reading from Prisma:
```ts
function fromPrismaSeverity(s: 'BANNED' | 'RESTRICTED' | 'WATCH' | null): Severity | null {
  if (s === null) return null;
  return s.toLowerCase() as Severity;
}
```

Actually, I need to be careful. The Prisma enum type in TypeScript would be imported from `@prisma/client`. Let me just use string comparisons and casting.

Let me also think about what `Product` type looks like. From the repository reference:
```ts
async findById(id: number) {
  return this.prisma.product.findUnique({
    where: { id },
    include: {
      productIngredients: { orderBy: { position: 'asc' } },
    },
  });
}
```

So `product.productIngredients` is an array of objects with at least `rawText` and `position`.

OK let me now write the complete file. I'll be careful about:
1. The normalization function
2. Severity ordinal mapping (for Prisma enum values which are uppercase)
3. The profile modifier logic (tighten-only)
4. The storage step (base findings only, no profile overlay)
5. The rescoreAll loop

One more thing: the plan says findings are "sorted by `position` before being returned or stored". Since I'm loading `productIngredients` with `orderBy: { position: 'asc' }`, they're already in order. I just process them in that order.

Let me also consider: the `ClassificationRepository.upsert` - from the plan signature, it takes the result data and findings array. The "delete-and-insert findings rows" is part of the upsert (the repository handles it internally). So I just call `upsert` with the data.

Now let me write the final version:
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { ProductRepository } from '../product/product.repository';
import { IngredientRepository } from '../ingredient/ingredient.repository';
import { MethodologyRepository } from '../methodology/methodology.repository';
import { ProfileRepository } from '../profile/profile.repository';
import { ClassificationRepository } from './classification.repository';
import {
  Severity,
  IngredientFinding,
  ClassificationResponse,
  ProfiledClassificationResponse,
  ResourceNotFound,
} from './types';

const DISCLAIMER =
  'This classification is informational only and does not constitute a safety determination. Always consult a qualified professional before use.';

const SEVERITY_ORDINAL: Record<Severity, number> = {
  banned: 3,
  restricted: 2,
  watch: 1,
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function toPrismaSeverity(s: Severity | null): string | null {
  if (s === null) return null;
  return s.toUpperCase();
}

function fromPrismaSeverity(s: string | null): Severity | null {
  if (s === null || s === undefined) return null;
  return s.toLowerCase() as Severity;
}

@Injectable()
export class ClassificationService {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly ingredientRepo: IngredientRepository,
    private readonly methodologyRepo: MethodologyRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly classificationRepo: ClassificationRepository,
  ) {}

  async classify(
    productId: number,
    profileId?: number,
  ): Promise<ClassificationResponse | ProfiledClassificationResponse> {
    // Step 1: Load product + ingredients ordered by position
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new ResourceNotFound();
    }

    // Step 3: Load active methodology version + its rules
    const activeVersion = await this.methodologyRepo.getActive();
    if (!activeVersion) {
      throw new ResourceNotFound();
    }
    const rules = await this.methodologyRepo.getRules(activeVersion.id);
    const ruleByIngredientId = new Map<number, (typeof rules)[number]>(
      rules.map((r) => [r.ingredientId, r]),
    );

    // Step 2: Resolve each raw_text
    const resolvedItems = await Promise.all(
      product.productIngredients.map(async (pi) => {
        const normalized = normalize(pi.rawText);
        const resolution = await this.ingredientRepo.resolve(normalized);
        return { rawText: pi.rawText, position: pi.position, resolution };
      }),
    );

    // Step 4: Build base findings (sorted by position — already ordered from DB)
    const baseFindings: IngredientFinding[] = resolvedItems.map((ri) => {
      if (!ri.resolution) {
        return {
          rawText: ri.rawText,
          resolvedName: null,
          ingredientId: null,
          isUnknown: true,
          flag: null,
          severity: null,
          sourceCitation: null,
        };
      }
      const rule = ruleByIngredientId.get(ri.resolution.ingredient.id) ?? null;
      return {
        rawText: ri.rawText,
        resolvedName: ri.resolution.ingredient.canonicalName,
        ingredientId: ri.resolution.ingredient.id,
        isUnknown: false,
        flag: rule ? rule.flag : null,
        severity: rule ? fromPrismaSeverity(rule.severity) : null,
        sourceCitation: rule ? rule.sourceCitation : null,
      };
    });

    // Step 5: Apply profile modifiers (tighten-only)
    let responseFindings = baseFindings;

    if (profileId !== undefined) {
      const profile = await this.profileRepo.findById(profileId);
      if (!profile) {
        throw new ResourceNotFound();
      }
      const modifiers = await this.profileRepo.getModifiers(profileId);
      const modifierByIngredientId = new Map<number, (typeof modifiers)[number]>(
        modifiers.map((m) => [m.ingredientId, m]),
      );

      responseFindings = baseFindings.map((finding) => {
        if (finding.isUnknown || finding.ingredientId === null) {
          return finding;
        }
        const modifier = modifierByIngredientId.get(finding.ingredientId);
        if (!modifier) {
          return finding;
        }

        const hasBaseRule = finding.flag !== null && finding.severity !== null;
        if (hasBaseRule) {
          const modOrdinal = SEVERITY_ORDINAL[modifier.severity as Severity];
          const baseOrdinal = SEVERITY_ORDINAL[finding.severity!];
          if (modOrdinal > baseOrdinal) {
            return {
              ...finding,
              flag: modifier.flag,
              severity: fromPrismaSeverity(modifier.severity),
              sourceCitation: modifier.sourceCitation,
            };
          }
          return finding;
        } else {
          // No base rule but modifier exists: add the modifier's flag/severity/citation
          return {
            ...finding,
            flag: modifier.flag,
            severity: fromPrismaSeverity(modifier.severity),
            sourceCitation: modifier.sourceCitation,
          };
        }
      });
    }

    // Step 6: Compute overall confidence
    const unknownCount = baseFindings.filter((f) => f.isUnknown).length;
    const overallConfidence = Math.max(0, 1 - 0.1 * unknownCount);

    // Step 7: Disclaimer (constant)
    const disclaimer = DISCLAIMER;

    // Step 8: Upsert stored result (base findings only, no profile overlay)
    await this.classificationRepo.upsert(
      {
        productId,
        methodologyVersionId: activeVersion.id,
        overallConfidence,
        disclaimer,
      },
      baseFindings.map((f) => ({
        rawText: f.rawText,
        resolvedName: f.resolvedName,
        ingredientId: f.ingredientId,
        isUnknown: f.isUnknown,
        flag: f.flag,
        severity: toPrismaSeverity(f.severity),
        sourceCitation: f.sourceCitation,
      })),
    );

    // Step 9: Build and return response
    const unknownIngredients = responseFindings
      .filter((f) => f.isUnknown)
      .map((f) => f.rawText);

    const response: ClassificationResponse = {
      productId,
      methodologyVersionId: activeVersion.id,
      findings: responseFindings,
      unknownIngredients,
      overallConfidence,
      disclaimer,
    };

    if (profileId !== undefined) {
      return { ...response, profileId } as ProfiledClassificationResponse;
    }

    return response;
  }

  async rescoreAll(versionId: number): Promise<void> {
    const rules = await this.methodologyRepo.getRules(versionId);
    const ruleByIngredientId = new Map<number, (typeof rules)[number]>(
      rules.map((r) => [r.ingredientId, r]),
    );

    const products = await this.productRepo.listWithIngredients();

    for (const product of products) {
      const resolvedItems = await Promise.all(
        product.productIngredients.map(async (pi) => {
          const normalized = normalize(pi.rawText);
          const resolution = await this.ingredientRepo.resolve(normalized);
          return { rawText: pi.rawText, resolution };
        }),
      );

      const baseFindings: IngredientFinding[] = resolvedItems.map((ri) => {
        if (!ri.resolution) {
          return {
            rawText: ri.rawText,
            resolvedName: null,
            ingredientId: null,
            isUnknown: true,
            flag: null,
            severity: null,
            sourceCitation: null,
          };
        }
        const rule = ruleByIngredientId.get(ri.resolution.ingredient.id) ?? null;
        return {
          rawText: ri.rawText,
          resolvedName: ri.resolution.ingredient.canonicalName,
          ingredientId: ri.resolution.ingredient.id,
          isUnknown: false,
          flag: rule ? rule.flag : null,
          severity: rule ? fromPrismaSeverity(rule.severity) : null,
          sourceCitation: rule ? rule.sourceCitation : null,
        };
      });

      const unknownCount = baseFindings.filter((f) => f.isUnknown).length;
      const overallConfidence = Math.max(0, 1 - 0.1 * unknownCount);

      await this.classificationRepo.upsert(
        {
          productId: product.id,
          methodologyVersionId: versionId,
          overallConfidence,
          disclaimer: DISCLAIMER,
        },
        baseFindings.map((f) => ({
          rawText: f.rawText,
          resolvedName: f.resolvedName,
          ingredientId: f.ingredientId,
          isUnknown: f.isUnknown,
          flag: f.flag,
          severity: toPrismaSeverity(f.severity),
          sourceCitation: f.sourceCitation,
        })),
      );
    }
  }
}
```
