import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OperationsModule } from './operations/operations.module';

@Module({
  imports: [ScheduleModule.forRoot(), OperationsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
