import { Module } from "@nestjs/common";
import { PayoutController } from "./payout.controller";
import { PayoutService } from "./payout.service";
import { PayoutRepository } from "./payout.repository";

@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
