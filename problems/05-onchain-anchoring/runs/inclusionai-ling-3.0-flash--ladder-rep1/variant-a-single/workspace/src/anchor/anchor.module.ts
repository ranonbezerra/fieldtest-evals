import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChainClient } from '../chain/chain.interface.js';
import { MockChainClient } from '../chain/chain.mock.js';
import { AnchorService } from './anchor.service.js';
import { AnchorRepository } from './anchor.repository.js';
import { AnchorWorker } from './anchor.worker.js';
import { AnchorRecovery } from './anchor.recovery.js';
import { AnchorController } from './anchor.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    AnchorWorker,
    AnchorRecovery,
    AnchorController,
    { provide: ChainClient, useClass: MockChainClient },
  ],
})
export class AnchorModule {}
