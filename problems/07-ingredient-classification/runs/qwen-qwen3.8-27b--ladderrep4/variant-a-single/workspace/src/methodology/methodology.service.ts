import { Injectable, Inject } from '@nestjs/common';
import {
  DuplicateVersionError,
  InvalidRequestError,
  ResourceNotFoundError,
} from '../common/errors.js';
import { ClassificationService, type Severity } from '../classification/classification.service.js';
import { MethodologyRepository } from './methodology.repository.js';

export interface CreateRuleInput {
  ingredientId: string;
  severity: Severity;
  sourceCitation: string;
}

export interface CreateMethodologyInput {
  version: number;
  name?: string;
  rules: CreateRuleInput[];
}

export interface CreateMethodologyResult {
  id: string;
  version: number;
  status: string;
}

export interface PublishResult {
  id: string;
  version: number;
  status: 'published';
  publishedAt: string | null;
  rescoredProducts: number;
}

@Injectable()
export class MethodologyService {
  constructor(
    @Inject(MethodologyRepository) private readonly repository: MethodologyRepository,
    @Inject(ClassificationService) private readonly classification: ClassificationService,
  ) {}

  async create(input: CreateMethodologyInput): Promise<CreateMethodologyResult> {
    const existing = await this.repository.findByVersion(input.version);
    if (existing) throw new DuplicateVersionError(input.version);
    const seen = new Set<string>();
    for (const rule of input.rules) {
      if (seen.has(rule.ingredientId)) {
        throw new InvalidRequestError('Only one rule per ingredient is allowed per version.', {
          ingredientId: rule.ingredientId,
        });
      }
      seen.add(rule.ingredientId);
      const ingredient = await this.repository.findIngredient(rule.ingredientId);
      if (!ingredient) throw new ResourceNotFoundError('ingredient', rule.ingredientId);
    }
    const version = await this.repository.createWithRules(input);
    return { id: version.id, version: version.version, status: version.status };
  }

  /**
   * Publish a version — from then on it is immutable: only status and
   * publishedAt change, never its rules — and trigger the idempotent
   * re-scoring of all products under it. Publishing twice is safe:
   * re-scoring upserts the same rows.
   */
  async publish(methodologyVersionId: string): Promise<PublishResult> {
    const version = await this.repository.findVersion(methodologyVersionId);
    if (!version) throw new ResourceNotFoundError('methodology_version', methodologyVersionId);
    let current = version;
    if (version.status !== 'published') {
      current = await this.repository.markPublished(methodologyVersionId);
    }
    const rescoredProducts = await this.classification.rescoreForVersion(methodologyVersionId);
    return {
      id: current.id,
      version: current.version,
      status: 'published',
      publishedAt: current.publishedAt ? current.publishedAt.toISOString() : null,
      rescoredProducts,
    };
  }
}
