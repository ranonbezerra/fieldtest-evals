import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller.js';
import { AnchorService } from './anchor.service.js';
import { AnchorRepository } from './anchor.repository.js';
import { AnchorWorker } from './anchor.worker.js';
import { ChainClient } from './chain-client.interface.js';
import { FakeChainClient } from './fake-chain-client.service.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [AnchorController],
  providers: [
    PrismaService,
    AnchorRepository,
    AnchorService,
    AnchorWorker,
    {
      provide: ChainClient, // now a value (abstract class) can be used as token
      useClass: FakeChainClient, // in real env replace with real impl
    },
  ],
  exports: [AnchorService],
})
export class AnchorModule {}
