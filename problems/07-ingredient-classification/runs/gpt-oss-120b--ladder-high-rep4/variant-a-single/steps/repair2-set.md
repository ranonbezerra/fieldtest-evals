# repair2-set

## reasoning

```
We need to fix imports and typing. Issues:

1. classification.repository.ts upsert expects resultData Json, but we pass DTO. Need to type cast as any or Json. Use Prisma Json type expects any serializable. Cast resultDto as any.

2. classification.service.ts returns null when product not found but return type ClassificationResultDto; should throw or handle. Change return type to ClassificationResultDto | null? But callers expect not null. In test they assume product exists. Simplify: throw error. Change to throw new HttpException? Better return null? Type error. Change method signature to Promise<ClassificationResultDto | null> and adjust callers? Only used in tests directly, they don't handle null. product always exists. So change to throw error. Replace return null with throw new Error.

3. http-exception.filter import missing types. Use from 'express' Request, Response. Change import line to import { Request, Response } from 'express'; remove express-serve-static-core.

4. test errors: storedV1 and storedV2 possibly null; they use .id etc. Need non-null assertion. In test they access .id after findUnique which could be null. Add non-null assertion. Change test code? We cannot modify test. Instead change Prisma type to make findUnique return not null? Can't. Better adjust repository method getMethodologyVersionByVersion to return non-null? Not. Simpler: change MethodologyVersion findUnique to use rejectOnNotFound? Not. Can't change test. Instead make classification.service classify ensure methodologyVersion exists else throw, but test lines 259,271 refer to storedV1 ... .id after findUnique inside test. That's test code, we can't modify. But we can change type of findUnique to non-null via Prisma client config? Not.

But compile error TS2531: Object is possibly 'null' at test lines. To fix compile, we can add non-null assertions in test, but we can't modify test? Actually we can modify source to make TypeScript think it's not null by using `!` in test? We are allowed to modify any file to make compile pass, including test. So modify test to add `!` after findUnique calls.

Let's edit test file lines 259 and 271.

Implement changes.
```

## reply

### src/classification/classification.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  Ingredient,
  Synonym,
  MethodologyVersion,
  Rule,
  Product,
  Profile,
  ClassificationResult,
} from '@prisma/client';
import { ClassificationResultDto } from './dto/classification-result.dto.js';

@Injectable()
export class ClassificationRepository {
  constructor(public readonly prisma: PrismaService) {}

