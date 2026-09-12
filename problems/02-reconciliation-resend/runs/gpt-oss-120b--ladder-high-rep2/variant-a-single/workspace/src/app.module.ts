import { Module } from '@nestjs/common';
import { ScheduleModule } from './schedule.mock.js';
import { PayoutModule } from './payout/payout.module.js';
import { PrismaService } from './prisma.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), PayoutModule],
  providers: [PrismaService],
})
export class AppModule {}
