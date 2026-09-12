import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AnchorModule } from './anchor/anchor.module.js';
import { AllExceptionsFilter } from './exception-filter.js';

@Module({
  imports: [AnchorModule],
  providers: [
    // Every error response uses the single envelope.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