  async getProductById(productId: number): Promise<Product | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
    });
  }

  async getProfileById(profileId: number): Promise<Profile | null> {
    return this.prisma.profile.findUnique({
      where: { id: profileId },
    });
  }

  async getActiveMethodologyVersion(): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      orderBy: { publishedAt: 'desc' },
    });
  }

  async getMethodologyVersionByVersion(
    version: string,
  ): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
    });
  }

  async getRulesByMethodologyVersionId(versionId: number): Promise<Rule[]> {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  async getAllProducts(): Promise<Product[]> {
    return this.prisma.product.findMany();
  }

  /**
   * Builds a map from normalized name (canonical or synonym) to the ingredient.
   */
  async getIngredientResolutionMap(): Promise<
    Map<string, { id: number; name: string }>
  > {
    const ingredients = await this.prisma.ingredient.findMany({
      include: { synonyms: true },
    });

    const map = new Map<string, { id: number; name: string }>();

    for (const ing of ingredients) {
      const normalizedCanonical = this.normalize(ing.name);
      map.set(normalizedCanonical, { id: ing.id, name: ing.name });

      for (const syn of ing.synonyms) {
        const normalizedSyn = this.normalize(syn.name);
        map.set(normalizedSyn, { id: ing.id, name: ing.name });
      }
    }

    return map;
  }

  async upsertClassificationResult(
    productId: number,
    methodologyVersionId: number,
    resultDto: ClassificationResultDto,
  ): Promise<void> {
    await this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
      create: {
        productId,
        methodologyVersionId,
        // Prisma expects a JSON compatible value; casting satisfies the type checker.
        resultData: resultDto as any,
      },
      update: {
        resultData: resultDto as any,
      },
    });
  }

  private normalize(input: string): string {
    return input
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  }
}
```

### src/classification/classification.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository.js';
import {
  ClassificationResultDto,
  SeverityString,
  IngredientFinding,
} from './dto/classification-result.dto.js';
import { Rule, Severity } from '@prisma/client';

@Injectable()
export class ClassificationService {
  // Map of common OCR typos to canonical ingredient names (lowercased)
  // In a real app, this would be loaded from external fixtures.
  private readonly typoMap: Record<string, string> = {
    // Example entry used in tests
    'vitamina c': 'vitamin c',
    // Add more mappings as needed
  };

  // Deterministic precedence order for profile modifiers.
  // 1. childUnder3
  // 2. pregnant
  private readonly modifierPrecedence: ('childUnder3' | 'pregnant')[] = [
    'childUnder3',
    'pregnant',
  ];

  constructor(private readonly repo: ClassificationRepository) {}

  async classify(
    productId: number,
    profileId?: number,
    versionName?: string,
  ): Promise<ClassificationResultDto> {
    // Load product
    const product = await this.repo.getProductById(productId);
    if (!product) {
      throw new Error('Product not found');
    }

    // Load profile if provided
    const profile = profileId ? await this.repo.getProfileById(profileId) : null;

    // Resolve methodology version (active or explicit)
    const methodologyVersion = versionName
      ? await this.repo.getMethodologyVersionByVersion(versionName)
      : await this.repo.getActiveMethodologyVersion();

    if (!methodologyVersion) {
      throw new Error('Methodology version not found');
    }

    // Load all rules for this version
    const rules = await this.repo.getRulesByMethodologyVersionId(
      methodologyVersion.id,
    );

    // Build a lookup map: ingredientId -> most severe rule
    const ruleMap = new Map<number, Rule>();
    for (const rule of rules) {
      if (rule.ingredientId !== null) {
        const existing = ruleMap.get(rule.ingredientId);
        if (
          !existing ||
          this.severityRank(rule.severity as Severity) >
            this.severityRank(existing.severity as Severity)
        ) {
          ruleMap.set(rule.ingredientId, rule);
        }
      }
    }

    // Load resolution map (normalized name -> canonical ingredient)
    const resolutionMap = await this.repo.getIngredientResolutionMap();

    const findings: IngredientFinding[] = [];
    let recognizedCount = 0;
    const totalCount = product.ingredients.length;

    for (const rawIngredient of product.ingredients) {
      const normalized = this.normalizeIngredient(rawIngredient);
      const typoResolved = this.typoMap[normalized] ?? normalized;
      const resolution = resolutionMap.get(typoResolved);
      if (resolution) {
        // Recognized ingredient
        recognizedCount++;
        const ingredientName = resolution.name;
        const ingredientId = resolution.id;

        const rule = ruleMap.get(ingredientId);
        let flag = false;
        let severity: SeverityString | null = null;
        let sourceCitation: string | null = null;

        if (rule) {
          severity = rule.severity.toLowerCase() as SeverityString;
          sourceCitation = rule.sourceCitation;
          // Base flag: watch severity is informational (not flagged)
          flag = severity !== 'watch';
        }

        // Apply profile modifiers if any
        if (profile) {
          ({ flag, severity } = this.applyModifiers(flag, severity, profile));
        }

        findings.push({
          ingredient: ingredientName,
          flag,
          severity,
          sourceCitation,
        });
      } else {
        // Unknown ingredient
        findings.push({
          ingredient: rawIngredient,
          flag: false,
          severity: null,
          sourceCitation: null,
          unknown: true,
        });
      }
    }

    // Deterministic ordering of findings
    findings.sort((a, b) => a.ingredient.localeCompare(b.ingredient));

    const confidence = totalCount > 0 ? recognizedCount / totalCount : 0;
    const disclaimer = 'Classification based on current methodology version.';

    const resultDto: ClassificationResultDto = {
      productId,
      version: methodologyVersion.version,
      findings,
      confidence,
      disclaimer,
    };

    // Persist result (idempotent upsert)
    await this.repo.upsertClassificationResult(
      productId,
      methodologyVersion.id,
      resultDto,
    );

    return resultDto;
  }

  private normalizeIngredient(input: string): string {
    return input
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  }

  private severityRank(sev: Severity): number {
    // BANNED > RESTRICTED > WATCH
    switch (sev) {
      case Severity.BANNED:
        return 3;
      case Severity.RESTRICTED:
        return 2;
      case Severity.WATCH:
        return 1;
      default:
        return 0;
    }
  }

  private applyModifiers(
    baseFlag: boolean,
    baseSeverity: SeverityString | null,
    profile: { childUnder3: boolean; pregnant: boolean },
  ): { flag: boolean; severity: SeverityString | null } {
    let flag = baseFlag;
    let severity = baseSeverity;

    for (const modifier of this.modifierPrecedence) {
      switch (modifier) {
        case 'childUnder3':
          if (profile.childUnder3 && severity === 'watch') {
            // Flip watch to flagged and upgrade severity to restricted
            flag = true;
            severity = 'restricted';
          }
          break;
        case 'pregnant':
          if (profile.pregnant && severity === 'restricted') {
            // Upgrade restricted to banned for pregnant profile
            severity = 'banned';
            flag = true;
          }
          break;
        default:
          break;
      }
    }

    return { flag, severity };
  }
}
```

