import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller.js';
import { AnchorRepository } from './anchor.repository.js';
import { AnchorService } from './anchor.service.js';
import { AnchorProcessor, ANCHOR_PROCESSOR_OPTIONS, processorOptionsFromEnv } from './anchor.processor.js';
import { CHAIN_CLIENT } from './chain-client.interface.js';
import type { ChainClient } from './chain-client.interface.js';
import { LocalChainClient } from './local-chain-client.js';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorRepository,
    // No real chain client is provided (no keys, no RPC): default to the
    // local deterministic implementation. Tests override CHAIN_CLIENT with a
    // failure-injecting fake.
    { provide: CHAIN_CLIENT, useFactory: (): ChainClient => new LocalChainClient() },
    AnchorService,
    { provide: ANCHOR_PROCESSOR_OPTIONS, useFactory: () => processorOptionsFromEnv() },
    AnchorProcessor,
  ],
})
export class AnchorModule {}
