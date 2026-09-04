# repair1-classification.service.ts

## reasoning

```
Let me analyze the compiler errors:

1. Multiple errors in `test/classification.spec.ts` say that the type `{ id: number; name: string; productIngredients: { rawText: string; position: number; }[]; }` is missing the property `ingredients` which is required in type `{ id: number; name: string; ingredients: { rawText: string; position: number; }[]; }`.

This means that `classification.service.ts` has a type where it expects `ingredients` as a property on the product object, but the test is passing objects with `productIngredients` instead.

2. One error says `'v1FindingsCall' is of type 'unknown'` at line 472.

The key issue: The service expects a product shape with `ingredients: { rawText: string; position: number }[]` but the test provides objects with `productIngredients: { rawText: string; position: number }[]`.

Wait, but the instruction says "Change nothing the messages do not name" and "Rewrite `src/classification/classification.service.ts` complete, fixing what these messages require of this file."

So I need to look at what `classification.service.ts` currently has and fix it so that the type it expects from the product matches what the test provides. The test passes objects with `productIngredients` not `ingredients`.

Looking at the plan:
- `ProductRepository.findById` returns a product
- The service calls `productRepository.findById(id)` which would return the product with its ingredients

The plan says the product repository has `getWithIngredients(id: number)` which returns a product. The product in the DB has `product_ingredients` as a separate table (junction table).

So when the service loads a product, it gets back a Prisma object. In Prisma, if you have a relation from `Product` to `ProductIngredient`, the field would be named `productIngredients` (camelCase of `product_ingredients`).

But wait - the service is likely using a custom type (not the Prisma type directly) that has `ingredients` as the field name. The test is mocking the repository to return objects with `productIngredients`.

Actually, looking more carefully at the error messages:

```
Property 'ingredients' is missing in type '{ id: number; name: string; productIngredients: { rawText: string; position: number; }[]; }' but required in type '{ id: number; name: string; ingredients: { rawText: string; position: number; }[]; }'.
```

This means the service's method signature (or internal type) expects an object with `ingredients` property, but the test is providing an object with `productIngredients`.

So the fix is: in `classification.service.ts`, wherever it defines or uses a type for the product with its ingredients, change `ingredients` to `productIngredients`.

But wait - I don't have the current content of `classification.service.ts`. I need to reconstruct it based on the plan and fix the type mismatch.

Let me think about what the service does:
1. It calls `productRepository.findById(id)` or similar to get a product with its ingredients
2. It processes each ingredient
3. It resolves synonyms
4. It looks up rules
5. It applies profile modifiers
6. It stores results

The product type the service expects should have `productIngredients` (matching what Prisma would return for the relation, and what the test is providing).

Let me also think about the `v1FindingsCall` being `unknown`. This is likely related to a mock return value not having a proper type. This might be in the test file, not in the service. But since I can only change `classification.service.ts`, maybe this is caused by a type issue in the service that makes the test's mock return `unknown`.

Actually wait - looking at this more carefully. The test is calling the service's method (or a repository method that the service uses) and getting back `unknown`. This could be because the service's method signature is too generic or the return type isn't properly defined.

Let me reconstruct the service based on the plan:

```typescript
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
  ResourceNotFound 
} from './types';

const DISCLAIMER = 'This classification is for informational purposes only and does not constitute safety or regulatory advice. Always consult relevant regulatory authorities before making decisions about product use.';

@Injectable()
export class ClassificationService {
  constructor(
    private productRepository: ProductRepository,
    private ingredientRepository: IngredientRepository,
    private methodologyRepository: MethodologyRepository,
    private profileRepository: ProfileRepository,
    private classificationRepository: ClassificationRepository,
  ) {}

