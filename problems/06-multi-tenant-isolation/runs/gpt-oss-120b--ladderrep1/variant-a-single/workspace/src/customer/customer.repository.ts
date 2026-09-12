import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { Customer } from '@prisma/client';
import { TenantContext } from '../tenant/tenant.context.js';

@Injectable()
export class CustomerRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async findAll(): Promise<Customer[]> {
    const tenantId = this.tenantContext.get();
    return this.prisma.customer.findMany({
      where: { tenantId },
    });
  }

  async findById(id: string): Promise<Customer | null> {
    const tenantId = this.tenantContext.get();
    return this.prisma.customer.findUnique({
      where: { id },
      rejectOnNotFound: false,
    }).then((c) => (c && c.tenantId === tenantId ? c : null));
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const tenantId = this.tenantContext.get();
    return this.prisma.customer.create({
      data: {
        email: dto.email,
        name: dto.name,
        tenantId,
      },
    });
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer | null> {
    const tenantId = this.tenantContext.get();
    try {
      return await this.prisma.customer.update({
        where: { id },
        data: { ...dto },
      }).then((c) => (c.tenantId === tenantId ? c : null));
    } catch (e) {
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    const tenantId = this.tenantContext.get();
    try {
      const del = await this.prisma.customer.delete({
        where: { id },
      });
      return del.tenantId === tenantId;
    } catch (e) {
      return false;
    }
  }
}
