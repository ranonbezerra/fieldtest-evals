import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { Provider } from '../provider.js';
import { PayoutWorker } from './payout.worker.js';

const prisma = new PrismaClient();

@Module({
  controllers: [PayoutController],
  providers: [
    {
      provide: PrismaClient,
      useValue: prisma,
    },
    Provider,
    PayoutRepository,
    PayoutService,
    PayoutWorker,
    {
      // Simple bootstrap to start the background worker when the app starts
      provide: 'APP_BOOTSTRAP',
      useFactory: (worker: PayoutWorker) => ({
        async onModuleInit() {
          await worker.start();
        },
      }),
      inject: [PayoutWorker],
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule implements OnModuleInit {
  async onModuleInit() {
    // Ensure DB connection is ready
    await prisma.$connect();
  }
}
