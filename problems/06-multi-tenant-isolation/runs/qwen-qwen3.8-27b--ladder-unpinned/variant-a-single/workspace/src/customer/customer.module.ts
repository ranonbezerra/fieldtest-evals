import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomerController } from './customer.controller';
import { CustomerRepository } from './customer.repository';
import { CustomerService } from './customer.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerRepository],
})
export class CustomerModule {}
