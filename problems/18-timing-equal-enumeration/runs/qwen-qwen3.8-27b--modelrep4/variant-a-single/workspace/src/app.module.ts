import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ErrorEnvelopeFilter } from './common/exception.filter';

@Module({
  imports: [AuthModule],
  providers: [
    // One envelope for every error response, on every route.
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
  ],
})
export class AppModule {}
