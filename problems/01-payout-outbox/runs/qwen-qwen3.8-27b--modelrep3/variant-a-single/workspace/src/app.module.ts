import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';
import { PayoutModule } from './payout/payout.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, PayoutModule],
  providers: [{ provide: APP_FILTER, useClass: ErrorEnvelopeFilter }],
})
export class AppModule {}
