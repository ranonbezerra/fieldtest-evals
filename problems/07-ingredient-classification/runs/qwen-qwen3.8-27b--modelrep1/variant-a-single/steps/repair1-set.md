# repair1-set

## reasoning

```
Let me analyze all the errors to identify the distinct mistakes:

1. **`@nestjs/core` doesn't export `Inject` or `Injectable`** — In NestJS, these come from `@nestjs/common`, not `@nestjs/core`. This affects multiple files:
   - `src/classification/classification.service.ts`
   - `src/methodology/methodology.service.ts`
   - `src/methodology/methodology.repository.ts`
   - `src/products/products.repository.ts`
   - `src/products/products.service.ts`
   - `src/profiles/profiles.repository.ts`
   - `src/profiles/profiles.service.ts`

2. **The Prisma schema doesn't match what the code expects.** The schema shown in the reference has:
   - `MethodologyVersion` with fields: `id`, `version` (String), `isActive`, but NO `name` or `status` field.
   - `Rule` with fields: `id`, `ingredientId`, `severity`, `sourceCitation`, `methodologyVersionId` — NO `source` or `note` field.
   - `Product` with fields: `id`, `name` — NO `ingredients` relation (it has `productIngredients` instead, and `ProductIngredient` has `ingredientId` not `name`).
   - `ClassificationResult` with fields: `id`, `productId`, `methodologyVersionId`, `findings` (Json), `confidence` (Float), `disclaimer` (String) — NO `unknowns` or `classifiedAt`.
   - `FamilyProfile` with fields: `id`, `name`, `type` — but the code uses `prisma.profile` and expects `description`, `modifiers`.
   - `Ingredient` has `name` as the only field, no `@@unique` on name (only `@id` on `id`), so `findUnique({ where: { name } })` won't work.
   - `ProductIngredient` has `ingredientId` (relation to Ingredient), not a `name` field.

   Wait, let me re-read the schema more carefully:

   ```prisma
   model Ingredient {
     id               String             @id @default(uuid())
     name             String
     synonyms         Synonym[]
     productIngredients ProductIngredient[]
     rules            Rule[]

     @@map("ingredients")
   }
   ```
   No `@@unique([name])` — so `findUnique({ where: { name } })` won't work.

   ```prisma
   model MethodologyVersion {
     id                    String                 @id @default(uuid())
     version               String
     isActive              Boolean                @default(false) @map("is_active")
     rules                 Rule[]
     classificationResults ClassificationResult[]

     @@unique([version])
     @@map("methodology_versions")
   }
   ```
   - `version` is `String`, not `number`
   - No `name` field
   - No `status` field

   ```prisma
   model Rule {
     id                   String             @id @default(uuid())
     ingredientId         String             @map("ingredient_id")
     ingredient           Ingredient         @relation(fields: [ingredientId], references: [id])
     severity             String
     sourceCitation       String             @map("source_citation")
     methodologyVersionId String             @map("methodology_version_id")
     methodologyVersion   MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])

     @@map("rules")
   }
   ```
   - `sourceCitation` not `source`
   - No `note` field

   ```prisma
   model Product {
     id                    String                 @id @default(uuid())
     name                  String
     productIngredients    ProductIngredient[]
     classificationResults ClassificationResult[]

     @@map("products")
   }
   ```
   - Relation is `productIngredients`, not `ingredients`

   ```prisma
   model ProductIngredient {
     id           String     @id @default(uuid())
     productId    String     @map("product_id")
     product      Product    @relation(fields: [productId], references: [id], onDelete: Cascade)
     ingredientId String     @map("ingredient_id")
     ingredient   Ingredient @relation(fields: [ingredientId], references: [id])

     @@unique([productId, ingredientId])
     @@map("product_ingredients")
   }
   ```
   - Has `ingredientId` (relation to Ingredient), no `name` field

   ```prisma
   model ClassificationResult {
     id                   String             @id @default(uuid())
     productId            String             @map("product_id")
     product              Product            @relation(fields: [productId], references: [id], onDelete: Cascade)
     methodologyVersionId String             @map("methodology_version_id")
     methodologyVersion   MethodologyVersion @relation(fields: [methodologyVersionId], references: [id], onDelete: Cascade)
     findings             Json
     confidence           Float
     disclaimer           String

     @@unique([productId, methodologyVersionId])
     @@map("classification_results")
   }
   ```
   - No `unknowns` field
   - No `classifiedAt` field

   ```prisma
   model FamilyProfile {
     id   String @id @default(uuid())
     name String
     type String

     @@map("family_profiles")
   }
   ```
   - Model is `FamilyProfile`, so Prisma client property would be `familyProfile`
   - Has `type` not `description`
   - No `modifiers` relation

   Now let me map the errors to the distinct mistakes:

**Mistake 1: `@nestjs/core` should be `@nestjs/common`** for `Inject` and `Injectable` imports.
Files: classification.service.ts, methodology.service.ts, methodology.repository.ts, products.repository.ts, products.service.ts, profiles.repository.ts, profiles.service.ts

**Mistake 2: The code expects a different schema than what's in schema.prisma.** The code was written against a schema that has:
- `MethodologyVersion.version` as `number` (schema has `String`)
- `MethodologyVersion.name` field (schema doesn't have it)
- `MethodologyVersion.status` field (schema doesn't have it)
- `Rule.source` field (schema has `sourceCitation`)
- `Rule.note` field (schema doesn't have it)
- `Product.ingredients` relation with a `name` field (schema has `productIngredients` with `ingredientId` relation to `Ingredient`)
- `ClassificationResult.unknowns` field (schema doesn't have it)
- `ClassificationResult.classifiedAt` field (schema doesn't have it)
- `PrismaService.profile` (schema has `FamilyProfile`, so it would be `familyProfile`)
- `FamilyProfile.description` (schema has `type` instead)
- `FamilyProfile.modifiers` relation (schema doesn't have it)
- `Ingredient.findUnique({ where: { name } })` (no unique constraint on name)
- `IngredientSynonym` model (schema has `Synonym` with `value` field, not `form`)

Wait, this is a LOT of schema mismatches. The instructions say "Do not add features, do not rename anything the errors do not mention, do not reorganise." and "Change exactly what the compiler requires."

So I need to make the code match the schema, not the other way around. Let me look at what the code needs to do and what the schema provides.

Actually wait - let me re-read the instructions more carefully. The task says "Fix all of them in one reply" referring to the typecheck errors. The schema is the ground truth (it's in the reference material). The code needs to be reconciled to match the schema.

But the code has deep architectural assumptions that don't match the schema. Let me think about what minimal changes would fix the typecheck errors.

Let me go through each file's errors:

### `src/classification/classification.repository.ts`
- Line 108: `unknowns` doesn't exist in ClassificationResult create input
- Line 114: `unknowns` doesn't exist in ClassificationResult update input
- Line 120: `toStoredResult` expects `unknowns` and `classifiedAt` but the row doesn't have them

The fix: Remove `unknowns` from the upsert and adjust `toStoredResult` to not expect `unknowns` and `classifiedAt`. But wait - the `StoredResult` type is defined in `classification.types.ts` which I don't have. Let me think about what I can infer.

Actually, I need to look at what types are imported. The code imports `BaseResult`, `ProfileRef`, `ScoringContext`, `Severity`, `StoredResult`, `VersionSummary` from `./classification.types.js`. I don't have that file, but I can infer from usage.

Looking at the service code:
```ts
stored.findings, stored.unknowns, stored.confidence, stored.disclaimer, stored.classifiedAt
```

And the `BaseResult` is spread into `upsertResult`:
```ts
await this.repo.upsertResult({
  productId: product.id,
  methodologyVersionId: version.id,
  ...this.scoreBase(product, context),
});
```

And `scoreBase` returns:
```ts
return {
  findings,
  unknowns,
  confidence,
  disclaimer: disclaimerFor(context.version.name, context.version.version),
};
```

So `BaseResult` has `findings`, `unknowns`, `confidence`, `disclaimer`.

`StoredResult` has `id`, `productId`, `methodologyVersionId`, `findings`, `unknowns`, `confidence`, `disclaimer`, `classifiedAt`.

The schema's `ClassificationResult` has: `id`, `productId`, `methodologyVersionId`, `findings` (Json), `confidence` (Float), `disclaimer` (String). No `unknowns`, no `classifiedAt`.

So the fix for the repository is:
- Remove `unknowns` from create and update in upsert
- Remove `classifiedAt` from the return
- Adjust `toStoredResult` to not expect `unknowns` and `classifiedAt`

But then `StoredResult` type needs to not have `unknowns` and `classifiedAt`... but I don't have that file. Hmm.

Wait, let me reconsider. The instructions say "Change exactly what the compiler requires." The compiler is complaining about the repository file. The type file (`classification.types.ts`) is not in the error list, so maybe it's already correct or maybe it will be fine once the repository is fixed.

Actually, looking more carefully at the errors, I notice that `classification.types.ts` is NOT in the error list. So either it compiles fine, or it's not being checked. Since the errors reference types from it, it must exist and compile. The issue is that the repository code is trying to use fields that don't exist in the Prisma schema.

Let me think about this differently. The `StoredResult` type in `classification.types.ts` probably has `unknowns` and `classifiedAt` because the service uses them. But the Prisma model doesn't have those fields. So the `toStoredResult` function needs to be adjusted to provide those values from somewhere else, or the type needs to change.

Actually wait - I think the right approach is:
1. The schema is the ground truth
2. The code needs to be made to work with the schema
3. I should only fix what the compiler complains about

For `classification.repository.ts`:
- Remove `unknowns` from the upsert (create and update)
- Fix `toStoredResult` to not require `unknowns` and `classifiedAt` from the row

But `StoredResult` type has those fields... I can't change `classification.types.ts` because it's not in the error list and changing it might break other things.

Hmm, actually let me reconsider. The `toStoredResult` function is defined IN the repository file. The error is:
```
src/classification/classification.repository.ts(120,27): error TS2345: Argument of type '{ id: string; methodologyVersionId: string; productId: string; findings: JsonValue; confidence: number; disclaimer: string; }' is not assignable to parameter of type '{ id: string; productId: string; methodologyVersionId: string; findings: JsonValue; unknowns: JsonValue; confidence: number; disclaimer: string; classifiedAt: Date; }'.
```

So `toStoredResult`'s parameter type includes `unknowns` and `classifiedAt`, but the Prisma row doesn't have them. The fix is to change `toStoredResult`'s parameter type to not include those, and then provide default values for them in the return, OR change the return type.

But the return type is `StoredResult` which is imported from `classification.types.ts`. If `StoredResult` has `unknowns` and `classifiedAt`, I need to provide them.

I think the cleanest fix is:
- Change `toStoredResult` to not expect `unknowns` and `classifiedAt` in the parameter
- Provide `unknowns: []` and `classifiedAt: new Date()` (or extract from `findings` JSON) in the return

Wait, but that changes the semantics. Let me look at how `unknowns` is used in the service:
```ts
unknowns: stored.unknowns,
```

And in `scoreBase`:
```ts
const unknowns: string[] = [];
// ...
unknowns.push(listedName);
```

So `unknowns` is derived from `findings` (any finding with status 'unknown'). Maybe the right approach is to store `unknowns` as part of the `findings` JSON, or to derive it.

Actually, I think the simplest fix that makes the compiler happy is:
1. In the upsert, remove `unknowns` from create and update
2. In `toStoredResult`, change the parameter to not require `unknowns` and `classifiedAt`, and provide defaults or derive them

But I need to be careful - the `StoredResult` type is in `classification.types.ts` which I can't see. Let me infer it from usage:

From the service:
```ts
return {
  productId: product.id,
  productName: product.name,
  methodologyVersionId: version.id,
  methodologyVersion: version.version,
  profileId: profile?.id ?? null,
  profileName: profile?.name ?? null,
  findings: ...,
  unknowns: stored.unknowns,
  confidence: stored.confidence,
  disclaimer: stored.disclaimer,
  classifiedAt: stored.classifiedAt,
};
```

And from `getStored`:
```ts
return {
  productId,
  methodologyVersionId: version.id,
  methodologyVersion: version.version,
  findings: stored.findings,
  unknowns: stored.unknowns,
  confidence: stored.confidence,
  disclaimer: stored.disclaimer,
  classifiedAt: stored.classifiedAt,
};
```

So `StoredResult` must have `unknowns: string[]` and `classifiedAt: Date`.

OK so my plan for `classification.repository.ts`:
- Remove `unknowns` from the upsert create/update (since the schema doesn't have that column)
- In `toStoredResult`, don't expect `unknowns` or `classifiedAt` from the row
- Derive `unknowns` from `findings` (filter for status === 'unknown')
- Use `new Date()` for `classifiedAt` (or we could add `classifiedAt` to the schema, but the instructions say not to change things not in the errors)

Wait, but if I can't change the schema (it's reference material), I need to make the code work with what's there. The schema has `findings Json` which can hold everything. Maybe I should store `unknowns` inside the `findings` JSON? No, that's too complex.

Actually, the simplest approach: since `findings` is a Json field, I could store both findings and unknowns in it. But that changes the data model significantly.

Let me re-read the constraint: "Change exactly what the compiler requires." The compiler says:
1. `unknowns` doesn't exist in create/update input → remove it from those
2. The row passed to `toStoredResult` doesn't have `unknowns` and `classifiedAt` → fix the function

The minimal fix:
- Remove `unknowns` from upsert create and update
- Change `toStoredResult` to accept a row without `unknowns` and `classifiedAt`
- In the return, derive `unknowns` from findings and use a default for `classifiedAt`

Actually wait, I just realized I can also store `unknowns` as part of the `findings` JSON. Let me look at how findings is stored:

```ts
findings: toJsonArray(input.findings),
```

So `findings` is stored as a JSON array. I could change it to store an object `{ findings: [...], unknowns: [...] }` but that would break the type.

The simplest approach: just derive `unknowns` from findings in `toStoredResult`:
```ts
function toStoredResult(row: { ... no unknowns, no classifiedAt ... }): StoredResult {
  const findings = row.findings as unknown as StoredResult['findings'];
  return {
    ...
    unknowns: findings.filter(f => f.status === 'unknown').map(f => f.listedName),
    classifiedAt: new Date(),
  };
}
```

Hmm, but `classifiedAt: new Date()` means every read gives a different time. That's not great but it satisfies the type checker.

Actually, you know what, let me look at this from a different angle. The `findings` Json field could store the whole result including unknowns and classifiedAt. Let me restructure:

Instead of storing `findings` as just the findings array, store the whole `BaseResult` as the `findings` JSON:
```ts
findings: JSON.stringify({ findings, unknowns, confidence, disclaimer })
```

No wait, that's too invasive. Let me just do the minimal fix.

OK let me take a step back and list ALL the distinct mistakes:

**Mistake 1: Wrong import source for Inject/Injectable**
- `@nestjs/core` → `@nestjs/common`
- Files: classification.service.ts, methodology.service.ts, methodology.repository.ts, products.repository.ts, products.service.ts, profiles.repository.ts, profiles.service.ts

**Mistake 2: `ClassificationResult` model doesn't have `unknowns` or `classifiedAt`**
- File: classification.repository.ts
- Fix: Remove `unknowns` from upsert, adjust `toStoredResult`

**Mistake 3: `MethodologyVersion.version` is `String` in schema, not `number`**
- File: methodology.repository.ts
- The `toSummary` function expects `version: number` but schema has `version: String`
- Also `findVersionByNumber` uses `where: { version }` with a number, but the unique field is a string
- Fix: Change to work with string version

**Mistake 4: `MethodologyVersion` doesn't have `name` or `status` fields**
- File: methodology.repository.ts
- `toSummary` expects `name` and `status`
- `setActive` tries to update `status`
- Fix: Remove `name` and `status` from the code, or... 

Wait, but `VersionSummary` type (in classification.types.ts) probably has `name` and `status`. If I can't change that file, I need to provide those values somehow.

Hmm, this is getting complicated. Let me look at what `VersionSummary` is used for:
- In the service: `context.version.name` and `context.version.version`
- In the output: `methodologyVersion: version.version`

If `VersionSummary` has `name` and `status`, I need to provide them. But the schema doesn't have them. I could hardcode `name` as something and `status` as derived from `isActive`.

Actually wait - I think I need to look at this more carefully. The `VersionSummary` type is in `classification.types.ts` which is NOT in the error list. So it compiles fine. The errors are in the repository files where the Prisma row doesn't match what `toSummary`/`toVersionSummary` expects.

The fix: Change `toSummary`/`toVersionSummary` to accept the actual Prisma row shape and provide the `VersionSummary` fields from what's available.

For `name`: The schema doesn't have a name field. I could use the version number as the name, or just provide a default.
For `status`: Derive from `isActive` - if active, status is 'active', otherwise 'draft' or 'superseded'.

Actually, looking at the service code:
```ts
disclaimerFor(context.version.name, context.version.version)
```

This produces: `Automated screening against methodology "${versionName}" (version ${version}).`

So `name` is used in the disclaimer. If the schema doesn't have it, I need to either:
- Add it to the schema (but I can't change the schema)
- Provide a fallback in the code

I think the right approach is to provide a fallback. Since the version is a string (like "1", "2"), I can use that as the name or just use a generic name.

Wait, actually let me reconsider the whole situation. The reference material shows the schema as it exists. The code was written expecting a different schema. The task is to fix the typecheck errors. The minimal fix is to make the code compile against the actual schema.

Let me now go through each file systematically:

### `src/classification/classification.service.ts`
Errors:
- Line 1: `Inject` and `Injectable` from `@nestjs/core` → fix to `@nestjs/common`
- Line 201: `findings.sort(compareByNormalized)` where `compareByNormalized` takes `string` args but `findings` is `Finding[]`

For line 201, the fix is to change the sort to use the right comparator:
```ts
findings.sort((a, b) => compareByNormalized(a.listedName, b.listedName));
```

Wait, let me look at the actual code again:
```ts
// Sort so the output never depends on the order the list was stored in.
findings.sort(compareByNormalized);
unknowns.sort(compareByNormalized);
```

`unknowns` is `string[]` so `unknowns.sort(compareByNormalized)` is fine.
`findings` is `Finding[]` so `findings.sort(compareByNormalized)` is wrong.

Fix: `findings.sort((a, b) => compareByNormalized(a.listedName, b.listedName));`

### `src/classification/classification.repository.ts`
Errors:
- Line 108: `unknowns` in create → remove
- Line 114: `unknowns` in update → remove  
- Line 120: `toStoredResult` parameter doesn't match

Also, `loadScoringContext` uses:
- `this.prisma.methodologyVersion.findUnique` - OK
- `this.prisma.rule.findMany` - OK, but the rule fields... let me check. The schema has `sourceCitation` not `source`. And no `note`.

Wait, looking at the error list again for classification.repository.ts, the errors are ONLY:
- Line 108: `unknowns` in create
- Line 114: `unknowns` in update
- Line 120: `toStoredResult` parameter

So the `loadScoringContext` method doesn't have type errors? Let me look at it:
```ts
rules: rules.map((rule) => ({
  ingredientId: rule.ingredientId,
  severity: rule.severity as Severity,
  source: rule.source,
  note: rule.note,
})),
```

But the schema has `sourceCitation` not `source`, and no `note`. So `rule.source` and `rule.note` should be errors... unless the Prisma client hasn't been regenerated, or the types are loose enough.

Hmm wait, the error list is what it is. If the compiler doesn't report an error on those lines, maybe the Prisma client types are different from what I expect. Or maybe the schema I'm looking at is the one that was used to generate the client, and the Prisma client does have those fields... 

No wait, I need to trust the error list. The compiler only reports specific errors. If `rule.source` were wrong, it would show up. Since it doesn't, maybe the Prisma client was generated from a different schema, or the types are permissive.

Actually, I think I should ONLY fix what's in the error list. The instructions say "Change exactly what the compiler requires." If the compiler doesn't complain about `rule.source`, I shouldn't touch it.

Let me re-read the errors for classification.repository.ts:
```
src/classification/classification.repository.ts(108,9): error TS2353: Object literal may only specify known properties, and 'unknowns' does not exist in type 'Without<ClassificationResultCreateInput, ClassificationResultUncheckedCreateInput> & ClassificationResultUncheckedCreateInput'.
src/classification/classification.repository.ts(114,9): error TS2353: Object literal may only specify known properties, and 'unknowns' does not exist in type '(Without<ClassificationResultUpdateInput, ClassificationResultUncheckedUpdateInput> & ClassificationResultUncheckedUpdateInput) | (Without<...> & ClassificationResultUpdateInput)'.
src/classification/classification.repository.ts(120,27): error TS2345: Argument of type '{ id: string; methodologyVersionId: string; productId: string; findings: JsonValue; confidence: number; disclaimer: string; }' is not assignable to parameter of type '{ id: string; productId: string; methodologyVersionId: string; findings: JsonValue; unknowns: JsonValue; confidence: number; disclaimer: string; classifiedAt: Date; }'.
  Type '{ id: string; methodologyVersionId: string; productId: string; findings: JsonValue; confidence: number; disclaimer: string; }' is missing the following properties from type '{ id: string; productId: string; methodologyVersionId: string; findings: JsonValue; unknowns: JsonValue; confidence: number; disclaimer: string; classifiedAt: Date; }': unknowns, classifiedAt
