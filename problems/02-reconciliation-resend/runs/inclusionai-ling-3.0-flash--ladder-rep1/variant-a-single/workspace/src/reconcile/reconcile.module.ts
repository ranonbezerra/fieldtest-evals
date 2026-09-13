import { Module } from "@nestjs/common";
import { PayoutModule } from "../payout/payout.module";
import { ReconcileJob } from "./reconcile.job";

@Module({
  imports: [PayoutModule],
  providers: [ReconcileJob],
})
export class ReconcileModule {}
