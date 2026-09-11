/**
 * The chain client contract. The system is built against this interface
 * only; no real keys or RPC live in this repository.
 *
 *   prepare(payload)   -> { txId, signedTx }   local and deterministic: the
 *                        transaction identity exists BEFORE the broadcast
 *                        does. The same payload always yields the same
 *                        txId/signedTx.
 *   broadcast(signedTx)                      may time out or otherwise fail
 *                        with an unknown outcome. Callers must not conclude
 *                        that the tx did or did not land from the return.
 *   getReceipt(txId)   -> receipt | null      the only source of
 *                        confirmation.
 */

export interface AnchorPayload {
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

/** Thrown by a client when the broadcast outcome is unknown (the timeout case). */
export class BroadcastTimeoutError extends Error {
  constructor(message = 'broadcast timed out; outcome unknown') {
    super(message);
    this.name = 'BroadcastTimeoutError';
  }
}

export interface ChainClient {
  prepare(payload: AnchorPayload): PreparedTx;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

/** DI token for the chain client implementation. */
export const CHAIN_CLIENT = Symbol('CHAIN_CLIENT');
