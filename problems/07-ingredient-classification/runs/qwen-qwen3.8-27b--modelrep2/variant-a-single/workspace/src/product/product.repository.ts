import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: { name: string; description?: string; ingredients: string[] }) {
    return this.prisma.product.create({
      data: {
        name: input.name,
        description: input.description,
        ingredients:
          input.ingredients.length > 0
            ? { create: input.ingredients.map((label, position) => ({ label, position })) }
            : undefined,
      },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
  }

  findById(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
  }

  list() {
    return this.prisma.product.findMany({
      orderBy: { createdAt: 'asc' },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
  }
}
