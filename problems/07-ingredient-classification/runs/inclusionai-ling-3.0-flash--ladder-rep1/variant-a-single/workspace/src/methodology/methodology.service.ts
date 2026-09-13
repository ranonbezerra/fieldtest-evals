import { Injectable } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository.js';
import { ClassifyService } from '../classify/classify.service.js';
import { ProductsRepository } from '../products/products.repository.js';
import { normalize } from '../common/normalizer.js';

@Injectable()
export class MethodologyService {
  constructor(
    private readonly repository: MethodologyRepository,
    private readonly classifyService: ClassifyService,
    private readonly productsRepository: ProductsRepository,
  ) {}

  async createVersion(version: string): Promise<void> {
    await this.repository.createVersion(version);
  }

  async addRule(versionId: string, rule: { name: string; severity: string; source: string }): Promise<void> {
    await this.repository.addRule(versionId, rule);
  }

  /**
   * Publish a methodology version and trigger idempotent re-scoring of affected products.
   * Re-scoring is idempotent: classifyService checks for existing results and skips if found.
   */
  async publishVersion(versionId: string): Promise<void> {
    await this.repository.publish(versionId);

    const version = await this.repository.getById(versionId);
    if (!version) return;

    // Determine which ingredients are covered by rules in this version
    const ruleIngredientNames = new Set(
      version.rules.map((r) => normalize(r.name)),
    );

    // Find affected products
    const products = await this.productsRepository.getAll();
    for (const product of products) {
      const ingredients = this.parseIngredients(product.ingredientList);
      const normalized = ingredients.map(normalize);
      const isAffected = normalized.some((n) => ruleIngredientNames.has(n));
      if (isAffected) {
        await this.classifyService.classify(product.id, undefined, versionId);
      }
    }
  }

  private parseIngredients(list: string): string[] {
    return list
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
