import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnchorController } from './anchor.controller.js';
import { AnchorService } from './anchor.service.js';
import { AnchorRepository } from './anchor.repository.js';
import { AnchorWorker } from './anchor.worker.js';
import { CHAIN_CLIENT } from './chain-client.js';
import { FileChainClient } from './file-chain-client.js';
import { DOCUMENT_CONTENT_SOURCE, InMemoryDocumentContentSource } from './document-content-source.js';

@Module({
  imports: [PrismaModule],
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    AnchorWorker,
    // Deterministic, file-backed stand-in for the L2 client (no real keys or
    // RPC in this codebase). A deployment that anchors to a real chain
    // overrides CHAIN_CLIENT.
    {
      provide: CHAIN_CLIENT,
      useFactory: () => new FileChainClient(process.env.ANCHOR_CHAIN_STATE_PATH ?? 'data/fake-chain.json'),
    },
    // Empty in-process report store; the platform's document store overrides
    // DOCUMENT_CONTENT_SOURCE.
    {
      provide: DOCUMENT_CONTENT_SOURCE,
      useFactory: () => new InMemoryDocumentContentSource(new Map()),
    },
  ],
})
export class AnchorModule {}