```

So the Prisma create/update input for ClassificationResult doesn't have `unknowns`. And the row returned from the query has: `id`, `methodologyVersionId`, `productId`, `findings`, `confidence`, `disclaimer` (no `unknowns`, no `classifiedAt`).

Fix:
1. Remove `unknowns` from create and update in the upsert
2. Change `toStoredResult` to accept the row without `unknowns` and `classifiedAt`, and provide those in the return

For `toStoredResult`, I need to provide `unknowns` and `classifiedAt` somehow. Since the `StoredResult` type (in classification.types.ts) has them, I'll derive `unknowns` from findings and use a default date.

Actually, I can store unknowns as part of the findings JSON. Let me look at how findings is used...

In the service:
```ts
findings: profile ? this.applyProfile(stored.findings, profile, context.ingredientNameById) : stored.findings,
unknowns: stored.unknowns,
```

And in `scoreBase`, `findings` includes entries with `status: 'unknown'`. So I can derive unknowns from findings.

Let me write the fix:
```ts
function toStoredResult(row: {
  id: string;
  productId: string;
  methodologyVersionId: string;
  findings: Prisma.JsonValue;
  confidence: number;
  disclaimer: string;
}): StoredResult {
  const findings = row.findings as unknown as StoredResult['findings'];
  return {
    id: row.id,
    productId: row.productId,
    methodologyVersionId: row.methodologyVersionId,
    findings,
    unknowns: findings.filter((f) => f.status === 'unknown').map((f) => f.listedName),
    confidence: row.confidence,
    disclaimer: row.disclaimer,
    classifiedAt: new Date(),
  };
}
```

Hmm but `classifiedAt: new Date()` is not great. Every read would give a different time. But it satisfies the type checker. Alternatively, I could encode it in the JSON.

Actually, you know what, let me just make it work. The compiler needs to pass. I'll derive unknowns from findings and use a fixed date or new Date().

### `src/methodology/methodology.repository.ts`
Errors:
- Line 1: `Inject`/`Injectable` from `@nestjs/core` → `@nestjs/common`
- Line 17: `toSummary` called with `{ id, version: string, isActive: boolean }` but expects `{ id, version: number, name: string, status: string, isActive: boolean }`
- Line 21: `where: { version }` where version is number but field is string
- Line 22: Same as 17
- Line 26: `findUnique({ where: { name } })` on Ingredient - no unique on name
- Line 34: `version: input.version` where input.version is number but field is string
- Line 37: `rules: { create: [...] }` with wrong field names
- Line 46: Same as 17
- Line 57: `status` doesn't exist in updateMany
- Line 61: `status` doesn't exist in update

So the MethodologyVersion in Prisma has: `id`, `version` (String), `isActive` (Boolean). That's it (plus relations).

The `VersionSummary` type (in classification.types.ts) probably has: `id`, `version`, `name`, `status`, `isActive`.

Since I can't change `classification.types.ts` (not in error list), I need to make `toSummary` work with the actual row shape and produce a valid `VersionSummary`.

For `version`: The schema has it as String. The `VersionSummary` type probably expects `number` (since the service does `version: input.version` where `input.version` is number, and `context.version.version` is used in a template string). 

Wait, but if `VersionSummary.version` is `number`, and the Prisma row has `version: string`, I need to convert: `Number(row.version)`.

For `name`: The schema doesn't have it. I'll use a fallback like `Version ${row.version}` or just the version number as a string.

For `status`: The schema doesn't have it. I'll derive it from `isActive`: `row.isActive ? 'active' : 'draft'`.

Let me look at how `VersionSummary` is used:
- `context.version.name` → used in disclaimer
- `context.version.version` → used in disclaimer and output
- `version.version` → used in output

So `name` just needs to be a string, and `version` needs to be a number (or string, depending on the type).

Actually, I realize I'm overthinking this. Let me look at the `CreateVersionInput` interface which IS in methodology.repository.ts:
```ts
export interface CreateVersionInput {
  version: number;
  name: string;
  rules: { ingredientId: string; severity: Severity; source: string; note: string | null }[];
}
```

This is the interface for the repository's `createVersion` method. The service calls it with these fields. But the Prisma schema doesn't have `name` on the version model, and the rule model has `sourceCitation` not `source`, and no `note`.

The error on line 34 says: `Type 'number' is not assignable to type 'string'` - this is `version: input.version` in the create. So I need to convert to string: `version: String(input.version)`.

The error on line 37 says the rules create has wrong fields. The schema's Rule model has: `ingredientId`, `severity`, `sourceCitation`, `methodologyVersionId`. So I need to use `sourceCitation` instead of `source`, and remove `note`.

But wait, `CreateVersionInput` is defined in this file and used by the service. If I change it, the service might break. But the service IS in the error list (for the import), so I can fix it there too.

Actually, let me look at what the service passes:
```ts
rules.push({
  ingredientId: ingredient.id,
  severity: rule.severity,
  source: rule.source,
  note: rule.note ?? null,
});
```

And `CreateMethodologyInput` (in methodology.service.ts):
```ts
export interface CreateMethodologyInput {
  version: number;
  name: string;
  rules: { ingredient: string; severity: Severity; source: string; note?: string }[];
}
```

So the service takes `source` and `note` from the caller, and passes them to the repository. The repository then needs to map them to the actual schema fields.

For the repository's `createVersion`:
- `version`: convert number to string
- `name`: not in schema, so don't include it
- `rules`: map `source` → `sourceCitation`, remove `note`

But then `CreateVersionInput` has `name` which isn't used. I should remove it from the interface and from the service call.

Wait, but `CreateVersionInput` is exported from this file. If I change it, the service needs to match. The service is in the error list (import error), so I can fix it.

Let me also look at `findIngredientByName`:
```ts
async findIngredientByName(name: string): Promise<{ id: string; name: string } | null> {
  const row = await this.prisma.ingredient.findUnique({ where: { name } });
  return row ? { id: row.id, name: row.name } : null;
}
```

Error: `Type '{ name: string; }' is not assignable to type 'IngredientWhereUniqueInput'` because the only unique field is `id`.

Fix: Use `findFirst` instead of `findUnique`:
```ts
const row = await this.prisma.ingredient.findFirst({ where: { name } });
```

Now for `setActive`:
```ts
async setActive(versionId: string): Promise<void> {
  await this.prisma.$transaction([
    this.prisma.methodologyVersion.updateMany({
      where: { isActive: true, NOT: { id: versionId } },
      data: { isActive: false, status: 'superseded' },
    }),
    this.prisma.methodologyVersion.update({
      where: { id: versionId },
      data: { isActive: true, status: 'active' },
    }),
  ]);
}
```

Error: `status` doesn't exist. Fix: Remove `status` from both updates.

Now for `toSummary`:
```ts
function toSummary(row: {
  id: string;
  version: number;
  name: string;
  status: string;
  isActive: boolean;
}): VersionSummary {
  return { id: row.id, version: row.version, name: row.name, status: row.status, isActive: row.isActive };
}
```

The actual row from Prisma has: `id: string`, `version: string`, `isActive: boolean`. No `name`, no `status`.

Fix:
```ts
function toSummary(row: {
  id: string;
  version: string;
  isActive: boolean;
}): VersionSummary {
  return { id: row.id, version: Number(row.version), name: `v${row.version}`, status: row.isActive ? 'active' : 'draft', isActive: row.isActive };
}
```

Wait, but I don't know the exact shape of `VersionSummary`. Let me infer from usage:
- `version.version` is used in template strings and comparisons
- `version.name` is used in the disclaimer
- `version.status` - where is it used? Let me check... I don't see it used in the service directly, but it's part of the type.
- `version.isActive` - not sure if used

Since `VersionSummary` is in `classification.types.ts` which I can't see, I need to make sure my `toSummary` returns something compatible. The safest bet is to return all the fields that the type likely has.

Looking at the in-memory fake:
```ts
function toSummary(version: DbVersion): VersionSummary {
  return { id: version.id, version: version.version, name: version.name, status: version.status, isActive: version.isActive };
}
```

Where `DbVersion` has `version: number`. So `VersionSummary.version` is `number`.

OK so my fix for `toSummary`:
```ts
function toSummary(row: {
  id: string;
  version: string;
  isActive: boolean;
}): VersionSummary {
  return { id: row.id, version: Number(row.version), name: `v${row.version}`, status: row.isActive ? 'active' : 'draft', isActive: row.isActive };
}
```

### `src/methodology/methodology.service.ts`
Errors:
- Line 1: Import fix
- The service also uses `input.version` (number) and `input.name` (string) in `CreateMethodologyInput`

The service's `create` method:
```ts
async create(input: CreateMethodologyInput): Promise<VersionSummary> {
  const existing = await this.repo.findVersionByNumber(input.version);
  // ...
  return this.repo.createVersion({ version: input.version, name: input.name, rules });
}
```

If I change `CreateVersionInput` to not have `name`, the service call needs to change. But the service's `CreateMethodologyInput` has `name` which is used... where? It's passed to `repo.createVersion`. If I remove `name` from `CreateVersionInput`, I just don't pass it.

But wait, the service's `CreateMethodologyInput` is a public interface. If I change it, callers (controllers, tests) might break. But the instructions say to only fix what the compiler requires. The compiler only complains about the import in this file. So I should only fix the import.

But wait, if I change `CreateVersionInput` in the repository, the service's call to `this.repo.createVersion({ version: input.version, name: input.name, rules })` will have a type error because `name` is not in `CreateVersionInput`. But that error isn't in the list...

Hmm, this is tricky. The error list is what it is. Let me just fix exactly what's listed and see if the resulting code is consistent.

Actually, I think the key insight is: I should fix the files to be mutually consistent AND fix the compiler errors. The instructions say "Fix all of them in one reply" and "Change exactly what the compiler requires." But if fixing one file's error introduces a new error in another file that's also being fixed, I need to handle that too.

Let me take a different approach. Let me identify the minimal set of changes needed:

1. **Import fix**: `@nestjs/core` → `@nestjs/common` in 7 files
2. **classification.repository.ts**: Remove `unknowns` from upsert, fix `toStoredResult`
3. **classification.service.ts**: Fix the sort comparator
4. **methodology.repository.ts**: 
   - Fix import
   - Fix `toSummary` to work with actual Prisma row shape
   - Fix `findVersionByNumber` to use string comparison
   - Fix `findIngredientByName` to use `findFirst`
   - Fix `createVersion` to use correct field names
   - Fix `setActive` to remove `status`
5. **methodology.service.ts**: Fix import (and potentially the `createVersion` call if the interface changes)
6. **products.repository.ts**: 
   - Fix import
   - The Product model has `productIngredients` (relation to `ProductIngredient`), not `ingredients`. `ProductIngredient` has `ingredientId` (relation to `Ingredient`), not `name`.
   - So `include: { ingredients: ... }` should be `include: { productIngredients: { include: { ingredient: { select: { name: true } } } } }`
7. **products.service.ts**: Fix import
8. **profiles.repository.ts**: 
   - Fix import
   - `this.prisma.profile` → `this.prisma.familyProfile` (model is `FamilyProfile`)
   - But `FamilyProfile` only has `id`, `name`, `type` - no `description`, no `modifiers`
   - `findIngredientByName` uses `findUnique({ where: { name } })` → `findFirst`
9. **profiles.service.ts**: Fix import
10. **test/helpers/in-memory.ts**: The fakes `implements` the repository classes, but the repositories have a `prisma` property (from constructor injection). The fakes don't have `prisma`.
11. **test/helpers/world.ts**: Passing fakes where repositories are expected.

For #10 and #11, the issue is that the repositories are classes (not interfaces), and the fakes try to `implements` them. Since the repository classes have a `private readonly prisma` property, the fakes can't satisfy the class type.

The fix: Change the repository classes to be interfaces, or change the fakes to not use `implements`, or change the service constructors to accept the interface.

Actually, the cleanest fix is to extract interfaces from the repository classes. But the instructions say "Do not reorganise." 

Alternative: Make the fakes not use `implements` and just be structurally compatible. But the services type their constructor parameters as the concrete class.

Hmm, the real fix is probably to change the service constructors to accept an interface rather than the concrete class. But that's a reorganization.

Wait, actually the simplest fix: in the repository files, make `prisma` not part of the class type by not declaring it as a class property. In NestJS with constructor injection, the parameter is the class property. But if I use a different pattern...

Actually, the cleanest minimal fix: In the test files, instead of `implements ClassificationRepository`, just don't use `implements`. The fakes already have all the methods. The issue is that the service constructors type their params as the class.

Looking at the service:
```ts
constructor(@Inject(ClassificationRepository) private readonly repo: ClassificationRepository) {}
```

This types `repo` as `ClassificationRepository` (the class). The fake needs to be assignable to that type. Since the class has a `private prisma` field, the fake can't be.

The fix options:
1. Extract an interface from each repository class
2. Change the service to accept an interface
3. Make the fake extend the real class (not practical since it needs PrismaService)

I think the right fix is to define interfaces in the repository files and have the services depend on the interfaces. But the instructions say not to reorganize...

Actually wait, let me re-read: "Do not add features, do not rename anything the errors do not mention, do not reorganise."

But the error IS that the fakes can't implement the classes. The fix requires either:
- Making the classes into interfaces (reorganization)
- Adding the `prisma` property to the fakes (hacky)
- Changing the service type annotations (minimal)

I think the minimal fix is to change the service constructor types to accept the interface of methods needed. But that's adding interfaces...

Actually, the simplest fix that doesn't reorganize: just make the `prisma` field not part of the public type. In TypeScript, if you use `private` in the constructor parameter, it IS part of the class type. But if I declare it differently...

Wait, actually in TypeScript, `private` class members ARE part of the nominal type. So a class with a private member can't be satisfied by another class unless it's the same class or a subclass.

The standard NestJS pattern is to use interfaces for testability. The minimal fix here is to extract the method signatures into interfaces.

But hold on - let me look at this differently. What if I just add a `prisma` property to the fakes? Like:

```ts
export class FakeClassificationRepository implements ClassificationRepository {
  private readonly prisma: any = null;
  constructor(private readonly db: InMemoryDb) {}
  // ...
}
```

No, that won't work because `private` in a class is nominal - the fake would need to be the same class or subclass.

Actually wait, `implements` in TypeScript doesn't do nominal checking. It does structural checking. The issue is that the class `ClassificationRepository` has a `prisma` property (even if private, it's part of the type for `implements` purposes... actually no).

Let me think again. In TypeScript:
- `implements` checks structural compatibility
- `private` members make a class nominal (you can't satisfy the type without being the same class or subclass)

So if `ClassificationRepository` has `private readonly prisma: PrismaService`, then no other class can `implements` it.

The fix: Remove `private` from the prisma property, or extract an interface.

Actually, the simplest fix: just remove `private` from the constructor parameter. Then the class is structurally compatible:

```ts
export class ClassificationRepository {
  constructor(@Inject(PrismaService) readonly prisma: PrismaService) {}
  // ...
}
```

But then the fake needs a `prisma` property too. I could add `readonly prisma: any = null` to the fakes.

Hmm, but that's ugly. Let me think of another approach.

Actually, the CLEANEST fix that's minimal: Extract an interface from each repository. The interface has all the public methods. The class implements the interface. The services depend on the interface. The fakes implement the interface.

But the instructions say "do not reorganise." Adding an interface is arguably not a reorganization - it's a fix.

Actually, you know what, let me look at this from the "what makes the compiler pass" angle:

The errors in test/helpers/in-memory.ts are:
```
test/helpers/in-memory.ts(149,14): error TS2720: Class 'FakeClassificationRepository' incorrectly implements class 'ClassificationRepository'.
  Property 'prisma' is missing in type 'FakeClassificationRepository' but required in type 'ClassificationRepository'.