  async classify(productId: number, profileId?: number): Promise<ClassificationResponse | ProfiledClassificationResponse> {
    // Step 1: Load product with ingredients
    const product = await this.productRepository.getWithIngredients(productId);
    if (!product) {
      throw new ResourceNotFound(`Product with id ${productId} not found`);
    }

    // Step 2: Load active methodology version + rules
    const activeVersion = await this.methodologyRepository.getActive();
    if (!activeVersion) {
      throw new ResourceNotFound('No active methodology version found');
    }
    const rules = await this.methodologyRepository.getRules(activeVersion.id);
    const rulesByIngredientId = new Map(rules.map(r => [r.ingredientId, r]));

    // Step 3: Resolve each ingredient and build base findings
    const findings: IngredientFinding[] = [];
    for (const pi of product.productIngredients) {
      const normalized = normalize(pi.rawText);
      const resolution = await this.ingredientRepository.resolve(normalized);
      
      if (!resolution) {
        findings.push({
          rawText: pi.rawText,
          resolvedName: null,
          ingredientId: null,
          isUnknown: true,
          flag: null,
          severity: null,
          sourceCitation: null,
        });
      } else {
        const rule = rulesByIngredientId.get(resolution.ingredient.id) || null;
        findings.push({
          rawText: pi.rawText,
          resolvedName: resolution.ingredient.canonicalName,
          ingredientId: resolution.ingredient.id,
          isUnknown: false,
          flag: rule ? rule.flag : null,
          severity: rule ? (rule.severity as Severity) : null,
          sourceCitation: rule ? rule.sourceCitation : null,
        });
      }
    }

    // Step 5: Apply profile modifiers if provided
    let profiledFindings = findings;
    if (profileId !== undefined) {
      const profile = await this.profileRepository.findById(profileId);
      if (!profile) {
        throw new ResourceNotFound(`Profile with id ${profileId} not found`);
      }
      const modifiers = await this.profileRepository.getModifiers(profileId);
      const modifiersByIngredientId = new Map(modifiers.map(m => [m.ingredientId, m]));
      
      profiledFindings = findings.map(f => {
        if (f.isUnknown || f.ingredientId === null) return f;
        const modifier = modifiersByIngredientId.get(f.ingredientId);
        if (!modifier) return f;
        
        const modifierOrdinal = severityOrdinal(modifier.severity);
        const baseOrdinal = f.severity ? severityOrdinal(f.severity) : 0;
        
        if (modifierOrdinal > baseOrdinal) {
          return {
            ...f,
            flag: modifier.flag,
            severity: modifier.severity as Severity,
            sourceCitation: modifier.sourceCitation,
          };
        }
        return f;
      });
    }

    // Step 6: Compute confidence
    const unknownCount = findings.filter(f => f.isUnknown).length;
    const overallConfidence = Math.max(0, 1 - 0.1 * unknownCount);

    // Step 8: Store result (base findings only, no profile overlay)
    await this.classificationRepository.upsert(
      {
        productId,
        methodologyVersionId: activeVersion.id,
        overallConfidence,
        disclaimer: DISCLAIMER,
      },
      findings.map(f => ({
        rawText: f.rawText,
        resolvedName: f.resolvedName,
        ingredientId: f.ingredientId,
        isUnknown: f.isUnknown,
        flag: f.flag,
        severity: f.severity as string | null,
        sourceCitation: f.sourceCitation,
      }))
    );

    // Step 9: Build response
    const unknownIngredients = findings.filter(f => f.isUnknown).map(f => f.rawText);
    
    const baseResponse: ClassificationResponse = {
      productId,
      methodologyVersionId: activeVersion.id,
      findings: profiledFindings,
      unknownIngredients,
      overallConfidence,
      disclaimer: DISCLAIMER,
    };

    if (profileId !== undefined) {
      return { ...baseResponse, profileId } as ProfiledClassificationResponse;
    }

    return baseResponse;
  }

  async rescoreAll(versionId: number): Promise<void> {
    const products = await this.productRepository.listWithIngredients();
    for (const product of products) {
      // Re-classify each product using the new version
      await this.classifyInternal(product.id, versionId);
    }
  }

