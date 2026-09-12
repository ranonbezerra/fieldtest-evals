# solution

## reasoning

```
The problem: We need to implement a solution for a cosmetics ingredient scanner with NestJS, Prisma, and Typescript. The spec is fairly complex. However, we have no existing code base provided except the references. The system instructs we need to "Build the whole solution in one reply." They mention "If files are given above the task, they are the existing codebase and they are real." But there are no code files provided. So we have to create the entire solution, including prisma schema, NestJS modules, controllers, services, repositories, tests, etc.

We need to produce a codebase with appropriate layers: controller, service, repository.

We need to implement:

- Prisma schema for ingredients, synonyms, rules under methodology versions, products, and classification results keyed by (product, methodologyVersion).

- classify(productId, profileId?) in a service: normalizes ingredient list, resolves synonyms/typos, applies base rules from active methodology version, applies profile contextual modifiers, returns output with per-ingredient findings (flag, severity, source citation), unknown ingredients as unknown, overall confidence, disclaimer.

- Publishing a new methodology version triggers idempotent re-scoring of affected products, results stored with version.

- Tests verifying: profile flips finding; unrecognized ingredient appears unknown and lowers confidence; synonym and OCR typo resolve; same product two runs identical output; same product shuffled ingredient order identical output; after publishing v2, both v1 and v2 results retrievable.

- Provide modifier precedence written down.

Given the time and complexity, we need to design a simplified but functional solution that satisfies spec. Because this is a code generation problem, we don't need to produce a fully exhaustive implementation; we need a solution that would compile, pass tests and meet spec. However, we must produce all files as needed.

We'll need to think about the domain model.

Entities:

- Ingredient: id, name (canonical name), maybe createdAt, updatedAt. Use snake_case column naming via @map.

- Synonym: id, ingredientId (FK to Ingredient), synonym (string). Possibly includes typographical errors, synonyms.

- MethodologyVersion: id, version (string or int), active (bool), createdAt.

- Rule: id, methodologyVersionId (FK), ingredientId (FK?), rule_type (banned, restricted, watch), sourceCitation (string). Also severity: enumeration.

We need to store rules. Each rule can be for a particular ingredient? Or maybe for an ingredient name. Probably rules are attached to ingredient (canonical). So Rule references Ingredient (or ingredientName?). The spec says "rules — from the regulator's restricted list and the curated watch list, each with a source citation and a severity of banned / restricted / watch — are grouped under a methodology version."

Thus we have:

- Rule: id, methodologyVersionId, ingredientId, severity (enum 'banned','restricted','watch'), sourceCitation.

Also, need to handle profile contextual modifiers. We'll need a Profile entity: id, name (e.g., child_under_3, pregnancy), maybe a list of modifiers.

ProfileModifier: id, profileId, ingredientId, action (maybe flip flag? Actually the spec says "profile flips a finding that the base rules alone would not have flagged". So we need modifiers that can override base rule for specific ingredient, maybe change severity, flag status. The spec mentions precedence; we can define that profile modifiers have higher precedence than base rules. Or we can define that the profile's modifiers are applied after base rules.

We need to define a classification result: stored classification result keyed by product and methodologyVersion.

Model: ClassificationResult: id, productId, methodologyVersionId, results JSON (maybe as Json field), confidence (float), createdAt.

Alternatively, we can store each ingredient finding as separate row. Simpler: classification result contains a JSON of findings.

Product: id, name, ingredientList (maybe stored as array of strings?), could be in a join table product_ingredients. But we need to support ordering (shuffling) and unknown ingredients. We can store the raw list as array of strings (text[]). Since Prisma's support for PostgreSQL arrays? Prisma supports scalar list fields (like String[]). That would be fine. So product has an ingredientList String[].

We need a repository to fetch product, methodology version, rules, synonyms. The service implements classification.

Normalization: case insensitivity, accents, synonyms, typo fixtures. Provide fixture data for synonyms and typo mapping. We can embed them as JSON in code.

Spec says "provided synonym fixtures". We'll need to embed some example data. Since not provided, we can define a minimal set for tests.

Normalization steps: For each ingredient string in product. Clean it: trim, to lower case, remove accents (maybe using a simple function). Then check if it matches a synonym entry (case-insensitive) that maps to a canonical ingredient. Also check for known OCR typo mapping (e.g., "glycerin" vs "glycerine"?). For simplicity, synonyms table includes synonyms as separate rows referencing ingredient. For typo mapping, we can embed a dictionary.

Resolution: If we find matching ingredient (via synonym or direct match with ingredient name), we resolve to that ingredient ID. Else unknown.

Applying rules:

Base rules: For each resolved ingredient, check if any rule exists in the current active methodology version for that ingredient. If rule exists, produce a finding with flag = true (meaning flagged?), severity = rule.severity, sourceCitation = rule.sourceCitation. If no rule, then no flag (i.e., safe?) But we don't want a binary safe/t Toxic field; we can treat flag as optional? The spec says we need per-ingredient findings (flag, severity, source citation). If no rule, maybe we set flag = false, severity null, sourceCitation null.

But spec wants "safe" not present; we must provide per-ingredient findings for flagged ones, maybe also for unflagged? Not explicit. But we need to include unknown as separate category.

We need profile contextual modifiers: For each ingredient, after base rules, we check if any modifiers for the profile apply. For a profile like "child under 3", it may flip a finding: e.g., a watch list ingredient may become flagged for child. Or maybe a banned ingredient is still banned. We'll implement a simple model: ProfileModifier: id, profileId, ingredientId, severityOverride (enum) and/or flagOverride (boolean). We'll also have a precedence defined: Profile modifiers override base rule (higher precedence). If multiple modifiers for same ingredient (unlikely as only one profile per classification), define deterministic precedence: maybe order by severity (banned > restricted > watch) and then by ruleId. However spec says "Two modifiers touching one ingredient must resolve the same way every time, so the order cannot be whatever the iteration happens to produce." We'll define deterministic ordering by sorting by id.

But since we have only one profile at a time, there won't be multiple modifiers for same ingredient; still we can sort.

Implementation:

- classify(productId, profileId?) returns an object: { findings: IngredientFinding[], unknownIngredients: string[], confidence: number, disclaimer: string }

Where IngredientFinding: { ingredient: string (canonical), flag: boolean, severity: 'banned' | 'restricted' | 'watch' | null, sourceCitation: string | null }

Confidence: ratio of recognized ingredients to total ingredients. Recognized includes those resolved to ingredient (even if flagged or not). Unknown reduce confidence.

Disclaimer: static text maybe: "Classification based on methodology version X."

We also need to store classification results: The service will after computing classification store a ClassificationResult row keyed by productId and methodologyVersionId. Should store the findings JSON (maybe as Json) and confidence and disclaimer, as well as timestamp.

When classify is called, we need to compute results using the active methodology version (the one with active = true). We'll need a repository method to get active methodology.

Publishing a new methodology version: we need a command / service that can create a new MethodologyVersion (active flag maybe default false) and associated rules. It should also re-score products: for each product, compute classification using that version, store result. Idempotent: if classification result already exists for product and version, skip or upsert (replace). Use upsert based on unique constraint (productId, methodologyVersionId). That ensures idempotence.

Tests: We need to write Vitest test files.

We'll need some test data fixtures for synonyms and typo mapping. We'll embed in code.

Given the scope, I'll design:

- Prisma schema: models for Ingredient, Synonym, MethodologyVersion, Rule, Profile, ProfileModifier, Product, ClassificationResult.

- NestJS modules: classification (or scanner) with controller, service, repository.

We'll name feature folder "scanner". So files:

- src/scanner/scanner.module.ts

- src/scanner/scanner.controller.ts

- src/scanner/scanner.service.ts

- src/scanner/scanner.repository.ts

- src/scanner/dto/classify.dto.ts (maybe not needed but we can define simple DTO)

- src/main.ts

- src/app.module.ts

We'll need environment variable for DATABASE_URL.

We'll need migrations: Not required for code.

We'll need tests: test/scanner.spec.ts

Now design code.

First, Prisma schema.

Let's write the Prisma schema:

prisma/schema.prisma:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Severity {
  banned
  restricted
  watch
}

model Ingredient {
  id          Int          @id @default(autoincrement())
  name        String       @unique @map("name")
  synonyms    Synonym[]
  rules       Rule[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@map("ingredients")
}

model Synonym {
  id            Int        @id @default(autoincrement())
  ingredient    Ingredient @relation(fields: [ingredientId], references: [id])
  ingredientId  Int
  synonym       String

  @@unique([synonym])
  @@map("synonyms")
}

model MethodologyVersion {
  id          Int       @id @default(autoincrement())
  version     String    @unique
  active      Boolean   @default(false)
  rules       Rule[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@map("methodology_versions")
}

model Rule {
  id                 Int                @id @default(autoincrement())
  methodologyVersion MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  methodologyVersionId Int
  ingredient         Ingredient         @relation(fields: [ingredientId], references: [id])
  ingredientId       Int
  severity           Severity
  sourceCitation     String

  @@unique([methodologyVersionId, ingredientId])
  @@map("rules")
}

model Profile {
  id        Int              @id @default(autoincrement())
  name      String           @unique
  modifiers ProfileModifier[]
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  @@map("profiles")
}

model ProfileModifier {
  id           Int       @id @default(autoincrement())
  profile      Profile   @relation(fields: [profileId], references: [id])
  profileId    Int
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])
  ingredientId Int
  // If set, overrides severity; if null, no change.
  severityOverride Severity?
  // If set, overrides flag (true means flagged, false means not flagged)
  flagOverride Boolean?

  @@unique([profileId, ingredientId])
  @@map("profile_modifiers")
}

model Product {
  id             Int       @id @default(autoincrement())
  name           String
  // Raw ingredient strings as entered; preserve order
  ingredients    String[]  @map("ingredients")
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@map("products")
}

model ClassificationResult {
  id                 Int                @id @default(autoincrement())
  product            Product            @relation(fields: [productId], references: [id])
  productId          Int
  methodologyVersion MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  methodologyVersionId Int
  // Store findings JSON
  findings           Json
  unknownIngredients String[]
  confidence         Float
  disclaimer         String
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([productId, methodologyVersionId])
  @@map("classification_results")
}
```

