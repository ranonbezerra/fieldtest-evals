import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class IngredientRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByNormalizedName(normalized: string) {
    return this.prisma.ingredient.findUnique({
      where: { normalized },
    });
  }

  async findByNormalizedSynonym(normalized: string) {
    const synonym = await this.prisma.ingredientSynonym.findUnique({
      where: { normalizedSynonym: normalized },
      include: { ingredient: true },
    });

    return synonym ? synonym.ingredient : null;
  }
}
