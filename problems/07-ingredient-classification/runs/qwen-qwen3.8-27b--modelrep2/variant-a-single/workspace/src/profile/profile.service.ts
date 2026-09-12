import { Injectable } from '@nestjs/common';
import { ResourceNotFoundException } from '../common/exceptions.js';
import { IngredientRepository } from '../ingredient/ingredient.repository.js';
import type { ModifierInput } from './profile.repository.js';
import { ProfileRepository } from './profile.repository.js';

@Injectable()
export class ProfileService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly ingredients: IngredientRepository,
  ) {}

  async create(input: { name: string; description?: string; modifiers: ModifierInput[] }) {
    const ingredientIds = [...new Set(input.modifiers.map((modifier) => modifier.ingredientId))];
    if (ingredientIds.length > 0) {
      const found = await this.ingredients.findByIds(ingredientIds);
      const missing = ingredientIds.filter(
        (id) => !found.some((ingredient) => ingredient.id === id),
      );
      if (missing.length > 0) {
        throw new ResourceNotFoundException('ingredient', { ingredientIds: missing });
      }
    }
    return this.profiles.create(input);
  }

  async get(id: string) {
    const profile = await this.profiles.findById(id);
    if (!profile) {
      throw new ResourceNotFoundException('profile', { id });
    }
    return profile;
  }

  list() {
    return this.profiles.list();
  }
}
