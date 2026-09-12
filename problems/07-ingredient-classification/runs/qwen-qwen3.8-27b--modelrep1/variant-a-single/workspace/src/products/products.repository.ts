import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ProductRecord } from '../classification/classification.types.js';

export interface IProductsRepository {
  create(name: string, ingredients: string[]): Promise<ProductRecord>;
  find(id: string): Promise<ProductRecord | null>;
  list(): Promise<ProductRecord[]>;
}

@Injectable()
export class ProductsRepository implements IProductsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(name: string, ingredients: string[]): Promise<ProductRecord> {
    // Exact-string dedup only: spellings that differ are kept as distinct
    // listed names; the classifier resolves each of them.
    const deduped = [...new Set(ingredients)];
    const product = await this.prisma.product.create({
      data: { name, ingredients: { create: deduped.map((ingredient) => ({ name: ingredient })) } },
      include: { ingredients: { select: { name: true } } },
    });
    return {
      id: product.id,
      name: product.name,
      listedIngredients: product.ingredients.map((ingredient) => ingredient.name),
    };
  }

  async find(id: string): Promise<ProductRecord | null> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { ingredients: { select: { name: true } } },
    });
    return product
      ? {
          id: product.id,
          name: product.name,
          listedIngredients: product.ingredients.map((ingredient) => ingredient.name),
        }
      : null;
  }

  async list(): Promise<ProductRecord[]> {
    const products = await this.prisma.product.findMany({
      include: { ingredients: { select: { name: true } } },
    });
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      listedIngredients: product.ingredients.map((ingredient) => ingredient.name),
    }));
  }
}