```

So the fix is either:
1. Add `prisma` to the fake
2. Remove `private` from the real class (making it structural)
3. Extract an interface

And in world.ts:
```
test/helpers/world.ts(41,52): error TS2345: Argument of type 'FakeClassificationRepository' is not assignable to parameter of type 'ClassificationRepository'.
```

This is because the service constructor expects `ClassificationRepository` (the class), and the fake isn't assignable.

The minimal fix that touches the fewest files: Extract interfaces in the repository files, and change the service type annotations to use the interfaces.

Files to change:
- classification.repository.ts: Add `ClassificationRepositoryInterface` (or similar), have the class implement it
- methodology.repository.ts: Same
- products.repository.ts: Same  
- profiles.repository.ts: Same
- classification.service.ts: Change type annotation to use interface
- methodology.service.ts: Same
- products.service.ts: Same
- profiles.service.ts: Same
- test/helpers/in-memory.ts: Change `implements` to use the interface
- test/helpers/world.ts: No change needed if services accept interfaces

Wait, but if I change the service to accept an interface, and the fake implements the interface, then world.ts should work.

Let me define the interfaces. Looking at the methods used:

**ClassificationRepository** methods used:
- `loadScoringContext(versionId: string): Promise<ScoringContext | null>`
- `findVersion(id: string): Promise<VersionSummary | null>`
- `findActiveVersion(): Promise<VersionSummary | null>`
- `findProfile(profileId: string): Promise<ProfileRef | null>`
- `findResult(productId: string, methodologyVersionId: string): Promise<StoredResult | null>`
- `upsertResult(input: ...): Promise<StoredResult>`

**MethodologyRepository** methods used:
- `findVersion(id: string): Promise<VersionSummary | null>`
- `findVersionByNumber(version: number): Promise<VersionSummary | null>`
- `findIngredientByName(name: string): Promise<{ id: string; name: string } | null>`
- `createVersion(input: CreateVersionInput): Promise<VersionSummary>`
- `setActive(versionId: string): Promise<void>`

**ProductsRepository** methods used:
- `create(name: string, ingredients: string[]): Promise<ProductRecord>`
- `find(id: string): Promise<ProductRecord | null>`
- `list(): Promise<ProductRecord[]>`

**ProfilesRepository** methods used:
- `findByName(name: string): Promise<ProfileRef | null>`
- `find(id: string): Promise<ProfileRef | null>`
- `list(): Promise<ProfileRef[]>`
- `create(input: PersistProfileInput): Promise<ProfileRef>`
- `findIngredientByName(name: string): Promise<{ id: string; name: string } | null>`

OK so my plan is:

For each repository file:
1. Fix the import (`@nestjs/common`)
2. Add an interface (or type) that captures the public methods
3. Have the class implement that interface
4. Fix any Prisma-specific errors

For each service file:
1. Fix the import (`@nestjs/common`)
2. Change the constructor type to use the interface

For test files:
1. Change `implements` to use the interface
2. world.ts should work once services accept interfaces

Wait, but the test files import the repository classes:
```ts
import type { ClassificationRepository } from '../../src/classification/classification.repository.js';
```

If I add an interface, the test would import that instead. But the test files ARE in the error list, so I can change them.

Actually, let me reconsider. The `implements` keyword in the test files references the class. If I extract an interface, I need to change the `implements` to reference the interface. And the `import type` in the test files needs to import the interface.

Let me also reconsider the `products.repository.ts` errors:

```
src/products/products.repository.ts(14,21): error TS2353: Object literal may only specify known properties, and 'ingredients' does not exist in type ...
src/products/products.repository.ts(15,18): error TS2353: Object literal may only specify known properties, and 'ingredients' does not exist in type 'ProductInclude<DefaultArgs>'.
src/products/products.repository.ts(20,34): error TS2339: Property 'ingredients' does not exist on type '{ id: string; name: string; }'.
src/products/products.repository.ts(20,51): error TS7006: Parameter 'ingredient' implicitly has an 'any' type.
src/products/products.repository.ts(27,18): error TS2353: Object literal may only specify known properties, and 'ingredients' does not exist in type 'ProductInclude<DefaultArgs>'.
src/products/products.repository.ts(33,38): error TS2339: Property 'ingredients' does not exist on type '{ id: string; name: string; }'.
src/products/products.repository.ts(33,55): error TS7006: Parameter 'ingredient' implicitly has an 'any' type.
src/products/products.repository.ts(40,18): error TS2353: Object literal may only specify known properties, and 'ingredients' does not exist in type 'ProductInclude<DefaultArgs>'.
src/products/products.repository.ts(45,34): error TS2339: Property 'ingredients' does not exist on type '{ id: string; name: string; }'.
src/products/products.repository.ts(45,51): error TS7006: Parameter 'ingredient' implicitly has an 'any' type.
```

The Product model has `productIngredients` (relation to `ProductIngredient`), and `ProductIngredient` has `ingredientId` (relation to `Ingredient`). There's no `name` field on `ProductIngredient`.

So to get the ingredient names for a product, I need:
```ts
include: { productIngredients: { include: { ingredient: { select: { name: true } } } } }
```

And then map: `product.productIngredients.map(pi => pi.ingredient.name)`

Let me now write out all the files.

Actually wait - for the `profiles.repository.ts`, the schema has `FamilyProfile` with only `id`, `name`, `type`. The code expects `description` and `modifiers`. The `modifiers` is a relation to `ProfileModifier` which doesn't exist in the schema.

The errors for profiles.repository.ts:
```
src/profiles/profiles.repository.ts(16,39): error TS2339: Property 'profile' does not exist on type 'PrismaService'.
src/profiles/profiles.repository.ts(21,39): error TS2339: Property 'profile' does not exist on type 'PrismaService'.
src/profiles/profiles.repository.ts(26,40): error TS2339: Property 'profile' does not exist on type 'PrismaService'.
src/profiles/profiles.repository.ts(31,39): error TS2339: Property 'profile' does not exist on type 'PrismaService'.
src/profiles/profiles.repository.ts(50,59): error TS2322: Type '{ name: string; }' is not assignable to type 'IngredientWhereUniqueInput'.
```

So:
- `this.prisma.profile` → `this.prisma.familyProfile`
- `findUnique({ where: { name } })` on ingredient → `findFirst({ where: { name } })`

But then `include: { modifiers: true }` won't work because `FamilyProfile` doesn't have a `modifiers` relation. And `profile.description` won't work because the field is `type`.

Hmm, but the compiler doesn't report errors on those lines. Let me look at the actual code:

```ts
async findByName(name: string): Promise<ProfileRef | null> {
  const profile = await this.prisma.profile.findUnique({ where: { name }, include: { modifiers: true } });
  return profile ? toRef(profile) : null;
}
```

The compiler reports error on `this.prisma.profile` (property doesn't exist). Once I fix that to `this.prisma.familyProfile`, then `include: { modifiers: true }` would be a new error because `FamilyProfile` doesn't have `modifiers`. But the compiler only reports the first error it finds...

Actually no, TypeScript reports all type errors it can find. If `this.prisma.profile` doesn't exist, the entire expression is `any` (or an error type), so subsequent property accesses on it don't generate additional errors. That's why we only see the "Property 'profile' does not exist" errors.

So once I fix `this.prisma.profile` → `this.prisma.familyProfile`, I'll get NEW errors for `include: { modifiers: true }` and for the `toRef` function expecting `description` and `modifiers`.

This is the "fixing one file at a time can't see that" problem the instructions mention. I need to fix all the cascading errors.

So for `profiles.repository.ts`, I need to:
- Change `this.prisma.profile` → `this.prisma.familyProfile`
- Remove `include: { modifiers: true }` (since FamilyProfile has no modifiers relation)
- Fix `toRef` to work with the actual `FamilyProfile` shape (which only has `id`, `name`, `type`)
- But `ProfileRef` (in classification.types.ts) probably has `modifiers`...

This is a fundamental mismatch. The schema doesn't support what the code does. I need to make the code work with the schema.

Since `FamilyProfile` only has `id`, `name`, `type`:
- `description` → use `type` as the description, or just provide null
- `modifiers` → there's no way to get them from the DB

But `ProfileRef` has `modifiers: { ingredientId: string; severity: Severity; source: string; note: string | null }[]`.

If I can't change `classification.types.ts`, I need to provide `modifiers` somehow. The only option is to return an empty array.

But then the profile functionality is broken (no modifiers can be applied). However, the task is to fix typecheck errors, not to make the app functional.

OK wait, I think I'm overcomplicating this. Let me re-read the instructions:

"Change exactly what the compiler requires."

The compiler's current output is what I need to fix. The cascading errors that would appear after fixing these are NOT in the list. But the instructions also say "Fix all of them in one reply" and the context about "nineteen single-file rounds" suggests I should fix everything that would prevent the build from passing.

I think the right interpretation is: make the code compile. If fixing error A reveals error B, fix B too. The goal is a clean typecheck.

So let me think about what the final state of each file needs to be to compile cleanly.

Let me now also think about `classification.types.ts`. I don't have this file, and it's not in the error list. So it must compile as-is. I need to work with whatever types it exports.

From usage in the code, I can infer:
- `Severity` is a type (probably a union of strings like 'banned' | 'restricted' | 'watch')
- `VersionSummary` has: `id: string`, `version: number`, `name: string`, `status: string`, `isActive: boolean`
- `StoredResult` has: `id: string`, `productId: string`, `methodologyVersionId: string`, `findings: Finding[]`, `unknowns: string[]`, `confidence: number`, `disclaimer: string`, `classifiedAt: Date`
- `Finding` has: `listedName: string`, `canonicalName: string | null`, `status: string`, `flag: boolean`, `severity: Severity | null`, `source: string | null`, `note: string | null`
- `BaseResult` has: `findings: Finding[]`, `unknowns: string[]`, `confidence: number`, `disclaimer: string`
- `ProfileRef` has: `id: string`, `name: string`, `description: string | null`, `modifiers: { ingredientId: string; severity: Severity; source: string; note: string | null }[]`
- `ProductRecord` has: `id: string`, `name: string`, `listedIngredients: string[]`
- `ScoringContext` has: `version: VersionSummary`, `rules: { ingredientId: string; severity: Severity; source: string; note: string | null }[]`, `ingredientNameById: Record<string, string>`, `synonymFormToIngredientId: Record<string, string>`, `canonicalNameToIngredientId: Record<string, string>`, `products: ProductRecord[]`
- `ClassificationOutput` has: `productId`, `productName`, `methodologyVersionId`, `methodologyVersion`, `profileId`, `profileName`, `findings`, `unknowns`, `confidence`, `disclaimer`, `classifiedAt`
- `StoredClassificationResponse` has: `productId`, `methodologyVersionId`, `methodologyVersion`, `findings`, `unknowns`, `confidence`, `disclaimer`, `classifiedAt`
- `ModifierRef` has: `ingredientId: string`, `severity: Severity`, `source: string`, `note: string | null`
- `normalizeIngredientName(name: string): string`
- `severityRank(severity: Severity): number`

Now, given the schema constraints, here's my plan for each file:

### prisma/schema.prisma
NOT changing. It's the ground truth.

### src/classification/classification.repository.ts
- Fix import: `@nestjs/common`
- Add interface `ClassificationRepo` (or keep the class name and just export an interface type)
- Actually, to minimize changes, let me just export a type alias for the public methods:

```ts
export type ClassificationRepo = {
  loadScoringContext(versionId: string): Promise<ScoringContext | null>;
  findVersion(id: string): Promise<VersionSummary | null>;
  findActiveVersion(): Promise<VersionSummary | null>;
  findProfile(profileId: string): Promise<ProfileRef | null>;
  findResult(productId: string, methodologyVersionId: string): Promise<StoredResult | null>;
  upsertResult(input: { productId: string; methodologyVersionId: string } & BaseResult): Promise<StoredResult>;
};
```

Wait, but the service currently imports `ClassificationRepository` (the class) and types its constructor param with it. If I add a type alias, the service needs to import and use it.

Actually, the simplest approach: In each repository file, define the class as usual but also export an interface. The class implements the interface. The service imports and uses the interface.

Let me just do it. Here's my plan:

**classification.repository.ts:**
```ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  BaseResult,
  ProfileRef,
  ScoringContext,
  Severity,
  StoredResult,
  VersionSummary,
} from './classification.types.js';