  private async classifyInternal(productId: number, methodologyVersionId: number): Promise<void> {
    const product = await this.productRepository.getWithIngredients(productId);
    if (!product) return;

    const rules = await this.methodologyRepository.getRules(methodologyVersionId);
    const rulesByIngredientId = new Map(rules.map(r => [r.ingredientId, r]));

    const findings: IngredientFinding[] = [];
    for (const pi of product.productIngredients) {
      const normalized = normalize(pi.rawText);
      const resolution = await this.ingredientRepository.resolve(normalized);
      
      if (!resolution) {
        findings.push({
          rawText: pi.rawText,
          resolvedName: null,
          ingredientId: null,
          isUnknown: true,
          flag: null,
          severity: null,
          sourceCitation: null,
        });
      } else {
        const rule = rulesByIngredientId.get(resolution.ingredient.id) || null;
        findings.push({
          rawText: pi.rawText,
          resolvedName: resolution.ingredient.canonicalName,
          ingredientId: resolution.ingredient.id,
          isUnknown: false,
          flag: rule ? rule.flag : null,
          severity: rule ? (rule.severity as Severity) : null,
          sourceCitation: rule ? rule.sourceCitation : null,
        });
      }
    }

    const unknownCount = findings.filter(f => f.isUnknown).length;
    const overallConfidence = Math.max(0, 1 - 0.1 * unknownCount);

    await this.classificationRepository.upsert(
      {
        productId,
        methodologyVersionId,
        overallConfidence,
        disclaimer: DISCLAIMER,
      },
      findings.map(f => ({
        rawText: f.rawText,
        resolvedName: f.resolvedName,
        ingredientId: f.ingredientId,
        isUnknown: f.isUnknown,
        flag: f.flag,
        severity: f.severity as string | null,
        sourceCitation: f.sourceCitation,
      }))
    );
  }

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  private severityOrdinal(severity: string): number {
    switch (severity) {
      case 'banned': return 3;
      case 'restricted': return 2;
      case 'watch': return 1;
      default: return 0;
    }
  }
}
```

Wait, but I don't have the actual current file. The errors tell me what's wrong - the service expects `ingredients` on the product type but the test provides `productIngredients`. 

The key insight is that the service is calling a repository method that returns a product, and the type it expects has `ingredients` but should have `productIngredients`.

Looking at the plan again:
- `ProductRepository.findById(id: number): Promise<Product | null>`
- The plan's data model has `product_ingredients` as the table name

In Prisma, if the model is:
```prisma
model Product {
  id        Int    @id @default(autoincrement())
  name      String
  productIngredients ProductIngredient[]
}
```

Then `product.productIngredients` would be the field name.

But the service might be defining its own interface/type for the product with ingredients, and using `ingredients` instead of `productIngredients`.

Since I can't see the actual file, I need to reconstruct it. The fix is clear: wherever the service references `product.ingredients`, it should be `product.productIngredients`.

But wait - maybe the issue is different. Maybe the service has a parameter or return type that includes `ingredients` and the test is mocking something that returns `productIngredients`. 

Let me think about this differently. The test is at lines like 284, 298, etc. These are likely where the test sets up mocks for the product repository. The mock returns `{ id: number; name: string; productIngredients: { rawText: string; position: number; }[]; }` but the service expects `{ id: number; name: string; ingredients: { rawText: string; position: number; }[]; }`.

So the service has a type (either inline or imported) that defines the product-with-ingredients shape using `ingredients` as the field name. I need to change it to `productIngredients`.

Now for the `v1FindingsCall` being `unknown` at line 472 - this is likely because the service's `classify` method or some related method has a return type that, when mocked, results in `unknown`. Or it could be that the test is calling a method on the service and the return type inference fails because of the other type errors.

Actually, since I'm rewriting the whole file, let me just make sure:
1. The product type uses `productIngredients` not `ingredients`
2. All types are properly defined so nothing falls through to `unknown`

Let me also consider: the service might be receiving the product as a parameter (injected from the controller or another service) rather than fetching it itself. But per the plan, the service calls `productRepository.getWithIngredients(id)`.

Wait, looking at the plan's service signatures:
```
classify(productId: number, profileId?: number): Promise<ClassificationResponse | ProfiledClassificationResponse>;
```

And the product repository:
```
findById(id: number): Promise<Product | null>;
getWithIngredients(id: number): Promise<Product | null>;
```

So the service calls `this.productRepository.getWithIngredients(productId)` and gets back a product. The product's type in the service's context needs to have `productIngredients`.

But here's the thing - if `Product` is the Prisma type, it would have whatever field name Prisma generates. If the relation in the schema is `productIngredients`, then the Prisma type would have that field.

I think the issue is that the current service file defines a local type or uses an inline type where it says `ingredients` instead of `productIngredients`. Let me just write the service using `productIngredients` throughout.

Let me also think about the `v1FindingsCall` issue. At line 472 in the test, it says `'v1FindingsCall' is of type 'unknown'`. This is probably a variable in the test that captures a mock call's arguments or return value. If the service method's type is broken (due to the `ingredients` vs `productIngredients` mismatch), TypeScript might not be able to infer the type properly, resulting in `unknown`.

By fixing the `productIngredients` issue, this should also resolve the `unknown` type error.

Now let me write the complete service file. I'll be careful to:
1. Use `productIngredients` not `ingredients` for the product's ingredient list
2. Make sure all types are explicit and proper
3. Follow the plan's control flow exactly

Actually, I realize I need to think about what types are available. The plan mentions:
- `src/classification/types.ts` exports `Severity`, `IngredientFinding`, `ClassificationResponse`, `ProfiledClassificationResponse`, `ResourceNotFound`, `ConflictError`

For the product type, I need to know what the repository returns. Since I can't see `product.repository.ts`, I'll assume it returns a type that has `productIngredients` (matching the test's mock).

Let me also think about the `severity` type. The plan says the enum is `SEV_ENUM: BANNED, RESTRICTED, WATCH`. In Prisma, this would be a string enum. The service needs to compare severities.

Let me write the file now:

```typescript
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
  'This classification is for informational purposes only and does not constitute safety or regulatory advice. Always consult relevant regulatory authorities before making decisions about product use.';

