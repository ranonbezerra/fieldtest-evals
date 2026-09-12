/**
 * Chain client abstraction. Production deployments implement this against a
 * real L2 (with keys); the default local run and all tests use the
 * deterministic in-memory emulator. No real keys or RPC live in this repo.
 */

export interface AnchorTxPayload {
  op: 'anchor-document';
  documentId: string;
  version: number;
  contentHash: string;
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

export type ChainReceipt =
  | { txId: string; status: 'confirmed'; blockNumber: number; blockHash: string }
  | { txId: string; status: 'failed'; failureReason?: string };

export interface ChainClient {
  /** Local and deterministic: the tx identity is a pure function of the payload. */
  prepare(payload: AnchorTxPayload): Promise<PreparedTx>;

  /**
   * Send the signed tx to the chain.
   *  - resolves once the chain has accepted the tx for inclusion;
   *  - rejects with ChainRejectionError when the chain definitively refused it (not on chain);
   *  - rejects with any other error when the outcome is unknown (e.g. a timeout).
   */
  broadcast(signedTx: string): Promise<void>;

  /** Current receipt for a tx, or null when the chain has no record of it yet. */
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

/** The chain definitively refused the tx: it is not on chain. */
export class ChainRejectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainRejectionError';
  }
}

export const CHAIN_CLIENT = 'CHAIN_CLIENT';
