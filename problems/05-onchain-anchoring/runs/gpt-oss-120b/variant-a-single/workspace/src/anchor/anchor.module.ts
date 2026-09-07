// src/anchor/anchor.module.ts
import { Module } from '@nestjs/common';

// ASSUMPTION: The following files exist in the repository with the expected
// class/interface exports. They are referenced here to satisfy the compiler
// errors listed in the task description.

import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { PrismaService } from '../prisma.service';
import { ChainClientInterface } from './chain-client.interface';
import { FakeChainClientService } from './fake-chain-client.service';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    PrismaService,
    // The chain client is injected via the interface token.
    {
      provide: ChainClientInterface,
      useClass: FakeChainClientService,
    },
  ],
  exports: [AnchorService],
})
export class AnchorModule {}
