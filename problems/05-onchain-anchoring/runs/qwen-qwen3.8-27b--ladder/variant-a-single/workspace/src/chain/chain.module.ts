import { Module } from '@nestjs/common';
import { CHAIN_CLIENT } from './chain-client.js';
import { FakeChainClient } from './fake-chain-client.js';

@Module({
  providers: [
    // No real keys or RPC in this build: the deterministic fake is the wired
    // chain client. A production L2 client implements the same ChainClient
    // contract and replaces this factory.
    { provide: CHAIN_CLIENT, useFactory: () => new FakeChainClient() },
  ],
  exports: [CHAIN_CLIENT],
})
export class ChainModule {}
