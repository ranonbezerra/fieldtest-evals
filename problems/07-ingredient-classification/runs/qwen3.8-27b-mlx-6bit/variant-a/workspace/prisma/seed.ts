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