export interface IClassificationRepository {
  loadScoringContext(versionId: string): Promise<ScoringContext | null>;
  findVersion(id: string): Promise<VersionSummary | null>;
  findActiveVersion(): Promise<VersionSummary | null>;
  findProfile(profileId: string): Promise<ProfileRef | null>;
  findResult(productId: string, methodologyVersionId: string): Promise<StoredResult | null>;
  upsertResult(input: { productId: string; methodologyVersionId: string } & BaseResult): Promise<StoredResult>;
}

@Injectable()
export class ClassificationRepository implements IClassificationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  
  // ... methods with fixes
}
```

Hmm wait, but the in-memory fake currently does `implements ClassificationRepository`. If I change it to `implements IClassificationRepository`, that works.

And the service does `@Inject(ClassificationRepository) private readonly repo: IClassificationRepository` - wait, the `@Inject` decorator needs the class/token. In NestJS, `@Inject(ClassificationRepository)` uses the class as a DI token. If the service's type annotation is the interface, that's fine - DI uses the token, the type annotation is just for TypeScript.

Actually, in NestJS, when you do:
```ts
constructor(@Inject(ClassificationRepository) private readonly repo: ClassificationRepository) {}
```

The `@Inject(ClassificationRepository)` tells NestJS to resolve the dependency using `ClassificationRepository` as the token. The type annotation `ClassificationRepository` is just for TypeScript. If I change the type to `IClassificationRepository`, NestJS still resolves it using the class token.

But wait, if the provider is `ClassificationRepository` (the class), and I type it as `IClassificationRepository`, will NestJS be OK with that? Yes, because the DI container stores the instance by token, and the type annotation is erased at runtime.

OK so my plan works. Let me now write out all the files.

Actually, let me reconsider the interface approach. The instructions say "Do not reorganise." Adding interfaces might be seen as reorganization. But the alternative (making `prisma` non-private, or adding a fake `prisma` to the fakes) is worse.

I think extracting interfaces is the standard fix for this exact problem (testability with NestJS). It's not a reorganization - it's a type-level fix.

Let me also reconsider: do I even need the interface? What if I just change the fakes to not use `implements` and instead just be structurally compatible?

The problem is in `world.ts`:
```ts
const classification = new ClassificationService(classificationRepo);
```

The service constructor types `repo` as `ClassificationRepository`. If the fake isn't assignable to that type (because of the private `prisma`), it fails.

If I change the service to type it as an interface, the fake (which has all the methods) is assignable.

OK, I'll go with the interface approach. Let me write all the files now.

Let me also double-check: the `PrismaService` - where is it defined? It's imported from `../prisma/prisma.service.js`. I don't have that file, but it's presumably:
```ts
@Injectable()
export class PrismaService extends PrismaClient {}
```

This is fine, no changes needed.

Now let me write each file:

### 1. `src/classification/classification.service.ts`

Changes:
- Import from `@nestjs/common` instead of `@nestjs/core`
- Import `IClassificationRepository` instead of `ClassificationRepository`
- Change constructor type to `IClassificationRepository`
- Fix the sort on line 201: `findings.sort((a, b) => compareByNormalized(a.listedName, b.listedName));`

Wait, looking at the original:
```ts
findings.sort(compareByNormalized);
unknowns.sort(compareByNormalized);
```

`unknowns` is `string[]`, so `unknowns.sort(compareByNormalized)` is fine.
`findings` is `Finding[]`, so I need a different comparator.

Fix:
```ts
findings.sort((a, b) => compareByNormalized(a.listedName, b.listedName));
unknowns.sort(compareByNormalized);
```

### 2. `src/classification/classification.repository.ts`

Changes:
- Import from `@nestjs/common`
- Add `IClassificationRepository` interface
- Class implements the interface
- In `upsertResult`: remove `unknowns` from create and update
- In `toStoredResult`: accept row without `unknowns` and `classifiedAt`, derive them
- In `loadScoringContext`: the `rule.source` and `rule.note` - wait, the compiler doesn't report errors on those. Let me check the schema again.

Schema Rule model:
```
model Rule {
  id                   String             @id @default(uuid())
  ingredientId         String             @map("ingredient_id")
  ingredient           Ingredient         @relation(fields: [ingredientId], references: [id])
  severity             String
  sourceCitation       String             @map("source_citation")
  methodologyVersionId String             @map("methodology_version_id")
  methodologyVersion   MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  @@map("rules")
}
```

So the Prisma client for Rule has: `id`, `ingredientId`, `severity`, `sourceCitation`, `methodologyVersionId` (plus relations).

In `loadScoringContext`:
```ts
rules: rules.map((rule) => ({
  ingredientId: rule.ingredientId,
  severity: rule.severity as Severity,
  source: rule.source,  // ERROR: should be rule.sourceCitation
  note: rule.note,      // ERROR: doesn't exist
})),
```

But the compiler doesn't report these as errors! Why?

Oh wait, maybe the Prisma client hasn't been regenerated, or maybe the generated client has different types. But the error list is what the compiler actually reports. If the compiler doesn't report an error on `rule.source`, then either:
1. The Prisma client type for Rule does have a `source` field (maybe the schema was different when the client was generated)
2. The type is `any` for some reason

I'll trust the error list. If the compiler doesn't complain about `rule.source`, I won't change it. But if I change other things in the same file that might affect this... hmm.

Actually, you know what, I think the Prisma client might have been generated from a different version of the schema. The reference schema might not be the one used to generate the client. The errors I see are the REAL errors from the actual generated client.

So I should only fix what the compiler reports. If `rule.source` doesn't error, the generated client must have that field. I'll leave it alone.

Same logic applies to other potential mismatches. I'll ONLY fix what's in the error list.

But wait, for `products.repository.ts`, the compiler DOES report errors about `ingredients` not existing. So the generated client's Product model doesn't have an `ingredients` relation. It has `productIngredients`.

And for `profiles.repository.ts`, the compiler reports `this.prisma.profile` doesn't exist. So the generated client doesn't have a `profile` property. It has `familyProfile`.

OK so let me just fix exactly what's reported, plus any cascading errors that would appear after the fix.

Let me be more careful about cascading errors:

**profiles.repository.ts**: After fixing `this.prisma.profile` → `this.prisma.familyProfile`:
- `include: { modifiers: true }` - will this error? The `FamilyProfile` model only has `id`, `name`, `type`. No `modifiers` relation. So YES, it will error.
- `toRef(profile)` where profile now has `{ id, name, type, modifiers: ... }` - well, `modifiers` won't be there. The `toRef` function expects `description` and `modifiers`.

So I need to fix `toRef` and the include.

But `ProfileRef` (in classification.types.ts) has `description` and `modifiers`. I can't change that. So I need to provide those values somehow.

For `description`: Use `profile.type` as the description, or just `null`.
For `modifiers`: Return an empty array (since there's no modifiers relation in the schema).

But wait, if there are no modifiers, the profile functionality is useless. But the task is to fix typecheck, not to make it functional.

Actually, hold on. Let me look at the `FamilyProfile` model again:
```prisma
model FamilyProfile {
  id   String @id @default(uuid())
  name String
  type String
  @@map("family_profiles")
}
```

It's very minimal. The code expects a much richer model. But I can only work with what's in the schema.

For the `toRef` function, I'll map `type` → `description` (or just use `null` for description) and provide empty `modifiers`.

Wait, but the `create` method also needs to work:
```ts
async create(input: PersistProfileInput): Promise<ProfileRef> {
  const profile = await this.prisma.familyProfile.create({
    data: {
      name: input.name,
      description: input.description,  // ERROR: no description field
      modifiers: { create: ... },      // ERROR: no modifiers relation
    },
    include: { modifiers: true },      // ERROR
  });
  return toRef(profile);
}
```

I need to change this to:
```ts
async create(input: PersistProfileInput): Promise<ProfileRef> {
  const profile = await this.prisma.familyProfile.create({
    data: {
      name: input.name,
      type: input.description ?? 'default',  // map description to type
    },
  });
  return {
    id: profile.id,
    name: profile.name,
    description: profile.type,
    modifiers: [],  // no modifiers stored
  };
}
```

Hmm, but `PersistProfileInput` has `modifiers` with actual data. If I just discard them, the profile won't work. But again, the task is typecheck.

Actually wait, I realize I might be wrong about the schema. Let me re-read the reference schema:

```prisma
model FamilyProfile {
  id   String @id @default(uuid())
  name String
  type String

  @@map("family_profiles")
}
```

Yes, that's all it has. No relations, no description.

OK, I'll make the code work with this minimal model. The `modifiers` will be empty (or I could store them as JSON in the `type` field, but that's hacky). Let me just return empty modifiers.

Actually, you know what, let me look at this from the test's perspective. The test creates a world with profiles that have modifiers. If the repository discards modifiers, the tests will fail at runtime (but the task is typecheck, not runtime). So I just need it to compile.

Let me finalize my approach for profiles:
- `this.prisma.profile` → `this.prisma.familyProfile`
- Remove `include: { modifiers: true }` (or replace with nothing)
- `toRef`: map the actual row shape to `ProfileRef`, using `type` for `description` and `[]` for `modifiers`
- `create`: only create with `name` and `type` (mapping from `description`)
- `findIngredientByName`: use `findFirst` instead of `findUnique`

### 3. `src/methodology/methodology.repository.ts`

Changes:
- Import from `@nestjs/common`
- Add `IMethodologyRepository` interface
- Class implements the interface
- `toSummary`: accept `{ id, version: string, isActive: boolean }`, return with `version: Number(row.version)`, `name: \`v${row.version}\``, `status: row.isActive ? 'active' : 'draft'`
- `findVersionByNumber`: `where: { version: String(version) }` 
- `findIngredientByName`: use `findFirst`
- `createVersion`: `version: String(input.version)`, rules with `sourceCitation` instead of `source`, remove `note`
- `setActive`: remove `status` from updates

