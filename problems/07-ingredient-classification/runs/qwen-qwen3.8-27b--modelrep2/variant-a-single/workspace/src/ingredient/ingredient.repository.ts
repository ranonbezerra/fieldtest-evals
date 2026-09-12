import { Injectable } from '@nestjs/common';
import type { Ingredient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class IngredientRepository {
  constructor(private readonly prisma: PrismaService) {}

  listWithSynonyms() {
    return this.prisma.ingredient.findMany({
      orderBy: { name: 'asc' },
      include: { synonyms: { orderBy: { alias: 'asc' }, select: { alias: true } } },
    });
  }

  listAll(): Promise<Ingredient[]> {
    return this.prisma.ingredient.findMany({ orderBy: { normalized: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.ingredient.findUnique({ where: { id } });
  }

  findByIds(ids: string[]) {
    return this.prisma.ingredient.findMany({ where: { id: { in: ids } } });
  }

  findByNormalized(normalized: string) {
    return this.prisma.ingredient.findUnique({ where: { normalized } });
  }

  findSynonymByNormalized(normalized: string) {
    return this.prisma.synonym.findUnique({ where: { normalized } });
  }

  listAllSynonymsWithIngredients() {
    return this.prisma.synonym.findMany({
      include: { ingredient: { select: { id: true, name: true, normalized: true } } },
    });
  }

  create(data: { name: string; normalized: string }): Promise<Ingredient> {
    return this.prisma.ingredient.create({ data });
  }

  createSynonym(data: { ingredientId: string; alias: string; normalized: string }) {
    return this.prisma.synonym.create({
      data,
      include: { ingredient: { select: { id: true, name: true } } },
    });
  }
}
