import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PayoutModule } from './payout/payout.module';
import { AllExceptionsFilter } from './common/exception.filter';

@Module({
  imports: [PayoutModule],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
