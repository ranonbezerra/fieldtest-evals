import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [PrismaModule, AccountsModule, PayoutModule],
})
export class AppModule {}
