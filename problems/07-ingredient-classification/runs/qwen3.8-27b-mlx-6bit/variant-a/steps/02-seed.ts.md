# 02-seed.ts

## reasoning

```
Let me analyze the plan and references to write the seed file.

From PLAN.md, the seed needs:
- Ingredients (canonical + display names)
- Synonyms (including OCR typos like "gyceryl" → "glycerol")
- Default methodology v1 with rules
- 2 profiles with modifiers
- 2 sample products

The seed must be idempotent (using upsert).

Let me look at the schema to understand the models:
- Ingredient: id, canonicalName, displayName
- Synonym: id, ingredientId, synonymText
- MethodologyVersion: id, version, name, isActive
- Rule: id, methodologyVersionId, ingredientId, severity (SEV_ENUM), flag, sourceCitation
- Profile: id, name, description
- ProfileModifier: id, profileId, ingredientId, severity, flag, sourceCitation
- Product: id, name
- ProductIngredient: id, productId, rawText, position

From the test requirements in the plan:
1. Profile flips a finding: base rule flags ingredient X as `watch`; profile modifier escalates to `banned`
2. Unknown ingredient lowers confidence: product has 5 ingredients, 1 unresolvable → confidence = 0.8
3. Synonym/typo resolves: raw text "gyceryl" → canonical "glycerol"
4. Identical across reruns
5. Shuffled ingredient order: product A [a, b, c] and product B [c, a, b]
6. Both versions coexist

So I need:
- Ingredients that make sense for cosmetics (INCI names)
- Synonyms including OCR typos
- Methodology v1 with rules for some ingredients
- Profile 1 (e.g., child under 3) with modifiers
- Profile 2 (e.g., pregnancy) with modifiers
- Product 1: 5 ingredients, 1 unresolvable (for the unknown test)
- Product 2: 3 ingredients (a, b, c) - for the shuffle test, I'll create two products with the same set in different order

Wait, let me re-read: "2 sample products". The plan says the seed has "2 sample products". But test 5 needs two products with shuffled order. Let me think about this...

Actually, looking more carefully at the plan:
- "2 sample products" - these are the seed products
- The tests will create additional products as needed (e.g., for the shuffle test, the test creates product A and product B)

So the seed just needs 2 products. Let me design them:

Product 1: "Moisturizing Cream" - 5 ingredients, one of which is unresolvable (not in ingredients or synonyms table)
Product 2: "Shampoo" - 3 ingredients

Let me pick realistic INCI ingredients:

Ingredients:
1. Glycerol (canonical: "glycerol", display: "Glycerin")
2. Paraffinum Liquidum (canonical: "paraffinum_liquidum", display: "Mineral Oil")
3. Tocopherol (canonical: "tocopherol", display: "Vitamin E")
4. Phenoxyethanol (canonical: "phenoxyethanol", display: "Phenoxyethanol")
5. Sodium Lauryl Sulfate (canonical: "sodium_lauryl_sulfate", display: "SLS")
6. Fragrance (canonical: "fragrance", display: "Fragrance (Parfum)")

Synonyms (normalized):
- For glycerol: "glycerin", "glycerine", "gyceryl" (OCR typo), "glycerol" (canonical)
- For paraffinum liquidum: "mineral_oil", "paraffin_oil"
- For tocopherol: "vitamin_e", "tocopherol_acetate"
- For phenoxyethanol: "phenoxyethanol" (canonical)
- For sodium lauryl sulfate: "sodium_dodecyl_sulfate", "sls"

Wait, the normalization pipeline is: NFD-decompose → strip combining marks → lowercase → trim → collapse internal whitespace. So the stored values should be in normalized form? Let me re-read...

The plan says: "synonym_text TEXT UNIQUE NOT NULL *(normalized form)*"

So synonym_text is stored in normalized form. The canonical_name should also be in a form that can be matched after normalization. Actually, looking at the repository interface:
```
resolve(normalizedText: string): Promise<{ ingredient: Ingredient; matchedVia: 'canonical' | 'synonym' } | null>;
```

So the repository takes normalized text and tries to match against canonical name (normalized) or synonym text. The canonical_name in the DB might not be normalized, but the resolution would normalize it for comparison. Or perhaps the canonical_name IS in normalized form.

Actually, let me think about this differently. The `resolve` method takes a `normalizedText` and tries to find it. It could:
1. Look up ingredient by canonical_name = normalizedText
2. Look up synonym by synonym_text = normalizedText

For this to work, both canonical_name and synonym_text must be stored in their normalized form.

Let me use normalized forms (lowercase, no accents, single spaces):
- "glycerol"
- "paraffinum liquidum" (note: space, not underscore - normalization collapses whitespace but doesn't replace with underscores)
- "tocopherol"
- "phenoxyethanol"
- "sodium lauryl sulfate"
- "fragrance"

Wait, the normalization is: NFD-decompose → strip combining marks → lowercase → trim → collapse internal whitespace. So "Paraffinum Liquidum" becomes "paraffinum liquidum". No underscores.

OK let me design the seed:

Ingredients (canonical_name is normalized):
1. canonical_name: "glycerol", display_name: "Glycerin"
2. canonical_name: "paraffinum liquidum", display_name: "Mineral Oil"
3. canonical_name: "tocopherol", display_name: "Vitamin E"
4. canonical_name: "phenoxyethanol", display_name: "Phenoxyethanol"
5. canonical_name: "sodium lauryl sulfate", display_name: "SLS"
6. canonical_name: "fragrance", display_name: "Fragrance (Parfum)"

Synonyms (synonym_text is normalized):
- ingredient 1 (glycerol): "glycerin", "glycerine", "gyceryl" (OCR typo)
- ingredient 2 (paraffinum liquidum): "mineral oil", "paraffin oil"
- ingredient 3 (tocopherol): "vitamin e", "tocopherol acetate"
- ingredient 5 (sodium lauryl sulfate): "sodium dodecyl sulfate", "sls"

Methodology v1:
- version: 1, name: "Base Regulatory Rules v1", is_active: true

Rules for v1:
- phenoxyethanol: BANNED, "banned_ingredient", "EU Regulation 1223/2009 Annex II, entry 18"
- sodium lauryl sulfate: RESTRICTED, "restricted_concentration", "EU Regulation 1223/2009 Annex V, 16.0"
- fragrance: WATCH, "sensitization_risk", "EU Scientific Committee SCCS/1596/13"
- paraffinum liquidum: WATCH, "comedogenic_risk", "ICR 2019 comedogenicity index"

Profiles:
1. "Child under 3" - modifiers:
   - phenoxyethanol: BANNED, "banned_for_infants", "EU Reg 1223/2009 Annex II, note for children"
   - fragrance: BANNED, "banned_for_infants", "SCCS opinion 2021: fragrance in products for children under 3"
   - sodium lauryl sulfate: BANNED, "banned_for_infants", "Pediatric dermatology guideline 2020"

2. "Pregnancy" - modifiers:
   - paraffinum liquidum: RESTRICTED, "restricted_during_pregnancy", "OB-GYN recommendation 2022"
   - fragrance: RESTRICTED, "restricted_during_pregnancy", "Hypoallergenic guideline for pregnant women"

Products:
1. "Moisturizing Cream" - 5 ingredients (one unresolvable):
   - position 1: "Glycerin" (resolves to glycerol via synonym)
   - position 2: "Paraffinum Liquidum" (resolves to paraffinum liquidum)
   - position 3: "Tocopherol" (resolves to tocopherol)
   - position 4: "Phenoxyethanol" (resolves to phenoxyethanol)
   - position 5: "Zinc Oxide" (unresolvable - not in ingredients or synonyms)

2. "Gentle Shampoo" - 3 ingredients:
   - position 1: "Water" (hmm, this would be unresolvable too...)

Wait, let me reconsider. The tests create their own products for specific test cases. The seed just provides baseline data. Let me make the 2 sample products reasonable:

Product 1: "Moisturizing Cream" - 5 ingredients, one unresolvable
Product 2: "Shampoo" - 3 ingredients, all resolvable

Actually for the shuffle test (test 5), the plan says: "create product A with ingredients [a, b, c] and product B with [c, a, b]". This would be done in the test itself, not in the seed. The seed just needs 2 sample products for general use.

Let me finalize:

Product 1: "Moisturizing Cream"
- "Glycerin" (position 1) → resolves via synonym to glycerol
- "Paraffinum Liquidum" (position 2) → resolves to paraffinum liquidum
- "Tocopherol" (position 3) → resolves to tocopherol
- "Phenoxyethanol" (position 4) → resolves to phenoxyethanol
- "Zinc Oxide" (position 5) → UNKNOWN (not in DB)

Product 2: "Gentle Shampoo"
- "Sodium Lauryl Sulfate" (position 1) → resolves to sodium lauryl sulfate
- "Fragrance" (position 2) → resolves to fragrance
- "Glycerol" (position 3) → resolves to glycerol

This gives us:
- Test 1 (profile flips): classify product 1 without profile → phenoxyethanol is BANNED. With "Child under 3" profile → fragrance goes from WATCH to BANNED (escalation). Actually phenoxyethanol is already BANNED in base, so the modifier doesn't change it. But fragrance goes from WATCH → BANNED with the child profile. That works for "profile flips a finding".

Wait, actually test 1 says: "base rule flags ingredient X as watch; profile modifier escalates to banned". So I need an ingredient that is WATCH in the base rules and BANNED in a profile modifier. That's fragrance:
- Base rule: WATCH
- Child under 3 modifier: BANNED

That works.

Now for the seed to be idempotent, I'll use upsert for everything. For relationships, I need to handle the case where the parent already exists.

Let me think about the Prisma upsert pattern:
- For simple entities: `upsert({ where: { id }, update: {...}, create: {...} })`
- For entities with unique constraints other than id: use the unique field as where

For ingredients, the unique constraint is `canonicalName`.
For synonyms, the unique constraint is `synonymText`.
For methodology versions, the unique constraint is `version`.
For rules, the unique constraint is `[methodologyVersionId, ingredientId]`.
For profiles - no unique constraint other than id. Hmm, I'll use id for idempotency.
For profile modifiers, the unique constraint is `[profileId, ingredientId]`.
For products - no unique constraint other than id. I'll use id.
For product ingredients, the unique constraint is `[productId, position]`.

Actually for profiles and products, since they don't have a natural unique key other than id, I'll just upsert by id. The seed will always use the same ids (1, 2, etc.) so it's idempotent.

Let me write the seed now. I'll use PrismaClient and make it async.

The file is `prisma/seed.ts`. It should be ESM since the project uses `"type": "module"`.

Wait, actually for Prisma seed files, the convention is usually CommonJS or ESM depending on the project setup. The plan says ESM with `"type": "module"`. So I'll use `import` syntax.

Let me write it:

```ts
import { PrismaClient, SEV_ENUM } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // --- Ingredients ---
  const glycerol = await prisma.ingredient.upsert({
    where: { canonicalName: 'glycerol' },
    update: { displayName: 'Glycerin' },
    create: { canonicalName: 'glycerol', displayName: 'Glycerin' },
  });

  const paraffinumLiquidum = await prisma.ingredient.upsert({
    where: { canonicalName: 'paraffinum liquidum' },
    update: { displayName: 'Mineral Oil' },
    create: { canonicalName: 'paraffinum liquidum', displayName: 'Mineral Oil' },
  });

  const tocopherol = await prisma.ingredient.upsert({
    where: { canonicalName: 'tocopherol' },
    update: { displayName: 'Vitamin E' },
    create: { canonicalName: 'tocopherol', displayName: 'Vitamin E' },
  });

  const phenoxyethanol = await prisma.ingredient.upsert({
    where: { canonicalName: 'phenoxyethanol' },
    update: { displayName: 'Phenoxyethanol' },
    create: { canonicalName: 'phenoxyethanol', displayName: 'Phenoxyethanol' },
  });

  const sodiumLaurylSulfate = await prisma.ingredient.upsert({
    where: { canonicalName: 'sodium lauryl sulfate' },
    update: { displayName: 'SLS' },
    create: { canonicalName: 'sodium lauryl sulfate', displayName: 'SLS' },
  });

  const fragrance = await prisma.ingredient.upsert({
    where: { canonicalName: 'fragrance' },
    update: { displayName: 'Fragrance (Parfum)' },
    create: { canonicalName: 'fragrance', displayName: 'Fragrance (Parfum)' },
  });

  // --- Synonyms ---
  const synonyms = [
    { ingredientId: glycerol.id, synonymText: 'glycerin' },
    { ingredientId: glycerol.id, synonymText: 'glycerine' },
    { ingredientId: glycerol.id, synonymText: 'gyceryl' }, // OCR typo fixture
    { ingredientId: paraffinumLiquidum.id, synonymText: 'mineral oil' },
    { ingredientId: paraffinumLiquidum.id, synonymText: 'paraffin oil' },
    { ingredientId: tocopherol.id, synonymText: 'vitamin e' },
    { ingredientId: tocopherol.id, synonymText: 'tocopherol acetate' },
    { ingredientId: sodiumLaurylSulfate.id, synonymText: 'sodium dodecyl sulfate' },
    { ingredientId: sodiumLaurylSulfate.id, synonymText: 'sls' },
  ];

  for (const s of synonyms) {
    await prisma.synonym.upsert({
      where: { synonymText: s.synonymText },
      update: { ingredientId: s.ingredientId },
      create: s,
    });
  }

  // --- Methodology version v1 (active) ---
  const v1 = await prisma.methodologyVersion.upsert({
    where: { version: 1 },
    update: { name: 'Base Regulatory Rules v1', isActive: true },
    create: { version: 1, name: 'Base Regulatory Rules v1', isActive: true },
  });

  // --- Rules for v1 ---
  const rules = [
    { methodologyVersionId: v1.id, ingredientId: phenoxyethanol.id, severity: SEV_ENUM.BANNED, flag: 'banned_ingredient', sourceCitation: 'EU Regulation 1223/2009 Annex II, entry 18' },
    { methodologyVersionId: v1.id, ingredientId: sodiumLaurylSulfate.id, severity: SEV_ENUM.RESTRICTED, flag: 'restricted_concentration', sourceCitation: 'EU Regulation 1223/2009 Annex V, 16.0' },
    { methodologyVersionId: v1.id, ingredientId: fragrance.id, severity: SEV_ENUM.WATCH, flag: 'sensitization_risk', sourceCitation: 'EU Scientific Committee SCCS/1596/13' },
    { methodologyVersionId: v1.id, ingredientId: paraffinumLiquidum.id, severity: SEV_ENUM.WATCH, flag: 'comedogenic_risk', sourceCitation: 'ICR 2019 comedogenicity index' },
  ];

  for (const r of rules) {
    await prisma.rule.upsert({
      where: {
        methodologyVersionId_ingredientId: {
          methodologyVersionId: r.methodologyVersionId,
          ingredientId: r.ingredientId,
        },
      },
      update: { severity: r.severity, flag: r.flag, sourceCitation: r.sourceCitation },
      create: r,
    });
  }

  // --- Profiles ---
  const childProfile = await prisma.profile.upsert({
    where: { id: 1 },
    update: { name: 'Child under 3', description: 'Modifiers for products used on children under 3 years old' },
    create: { id: 1, name: 'Child under 3', description: 'Modifiers for products used on children under 3 years old' },
  });

  const pregnancyProfile = await prisma.profile.upsert({
    where: { id: 2 },
    update: { name: 'Pregnancy', description: 'Modifiers for use during pregnancy' },
    create: { id: 2, name: 'Pregnancy', description: 'Modifiers for use during pregnancy' },
  });

  // --- Profile modifiers ---
  const childModifiers = [
    { profileId: childProfile.id, ingredientId: phenoxyethanol.id, severity: SEV_ENUM.BANNED, flag: 'banned_for_infants', sourceCitation: 'EU Reg 1223/2009 Annex II, note for children' },
    { profileId: childProfile.id, ingredientId: fragrance.id, severity: SEV_ENUM.BANNED, flag: 'banned_for_infants', sourceCitation: 'SCCS opinion 2021: fragrance in products for children under 3' },
    { profileId: childProfile.id, ingredientId: sodiumLaurylSulfate.id, severity: SEV_ENUM.BANNED, flag: 'banned_for_infants', sourceCitation: 'Pediatric dermatology guideline 2020' },
  ];

  const pregnancyModifiers = [
    { profileId: pregnancyProfile.id, ingredientId: paraffinumLiquidum.id, severity: SEV_ENUM.RESTRICTED, flag: 'restricted_during_pregnancy', sourceCitation: 'OB-GYN recommendation 2022' },
    { profileId: pregnancyProfile.id, ingredientId: fragrance.id, severity: SEV_ENUM.RESTRICTED, flag: 'restricted_during_pregnancy', sourceCitation: 'Hypoallergenic guideline for pregnant women' },
  ];

  for (const m of [...childModifiers, ...pregnancyModifiers]) {
    await prisma.profileModifier.upsert({
      where: {
        profileId_ingredientId: {
          profileId: m.profileId,
          ingredientId: m.ingredientId,
        },
      },
      update: { severity: m.severity, flag: m.flag, sourceCitation: m.sourceCitation },
      create: m,
    });
  }

  // --- Products ---
  const product1 = await prisma.product.upsert({
    where: { id: 1 },
    update: { name: 'Moisturizing Cream' },
    create: { id: 1, name: 'Moisturizing Cream' },
  });

  const product2 = await prisma.product.upsert({
    where: { id: 2 },
    update: { name: 'Gentle Shampoo' },
    create: { id: 2, name: 'Gentle Shampoo' },
  });

  // --- Product ingredients ---
  const productIngredients = [
    { productId: product1.id, rawText: 'Glycerin', position: 1 },
    { productId: product1.id, rawText: 'Paraffinum Liquidum', position: 2 },
    { productId: product1.id, rawText: 'Tocopherol', position: 3 },
    { productId: product1.id, rawText: 'Phenoxyethanol', position: 4 },
    { productId: product1.id, rawText: 'Zinc Oxide', position: 5 },
    { productId: product2.id, rawText: 'Sodium Lauryl Sulfate', position: 1 },
    { productId: product2.id, rawText: 'Fragrance', position: 2 },
    { productId: product2.id, rawText: 'Glycerol', position: 3 },
  ];

  for (const pi of productIngredients) {
    await prisma.productIngredient.upsert({
      where: {
        productId_position: {
          productId: pi.productId,
          position: pi.position,
        },
      },
      update: { rawText: pi.rawText },
      create: pi,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Wait, I need to check the Prisma client import. With `prisma-client-js` generator, the import is `@prisma/client`. The enum would be `PrismaClient` and the severity enum. Let me check - in the schema it's `SEV_ENUM` with values `BANNED`, `RESTRICTED`, `WATCH`. In Prisma client, enums are exported as objects. So it would be:

```ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
// Use string values directly: 'BANNED', 'RESTRICTED', 'WATCH'
```

Actually, with Prisma, you can just use the string values directly for enum fields. The type system will accept them. But to be safe and explicit, I could import the enum. Let me check...

With `prisma-client-js`, the generated client exports enums. So:
```ts
import { PrismaClient, SEV_ENUM } from '@prisma/client';
```

Wait, actually Prisma exports enums as objects where the key and value are the same string. So `SEV_ENUM.BANNED` would be `'BANNED'`. Let me use that for clarity.

Actually, I just realized - does Prisma export the enum by its name in the schema? Yes, `SEV_ENUM` would be exported as `SEV_ENUM` from `@prisma/client`.

Let me also double-check the composite unique where clause naming. In Prisma, for a `@@unique([field1, field2])` constraint, the compound unique input type is named by joining the fields with underscores: `field1_field2`. So:
- `@@unique([methodologyVersionId, ingredientId])` → `methodologyVersionId_ingredientId`
- `@@unique([profileId, ingredientId])` → `profileId_ingredientId`
- `@@unique([productId, position])` → `productId_position`

That looks correct.

One thing I'm not sure about: the `SEV_ENUM` import. In newer versions of Prisma, the enum might be accessed differently. But with `prisma-client-js` (the standard generator), enums are exported directly. Let me go with that.

Actually, I want to double-check one more thing. The plan says the file should be at `prisma/seed.ts`. In Prisma, you configure the seed command in `package.json` or in the schema's `generator` block. The standard approach is:

```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

or in the schema:
```
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["seed"]  // not standard
  
  // Actually, seed is configured in package.json
}
```

Anyway, the file just needs to be a valid TypeScript script that can be run. I'll use `import` syntax since the project is ESM.

Let me finalize my seed file. I think it's solid. Let me review once more:

1. ✅ 6 ingredients with canonical (normalized) and display names
2. ✅ 9 synonyms including OCR typo "gyceryl" → glycerol
3. ✅ Methodology v1, active, with 4 rules
4. ✅ 2 profiles (Child under 3, Pregnancy) with modifiers
5. ✅ 2 products with ingredients (product 1 has an unresolvable "Zinc Oxide")
6. ✅ All upserts are idempotent

I think this is complete and correct. Let me write the final version.
```

## reply

```typescript
import { PrismaClient, SEV_ENUM } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // --- Ingredients ---
  const glycerol = await prisma.ingredient.upsert({
    where: { canonicalName: 'glycerol' },
    update: { displayName: 'Glycerin' },
    create: { canonicalName: 'glycerol', displayName: 'Glycerin' },
  });

  const paraffinumLiquidum = await prisma.ingredient.upsert({
    where: { canonicalName: 'paraffinum liquidum' },
    update: { displayName: 'Mineral Oil' },
    create: { canonicalName: 'paraffinum liquidum', displayName: 'Mineral Oil' },
  });

  const tocopherol = await prisma.ingredient.upsert({
    where: { canonicalName: 'tocopherol' },
    update: { displayName: 'Vitamin E' },
    create: { canonicalName: 'tocopherol', displayName: 'Vitamin E' },
  });

  const phenoxyethanol = await prisma.ingredient.upsert({
    where: { canonicalName: 'phenoxyethanol' },
    update: { displayName: 'Phenoxyethanol' },
    create: { canonicalName: 'phenoxyethanol', displayName: 'Phenoxyethanol' },
  });

  const sodiumLaurylSulfate = await prisma.ingredient.upsert({
    where: { canonicalName: 'sodium lauryl sulfate' },
    update: { displayName: 'SLS' },
    create: { canonicalName: 'sodium lauryl sulfate', displayName: 'SLS' },
  });

  const fragrance = await prisma.ingredient.upsert({
    where: { canonicalName: 'fragrance' },
    update: { displayName: 'Fragrance (Parfum)' },
    create: { canonicalName: 'fragrance', displayName: 'Fragrance (Parfum)' },
  });

  // --- Synonyms (normalized text, includes OCR-typo fixtures) ---
  const synonyms = [
    { ingredientId: glycerol.id, synonymText: 'glycerin' },
    { ingredientId: glycerol.id, synonymText: 'glycerine' },
    { ingredientId: glycerol.id, synonymText: 'gyceryl' },
    { ingredientId: paraffinumLiquidum.id, synonymText: 'mineral oil' },
    { ingredientId: paraffinumLiquidum.id, synonymText: 'paraffin oil' },
    { ingredientId: tocopherol.id, synonymText: 'vitamin e' },
    { ingredientId: tocopherol.id, synonymText: 'tocopherol acetate' },
    { ingredientId: sodiumLaurylSulfate.id, synonymText: 'sodium dodecyl sulfate' },
    { ingredientId: sodiumLaurylSulfate.id, synonymText: 'sls' },
  ];

  for (const s of synonyms) {
    await prisma.synonym.upsert({
      where: { synonymText: s.synonymText },
      update: { ingredientId: s.ingredientId },
      create: s,
    });
  }

  // --- Methodology version v1 (active by default) ---
  const v1 = await prisma.methodologyVersion.upsert({
    where: { version: 1 },
    update: { name: 'Base Regulatory Rules v1', isActive: true },
    create: { version: 1, name: 'Base Regulatory Rules v1', isActive: true },
  });

  // --- Rules for v1 ---
  const rules = [
    {
      methodologyVersionId: v1.id,
      ingredientId: phenoxyethanol.id,
      severity: SEV_ENUM.BANNED,
      flag: 'banned_ingredient',
      sourceCitation: 'EU Regulation 1223/2009 Annex II, entry 18',
    },
    {
      methodologyVersionId: v1.id,
      ingredientId: sodiumLaurylSulfate.id,
      severity: SEV_ENUM.RESTRICTED,
      flag: 'restricted_concentration',
      sourceCitation: 'EU Regulation 1223/2009 Annex V, 16.0',
    },
    {
      methodologyVersionId: v1.id,
      ingredientId: fragrance.id,
      severity: SEV_ENUM.WATCH,
      flag: 'sensitization_risk',
      sourceCitation: 'EU Scientific Committee SCCS/1596/13',
    },
    {
      methodologyVersionId: v1.id,
      ingredientId: paraffinumLiquidum.id,
      severity: SEV_ENUM.WATCH,
      flag: 'comedogenic_risk',
      sourceCitation: 'ICR 2019 comedogenicity index',
    },
  ];

  for (const r of rules) {
    await prisma.rule.upsert({
      where: {
        methodologyVersionId_ingredientId: {
          methodologyVersionId: r.methodologyVersionId,
          ingredientId: r.ingredientId,
        },
      },
      update: { severity: r.severity, flag: r.flag, sourceCitation: r.sourceCitation },
      create: r,
    });
  }

  // --- Profiles ---
  const childProfile = await prisma.profile.upsert({
    where: { id: 1 },
    update: { name: 'Child under 3', description: 'Modifiers for products used on children under 3 years old' },
    create: { id: 1, name: 'Child under 3', description: 'Modifiers for products used on children under 3 years old' },
  });

  const pregnancyProfile = await prisma.profile.upsert({
    where: { id: 2 },
    update: { name: 'Pregnancy', description: 'Modifiers for use during pregnancy' },
    create: { id: 2, name: 'Pregnancy', description: 'Modifiers for use during pregnancy' },
  });

  // --- Profile modifiers (tighten-only: escalate severity or add new flags) ---
  const childModifiers = [
    {
      profileId: childProfile.id,
      ingredientId: phenoxyethanol.id,
      severity: SEV_ENUM.BANNED,
      flag: 'banned_for_infants',
      sourceCitation: 'EU Reg 1223/2009 Annex II, note for children',
    },
    {
      profileId: childProfile.id,
      ingredientId: fragrance.id,
      severity: SEV_ENUM.BANNED,
      flag: 'banned_for_infants',
      sourceCitation: 'SCCS opinion 2021: fragrance in products for children under 3',
    },
    {
      profileId: childProfile.id,
      ingredientId: sodiumLaurylSulfate.id,
      severity: SEV_ENUM.BANNED,
      flag: 'banned_for_infants',
      sourceCitation: 'Pediatric dermatology guideline 2020',
    },
  ];

  const pregnancyModifiers = [
    {
      profileId: pregnancyProfile.id,
      ingredientId: paraffinumLiquidum.id,
      severity: SEV_ENUM.RESTRICTED,
      flag: 'restricted_during_pregnancy',
      sourceCitation: 'OB-GYN recommendation 2022',
    },
    {
      profileId: pregnancyProfile.id,
      ingredientId: fragrance.id,
      severity: SEV_ENUM.RESTRICTED,
      flag: 'restricted_during_pregnancy',
      sourceCitation: 'Hypoallergenic guideline for pregnant women',
    },
  ];

  for (const m of [...childModifiers, ...pregnancyModifiers]) {
    await prisma.profileModifier.upsert({
      where: {
        profileId_ingredientId: {
          profileId: m.profileId,
          ingredientId: m.ingredientId,
        },
      },
      update: { severity: m.severity, flag: m.flag, sourceCitation: m.sourceCitation },
      create: m,
    });
  }

  // --- Products ---
  const product1 = await prisma.product.upsert({
    where: { id: 1 },
    update: { name: 'Moisturizing Cream' },
    create: { id: 1, name: 'Moisturizing Cream' },
  });

  const product2 = await prisma.product.upsert({
    where: { id: 2 },
    update: { name: 'Gentle Shampoo' },
    create: { id: 2, name: 'Gentle Shampoo' },
  });

  // --- Product ingredient lists ---
  const productIngredients = [
    { productId: product1.id, rawText: 'Glycerin', position: 1 },
    { productId: product1.id, rawText: 'Paraffinum Liquidum', position: 2 },
    { productId: product1.id, rawText: 'Tocopherol', position: 3 },
    { productId: product1.id, rawText: 'Phenoxyethanol', position: 4 },
    { productId: product1.id, rawText: 'Zinc Oxide', position: 5 },
    { productId: product2.id, rawText: 'Sodium Lauryl Sulfate', position: 1 },
    { productId: product2.id, rawText: 'Fragrance', position: 2 },
    { productId: product2.id, rawText: 'Glycerol', position: 3 },
  ];

  for (const pi of productIngredients) {
    await prisma.productIngredient.upsert({
      where: {
        productId_position: {
          productId: pi.productId,
          position: pi.position,
        },
      },
      update: { rawText: pi.rawText },
      create: pi,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```
