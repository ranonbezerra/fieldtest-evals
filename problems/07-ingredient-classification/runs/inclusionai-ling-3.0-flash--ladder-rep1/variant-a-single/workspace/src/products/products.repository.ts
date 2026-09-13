import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Product } from '@prisma/client';

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(name: string, ingredientList: string): Promise<Product> {
    return this.prisma.product.create({
      data: { name, ingredientList },
    });
  }

  async getById(id: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id } });
  }

  async getAll(): Promise<Product[]> {
    return this.prisma.product.findMany();
  }
}
