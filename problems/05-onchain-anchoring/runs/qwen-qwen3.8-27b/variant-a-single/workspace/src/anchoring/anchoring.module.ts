import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CHAIN_CLIENT } from '../chain/chain-client.js';
import { FakeChainClient } from '../chain/fake-chain-client.js';
import { DOCUMENT_SOURCE } from './document-source.js';
import { FakeDocumentSource } from './fake-document-source.js';
import { AnchoringController } from './anchoring.controller.js';
import { AnchoringService } from './anchoring.service.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { AnchoringWorker } from './anchoring.worker.js';

@Module({
  controllers: [AnchoringController],
  providers: [
    PrismaClient,
    AnchoringRepository,
    AnchoringService,
    AnchoringWorker,
    // ASSUMPTION: no real chain access is allowed (no keys, no RPC); the
    // deterministic fake is the runtime provider until a real adapter exists.
    { provide: CHAIN_CLIENT, useClass: FakeChainClient },
    // ASSUMPTION: the platform's real document store is out of scope; the
    // in-memory source stands in so the API is usable end to end.
    { provide: DOCUMENT_SOURCE, useClass: FakeDocumentSource },
  ],
})
export class AnchoringModule {}
