import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OperationsModule,
  ],
})
export class AppModule {}
