import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnchoringController } from './anchoring.controller.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { AnchoringService } from './anchoring.service.js';
import { ConfirmationWorker } from './confirmation-worker.service.js';
import { RecoverySweep } from './recovery-sweep.service.js';
import { CHAIN_CLIENT } from './chain-client.js';
import { StubChainClient } from './stub-chain-client.js';
import { ANCHORING_CONFIG, loadAnchoringConfig } from './anchoring.config.js';

@Module({
  imports: [PrismaModule],
  controllers: [AnchoringController],
  providers: [
    AnchoringRepository,
    AnchoringService,
    ConfirmationWorker,
    RecoverySweep,
    {
      provide: CHAIN_CLIENT,
      // No real keys or RPC in this deployment: the app runs against the
      // ChainClient contract with a placeholder. Production swaps this
      // provider for the real L2 client.
      useFactory: () => new StubChainClient(),
    },
    { provide: ANCHORING_CONFIG, useFactory: () => loadAnchoringConfig() },
  ],
})
export class AnchoringModule {}
