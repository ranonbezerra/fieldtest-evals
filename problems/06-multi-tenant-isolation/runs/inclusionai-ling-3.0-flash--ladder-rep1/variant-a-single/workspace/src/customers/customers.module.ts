import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomersService } from './customers.service.js';
import { CustomersController } from './customers.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [CustomersRepository, CustomersService],
  controllers: [CustomersController],
  exports: [CustomersService],
})
export class CustomersModule {}