We also might need to define type for Json: Prisma uses Json type.

Now the NestJS structure.

src/main.ts:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

src/app.module.ts:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ScannerModule } from './scanner/scanner.module';

@Module({
  imports: [PrismaModule, ScannerModule],
})
export class AppModule {}
```

We'll need a Prisma module to provide Prisma client injection. We'll implement minimal module.

src/prisma/prisma.module.ts:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

src/prisma/prisma.service.ts:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Now scanner module.

src/scanner/scanner.module.ts:

```ts
import { Module } from '@nestjs/common';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';
import { ScannerRepository } from './scanner.repository';

@Module({
  controllers: [ScannerController],
  providers: [ScannerService, ScannerRepository],
  exports: [ScannerService],
})
export class ScannerModule {}
```

Define DTO for classify endpoint: classify(productId, profileId?)

src/scanner/dto/classify.dto.ts:

```ts
import { IsInt, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class ClassifyDto {
  @IsInt()
  @Transform(({ value }) => Number(value))
  productId: number;

  @IsOptional()
  @IsInt()
  @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
  profileId?: number;
}
```

Now the controller: Provide an endpoint POST /classify (or GET?). According to API guidelines, endpoints are kebab-case plural. Let's define endpoint `POST /classifications` maybe.

But the spec doesn't require external API; just classify method. For test we can directly call service.

Nevertheless we can implement a simple POST endpoint.

src/scanner/scanner.controller.ts:

```ts
import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ScannerService } from './scanner.service';
import { ClassifyDto } from './dto/classify.dto';
import { ClassificationResultDto } from './dto/classification-result.dto';

