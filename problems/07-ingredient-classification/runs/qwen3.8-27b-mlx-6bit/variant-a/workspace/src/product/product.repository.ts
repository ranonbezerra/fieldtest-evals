import { Injectable } from '@nestjs/common';
// ASSUMPTION: prisma service lives at src/prisma.service.ts, matching the relative path '../prisma.service' used by methodology.repository.ts
import { PrismaService } from '../prisma.service';
import type { Product, ProductIngredient } from '@prisma/client';

type ProductWithIngredients = Product & { productIngredients: ProductIngredient[] };

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: number): Promise<ProductWithIngredients | null> {
    return this.prisma.product.findUnique({
      where: { id },
      include: { productIngredients: { orderBy: { position: 'asc' } } },
    });
  }

  async listWithIngredients(): Promise<ProductWithIngredients[]> {
    return this.prisma.product.findMany({
      where: { productIngredients: { some: {} } },
      include: { productIngredients: { orderBy: { position: 'asc' } } },
    });
  }

  async list(): Promise<ProductWithIngredients[]> {
    return this.prisma.product.findMany({
      include: { productIngredients: { orderBy: { position: 'asc' } } },
    });
  }

  async create(name: string, ingredients: string[]): Promise<ProductWithIngredients> {
    return this.prisma.product.create({
      data: {
        name,
        productIngredients: {
          create: ingredients.map((rawText: string, index: number) => ({
            rawText,
            position: index + 1,
          })),
        },
      },
      include: { productIngredients: true },
    });
  }
}
