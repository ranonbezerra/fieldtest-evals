import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from './customers.dto.js';
import { getTenantId } from '../common/tenant-context.js';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.prisma.customer.findMany();
  }

  findById(id: string) {
    return this.prisma.prisma.customer.findFirst({
      where: { id },
    });
  }

  create(data: CreateCustomerDto) {
    return this.prisma.prisma.customer.create({
      data: { ...data, tenantId: getTenantId() },
    });
  }

  update(id: string, data: UpdateCustomerDto) {
    return this.prisma.prisma.customer.update({
      where: { id },
      data,
    });
  }

  delete(id: string) {
    return this.prisma.prisma.customer.delete({
      where: { id },
    });
  }
}
