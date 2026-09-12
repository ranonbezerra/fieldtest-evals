import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { ConflictError, NotFoundError } from '../common/api-error.js';
import { isPrismaForeignKeyViolation, isPrismaMissingRecord, isPrismaUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Customer[]> {
    // No tenantId in `where`: the tenant-aware client scopes this automatically.
    return this.prisma.client.customer.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  findById(id: string): Promise<Customer | null> {
    return this.prisma.client.customer.findUnique({ where: { id } });
  }

  async create(data: { email: string; name: string }): Promise<Customer> {
    try {
      return await this.prisma.client.customer.create({ data });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictError('email_already_exists', `A customer with email "${data.email}" already exists in this tenant`);
      }
      throw error;
    }
  }

  async update(id: string, data: { name?: string; email?: string }): Promise<Customer> {
    try {
      return await this.prisma.client.customer.update({ where: { id }, data });
    } catch (error) {
      if (isPrismaMissingRecord(error)) {
        throw new NotFoundError(`Customer with id "${id}" was not found in this tenant`);
      }
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictError('email_already_exists', 'A customer with that email already exists in this tenant');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.client.customer.delete({ where: { id } });
    } catch (error) {
      if (isPrismaMissingRecord(error)) {
        throw new NotFoundError(`Customer with id "${id}" was not found in this tenant`);
      }
      if (isPrismaForeignKeyViolation(error)) {
        throw new ConflictError('delete_restricted', `Customer "${id}" still has orders and cannot be deleted`);
      }
      throw error;
    }
  }
}