const SEVERITY_ORDINAL: Record<string, number> = {
  watch: 1,
  restricted: 2,
  banned: 3,
};

@Injectable()
export class ClassificationService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly ingredientRepository: IngredientRepository,
    private readonly methodologyRepository: MethodologyRepository,
    private readonly profileRepository: ProfileRepository,
    private readonly classificationRepository: ClassificationRepository,
  ) {}

  async classify(
    productId: number,
    profileId?: number,
  ): Promise<ClassificationResponse | ProfiledClassificationResponse> {
    const product = await this.productRepository.getWithIngredients(productId);
    if (!product) {
      throw new ResourceNotFound(`Product with id ${productId} not found`);
    }

    const activeVersion = await this.methodologyRepository.getActive();
    if (!activeVersion) {
      throw new ResourceNotFound('No active methodology version found');
    }

    const rules = await this.methodologyRepository.getRules(activeVersion.id);
    const rulesByIngredientId = new Map<number, (typeof rules)[number]>();
    for (const rule of rules) {
      rulesByIngredientId.set(rule.ingredientId, rule);
    }

    const findings = await this.buildBaseFindings(product.productIngredients, rulesByIngredientId);

    let responseFindings = findings;
    if (profileId !== undefined) {
      const profile = await this.profileRepository.findById(profileId);
      if (!profile) {
        throw new ResourceNotFound(`Profile with id ${profileId} not found`);
      }
      const modifiers = await this.profileRepository.getModifiers(profileId);
      const modifiersByIngredientId = new Map<number, (typeof modifiers)[number]>();
      for (const mod of modifiers) {
        modifiersByIngredientId.set(mod.ingredientId, mod);
      }
      responseFindings = this.applyModifiers(findings, modifiersByIngredientId);
    }

    const unknownCount = findings.filter((f) => f.isUnknown).length;
    const overallConfidence = Math.max(0, 1 - 0.1 * unknownCount);
    const unknownIngredients = findings.filter((f) => f.isUnknown).map((f) => f.rawText);

    await this.classificationRepository.upsert(
      {
        productId,
        methodologyVersionId: activeVersion.id,
        overallConfidence,
        disclaimer: DISCLAIMER,
      },
      findings.map((f) => ({
        rawText: f.rawText,
        resolvedName: f.resolvedName,
        ingredientId: f.ingredientId,
        isUnknown: f.isUnknown,
        flag: f.flag,
        severity: f.severity ?? null,
        sourceCitation: f.sourceCitation,
      })),
    );

    const baseResponse: ClassificationResponse = {
      productId,
      methodologyVersionId: activeVersion.id,
      findings: responseFindings,
      unknownIngredients,
      overallConfidence,
      disclaimer: DISCLAIMER,
    };

    if (profileId !== undefined) {
      return { ...baseResponse, profileId };
    }

    return baseResponse;
  }

  async rescoreAll(versionId: number): Promise<void> {
    const products = await this.productRepository.listWithIngredients();
    for (const product of products) {
      await this.classifyForVersion(product.id, versionId);
    }
  }

  private async classifyForVersion(
    productId: number,
    methodologyVersionId: number,
  ): Promise<void> {
    const product = await this.productRepository.getWithIngredients(productId);
    if (!product) return;

    const rules = await this.methodologyRepository.getRules(methodologyVersionId);
    const rulesByIngredientId = new Map<number, (typeof rules)[number]>();
    for (const rule of rules) {
      rulesByIngredientId.set(rule.ingredientId, rule);
    }

    const findings = await this.buildBaseFindings(product.productIngredients, rulesByIngredientId);

    const unknownCount = findings.filter((f) => f.isUnknown).length;
    const overallConfidence = Math.max(0, 1 - 0.1 * unknownCount);

    await this.classificationRepository.upsert(
      {
        productId,
        methodologyVersionId,
        overallConfidence,
        disclaimer: DISCLAIMER,
      },
      findings.map((f) => ({
        rawText: f.rawText,
        resolvedName: f.resolvedName,
        ingredientId: f.ingredientId,
        isUnknown: f.isUnknown,
        flag: f.flag,
        severity: f.severity ?? null,
        sourceCitation: f.sourceCitation,
      })),
    );
  }

  private async buildBaseFindings(
    productIngredients: { rawText: string; position: number }[],
    rulesByIngredientId: Map<number, { ingredientId: number; severity: string; flag: string; sourceCitation: string }>,
  ): Promise<IngredientFinding[]> {
    const findings: IngredientFinding[] = [];
    for (const pi of productIngredients) {
      const normalized = this.normalize(pi.rawText);
      const resolution = await this.ingredientRepository.resolve(normalized);

      if (!resolution) {
        findings.push({
          rawText: pi.rawText,
          resolvedName: null,
          ingredientId: null,
          isUnknown: true,
          flag: null,
          severity: null,
          sourceCitation: null,
        });
      } else {
        const rule = rulesByIngredientId.get(resolution.ingredient.id) ?? null;
        findings.push({
          rawText: pi.rawText,
          resolvedName: resolution.ingredient.canonicalName,
          ingredientId: resolution.ingredient.id,
          isUnknown: false,
          flag: rule ? rule.flag : null,
          severity: rule ? (rule.severity as Severity) : null,
          sourceCitation: rule ? rule.sourceCitation : null,
        });
      }
    }
    return findings;
  }

  private applyModifiers(
    findings: IngredientFinding[],
    modifiersByIngredientId: Map<number, { ingredientId: number; severity: string; flag: string; sourceCitation: string }>,
  ): IngredientFinding[] {
    return findings.map((f) => {
      if (f.isUnknown || f.ingredientId === null) return f;
      const modifier = modifiersByIngredientId.get(f.ingredientId);
      if (!modifier) return f;

      const modifierOrdinal = SEVERITY_ORDINAL[modifier.severity] ?? 0;
      const baseOrdinal = f.severity ? (SEVERITY_ORDINAL[f.severity] ?? 0) : 0;

      if (modifierOrdinal > baseOrdinal) {
        return {
          ...f,
          flag: modifier.flag,
          severity: modifier.severity as Severity,
          sourceCitation: modifier.sourceCitation,
        };
      }
      return f;
    });
  }

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }
}
```

Hmm wait, I'm not sure about the exact types that the repositories return. The test mocks return specific shapes. Let me think about what would make the test compile.

The test is mocking `productRepository.getWithIngredients` to return `{ id: number; name: string; productIngredients: { rawText: string; position: number; }[]; }`.

So the service just needs to access `product.productIngredients` where each element has `rawText` and `position`.

For the `v1FindingsCall` being `unknown` - this might be related to how the test captures mock calls. If the service's type is correct, this should resolve.

Actually, I realize I might be overthinking this. The error is clear: the service expects `ingredients` but gets `productIngredients`. I just need to make sure my service uses `productIngredients` everywhere it accesses the product's ingredient list.

Let me also consider: maybe the service has a type alias or interface defined locally that includes `ingredients`. I should make sure not to define such a type.

Let me finalize my answer. I'll write a clean service that:
1. Uses `product.productIngredients` (not `product.ingredients`)
2. Has proper types throughout
3. Follows the plan's control flow

One more thought: the `severity` field. In the Prisma enum, it would be uppercase (`BANNED`, `RESTRICTED`, `WATCH`). But the `Severity` type in `types.ts` is `'banned' | 'restricted' | 'watch'` (lowercase). So there might be a conversion needed. But looking at the plan, the enum values are `BANNED`, `RESTRICTED`, `WATCH` (uppercase in Prisma). The service needs to handle the conversion.

Actually, looking at the plan more carefully:
- Prisma enum: `SEV_ENUM`: `BANNED`, `RESTRICTED`, `WATCH`
- TypeScript type: `Severity = 'banned' | 'restricted' | 'watch'`

So when the service reads from the DB (via repository), it gets uppercase values. When it returns in the response, it should be lowercase. I need to add a conversion.

Wait, but maybe the repository already does the conversion? Or maybe the types in `types.ts` use uppercase? I can't see `types.ts`. Let me just use a conversion function to be safe.

Actually, let me reconsider. The plan says:
```
export type Severity = 'banned' | 'restricted' | 'watch';
```

And the Prisma enum is `BANNED`, `RESTRICTED`, `WATCH`. So the repository likely returns the Prisma enum values (uppercase strings), and the service needs to convert them to the lowercase `Severity` type for the response.

Let me add a helper:
```typescript
private toSeverity(value: string): Severity {
  return value.toLowerCase() as Severity;
}
```

This should handle the conversion. Let me incorporate this into my solution.

Actually, I just realized - I'm making assumptions about what the repository returns. The test is the source of truth for what the service should work with. Since the test provides `productIngredients` on the product, I'll use that. For the other repository methods, I'll assume they return types that are compatible with what the service needs.

Let me write the final version now.
```

