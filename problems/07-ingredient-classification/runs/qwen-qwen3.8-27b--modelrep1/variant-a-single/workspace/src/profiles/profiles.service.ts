import { Inject, Injectable } from '@nestjs/common';
import { normalizeIngredientName, type ProfileRef, type Severity } from '../classification/classification.types.js';
import { ApiException } from '../common/api-exception.js';
import { ProfilesRepository, type IProfilesRepository } from './profiles.repository.js';

export interface CreateProfileInput {
  name: string;
  description?: string;
  modifiers: { ingredient: string; severity: Severity; source: string; note?: string }[];
}

@Injectable()
export class ProfilesService {
  constructor(@Inject(ProfilesRepository) private readonly repo: IProfilesRepository) {}

  async create(input: CreateProfileInput): Promise<ProfileRef> {
    const existing = await this.repo.findByName(input.name);
    if (existing) {
      throw new ApiException('profile_exists', `A profile named "${input.name}" already exists.`, 409, {
        name: input.name,
      });
    }

    const modifiers = [];
    for (const modifier of input.modifiers) {
      const ingredient = await this.repo.findIngredientByName(normalizeIngredientName(modifier.ingredient));
      if (!ingredient) {
        throw new ApiException('unknown_ingredient', `No known ingredient named "${modifier.ingredient}".`, 422, {
          ingredient: modifier.ingredient,
        });
      }
      modifiers.push({
        ingredientId: ingredient.id,
        severity: modifier.severity,
        source: modifier.source,
        note: modifier.note ?? null,
      });
    }

    return this.repo.create({
      name: input.name,
      description: input.description ?? null,
      modifiers,
    });
  }

  list(): Promise<ProfileRef[]> {
    return this.repo.list();
  }
}
