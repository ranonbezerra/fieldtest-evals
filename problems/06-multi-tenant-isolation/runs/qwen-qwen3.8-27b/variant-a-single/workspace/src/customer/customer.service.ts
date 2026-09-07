import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception.js';
import { CustomerRepository } from './customer.repository.js';

@Injectable()
export class CustomerService {
  constructor(private readonly repository: CustomerRepository) {}

  async create(input: { name: string; email: string }) {
    const data = {
      name: input.name.trim(),
      email: normalizeEmail(input.email),
    };

    try {
      return await this.repository.create(data);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(
          409,
          'email_taken',
          'This email is already registered for the current tenant.',
          { email: data.email },
        );
      }

      throw error;
    }
  }

  list() {
    return this.repository.list();
  }

  async getById(id: string) {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw customerNotFound(id);
    }

    return customer;
  }

  async update(id: string, input: { name?: string; email?: string }) {
    const data: { name?: string; email?: string } = {};

    if (input.name !== undefined) {
      data.name = input.name.trim();
    }

    if (input.email !== undefined) {
      data.email = normalizeEmail(input.email);
    }

    const existing = await this.repository.findById(id);
    if (!existing) {
      throw customerNotFound(id);
    }

    if (Object.keys(data).length === 0) {
      return existing;
    }

    try {
      await this.repository.update(id, data);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(
          409,
          'email_taken',
          'This email is already registered for the current tenant.',
          { email: data.email },
        );
      }

      throw error;
    }

    const updated = await this.repository.findById(id);
    if (!updated) {
      throw customerNotFound(id);
    }

    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw customerNotFound(id);
    }

    const result = await this.repository.delete(id);
    if (result.count === 0) {
      throw customerNotFound(id);
    }
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function customerNotFound(id: string): AppException {
  return new AppException(
    404,
    'customer_not_found',
    'Customer was not found in the current tenant.',
    { id },
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}