@Controller('classifications')
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

  @Post()
  async classify(@Body() dto: ClassifyDto): Promise<ClassificationResultDto> {
    try {
      const result = await this.scannerService.classify(dto.productId, dto.profileId);
      return result;
    } catch (error) {
      throw new HttpException(
        { error: { code: 'classification_failed', message: (error as Error).message, details: {} } },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
```

Now we need a DTO for classification result. Provide shape.

src/scanner/dto/classification-result.dto.ts:

```ts
export type Severity = 'banned' | 'restricted' | 'watch';

export interface IngredientFindingDto {
  ingredient: string; // canonical name
  flag: boolean;
  severity: Severity | null;
  sourceCitation: string | null;
}

export interface ClassificationResultDto {
  productId: number;
  methodologyVersion: string;
  findings: IngredientFindingDto[];
  unknownIngredients: string[];
  confidence: number; // 0 to 1
  disclaimer: string;
}
```

Now repository: scanner.repository.ts

Implement methods to fetch product, active methodology version, fetch ingredient by name, synonyms, rules, profile modifiers.

src/scanner/scanner.repository.ts:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Ingredient, MethodologyVersion, Rule, Product, Profile, ProfileModifier } from '@prisma/client';

@Injectable()
export class ScannerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getProductById(productId: number): Promise<Product> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException({ error: { code: 'resource_not_found', message: `Product ${productId} not found`, details: {} } });
    }
    return product;
  }

  async getActiveMethodologyVersion(): Promise<MethodologyVersion> {
    const version = await this.prisma.methodologyVersion.findFirst({
      where: { active: true },
    });
    if (!version) {
      throw new NotFoundException({ error: { code: 'resource_not_found', message: 'Active methodology version not found', details: {} } });
    }
    return version;
  }

  async getIngredientByName(name: string): Promise<Ingredient | null> {
    return this.prisma.ingredient.findUnique({
      where: { name },
    });
  }

  async getIngredientBySynonym(synonym: string): Promise<Ingredient | null> {
    const synonymRecord = await this.prisma.synonym.findFirst({
      where: { synonym },
      include: { ingredient: true },
    });
    return synonymRecord?.ingredient ?? null;
  }

  async getRulesForVersion(versionId: number): Promise<Rule[]> {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
      include: { ingredient: true },
    });
  }

  async getProfileById(profileId: number): Promise<Profile | null> {
    return this.prisma.profile.findUnique({
      where: { id: profileId },
    });
  }

  async getProfileModifiers(profileId: number): Promise<ProfileModifier[]> {
    return this.prisma.profileModifier.findMany({
      where: { profileId },
      include: { ingredient: true },
    });
  }

  async upsertClassificationResult(
    productId: number,
    methodologyVersionId: number,
    findings: any,
    unknownIngredients: string[],
    confidence: number,
    disclaimer: string,
  ) {
    // Use upsert to be idempotent
    await this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
      update: {
        findings,
        unknownIngredients,
        confidence,
        disclaimer,
        updatedAt: new Date(),
      },
      create: {
        productId,
        methodologyVersionId,
        findings,
        unknownIngredients,
        confidence,
        disclaimer,
      },
    });
  }

  async getClassificationResult(productId: number, methodologyVersionId: number) {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
    });
  }

  async getAllProducts(): Promise<Product[]> {
    return this.prisma.product.findMany();
  }
}
```

Note: Prisma requires a unique composite key for upsert
```

## reply

(empty)
