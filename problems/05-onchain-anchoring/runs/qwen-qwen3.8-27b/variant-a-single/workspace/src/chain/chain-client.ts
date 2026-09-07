import { InjectionToken } from '@nestjs/common';

/**
 * Port to the L2 chain client. The real client would be a thin RPC adapter;
 * this codebase ships without real keys or RPC, so the default provider is
 * the deterministic fake (fake-chain-client.ts) and tests override the token.
 */
export const CHAIN_CLIENT: InjectionToken<ChainClient> = Symbol('CHAIN_CLIENT');

/** The on-chain anchor payload. `prepare` is local and deterministic. */
export interface AnchorPayload {
  kind: 'anchor';
  documentId: string;
  version: number;
  contentHash: string;
}

export interface PreparedTx {
  /** Deterministic tx identity, known before broadcasting. */
  txId: string;
  /** Opaque signed transaction; re-broadcasting the same signedTx is idempotent. */
  signedTx: string;
}

export interface ChainReceipt {
  txId: string;
  status: 'success' | 'failed';
  blockNumber: bigint;
  logIndex: number;
}

export interface ChainClient {
  prepare(tx: AnchorPayload): Promise<PreparedTx>;
  /** May reject with BroadcastTimeoutError, in which case the outcome is unknown. */
  broadcast(signedTx: string): Promise<void>;
  /** Null while no receipt is available for the tx yet. */
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

export class BroadcastTimeoutError extends Error {
  constructor(message = 'broadcast timed out; outcome unknown') {
    super(message);
    this.name = 'BroadcastTimeoutError';
  }
}
