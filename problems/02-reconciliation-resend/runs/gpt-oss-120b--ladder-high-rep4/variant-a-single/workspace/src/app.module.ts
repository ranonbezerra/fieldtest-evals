import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';
import { ReconcileModule } from './reconcile/reconcile.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, PayoutModule, ReconcileModule],
})
export class AppModule {}
