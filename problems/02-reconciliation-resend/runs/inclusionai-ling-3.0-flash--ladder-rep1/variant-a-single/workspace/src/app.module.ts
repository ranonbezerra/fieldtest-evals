import { Module } from "@nestjs/common";
import { ReconcileModule } from "./reconcile/reconcile.module";

@Module({
  imports: [ReconcileModule],
})
export class AppModule {}
