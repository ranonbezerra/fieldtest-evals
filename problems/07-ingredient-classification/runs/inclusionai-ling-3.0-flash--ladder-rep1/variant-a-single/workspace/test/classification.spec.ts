import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaService } from "../src/prisma.service.js";
import { ProductService } from "../src/product/product.service.js";
import { MethodologyService } from "../src/methodology/methodology.service.js";
import { ProfileService } from "../src/profile/profile.service.js";
import { SynonymService } from "../src/synonym/synonym.service.js";
import { IngredientService } from "../src/ingredient/ingredient.service.js";
import { ClassificationService } from "../src/classification/classification.service.js";
import { ClassificationRepository } from "../src/classification/classification.repository.js";

let prisma: PrismaService;
let productService: ProductService;
let methodologyService: MethodologyService;
let profileService: ProfileService;
let synonymService: SynonymService;
let ingredientService: IngredientService;
let classificationService: ClassificationService;
let classificationRepo: ClassificationRepository;

beforeEach(async () => {
  prisma = new PrismaService();
  await prisma.$connect();

  ingredientService = new IngredientService(
    new (await import("../src/ingredient/ingredient.repository.js")).IngredientRepository(
      prisma,
    ),
  );
  // Hmm this is getting messy. Let me use a simpler approach.
});
