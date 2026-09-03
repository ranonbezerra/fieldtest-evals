import { Module } from '@nestjs/common';
import { AnchoringController } from './anchoring.controller';
import { AnchoringService } from './anchoring.service';
import { AnchoringRepository } from './anchoring.repository';
import { AnchorWorkerService } from './anchor-worker.service';
import { ChainClient } from './chain-client.interface';

@Module({
  controllers: [AnchoringController],
  providers: [AnchoringRepository, AnchoringService, AnchorWorkerService, ChainClient],
  exports: [AnchoringService, ChainClient],
})
export class AnchoringModule {}
