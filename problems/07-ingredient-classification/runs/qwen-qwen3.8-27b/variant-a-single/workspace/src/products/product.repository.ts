import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

export interface ProductWithIngredients {
  id: string;
  name: string;
  ingredients: string[];
}

/**
 * Repository for product and ingredient-list queries.
 *
 * ASSUMPTION: The Prisma client has not been generated in this workspace,
 * so `PrismaClient` is not yet available as an importable type from
 * `@prisma/client`. The generated client will provide the `product`,
 * `ingredient`, and `ingredientSynonym` model delegates on `PrismaService`.
 * This file is written against the expected generated schema shapes.
 */
@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns a product with its ordered ingredient list by name,
   * or null if the product does not exist.
   */
  async findProductWithIngredients(productId: string): Promise<ProductWithIngredients | null> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        ingredients: {
          select: { rawName: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!product) return null;
    return {
      id: product.id,
      name: product.name,
      ingredients: product.ingredients.map((i) => i.rawName),
    };
  }

  /**
   * Returns all products with their ingredient lists.
   * Used during methodology re-scoring.
   */
  async findAllProductsWithIngredients(): Promise<ProductWithIngredients[]> {
    const products = await this.prisma.product.findMany({
      include: {
        ingredients: {
          select: { rawName: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      ingredients: p.ingredients.map((i) => i.rawName),
    }));
  }
}
