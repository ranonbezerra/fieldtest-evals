import { Injectable } from '@nestjs/common';
import { PrismaClient, Ingredient } from '@prisma/client';

export interface ResolveResult {
  ingredient: Ingredient;
  matchedVia: 'canonical' | 'synonym';
}

@Injectable()
export class IngredientRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: number): Promise<Ingredient | null> {
    return this.prisma.ingredient.findUnique({ where: { id } });
  }

  async findByName(canonicalName: string): Promise<Ingredient | null> {
    return this.prisma.ingredient.findUnique({ where: { canonicalName } });
  }

  async resolve(normalizedText: string): Promise<ResolveResult | null> {
    const byCanonical = await this.prisma.ingredient.findUnique({
      where: { canonicalName: normalizedText },
    });
    if (byCanonical) {
      return { ingredient: byCanonical, matchedVia: 'canonical' };
    }

    const bySynonym = await this.prisma.synonym.findUnique({
      where: { synonymText: normalizedText },
      include: { ingredient: true },
    });
    if (bySynonym) {
      return { ingredient: bySynonym.ingredient, matchedVia: 'synonym' };
    }

    return null;
  }

  async list(): Promise<Ingredient[]> {
    return this.prisma.ingredient.findMany();
  }
}
