import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

/**
 * Provider tokens (resolved in the real app via HttpModule/ConfigService):
 *  - 'BankClient': HTTP adapter implementing the bank's instant-payment API.
 *  - PrismaClient: the Prisma client instance.
 *  - PayoutService clock: a wall-clock implementation returning Date.now().
 * The service itself is transport-agnostic and fully testable.
 */
@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    { provide: 'BankClient', useValue: null },
    { provide: 'PAYOUT_CLOCK', useValue: { now: () => Date.now() } },
    {
      provide: 'PAYOUT_CONFIG',
      useValue: {
        maxAttempts: Number(process.env.PAYMENT_MAX_ATTEMPTS ?? 5),
        lagMs: Number(process.env.PAYMENT_PUBLISHING_LAG_MS ?? 30 * 60 * 1000),
      },
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
