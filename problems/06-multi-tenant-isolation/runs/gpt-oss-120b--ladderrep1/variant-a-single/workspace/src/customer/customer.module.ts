import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { CustomerRepository } from './customer.repository.js';

@Module({
  controllers: [CustomerController],
  providers: [CustomerService, CustomerRepository],
})
export class CustomerModule {}
