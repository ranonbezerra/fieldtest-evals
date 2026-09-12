import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        ingredients: {
          orderBy: { position: 'asc' },
        },
      },
    });
  }

  async findAllWithIngredients() {
    return this.prisma.product.findMany({
      where: {
        ingredients: { some: {} },
      },
      include: {
        ingredients: {
          orderBy: { position: 'asc' },
        },
      },
    });
  }
}
