import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller.js';
import { AnchorService } from './anchor.service.js';
import { AnchorRepository } from './anchor.repository.js';
import { AnchorWorker } from './anchor.worker.js';
import { PrismaService } from '../prisma.service.js';
import { ChainClient } from './chain-client.interface.js';
import { FakeChainClient } from './fake-chain-client.js';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorRepository,
    AnchorService,
    AnchorWorker,
    PrismaService,
    {
      provide: 'CHAIN_CLIENT',
      useClass: FakeChainClient,
    },
  ],
  exports: [AnchorService, AnchorRepository],
})
export class AnchorModule {}
