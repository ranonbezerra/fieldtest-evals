import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface IngredientResolution {
  ingredientId: string;
  canonicalName: string;
  matchedAs: 'canonical' | 'synonym';
}

@Injectable()
export class IngredientRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByIds(ids: string[]): Promise<Array<{ id: string; name: string }>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return Promise.resolve([]);
    return this.prisma.ingredient.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  }

  /**
   * Resolves normalized keys to canonical ingredients. A canonical name always
   * beats a synonym when both would match (fixtures never create such a
   * collision, but the rule keeps the mapping total and deterministic).
   */
  async resolveByNormalizedKeys(keys: string[]): Promise<Map<string, IngredientResolution>> {
    const resolution = new Map<string, IngredientResolution>();
    const unique = [...new Set(keys)];
    if (unique.length === 0) return resolution;

    const [ingredients, synonyms] = await Promise.all([
      this.prisma.ingredient.findMany({ where: { normalized: { in: unique } } }),
      this.prisma.synonym.findMany({
        where: { normalized: { in: unique } },
        include: { ingredient: { select: { id: true, name: true } } },
      }),
    ]);

    for (const synonym of synonyms) {
      resolution.set(synonym.normalized, {
        ingredientId: synonym.ingredient.id,
        canonicalName: synonym.ingredient.name,
        matchedAs: 'synonym',
      });
    }
    for (const ingredient of ingredients) {
      resolution.set(ingredient.normalized, {
        ingredientId: ingredient.id,
        canonicalName: ingredient.name,
        matchedAs: 'canonical',
      });
    }
    return resolution;
  }
}
