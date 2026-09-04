import { Module } from '@nestjs/common';
import { PrismaModule } from '../db/prisma.module.js';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { CustomerRepository } from './customer.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerRepository, CustomerService],
})
export class CustomerModule {}
