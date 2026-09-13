import { Module } from "@nestjs/common";
import { PayoutController } from "./payout.controller.js";
import { PayoutService } from "./payout.service.js";
import { PayoutRepository } from "./payout.repository.js";
import { PayoutWorker } from "./payout.worker.js";
import { ProviderService } from "./provider.service.js";

@Module({
  imports: [],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, PayoutWorker, ProviderService],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
