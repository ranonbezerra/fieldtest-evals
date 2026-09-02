import { Module } from "@nestjs/common";
import { OperationsController } from "./operations.controller";
import { OperationsService } from "./operations.service";
import { OperationsRepository } from "./operations.repository";

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  exports: [OperationsService, OperationsRepository],
})
export class OperationsModule {}
