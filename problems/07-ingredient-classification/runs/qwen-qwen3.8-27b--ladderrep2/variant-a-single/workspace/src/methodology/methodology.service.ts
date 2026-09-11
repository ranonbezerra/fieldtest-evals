import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { MethodologyStatus } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { toPrismaSeverity, type Severity } from '../common/severity.js';
import { ClassificationService } from '../classification/classification.service.js';
import { IngredientRepository } from '../ingredient/ingredient.repository.js';
import { MethodologyRepository } from './methodology.repository.js';

export interface NewMethodologyRule {
  ingredientId: string;
  severity: Severity;
  source: string;
}

@Injectable()
export class MethodologyService {
  constructor(
    @Inject(MethodologyRepository)
    private readonly methodologies: MethodologyRepository,
    @Inject(IngredientRepository)
    private readonly ingredients: IngredientRepository,
    // The module cycle (publish triggers re-scoring; classify reads rules) is
    // declared with forwardRef here and in MethodologyModule.
    @Inject(forwardRef(() => ClassificationService))
    private readonly classifications: ClassificationService,
  ) {}

  list() {
    return this.methodologies.list().then((versions) =>
      versions.map((version) => ({
        id: version.id,
        revision: version.revision,
        label: version.label,
        status: version.status === MethodologyStatus.PUBLISHED ? 'published' : 'draft',
        publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
        createdAt: version.createdAt.toISOString(),
        ruleCount: version._count.rules,
      })),
    );
  }

  async create(label: string, rules: NewMethodologyRule[]): Promise<{ id: string; label: string }> {
    const uniqueIngredientIds = [...new Set(rules.map((rule) => rule.ingredientId))];
    const known = await this.ingredients.findByIds(uniqueIngredientIds);
    const knownIds = new Set(known.map((ingredient) => ingredient.id));
    const missing = uniqueIngredientIds.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      throw new ApiError(400, 'validation_error', 'Every rule must reference an existing ingredient.', { missingIngredients: missing });
    }
    const version = await this.methodologies.create(
      label,
      rules.map((rule) => ({ ...rule, severity: toPrismaSeverity(rule.severity) })),
    );
    return { id: version.id, label: version.label };
  }

  /**
   * Publishing is the only write path that changes which methodology is in
   * effect. The version becomes immutable from this point on, and the
   * idempotent re-score stores fresh baseline results for it; results of
   * previous versions are left untouched and remain retrievable.
   */
  async publish(id: string): Promise<{ id: string; label: string; publishedAt: string }> {
    const existing = await this.methodologies.findById(id);
    if (!existing) {
      throw new ApiError(404, 'resource_not_found', 'Methodology version not found.', { methodologyVersionId: id });
    }
    if (existing.status === MethodologyStatus.PUBLISHED) {
      throw new ApiError(
        409,
        'methodology_already_published',
        'A published methodology version is immutable and cannot be published again.',
        { methodologyVersionId: id },
      );
    }
    const version = await this.methodologies.markPublished(id);
    await this.classifications.recomputeForVersion(id);
    return { id: version.id, label: version.label, publishedAt: version.publishedAt ? version.publishedAt.toISOString() : '' };
  }

  /** Idempotent re-scoring of a published version; safe to run repeatedly. */
  rescore(id: string) {
    return this.classifications.recomputeForVersion(id);
  }
}
