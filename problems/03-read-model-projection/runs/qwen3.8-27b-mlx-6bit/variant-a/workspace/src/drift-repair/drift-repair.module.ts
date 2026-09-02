import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { OperationsModule } from "../operations/operations.module";
import { DriftRepairService } from "./drift-repair.service";

@Module({
  imports: [ScheduleModule.forRoot(), OperationsModule],
  providers: [DriftRepairService],
})
export class DriftRepairModule {}
