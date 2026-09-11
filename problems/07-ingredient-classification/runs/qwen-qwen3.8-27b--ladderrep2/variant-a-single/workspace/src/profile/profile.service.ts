import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { fromPrismaSeverity, toPrismaSeverity, type Severity } from '../common/severity.js';
import { IngredientRepository } from '../ingredient/ingredient.repository.js';
import { ProfileRepository } from './profile.repository.js';

export interface NewProfileModifierInput {
  ingredientId: string;
  severity: Severity;
  reason: string;
}

type ProfileWithModifiers = NonNullable<Awaited<ReturnType<ProfileRepository['findById']>>>;

@Injectable()
export class ProfileService {
  constructor(
    @Inject(ProfileRepository)
    private readonly profiles: ProfileRepository,
    @Inject(IngredientRepository)
    private readonly ingredients: IngredientRepository,
  ) {}

  async create(name: string, modifiers: NewProfileModifierInput[]): Promise<{ id: string; name: string }> {
    const uniqueIngredientIds = [...new Set(modifiers.map((modifier) => modifier.ingredientId))];
    const known = await this.ingredients.findByIds(uniqueIngredientIds);
    const knownIds = new Set(known.map((ingredient) => ingredient.id));
    const missing = uniqueIngredientIds.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      throw new ApiError(400, 'validation_error', 'Every modifier must reference an existing ingredient.', { missingIngredients: missing });
    }
    const profile = await this.profiles.create(
      name,
      modifiers.map((modifier) => ({ ...modifier, severity: toPrismaSeverity(modifier.severity) })),
    );
    return { id: profile.id, name: profile.name };
  }

  list() {
    return this.profiles.list().then((profiles) => profiles.map((profile) => this.toView(profile)));
  }

  async findById(id: string) {
    const profile = await this.profiles.findById(id);
    if (!profile) {
      throw new ApiError(404, 'resource_not_found', 'Profile not found.', { profileId: id });
    }
    return this.toView(profile);
  }

  private toView(profile: ProfileWithModifiers) {
    return {
      id: profile.id,
      name: profile.name,
      createdAt: profile.createdAt.toISOString(),
      modifiers: profile.modifiers.map((modifier) => ({
        id: modifier.id,
        ingredientId: modifier.ingredientId,
        severity: fromPrismaSeverity(modifier.severity),
        reason: modifier.reason,
      })),
    };
  }
}
