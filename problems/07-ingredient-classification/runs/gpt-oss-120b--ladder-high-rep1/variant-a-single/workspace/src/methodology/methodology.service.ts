import { Injectable, BadRequestException } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository';
import { ClassificationService } from '../classification/classification.service';
import { PrismaService } from '../prisma/prisma.service';
import { Severity } from '@prisma/client';

interface RuleInput {
  ingredientName: string;
  severity: Severity;
  sourceCitation: string;
}

/**
 * Service to manage methodology versions and trigger re-scoring.
 */
@Injectable()
export class MethodologyService {
  constructor(
    private readonly methodologyRepo: MethodologyRepository,
    private readonly classificationService: ClassificationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Publishes a new methodology version with the given rules.
   * Re-scores all existing products. The operation is idempotent.
   *
   * Precedence for rule application:
   * - New version is immutable.
   * - Existing version results are retained.
   * - Re-scoring uses the new version exclusively.
   */
  async publishVersion(versionName: string, rules: RuleInput[]): Promise<void> {
    // Check if version already exists (idempotent)
    const existing = await this.methodologyRepo.findVersionByName(versionName);
    if (existing) {
      return;
    }

    // Transactional creation
    await this.prisma.$transaction(async (tx) => {
      // Deactivate old active versions
      await tx.methodologyVersion.updateMany({
        where: { active: true },
        data: { active: false },
      });

      // Create new version
      const newVersion = await tx.methodologyVersion.create({
        data: {
          version: versionName,
          active: true,
        },
      });

      // Ensure ingredients exist; create if missing and add rules
      for (const rule of rules) {
        const ingredient = await tx.ingredient.upsert({
          where: { name: rule.ingredientName },
          update: {}, // No updates to immutable ingredient
          create: {
            name: rule.ingredientName,
          },
        });

        await tx.rule.create({
          data: {
            ingredientId: ingredient.id,
            severity: rule.severity,
            sourceCitation: rule.sourceCitation,
            methodologyVersionId: newVersion.id,
          },
        });
      }
    });

    // After publishing, re-score all products using the new version
    const newVersion = await this.methodologyRepo.findVersionByName(versionName);
    if (!newVersion) {
      throw new BadRequestException('Failed to retrieve newly created methodology version');
    }

    const productIds = await this.methodologyRepo.findAllProducts();
    for (const p of productIds) {
      // Classify with explicit versionId to ensure idempotency
      await this.classificationService.classify(p.id, undefined, newVersion.id);
    }
  }
}