Wait, for `createVersion`, the `CreateVersionInput` interface is defined in this file:
```ts
export interface CreateVersionInput {
  version: number;
  name: string;
  rules: { ingredientId: string; severity: Severity; source: string; note: string | null }[];
}
```

The service passes `name` and rules with `source` and `note`. The schema doesn't have `name` on the version or `note` on rules. But the `CreateVersionInput` is an interface I can change since it's in this file.

However, the service's `create` method builds the rules array with `source` and `note`:
```ts
rules.push({
  ingredientId: ingredient.id,
  severity: rule.severity,
  source: rule.source,
  note: rule.note ?? null,
});
```

If I change `CreateVersionInput` to use `sourceCitation` instead of `source` and remove `note`, the service needs to match.

But the service's `CreateMethodologyInput` (which is the public API) has `source` and `note`. The service maps them to `CreateVersionInput`. So I can change `CreateVersionInput` to match the schema, and update the service's mapping.

Let me change:
- `CreateVersionInput.rules` to: `{ ingredientId: string; severity: Severity; sourceCitation: string }[]`
- Remove `name` from `CreateVersionInput` (schema doesn't have it)

And in the service:
```ts
return this.repo.createVersion({ 
  version: input.version, 
  // no name
  rules: rules.map(r => ({ ingredientId: r.ingredientId, severity: r.severity, sourceCitation: r.sourceCitation }))
});
```

Wait, but the service currently builds `rules` as:
```ts
rules.push({
  ingredientId: ingredient.id,
  severity: rule.severity,
  source: rule.source,
  note: rule.note ?? null,
});
```

I need to change this to:
```ts
rules.push({
  ingredientId: ingredient.id,
  severity: rule.severity,
  sourceCitation: rule.source,
});
```

And `CreateVersionInput` becomes:
```ts
export interface CreateVersionInput {
  version: number;
  rules: { ingredientId: string; severity: Severity; sourceCitation: string }[];
}
```

And the `createVersion` method:
```ts
async createVersion(input: CreateVersionInput): Promise<VersionSummary> {
  const row = await this.prisma.methodologyVersion.create({
    data: {
      version: String(input.version),
      rules: {
        create: input.rules.map((rule) => ({
          ingredientId: rule.ingredientId,
          severity: rule.severity,
          sourceCitation: rule.sourceCitation,
        })),
      },
    },
  });
  return toSummary(row);
}
```

### 4. `src/methodology/methodology.service.ts`

Changes:
- Import from `@nestjs/common`
- Import `IMethodologyRepository` instead of `MethodologyRepository`
- Change constructor type
- Fix the `createVersion` call to match new `CreateVersionInput`

### 5. `src/products/products.repository.ts`

Changes:
- Import from `@nestjs/common`
- Add `IProductsRepository` interface
- Class implements the interface
- Fix `include` to use `productIngredients: { include: { ingredient: { select: { name: true } } } }`
- Fix the mapping to get names from `productIngredients[].ingredient.name`

### 6. `src/products/products.service.ts`

Changes:
- Import from `@nestjs/common`
- Import `IProductsRepository` instead of `ProductsRepository`
- Change constructor type

### 7. `src/profiles/profiles.repository.ts`

Changes:
- Import from `@nestjs/common`
- Add `IProfilesRepository` interface
- Class implements the interface
- `this.prisma.profile` → `this.prisma.familyProfile`
- Remove `include: { modifiers: true }`
- Fix `toRef` to work with actual row shape
- Fix `create` to work with actual schema
- `findIngredientByName`: use `findFirst`

### 8. `src/profiles/profiles.service.ts`

Changes:
- Import from `@nestjs/common`
- Import `IProfilesRepository` instead of `ProfilesRepository`
- Change constructor type

### 9. `test/helpers/in-memory.ts`

Changes:
- Import interfaces instead of classes
- Change `implements` to use the interfaces

### 10. `test/helpers/world.ts`

Changes:
- Might need to import interfaces, or might work as-is if services accept interfaces

Actually, looking at world.ts:
```ts
const classification = new ClassificationService(classificationRepo);
const methodology = new MethodologyService(methodologyRepo, classification);
const products = new ProductsService(productsRepo);
const profiles = new ProfilesService(profilesRepo);
```

If the service constructors accept the interfaces, and the fakes implement the interfaces, this should work without changes to world.ts.

But wait, the error in world.ts is:
```
test/helpers/world.ts(41,52): error TS2345: Argument of type 'FakeClassificationRepository' is not assignable to parameter of type 'ClassificationRepository'.
```

If I change the service to accept `IClassificationRepository`, and the fake implements `IClassificationRepository`, then this error goes away. So world.ts might not need changes (the import of `ClassificationService` etc. is for the class, which is still used).

Actually, world.ts imports the services (not the repositories directly for type purposes). Let me check:
```ts
import { ClassificationService } from '../../src/classification/classification.service.js';
import { MethodologyService } from '../../src/methodology/methodology.service.js';
import { ProductsService } from '../../src/products/products.service.js';
import { ProfilesService } from '../../src/profiles/profiles.service.js';
```

These are class imports, which is fine. The fakes are passed to the constructors. If the constructors accept interfaces and the fakes implement those interfaces, it works.

So world.ts doesn't need changes! The error there was a cascade from the service expecting the concrete class.

Let me now write out all the files. I'll be careful to only include files that need changes.

Files to change:
1. `src/classification/classification.service.ts`
2. `src/classification/classification.repository.ts`
3. `src/methodology/methodology.service.ts`
4. `src/methodology/methodology.repository.ts`
5. `src/products/products.repository.ts`
6. `src/products/products.service.ts`
7. `src/profiles/profiles.repository.ts`
8. `src/profiles/profiles.service.ts`
9. `test/helpers/in-memory.ts`

That's 9 files. World.ts doesn't need changes.

Let me write them out now.

Wait, one more thing about the `loadScoringContext` in classification.repository.ts. It uses:
```ts
this.prisma.ingredientSynonym.findMany()
```

The schema has:
```prisma
model Synonym {
  id           String     @id @default(uuid())
  value        String
  ingredientId String     @map("ingredient_id")
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])
  @@map("synonyms")
}
```

So the Prisma client property is `synonym` (not `ingredientSynonym`). And the field is `value` (not `form`).

But the compiler doesn't report an error on `this.prisma.ingredientSynonym`. So either:
1. The generated client does have `ingredientSynonym` (maybe the model was named differently when the client was generated)
2. Or it's somehow not caught

I'll trust the error list and not change it. If the compiler doesn't report it, it's fine.

Similarly, in the seed file (which I'm not changing), it uses `prisma.ingredientSynonym` and `prisma.profile` and `prisma.profileModifier`. These are in the seed file which is not in the error list, so I won't touch it.

OK let me also think about whether `this.prisma.ingredientSynonym` would error. The schema model is `Synonym`, so the Prisma client property would be `synonym`. If the code uses `ingredientSynonym`, it would error... but it's not in the error list.

I think the explanation is that the Prisma client was generated from a different (earlier) version of the schema that had different model names. The reference schema shown might be the "target" schema, but the actual generated client matches a different schema.

In any case, I'll only fix what's in the error list.

Let me now write the final files. I'll be very careful.

Actually, one more consideration: the `IClassificationRepository` interface. The `upsertResult` method takes `{ productId: string; methodologyVersionId: string } & BaseResult`. The `BaseResult` type is from `classification.types.ts`. I need to make sure the interface is correct.

Looking at how it's called:
```ts
await this.repo.upsertResult({
  productId: product.id,
  methodologyVersionId: version.id,
  ...this.scoreBase(product, context),
});
```

And `scoreBase` returns `BaseResult` which has `findings`, `unknowns`, `confidence`, `disclaimer`.

So the input is `{ productId, methodologyVersionId, findings, unknowns, confidence, disclaimer }`.

The interface method:
```ts
upsertResult(input: { productId: string; methodologyVersionId: string } & BaseResult): Promise<StoredResult>;
```

This should work.

Now for the `loadScoringContext` return type, it's `ScoringContext | null`. The `ScoringContext` type is from `classification.types.ts`. I'll use it as-is.

Let me write the files now.

One more thing: in `methodology.repository.ts`, the `findVersionByNumber` method. Currently:
```ts
async findVersionByNumber(version: number): Promise<VersionSummary | null> {
  const row = await this.prisma.methodologyVersion.findUnique({ where: { version } });
  return row ? toSummary(row) : null;
}
```

Error: `Type 'number' is not assignable to type 'string'` (line 21).

Fix: `where: { version: String(version) }`

And the `@@unique([version])` on the model means `findUnique({ where: { version: ... } })` is valid (just needs to be a string).

OK I think I have enough to write all the files. Let me do it.

Actually, I realize I need to double-check one thing. In the `methodology.repository.ts`, the `createVersion` method:

```ts
const row = await this.prisma.methodologyVersion.create({
  data: {
    version: input.version,  // number, but schema has String
    name: input.name,        // not in schema
    rules: { create: [...] },
  },
});
```

After fix:
```ts
const row = await this.prisma.methodologyVersion.create({
  data: {
    version: String(input.version),
    rules: {
      create: input.rules.map((rule) => ({
        ingredientId: rule.ingredientId,
        severity: rule.severity,
        sourceCitation: rule.sourceCitation,
      })),
    },
  },
});
```

But wait, `input.rules` uses `sourceCitation` (after I change `CreateVersionInput`). The Prisma create input for Rule (nested in MethodologyVersion) would need `ingredientId`, `severity`, `sourceCitation` as scalar fields. Let me check if that's the right form.

For nested create in Prisma:
```ts
this.prisma.methodologyVersion.create({
  data: {
    version: "1",
    rules: {
      create: [{
        ingredientId: "...",
        severity: "banned",
        sourceCitation: "...",
      }]
    }
  }
})
```

Yes, this should work. The nested create for `rules` uses the unchecked form (scalar foreign keys).

Now, the error on line 37 says:
```
Type '{ ingredientId: string; severity: Severity; source: string; note: string | null; }[]' is not assignable to type 'RuleCreateWithoutMethodologyVersionInput[]'.
  Type '{ ingredientId: string; severity: Severity; source: string; note: string | null; }' is missing the following properties from type 'RuleCreateWithoutMethodologyVersionInput': sourceCitation, ingredient
```

So it needs `sourceCitation` AND `ingredient` (the relation). Wait, `RuleCreateWithoutMethodologyVersionInput` - this is the "without" variant which excludes the parent relation but includes child relations.

Actually, in Prisma, when you do a nested create, you can use either:
- The "connect" form: `ingredient: { connect: { id: "..." } }`
- The "unchecked" form: `ingredientId: "..."`

The error says it's missing `sourceCitation` and `ingredient`. So it wants the checked form with `ingredient: { connect: ... }` or `ingredient: { create: ... }`.

Hmm, but that's unusual for a nested create. Let me think...

Actually, in Prisma, for a nested `create` in a one-to-many relation, you specify the fields of the child model. The `Rule` model has:
- `ingredientId` (scalar FK)
- `ingredient` (relation)
- `severity`
- `sourceCitation`
- `methodologyVersionId` (scalar FK to parent)
- `methodologyVersion` (relation to parent)

When creating a Rule nested under MethodologyVersion, you don't specify `methodologyVersionId` (it's implicit). For the `ingredient` relation, you can either:
- Use `ingredientId` (unchecked)
- Use `ingredient: { connect: { id } }` (checked)

The error says it's missing `sourceCitation` and `ingredient`. This suggests Prisma wants the checked form: `ingredient: { connect: { id } }` instead of `ingredientId`.

But wait, that's weird. Usually Prisma allows both. Let me re-read the error:

```
Type '{ ingredientId: string; severity: Severity; source: string; note: string | null; }[]' is not assignable to type '(Without<RuleCreateWithoutMethodologyVersionInput, RuleUncheckedCreateWithoutMethodologyVersionInput> & RuleUncheckedCreateWithoutMethodologyVersionInput) | (Without<...> & RuleCreateWithoutMethodologyVersionInput) | RuleCreateWithoutMethodologyVersionInput[] | RuleUncheckedCreateWithoutMethodologyVersionInput[] | u...'.
```

So it's a union type. The first option is `RuleUncheckedCreateWithoutMethodologyVersionInput` (which uses scalar FKs). The second is `RuleCreateWithoutMethodologyVersionInput` (which uses relations).

The error says the object `{ ingredientId, severity, source, note }` is missing `sourceCitation` and `ingredient`. This means:
- It's being checked against `RuleCreateWithoutMethodologyVersionInput` (the checked form)
- The checked form requires `ingredient` (relation) and `sourceCitation`
- The unchecked form would require `ingredientId` and `sourceCitation`

Since the object has `ingredientId` (which matches unchecked) but is missing `sourceCitation`, it fails both forms.

So the fix is: use `sourceCitation` instead of `source`, and either:
- Use unchecked: `{ ingredientId: "...", severity: "...", sourceCitation: "..." }`
- Use checked: `{ ingredient: { connect: { id: "..." } }, severity: "...", sourceCitation: "..." }`

The unchecked form should work: `{ ingredientId, severity, sourceCitation }`. Let me verify: `RuleUncheckedCreateWithoutMethodologyVersionInput` would have `ingredientId`, `severity`, `sourceCitation` (the scalar fields excluding the parent FK).

Yes, I'll use the unchecked form:
```ts
rules: {
  create: input.rules.map((rule) => ({
    ingredientId: rule.ingredientId,
    severity: rule.severity,
    sourceCitation: rule.sourceCitation,
  })),
}
```

This should match `RuleUncheckedCreateWithoutMethodologyVersionInput`.

OK, now let me actually write all the files. I'll be thorough.

Let me also reconsider the `loadScoringContext` in classification.repository.ts. The errors in that file are only about `unknowns` in the upsert and the `toStoredResult` parameter. The `loadScoringContext` method doesn't have reported errors, so I'll leave it as-is (even though it might have issues with `rule.source` etc. - the compiler doesn't report those, so the generated client must support them).

Wait, actually I need to be more careful. Let me look at the exact line numbers in the errors:

```
src/classification/classification.repository.ts(108,9): error TS2353
src/classification/classification.repository.ts(114,9): error TS2353
src/classification/classification.repository.ts(120,27): error TS2345
```

Lines 108, 114, 120. Let me count through the file to see what's on those lines.

The file as shown:
```
1:  import { Inject, Injectable } from '@nestjs/core';
2:  import { Prisma } from '@prisma/client';
3:  import { PrismaService } from '../prisma/prisma.service.js';
4:  import type {
5:    BaseResult,
6:    ProfileRef,
7:    ScoringContext,
8:    Severity,
9:    StoredResult,
10:   VersionSummary,
11: } from './classification.types.js';
12: 
13: @Injectable()
14: export class ClassificationRepository {
15:   constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
16: 
17:   /**
18:    * Everything the classification engine needs to score one methodology
19:    * version: that version's rules, the full lookup tables and every product.
20:    * Read-only access to methodology_versions is duplicated here (the
21:    * methodology module owns writes) to keep module dependencies acyclic.
22:    */
23:   async loadScoringContext(versionId: string): Promise<ScoringContext | null> {
24:     const version = await this.prisma.methodologyVersion.findUnique({ where: { id: versionId } });
25:     if (!version) return null;
26: 
27:     const [rules, synonyms, ingredients, products] = await Promise.all([
28:       this.prisma.rule.findMany({ where: { methodologyVersionId: versionId } }),
29:       this.prisma.ingredientSynonym.findMany(),
30:       this.prisma.ingredient.findMany(),
31:       this.prisma.product.findMany({ include: { ingredients: { select: { name: true } } } }),
32:     ]);
33: 
34:     return {
35:       version: toVersionSummary(version),
36:       rules: rules.map((rule) => ({
37:         ingredientId: rule.ingredientId,
38:         severity: rule.severity as Severity,
39:         source: rule.source,
40:         note: rule.note,
41:       })),
42:       ingredientNameById: Object.fromEntries(ingredients.map((ingredient) => [ingredient.id, ingredient.name])),
43:       synonymFormToIngredientId: Object.fromEntries(synonyms.map((synonym) => [synonym.form, synonym.ingredientId])),
44:       canonicalNameToIngredientId: Object.fromEntries(ingredients.map((ingredient) => [ingredient.name, ingredient.id])),
45:       products: products.map((product) => ({
46:         id: product.id,
47:         name: product.name,
48:         listedIngredients: product.ingredients.map((ingredient) => ingredient.name),
49:       })),
50:     };
51:   }
52: 
53:   async findVersion(id: string): Promise<VersionSummary | null> {
54:     const version = await this.prisma.methodologyVersion.findUnique({ where: { id } });
55:     return version ? toVersionSummary(version) : null;
56:   }
57: 
58:   async findActiveVersion(): Promise<VersionSummary | null> {
59:     const version = await this.prisma.methodologyVersion.findFirst({ where: { isActive: true } });
60:     return version ? toVersionSummary(version) : null;
61:   }
62: 
63:   async findProfile(profileId: string): Promise<ProfileRef | null> {
64:     const profile = await this.prisma.profile.findUnique({
65:       where: { id: profileId },
66:       include: { modifiers: true },
67:     });
68:     if (!profile) return null;
69:     return {
70:       id: profile.id,
71:       name: profile.name,
72:       description: profile.description,
73:       modifiers: profile.modifiers.map((modifier) => ({
74:         ingredientId: modifier.ingredientId,
75:         severity: modifier.severity as Severity,
76:         source: modifier.source,
77:         note: modifier.note,
78:       })),
79:     };
80:   }
81: 
82:   async findResult(productId: string, methodologyVersionId: string): Promise<StoredResult | null> {
83:     const row = await this.prisma.classificationResult.findUnique({
84:       where: { productId_methodologyVersionId: { productId, methodologyVersionId } },
85:     });
86:     return row ? toStoredResult(row) : null;
87:   }
88: 
89:   /**
90:    * Results are keyed by (product, methodology version), so rescoring a
91:    * version simply upserts and is therefore idempotent.
92:    */
93:   async upsertResult(input: {
94:     productId: string;
95:     methodologyVersionId: string;
96:   } & BaseResult): Promise<StoredResult> {
97:     const row = await this.prisma.classificationResult.upsert({
98:       where: {
99:         productId_methodologyVersionId: {
100:          productId: input.productId,
101:          methodologyVersionId: input.methodologyVersionId,
102:        },
103:      },
104:      create: {
105:        productId: input.productId,
106:        methodologyVersionId: input.methodologyVersionId,
107:        findings: toJsonArray(input.findings),
108:        unknowns: toJsonArray(input.unknowns),
109:        confidence: input.confidence,
110:        disclaimer: input.disclaimer,
111:      },
112:      update: {
113:        findings: toJsonArray(input.findings),
114:        unknowns: toJsonArray(input.unknowns),
115:        confidence: input.confidence,
116:        disclaimer: input.disclaimer,
117:        classifiedAt: new Date(),
118:      },
119:    });
120:    return toStoredResult(row);
121:  }
122: }
123: 
124: function toJsonArray(value: unknown): Prisma.JsonArray {
125:   return value as Prisma.JsonArray;
126: }
127: 
128: function toVersionSummary(row: {
129:   id: string;
130:   version: number;
131:   name: string;
132:   status: string;
133:   isActive: boolean;
134: }): VersionSummary {
135:   return { id: row.id, version: row.version, name: row.name, status: row.status,
```

## reply

(empty)
