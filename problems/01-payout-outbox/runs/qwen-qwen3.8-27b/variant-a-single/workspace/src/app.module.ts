import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { PayoutModule } from './payout/payout.module';

@Module({
  imports: [PrismaModule, PayoutModule],
})
export class AppModule {}
