import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnchoringController } from './anchoring.controller.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { AnchoringService } from './anchoring.service.js';
import { AnchoringWorker } from './anchoring.worker.js';
import { ANCHORING_CONFIG, anchoringConfigFromEnv } from './anchoring.config.js';
import { CHAIN_CLIENT } from './chain-client.js';
import { InMemoryChainClient } from './in-memory-chain-client.js';

@Module({
  imports: [PrismaModule],
  controllers: [AnchoringController],
  providers: [
    AnchoringService,
    AnchoringRepository,
    AnchoringWorker,
    { provide: ANCHORING_CONFIG, useFactory: anchoringConfigFromEnv },
    // ASSUMPTION: no real L2 client exists in scope ("no real keys and no RPC"),
    // so the in-process implementation is the default provider; a deployment
    // replaces this provider with a real ChainClient.
    { provide: CHAIN_CLIENT, useFactory: () => new InMemoryChainClient() },
  ],
  exports: [AnchoringService],
})
export class AnchoringModule {}