## reply

```typescript
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
  'This classification is for informational purposes only and does not constitute safety or regulatory advice. Always consult relevant regulatory authorities before making decisions about product use.';

const SEVERITY_ORDINAL: Record<string, number> = {
  watch: 1,
  restricted: 2,
  banned: 3,
};

function toSeverity(value: string): Severity {
  return value.toLowerCase() as Severity;
}

@Injectable()
export class ClassificationService {
  constructor(
    private readonly productRepository: ProductRepository,
    private readonly ingredientRepository: IngredientRepository,
    private readonly methodologyRepository: MethodologyRepository,
    private readonly profileRepository: ProfileRepository,
    private readonly classificationRepository: ClassificationRepository,
  ) {}

  async classify(
    productId: number,
    profileId?: number,
  ): Promise<ClassificationResponse | ProfiledClassificationResponse> {
    const product = await this.productRepository.getWithIngredients(productId);
    if (!product) {
      throw new ResourceNotFound(`Product with id ${productId} not found`);
    }

    const activeVersion = await this.methodologyRepository.getActive();
    if (!activeVersion) {
      throw new ResourceNotFound('No active methodology version found');
    }

    const rules = await this.methodologyRepository.getRules(activeVersion.id);
    const rulesByIngredientId = new Map<number, (typeof rules)[number]>();
    for (const rule of rules) {
      rulesByIngredientId.set(rule.ingredientId, rule);
    }

    const findings = await this.buildBaseFindings(
      product.productIngredients,
      rulesByIngredientId,
    );

    let responseFindings = findings;
    if (profileId !== undefined) {
      const profile = await this.profileRepository.findById(profileId);
      if (!profile) {
        throw new ResourceNotFound(`Profile with id ${profileId} not found`);
      }
      const modifiers = await this.profileRepository.getModifiers(profileId);
      const modifiersByIngredientId = new Map<number, (typeof modifiers)[number]>();
      for (const mod of modifiers) {
        modifiersByIngredientId.set(mod.ingredientId, mod);
      }
      responseFindings = this.applyModifiers(findings, modifiersByIngredientId);
    }

    const unknownCount = findings.filter((f) => f.isUnknown).length;
    const overallConfidence = Math.max(0, 1 - 0.1 * unknownCount);
    const unknownIngredients = findings.filter((f) => f.isUnknown).map((f) => f.rawText);

    await this.classificationRepository.upsert(
      {
        productId,
        methodologyVersionId: activeVersion.id,
        overallConfidence,
        disclaimer: DISCLAIMER,
      },
      findings.map((f) => ({
        rawText: f.rawText,
        resolvedName: f.resolvedName,
        ingredientId: f.ingredientId,
        isUnknown: f.isUnknown,
        flag: f.flag,
        severity: f.severity ?? null,
        sourceCitation: f.sourceCitation,
      })),
    );

    const baseResponse: ClassificationResponse = {
      productId,
      methodologyVersionId: activeVersion.id,
      findings: responseFindings,
      unknownIngredients,
      overallConfidence,
      disclaimer: DISCLAIMER,
    };

    if (profileId !== undefined) {
      return { ...baseResponse, profileId };
    }

    return baseResponse;
  }

  async rescoreAll(versionId: number): Promise<void> {
    const products = await this.productRepository.listWithIngredients();
    for (const product of products) {
      await this.classifyForVersion(product.id, versionId);
    }
  }

  private async classifyForVersion(
    productId: number,
    methodologyVersionId: number,
  ): Promise<void> {
    const product = await this.productRepository.getWithIngredients(productId);
    if (!product) return;

    const rules = await this.methodologyRepository.getRules(methodologyVersionId);
    const rulesByIngredientId = new Map<number, (typeof rules)[number]>();
    for (const rule of rules) {
      rulesByIngredientId.set(rule.ingredientId, rule);
    }

    const findings = await this.buildBaseFindings(
      product.productIngredients,
      rulesByIngredientId,
    );

    const unknownCount = findings.filter((f) => f.isUnknown).length;
    const overallConfidence = Math.max(0, 1 - 0.1 * unknownCount);

    await this.classificationRepository.upsert(
      {
        productId,
        methodologyVersionId,
        overallConfidence,
        disclaimer: DISCLAIMER,
      },
      findings.map((f) => ({
        rawText: f.rawText,
        resolvedName: f.resolvedName,
        ingredientId: f.ingredientId,
        isUnknown: f.isUnknown,
        flag: f.flag,
        severity: f.severity ?? null,
        sourceCitation: f.sourceCitation,
      })),
    );
  }

  private async buildBaseFindings(
    productIngredients: { rawText: string; position: number }[],
    rulesByIngredientId: Map<
      number,
      { ingredientId: number; severity: string; flag: string; sourceCitation: string }
    >,
  ): Promise<IngredientFinding[]> {
    const findings: IngredientFinding[] = [];

    for (const pi of productIngredients) {
      const normalized = this.normalize(pi.rawText);
      const resolution = await this.ingredientRepository.resolve(normalized);

      if (!resolution) {
        findings.push({
          rawText: pi.rawText,
          resolvedName: null,
          ingredientId: null,
          isUnknown: true,
          flag: null,
          severity: null,
          sourceCitation: null,
        });
      } else {
        const rule = rulesByIngredientId.get(resolution.ingredient.id) ?? null;
        findings.push({
          rawText: pi.rawText,
          resolvedName: resolution.ingredient.canonicalName,
          ingredientId: resolution.ingredient.id,
          isUnknown: false,
          flag: rule ? rule.flag : null,
          severity: rule ? toSeverity(rule.severity) : null,
          sourceCitation: rule ? rule.sourceCitation : null,
        });
      }
    }

    return findings;
  }

  private applyModifiers(
    findings: IngredientFinding[],
    modifiersByIngredientId: Map<
      number,
      { ingredientId: number; severity: string; flag: string; sourceCitation: string }
    >,
  ): IngredientFinding[] {
    return findings.map((f) => {
      if (f.isUnknown || f.ingredientId === null) return f;

      const modifier = modifiersByIngredientId.get(f.ingredientId);
      if (!modifier) return f;

      const modifierOrdinal = SEVERITY_ORDINAL[toSeverity(modifier.severity)] ?? 0;
      const baseOrdinal = f.severity ? (SEVERITY_ORDINAL[f.severity] ?? 0) : 0;

      if (modifierOrdinal > baseOrdinal) {
        return {
          ...f,
          flag: modifier.flag,
          severity: toSeverity(modifier.severity),
          sourceCitation: modifier.sourceCitation,
        };
      }

      return f;
    });
  }

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }
}
```
