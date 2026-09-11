import { Customer, Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CustomerCreateData {
  email: string;
  name?: string;
}

export interface CustomerUpdateData {
  email?: string;
  name?: string;
}

/**
 * The only layer that touches the database for customers. Note what is not
 * here: no tenantId in any query. Scoping and stamping happen structurally in
 * the tenant-aware Prisma client.
 */
@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findUnique({ where: { id } });
  }

  create(data: CustomerCreateData): Promise<Customer> {
    return this.prisma.customer.create({
      data: { email: data.email, name: data.name ?? null } as unknown as Prisma.CustomerUncheckedCreateInput,
    });
  }

  update(id: string, data: CustomerUpdateData): Promise<Customer> {
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.name !== undefined ? { name: data.name } : {}),
      },
    });
  }

  remove(id: string): Promise<Customer> {
    return this.prisma.customer.delete({ where: { id } });
  }
}
