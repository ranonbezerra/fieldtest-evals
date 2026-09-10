import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PayoutController } from './payout.controller';
import { PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { PayoutWorker } from './payout.worker';
// ASSUMPTION: PayoutProvider is an injectable class exposing transfer(to: string, amount: bigint) => Promise<{ txHash: string }>
import { PayoutProvider } from './payout.provider';

@Module({
  imports: [PrismaModule],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, PayoutWorker, PayoutProvider],
})
export class PayoutModule {}
