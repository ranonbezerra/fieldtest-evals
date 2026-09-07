// src/app.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

// ASSUMPTION: The project contains a PrismaModule that provides the PrismaService.
import { PrismaModule } from './prisma/prisma.module';

// ASSUMPTION: The payout feature is implemented in its own module.
import { PayoutModule } from './payout/payout.module';

@Module({
  imports: [
    // Initialize the NestJS scheduler (used by the message processor/worker).
    ScheduleModule.forRoot(),
    PrismaModule,
    PayoutModule,
  ],
})
export class AppModule {}
