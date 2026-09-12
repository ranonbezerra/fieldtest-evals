import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller.js';
import { AnchorService } from './anchor.service.js';
import { AnchorRepository } from './anchor.repository.js';
import { AnchorWorkerService } from './anchor.worker.js';
import { ChainClient } from './chain-client.interface.js';
import { FakeChainClient } from './fake-chain-client.service.js';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    AnchorWorkerService,
    {
      provide: 'ChainClient',
      useClass: FakeChainClient,
    },
  ],
  exports: [AnchorService, AnchorWorkerService],
})
export class AnchorModule {}
