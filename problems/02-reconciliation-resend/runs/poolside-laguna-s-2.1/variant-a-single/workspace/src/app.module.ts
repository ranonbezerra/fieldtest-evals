import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';
import { BankModule } from './bank/bank.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, BankModule, PayoutModule],
})
export class AppModule {}
