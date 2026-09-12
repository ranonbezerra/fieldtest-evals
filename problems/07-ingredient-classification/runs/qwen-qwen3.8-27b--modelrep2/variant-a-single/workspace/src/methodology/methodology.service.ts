import { Injectable } from '@nestjs/common';
import { EventEmitterService } from '@nestjs/event-emitter';
import { ResourceNotFoundException } from '../common/exceptions.js';
import { IngredientRepository } from '../ingredient/ingredient.repository.js';
import { MethodologyRepository } from './methodology.repository.js';
import type { RuleInput } from './methodology.repository.js';

export const METHODOLOGY_PUBLISHED_EVENT = 'methodology.published';

export interface PublishedMethodology {
  versionId: string;
  rules: RuleInput[];
}

@Injectable()
export class MethodologyService {
  constructor(
    private readonly methodologies: MethodologyRepository,
    private readonly ingredients: IngredientRepository,
    private readonly eventEmitter: EventEmitterService,
  ) {}

  list() {
    return this.methodologies.list();
  }

  async get(id: string) {
    const version = await this.methodologies.findByIdWithRules(id);
    if (!version) {
      throw new ResourceNotFoundException('methodology version', { id });
    }
    return version;
  }

  /**
   * Creates a draft version with its rules. Versions are immutable: the
   * only transition offered is draft -> published.
   */
  async create(input: { label: string; rules: RuleInput[] }) {
    const ingredientIds = [...new Set(input.rules.map((rule) => rule.ingredientId))];
    if (ingredientIds.length > 0) {
      const found = await this.ingredients.findByIds(ingredientIds);
      const missing = ingredientIds.filter(
        (id) => !found.some((ingredient) => ingredient.id === id),
      );
      if (missing.length > 0) {
        throw new ResourceNotFoundException('ingredient', { ingredientIds: missing });
      }
    }
    return this.methodologies.createWithRules(input);
  }

  /**
   * Publishes the version: it becomes the active methodology and the
   * published event triggers an idempotent re-score of all affected
   * products. Publishing an already published version is a no-op.
   */
  async publish(id: string) {
    const result = await this.methodologies.publish(id);
    if (!result) {
      throw new ResourceNotFoundException('methodology version', { id });
    }
    if (result.justPublished) {
      const payload: PublishedMethodology = {
        versionId: result.version.id,
        rules: result.version.rules.map((rule) => ({
          ingredientId: rule.ingredientId,
          severity: rule.severity,
          sourceCitation: rule.sourceCitation,
        })),
      };
      await this.eventEmitter.emitAsync(METHODOLOGY_PUBLISHED_EVENT, payload);
    }
    return result.version;
  }
}
