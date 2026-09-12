import { Injectable } from '@nestjs/common';
import type { Ingredient } from '@prisma/client';
import {
  AlreadyExistsException,
  InvalidInputException,
  ResourceNotFoundException,
} from '../common/exceptions.js';
import { normalizeLabel } from '../common/normalization.js';
import { IngredientRepository } from './ingredient.repository.js';

@Injectable()
export class IngredientService {
  constructor(private readonly ingredients: IngredientRepository) {}

  list() {
    return this.ingredients.listWithSynonyms();
  }

  async createIngredient(input: { name: string }): Promise<Ingredient> {
    const normalized = normalizeLabel(input.name);
    if (normalized.length === 0) {
      throw new InvalidInputException('Ingredient name must contain visible characters.');
    }
    const existing = await this.ingredients.findByNormalized(normalized);
    if (existing) {
      throw new AlreadyExistsException('ingredient', { name: input.name });
    }
    return this.ingredients.create({ name: input.name.trim(), normalized });
  }

  async createSynonym(input: { ingredientId: string; alias: string }) {
    const ingredient = await this.ingredients.findById(input.ingredientId);
    if (!ingredient) {
      throw new ResourceNotFoundException('ingredient', { ingredientId: input.ingredientId });
    }
    const normalized = normalizeLabel(input.alias);
    if (normalized.length === 0) {
      throw new InvalidInputException('Synonym alias must contain visible characters.');
    }
    const existing = await this.ingredients.findSynonymByNormalized(normalized);
    if (existing) {
      throw new AlreadyExistsException('synonym', { alias: input.alias });
    }
    return this.ingredients.createSynonym({
      ingredientId: ingredient.id,
      alias: input.alias.trim(),
      normalized,
    });
  }
}
