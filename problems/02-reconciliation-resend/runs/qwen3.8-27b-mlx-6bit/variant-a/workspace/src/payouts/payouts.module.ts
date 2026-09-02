import { Module } from '@nestjs/common';
import { PayoutsController } from './payouts.controller.js';
import { PayoutsService } from './payouts.service.js';
import { PayoutsRepository } from './payouts.repository.js';

@Module({
  providers: [PayoutsService, PayoutsRepository],
  controllers: [PayoutsController],
})
export class PayoutsModule {}
