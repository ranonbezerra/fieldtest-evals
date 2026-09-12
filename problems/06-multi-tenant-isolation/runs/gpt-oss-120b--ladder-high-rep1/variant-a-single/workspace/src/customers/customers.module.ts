import { Module, Scope } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { CustomersRepository } from './customers.repository.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [
    {
      provide: CustomersRepository,
      useClass: CustomersRepository,
      scope: Scope.REQUEST,
    },
    {
      provide: CustomersService,
      useClass: CustomersService,
      scope: Scope.REQUEST,
    },
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
