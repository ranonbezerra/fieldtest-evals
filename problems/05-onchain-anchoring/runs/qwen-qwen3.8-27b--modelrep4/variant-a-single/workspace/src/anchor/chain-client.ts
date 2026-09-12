/**
 * The L2 client contract. No real keys or RPC live in this codebase: tests
 * (and the local app run) use fakes; a deployment that anchors to a real
 * chain supplies the real client under the same token.
 *
 * - prepare(tx) is local and deterministic: the same tx always yields the
 *   same txId and signedTx, so re-preparing an anchor's tx recovers the exact
 *   same on-chain identity.
 * - broadcast(signedTx) may time out with an unknown outcome: the tx may or
 *   may not have reached the chain.
 * - getReceipt(txId) returns null until the tx is mined.
 */
export interface AnchorTx {
  /** The anchor hash (hex) to store on chain. */
  data: string;
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

export interface TxReceipt {
  txId: string;
  blockNumber: number;
  status: 'success' | 'failure';
}

export interface ChainClient {
  prepare(tx: AnchorTx): Promise<PreparedTx>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<TxReceipt | null>;
}

/** DI token for the chain client. */
export const CHAIN_CLIENT = 'ANCHOR_CHAIN_CLIENT';
