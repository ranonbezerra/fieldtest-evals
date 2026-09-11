import { createHash } from 'node:crypto';
import { type AnchorPayload, type ChainClient, type ChainReceipt, type PreparedTx } from './chain-client.js';
import { canonicalize } from './canonical-json.js';

// ASSUMPTION: no real chain client (keys/RPC) is in scope; this placeholder
// keeps the ChainClient wiring complete. prepare is implemented for real
// (local, deterministic); broadcast pretends the chain accepted the tx but
// no receipt is ever produced, so anchors stay pending. Production deploys
// swap this provider for the real L2 client — the interface is the contract.
export class StubChainClient implements ChainClient {
  prepare(payload: AnchorPayload): PreparedTx {
    const signedTx = 'stub-signed:' + canonicalize(payload);
    const txId = 'tx_' + createHash('sha256').update(signedTx, 'utf8').digest('hex').slice(0, 24);
    return { txId, signedTx };
  }

  async broadcast(_signedTx: string): Promise<void> {
    // Pretend the chain accepted the tx.
  }

  async getReceipt(_txId: string): Promise<ChainReceipt | null> {
    return null; // No real chain: no receipts.
  }
}