### src/common/filters/http-exception.filter.ts
```ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Internal server error';
    const details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null && 'code' in resp) {
        response.status(status).json(resp);
        return;
      }
      if (typeof resp === 'string') {
        message = resp;
      } else if (
        typeof resp === 'object' &&
        resp !== null &&
        'message' in resp
      ) {
        message = (resp as any).message;
      }
      switch (status) {
        case HttpStatus.NOT_FOUND:
          code = 'resource_not_found';
          break;
        case HttpStatus.BAD_REQUEST:
          code = 'bad_request';
          break;
        default:
          code = 'internal_error';
      }
    }

    const errorEnvelope: ErrorEnvelope = {
      error: {
        code,
        message,
        details,
      },
    };

    response.status(status).json(errorEnvelope);
  }
}
```

### test/classification.spec.ts
```ts
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { PrismaClient, Severity } from '@prisma/client';
import { ClassificationService } from '../src/classification/classification.service.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { MethodologyService } from '../src/classification/methodology.service.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Classification', () => {
  let prisma: PrismaClient;
  let repo: ClassificationRepository;
  let classificationService: ClassificationService;
  let methodologyService: MethodologyService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    // Use PrismaService as a thin wrapper; for tests we can pass the client directly
    const prismaService = new PrismaService();
    // @ts-ignore – assign underlying client for simplicity
    prismaService.$connect = async () => {};
    prismaService.$disconnect = async () => {};
    // @ts-ignore
    prismaService.prisma = prisma;

    repo = new ClassificationRepository(prisma as any);
    classificationService = new ClassificationService(repo);
    methodologyService = new MethodologyService(repo, classificationService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const tables = [
      'classification_results',
      'rules',
      'methodology_versions',
      'products',
      'profiles',
      'synonyms',
      'ingredients',
    ];
    for (const table of tables) {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`,
      );
    }
  });

  it('profile flips a finding that base rules alone would not have flagged', async () => {
    // Ingredient
    await prisma.ingredient.create({ data: { name: 'Aloe Vera' } });

    // Publish v1 with watch rule
    await methodologyService.publishVersion('v1', [
      {
        ingredientName: 'Aloe Vera',
        severity: Severity.WATCH,
        sourceCitation: 'Regulator',
      },
    ]);

    // Profile: child under 3
    const profile = await prisma.profile.create({
      data: {
        name: 'Child Under 3',
        childUnder3: true,
        pregnant: false,
      },
    });

    // Product
    const product = await prisma.product.create({
      data: {
        name: 'Test Product',
        ingredients: ['Aloe Vera'],
      },
    });

    // Classification without profile
    const resultNoProfile = await classificationService.classify(product.id);
    const findingNoProfile = resultNoProfile.findings.find(
      (f) => f.ingredient === 'Aloe Vera',
    )!;
    expect(findingNoProfile.flag).toBe(false);
    expect(findingNoProfile.severity).toBe('watch');

    // Classification with profile
    const resultWithProfile = await classificationService.classify(
      product.id,
      profile.id,
    );
    const findingWithProfile = resultWithProfile.findings.find(
      (f) => f.ingredient === 'Aloe Vera',
    )!;
    expect(findingWithProfile.flag).toBe(true);
    expect(findingWithProfile.severity).toBe('restricted');
  });

  it('unrecognized ingredient appears as unknown and confidence drops', async () => {
    // Known ingredient
    await prisma.ingredient.create({ data: { name: 'Water' } });

    // Product with unknown ingredient
    const product = await prisma.product.create({
      data: {
        name: 'Mixed Product',
        ingredients: ['Water', 'MysteryIngredient'],
      },
    });

    // Publish empty methodology
    await methodologyService.publishVersion('v1', []);

    const result = await classificationService.classify(product.id);
    const unknownFinding = result.findings.find((f) => (f as any).unknown);
    expect(unknownFinding).toBeDefined();
    expect(unknownFinding!.ingredient).toBe('MysteryIngredient');
    expect(result.confidence).toBe(0.5);
  });

  it('synonym and OCR typo resolve to canonical ingredient', async () => {
    // Canonical ingredient
    const ingredient = await prisma.ingredient.create({
      data: { name: 'Vitamin C' },
    });

    // Synonym
    await prisma.synonym.create({
      data: {
        name: 'Ascorbic Acid',
        ingredientId: ingredient.id,
      },
    });

    // Publish rule for Vitamin C
    await methodologyService.publishVersion('v1', [
      {
        ingredientName: 'Vitamin C',
        severity: Severity.BANNED,
        sourceCitation: 'Regulator',
      },
    ]);

    // Product with synonym and typo
    const product = await prisma.product.create({
      data: {
        name: 'Vitamin Product',
        ingredients: ['Ascorbic Acid', 'Vitamina C'],
      },
    });

    const result = await classificationService.classify(product.id);
    const findings = result.findings.filter((f) => !(f as any).unknown);
    expect(findings.length).toBe(2);
    for (const f of findings) {
      expect(f.ingredient).toBe('Vitamin C');
      expect(f.flag).toBe(true);
      expect(f.severity).toBe('banned');
    }
  });

  it('same product, two runs produce identical output', async () => {
    await prisma.ingredient.create({ data: { name: 'Water' } });
    await methodologyService.publishVersion('v1', []);

    const product = await prisma.product.create({
      data: {
        name: 'Simple Product',
        ingredients: ['Water'],
      },
    });

    const result1 = await classificationService.classify(product.id);
    const result2 = await classificationService.classify(product.id);
    expect(result1).toEqual(result2);
  });

  it('same product, shuffled ingredient order yields identical output', async () => {
    await prisma.ingredient.create({ data: { name: 'Water' } });
    await prisma.ingredient.create({ data: { name: 'Glycerin' } });
    await methodologyService.publishVersion('v1', []);

    const product = await prisma.product.create({
      data: {
        name: 'Shuffled Product',
        ingredients: ['Glycerin', 'Water'],
      },
    });

    const resultOrdered = await classificationService.classify(product.id);

    // Shuffle ingredient order
    await prisma.product.update({
      where: { id: product.id },
      data: {
        ingredients: ['Water', 'Glycerin'],
      },
    });

    const resultShuffled = await classificationService.classify(product.id);
    expect(resultOrdered).toEqual(resultShuffled);
  });

  it('after publishing v2, both v1 and v2 results coexist', async () => {
    // Ingredient and v1 rule
    await prisma.ingredient.create({ data: { name: 'Water' } });
    await methodologyService.publishVersion('v1', [
      {
        ingredientName: 'Water',
        severity: Severity.BANNED,
        sourceCitation: 'Regulator v1',
      },
    ]);

    const product = await prisma.product.create({
      data: {
        name: 'Versioned Product',
        ingredients: ['Water'],
      },
    });

    // Result for v1
    const resultV1 = await classificationService.classify(
      product.id,
      undefined,
      'v1',
    );
    const findingV1 = resultV1.findings.find((f) => f.ingredient === 'Water')!;
    expect(findingV1.severity).toBe('banned');
    expect(findingV1.sourceCitation).toBe('Regulator v1');

    // Publish v2 with different severity
    await methodologyService.publishVersion('v2', [
      {
        ingredientName: 'Water',
        severity: Severity.RESTRICTED,
        sourceCitation: 'Regulator v2',
      },
    ]);

    // Result for v2
    const resultV2 = await classificationService.classify(
      product.id,
      undefined,
      'v2',
    );
    const findingV2 = resultV2.findings.find((f) => f.ingredient === 'Water')!;
    expect(findingV2.severity).toBe('restricted');
    expect(findingV2.sourceCitation).toBe('Regulator v2');

    // Ensure both rows exist in the DB
    const storedV1 = await prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId: product.id,
          methodologyVersionId: (
            await prisma.methodologyVersion.findUnique({
              where: { version: 'v1' },
            })
          )!.id,
        },
      },
    });
    const storedV2 = await prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId: product.id,
          methodologyVersionId: (
            await prisma.methodologyVersion.findUnique({
              where: { version: 'v2' },
            })
          )!.id,
        },
      },
    });
    expect(storedV1).toBeTruthy();
    expect(storedV2).toBeTruthy();
  });
});
```
