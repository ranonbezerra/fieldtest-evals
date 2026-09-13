import { Module } from "@nestjs/common";
import { SynonymService } from "./synonym.service.js";
import { SynonymRepository } from "./synonym.repository.js";
import { SynonymController } from "./synonym.controller.js";

@Module({
  controllers: [SynonymController],
  providers: [SynonymService, SynonymRepository],
  exports: [SynonymService, SynonymRepository],
})
export class SynonymModule {}
