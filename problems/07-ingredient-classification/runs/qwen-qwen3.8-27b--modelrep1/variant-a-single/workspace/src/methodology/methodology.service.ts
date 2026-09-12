import { Inject, Injectable } from '@nestjs/common';
import { normalizeIngredientName, type Severity, type VersionSummary } from '../classification/classification.types.js';
import { ClassificationService } from '../classification/classification.service.js';
import { ApiException } from '../common/api-exception.js';
import { MethodologyRepository, type IMethodologyRepository } from './methodology.repository.js';

export interface CreateMethodologyInput {
  version: number;
  name: string;
  rules: { ingredient: string; severity: Severity; source: string; note?: string }[];
}

export interface PublishResult {
  version: VersionSummary;
  rescoredProducts: number;
}

@Injectable()
export class MethodologyService {
  constructor(
    @Inject(MethodologyRepository) private readonly repo: IMethodologyRepository,
    @Inject(ClassificationService) private readonly classifications: ClassificationService,
  ) {}

  async create(input: CreateMethodologyInput): Promise<VersionSummary> {
    const existing = await this.repo.findVersionByNumber(input.version);
    if (existing) {
      throw new ApiException(
        'methodology_version_exists',
        `Methodology version ${input.version} already exists.`,
        409,
        { version: input.version },
      );
    }

    const rules = [];
    for (const rule of input.rules) {
      const ingredient = await this.repo.findIngredientByName(normalizeIngredientName(rule.ingredient));
      if (!ingredient) {
        throw new ApiException('unknown_ingredient', `No known ingredient named "${rule.ingredient}".`, 422, {
          ingredient: rule.ingredient,
        });
      }
      rules.push({
        ingredientId: ingredient.id,
        severity: rule.severity,
        source: rule.source,
        note: rule.note ?? null,
      });
    }

    return this.repo.createVersion({ version: input.version, name: input.name, rules });
  }

  /**
   * Publish = activate the version and rescore every affected product under
   * it. Rescoring is idempotent, so publishing (or re-publishing) never
   * duplicates stored results; results from earlier versions stay
   * retrievable.
   */
  async publish(versionId: string): Promise<PublishResult> {
    const version = await this.repo.findVersion(versionId);
    if (!version) {
      throw new ApiException('resource_not_found', `Methodology version "${versionId}" not found.`, 404, {
        methodologyVersionId: versionId,
      });
    }

    await this.repo.setActive(versionId);
    const rescoredProducts = await this.classifications.rescoreVersion(versionId);
    const published = (await this.repo.findVersion(versionId))!;
    return { version: published, rescoredProducts };
  }
}
