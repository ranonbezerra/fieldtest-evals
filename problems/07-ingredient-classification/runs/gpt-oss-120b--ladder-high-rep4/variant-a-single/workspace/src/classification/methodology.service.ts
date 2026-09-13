import { Injectable } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository.js';
import { ClassificationService } from './classification.service.js';
import { Prisma, Severity } from '@prisma/client';

@Injectable()
export class MethodologyService {
  constructor(
    private readonly repo: ClassificationRepository,
    private readonly classificationService: ClassificationService,
  ) {}

  /**
   * Publishes a new immutable methodology version.
   * `rules` is an array of { ingredientName, severity, sourceCitation }.
   */
  async publishVersion(
    version: string,
    rules: Array<{
      ingredientName: string;
      severity: Severity;
      sourceCitation: string;
    }>,
  ): Promise<void> {
    const methodology = await this.repo.prisma.methodologyVersion.create({
      data: { version },
    });

    // Ensure all referenced ingredients exist
    for (const rule of rules) {
      const canonical = this.normalize(rule.ingredientName);
      let ingredient = await this.repo.prisma.ingredient.findFirst({
        where: {
          name: {
            equals: rule.ingredientName,
            mode: 'insensitive',
          },
        },
      });

      if (!ingredient) {
        ingredient = await this.repo.prisma.ingredient.create({
          data: { name: rule.ingredientName },
        });
      }

      await this.repo.prisma.rule.create({
        data: {
          methodologyVersionId: methodology.id,
          ingredientId: ingredient.id,
          severity: rule.severity,
          sourceCitation: rule.sourceCitation,
        },
      });
    }

    // Idempotent re-scoring of all products for this new version
    await this.reScoreAllProducts(methodology.id);
  }

  private async reScoreAllProducts(methodologyVersionId: number): Promise<void> {
    const products = await this.repo.getAllProducts();
    const methodology = await this.repo.prisma.methodologyVersion.findUnique({
      where: { id: methodologyVersionId },
    });
    const versionString = methodology?.version ?? '';

    for (const product of products) {
      // Explicitly pass version name to avoid race conditions with active version lookup
      await this.classificationService.classify(
        product.id,
        undefined,
        versionString,
      );
    }
  }

  private normalize(input: string): string {
    return input
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  }
}
