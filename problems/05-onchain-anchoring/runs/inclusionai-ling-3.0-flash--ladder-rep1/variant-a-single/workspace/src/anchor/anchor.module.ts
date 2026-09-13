import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { FakeChainClient } from '../chain/fake-chain-client.js';
import { AnchorController } from './anchor.controller.js';
import { AnchorService } from './anchor.service.js';
import { AnchorRepository } from './anchor.repository.js';
import { ConfirmationWorker } from './confirmation-worker.js';
import { RecoverySweep } from './recovery-sweep.js';

@Module({
  imports: [],
  providers: [
    { provide: PrismaClient, useValue: new PrismaClient() },
    { provide: 'ChainClient', useClass: FakeChainClient },
    AnchorService,
    AnchorRepository,
    AnchorController,
    ConfirmationWorker,
    RecoverySweep,
  ],
  exports: [AnchorService, 'ChainClient', AnchorRepository],
})
export class AnchorModule {}
