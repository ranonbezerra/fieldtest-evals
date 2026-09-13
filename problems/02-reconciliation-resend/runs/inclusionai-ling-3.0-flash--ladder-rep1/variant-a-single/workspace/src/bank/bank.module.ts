import { Module } from '@nestjs/common';
import { BankGatewayService } from './bank.gateway';
import { BankGateway } from './bank.types';

@Module({
  providers: [
    {
      provide: BankGateway,
      useClass: BankGatewayService,
    },
  ],
  exports: [BankGateway],
})
export class BankModule {}
