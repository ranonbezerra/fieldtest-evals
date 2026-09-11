import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/app-exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCustomerInput, UpdateCustomerInput } from './customers.service.js';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.client.customer.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.client.customer.findFirst({ where: { id } });
  }

  async create(input: CreateCustomerInput) {
    try {
      return await this.prisma.client.customer.create({ data: input as Prisma.CustomerCreateInput });
    } catch (error) {
      throw this.rethrowUniqueError(error, 'Customer');
    }
  }

  async update(id: string, input: UpdateCustomerInput) {
    try {
      const result = await this.prisma.client.customer.updateMany({ where: { id }, data: input });
      if (result.count === 0) {
        return null;
      }
      return await this.prisma.client.customer.findFirst({ where: { id } });
    } catch (error) {
      throw this.rethrowUniqueError(error, 'Customer');
    }
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.prisma.client.customer.deleteMany({ where: { id } });
    return result.count > 0;
  }

  private rethrowUniqueError(error: unknown, resource: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppException(409, 'duplicate_resource', `${resource} already exists`, {});
    }
    throw error;
  }
}
