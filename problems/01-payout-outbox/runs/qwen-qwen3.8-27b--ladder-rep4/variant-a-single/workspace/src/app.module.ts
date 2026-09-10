import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';

@Module({
  imports: [PayoutModule],
  providers: [
    {
      provide: 'APP_FILTER',
      useClass: ErrorEnvelopeFilter,
    },
  ],
})
export class AppModule {}
