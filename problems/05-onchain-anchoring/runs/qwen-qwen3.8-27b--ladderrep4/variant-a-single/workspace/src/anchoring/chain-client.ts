/**
 * The chain-client contract (no real keys, no RPC — code against this
 * interface; tests and the local default use an in-memory implementation):
 *
 *   prepare(tx)         -> { txId, signedTx }   local, deterministic
 *   broadcast(signedTx) -> Promise<void>        may time out, outcome unknown
 *   getReceipt(txId)    -> Promise<ChainReceipt | null>  the receipt once included, else null
 *
 * Key property: `prepare` is local, so the transaction identity exists BEFORE
 * any broadcast. Confirmation always comes from `getReceipt`, never from
 * `broadcast()` returning.
 */

export interface ChainTxInput {
  documentId: string;
  version: number;
  contentHash: string;
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

export interface ChainReceipt {
  txId: string;
  blockNumber: number;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface ChainClient {
  prepare(tx: ChainTxInput): PreparedTx;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

export const CHAIN_CLIENT = 'CHAIN_CLIENT';
