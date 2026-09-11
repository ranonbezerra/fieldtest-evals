import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';

@Module({
  imports: [AuthModule],
  providers: [
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}
