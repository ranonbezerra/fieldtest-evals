import { Module } from "@nestjs/common";
import { MethodologyService } from "./methodology.service.js";
import { MethodologyRepository } from "./methodology.repository.js";
import { MethodologyController } from "./methodology.controller.js";

@Module({
  controllers: [MethodologyController],
  providers: [MethodologyService, MethodologyRepository],
  exports: [MethodologyService, MethodologyRepository],
})
export class MethodologyModule {}
