import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PayoutsController } from './payouts.controller.js';
import { PayoutsRepository } from './payouts.repository.js';
import { PayoutsService } from './payouts.service.js';

@Module({
  controllers: [PayoutsController],
  providers: [
    {
      provide: PayoutsRepository,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PayoutsRepository(prisma),
    },
    PayoutsService,
  ],
})
export class PayoutsModule {}
