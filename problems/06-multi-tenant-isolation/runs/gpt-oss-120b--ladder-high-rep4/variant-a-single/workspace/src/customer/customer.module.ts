import { Module } from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { CustomerController } from './customer.controller.js';
import { CustomerRepository } from './customer.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  providers: [CustomerService, CustomerRepository, PrismaService],
  controllers: [CustomerController],
})
export class CustomerModule {}
