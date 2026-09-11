import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ProductRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(name: string, ingredientNames: string[]): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { name } });
      if (ingredientNames.length > 0) {
        await tx.productIngredient.createMany({
          data: ingredientNames.map((raw, position) => ({ productId: product.id, position, raw })),
        });
      }
      return { id: product.id };
    });
  }

  findById(id: string) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  findByIdWithIngredients(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
  }

  list() {
    return this.prisma.product.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { ingredients: true } } },
    });
  }

  /** Every product with at least one INCI entry — the population the re-scoring path covers. */
  findAllWithIngredients() {
    return this.prisma.product.findMany({
      where: { ingredients: { some: {} } },
      include: { ingredients: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
