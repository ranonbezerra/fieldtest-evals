// src/customer/customer.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';

// ASSUMPTION: The actual DTOs and repository implementations are not required for
// this task.  To keep the file self‑contained and free of compile‑time errors we
// use generic `any` types for method parameters and return values.  The service
// follows the NestJS convention of being injected where needed, but does not
// depend on any missing modules (e.g. PrismaService, repository classes, DTOs).

@Injectable()
export class CustomerService {
  // In a real implementation these would delegate to a repository that talks to
  // Prisma.  Here we provide minimal, in‑memory behaviour sufficient for type‑checking.

  private readonly store = new Map<string, any>();

  /** Create a new customer record. */
  async create(data: any): Promise<any> {
    // Generate a simple identifier.
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const record = { id, ...data };
    this.store.set(id, record);
    return record;
  }

  /** Return all customers visible to the current tenant. */
  async findAll(): Promise<any[]> {
    return Array.from(this.store.values());
  }

  /** Find a single customer by its identifier. */
  async findOne(id: string): Promise<any> {
    const record = this.store.get(id);
    if (!record) {
      throw new NotFoundException(`Customer with id "${id}" not found`);
    }
    return record;
  }

  /** Update an existing customer. */
  async update(id: string, data: any): Promise<any> {
    const existing = await this.findOne(id);
    const updated = { ...existing, ...data };
    this.store.set(id, updated);
    return updated;
  }

  /** Delete a customer. */
  async remove(id: string): Promise<void> {
    const existed = this.store.delete(id);
    if (!existed) {
      throw new NotFoundException(`Customer with id "${id}" not found`);
    }
  }
}
