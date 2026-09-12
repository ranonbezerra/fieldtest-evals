import { Module } from '@nestjs/common';
import { CHAIN_CLIENT } from './chain.client.js';
import { InMemoryChainClient } from './in-memory-chain.client.js';

function autoFinalizeMs(): number {
  const raw = process.env.CHAIN_AUTO_FINALIZE_MS;
  const value = raw === undefined ? 500 : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`CHAIN_AUTO_FINALIZE_MS must be a non-negative number, got "${raw}"`);
  }
  return value;
}

/**
 * The only chain implementation in this repo is the local deterministic
 * emulator (no keys, no RPC). A real L2 client would replace the factory.
 */
@Module({
  providers: [
    {
      provide: CHAIN_CLIENT,
      useFactory: () => new InMemoryChainClient({ autoFinalizeMs: autoFinalizeMs() }),
    },
  ],
  exports: [CHAIN_CLIENT],
})
export class ChainModule {}
