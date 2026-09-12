import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Product, ProductIngredient } from '@prisma/client';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProduct(name: string, ingredientStrings: string[]): Promise<Product> {
    return this.prisma.product.create({
      data: {
        name,
        product_ingredients: {
          create: ingredientStrings.map((s) => ({
            ingredient_string: s,
          })),
        },
      },
    });
  }

  async findById(id: number) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        product_ingredients: true,
      },
    });
  }
}
