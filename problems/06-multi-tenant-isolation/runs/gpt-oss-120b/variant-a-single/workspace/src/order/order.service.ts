// src/order/order.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// The original code referenced './update-order.dto' and the
// `Order` type from `@prisma/client`, but those modules are not present
// in the repository. To keep the service compile‑able we provide minimal
// in‑file stand‑ins.
//
// ASSUMPTION: The exact shape of the Order model is not required for the
// compilation of this file, therefore we treat it as `any`.
// ASSUMPTION: The DTOs used elsewhere are simple data carriers; we define the
// fields we need for the service methods.
export class CreateOrderDto {
  // example fields – adjust as needed by the rest of the app
  customerId!: string;
  planId!: string;
  amount!: number;
}

export class UpdateOrderDto {
  // optional fields that may be updated
  amount?: number;
  status?: string;
}

// Service implementing basic CRUD operations for orders. All DB interactions
// are delegated to the tenant‑aware PrismaService; the tenant filter is applied
// automatically by the Prisma middleware, so we do not need to pass `tenantId`
// manually.
@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  // Create a new order for the current tenant.
  async create(data: CreateOrderDto): Promise<any> {
    // `prisma.order` is typed as `any` because the generated Prisma client does
    // not export an `Order` type in this workspace.
    return (this.prisma as any).order.create({ data });
  }

  // Retrieve a single order by its identifier.
  async findOne(id: string): Promise<any> {
    return (this.prisma as any).order.findUnique({
      where: { id },
    });
  }

  // List all orders for the current tenant.
  async findAll(): Promise<any[]> {
    return (this.prisma as any).order.findMany({});
  }

  // Update an existing order – the Prisma middleware ensures the operation
  // only affects rows belonging to the resolved tenant.
  async update(id: string, data: UpdateOrderDto): Promise<any> {
    return (this.prisma as any).order.update({
      where: { id },
      data,
    });
  }

  // Delete an order.
  async remove(id: string): Promise<any> {
    return (this.prisma as any).order.delete({
      where: { id },
    });
  }
}
