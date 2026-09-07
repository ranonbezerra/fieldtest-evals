// src/customer/customer.module.ts

import { Module } from '@nestjs/common';

// ASSUMPTION: The following files exist in the project structure.
// If they are not present, they need to be created accordingly.
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { CustomerRepository } from './customer.repository';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerRepository],
  exports: [CustomerService],
})
export class CustomerModule {}
