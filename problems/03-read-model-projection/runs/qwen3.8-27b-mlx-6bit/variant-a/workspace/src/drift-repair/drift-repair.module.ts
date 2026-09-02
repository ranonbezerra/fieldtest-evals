import { Module } from "@nestjs/common";
import { OperationsModule } from "../operations/operations.module";
import { DriftRepairService } from "./drift-repair.service";

@Module({
  imports: [OperationsModule],
  providers: [DriftRepairService],
})
export class DriftRepairModule {}
