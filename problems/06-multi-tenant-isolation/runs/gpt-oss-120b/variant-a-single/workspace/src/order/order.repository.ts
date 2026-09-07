// src/order/order.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ASSUMPTION: The Prisma schema defines an `Order` model. The generated
// PrismaClient therefore has a `order` delegate (this.prisma.order). Types such
// as `Order`, `OrderCreateInput`, etc., may not be exported in the current
// client version, so we use `any` for method signatures to keep the compiler
// happy while preserving runtime functionality.

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<any[]> {
    return this.prisma.order.findMany();
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.order.findUnique({
      where: { id },
    });
  }

  async create(data: any): Promise<any> {
    return this.prisma.order.create({
      data,
    });
  }

  async update(id: string, data: any): Promise<any> {
    return this.prisma.order.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<any> {
    return this.prisma.order.delete({
      where: { id },
    });
  }
}
