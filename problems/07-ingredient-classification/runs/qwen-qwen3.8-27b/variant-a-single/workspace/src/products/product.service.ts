import { Injectable } from '@nestjs/common';
import { IngredientService } from '../ingredients/ingredient.service.js';
import { Errors } from '../common/errors.js';
import { ProductRepository } from './product.repository.js';

@Injectable()
export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly ingredients: IngredientService,
  ) {}

  /**
   * Creates a product with its raw ingredient list. Any entry that does not
   * yet resolve to a canonical ingredient is registered as one (typo
   * spellings included) so later synonym fixtures can map onto it; entries
   * that resolve stay attached to their canonical ingredient.
   */
  async create(name: string, rawIngredientNames: string[]): Promise<{ id: string; name: string }> {
    if (!name.trim()) {
      throw Errors.invalidInput('Product name must not be empty.');
    }
    if (rawIngredientNames.length === 0) {
      throw Errors.invalidInput('A product needs at least one ingredient entry.');
    }
    const seen = new Map<string, string>();
    const resolvedNames: string[] = [];
    for (const rawName of rawIngredientNames) {
      const value = rawName.trim();
      if (!value) {
        continue;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        throw Errors.invalidInput('Duplicate ingredient entry in the product list.', {
          entry: rawName,
        });
      }
      seen.set(key, rawName);
      const resolved = await this.ingredients.resolve(value);
      resolvedNames.push(resolved ? resolved.name : value);
    }
    if (resolvedNames.length === 0) {
      throw Errors.invalidInput('A product needs at least one non-empty ingredient entry.');
    }
    return this.repository.create({ name, ingredients: resolvedNames });
  }

  async findById(id: string) {
    const product = await this.repository.findById(id);
    if (!product) {
      throw Errors.notFound('Product', { productId: id });
    }
    return product;
  }

  async setIngredientEntries(productId: string, rawNames: string[]): Promise<void> {
    await this.findById(productId);
    if (rawNames.length === 0) {
      throw Errors.invalidInput('A product needs at least one ingredient entry.');
    }
    const seen = new Map<string, string>();
    const resolvedNames: string[] = [];
    for (const rawName of rawNames) {
      const value = rawName.trim();
      if (!value) {
        continue;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        throw Errors.invalidInput('Duplicate ingredient entry in the product list.', {
          entry: rawName,
        });
      }
      seen.set(key, rawName);
      const resolved = await this.ingredients.resolve(value);
      resolvedNames.push(resolved ? resolved.name : value);
    }
    if (resolvedNames.length === 0) {
      throw Errors.invalidInput('A product needs at least one non-empty ingredient entry.');
    }
    await this.repository.setIngredientEntries(productId, resolvedNames);
  }
}
