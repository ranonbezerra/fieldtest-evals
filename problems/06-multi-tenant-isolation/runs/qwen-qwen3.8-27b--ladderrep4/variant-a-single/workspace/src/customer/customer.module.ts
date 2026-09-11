import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module.js';
import { CustomerController } from './customer.controller.js';
import { CustomerRepository } from './customer.repository.js';
import { CustomerService } from './customer.service.js';

@Module({
  imports: [TenantModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerRepository],
})
export class CustomerModule {}
