import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { PayoutModule } from './payout/payout.module.js';
import { PayoutExceptionFilter } from './payout/payout-exception-filter.js';

@Module({
  imports: [PrismaModule, PayoutModule],
  providers: [
    { provide: APP_FILTER, useClass: PayoutExceptionFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
