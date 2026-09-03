import { TenantPrismaService } from '../multi-tenant/tenant-prisma.service.js';
import type { CreateCustomerInput, UpdateCustomerInput, Customer } from './dto.js';

export class CustomerRepository {
  constructor(private readonly db: TenantPrismaService) {}

  async list(): Promise<Customer[]> {
    return this.db.customer.findMany();
  }

  async findById(id: string): Promise<Customer | null> {
    return this.db.customer.findUnique({ where: { id } });
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    return this.db.customer.create({ data: input });
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    return this.db.customer.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.db.customer.delete({ where: { id } });
  }
}
