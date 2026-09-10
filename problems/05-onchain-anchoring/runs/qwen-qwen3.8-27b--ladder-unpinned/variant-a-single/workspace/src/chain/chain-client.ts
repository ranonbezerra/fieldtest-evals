/**
 * The chain client contract.
 *
 * prepare() is local and deterministic: the same payload always yields the same
 * { txId, signedTx }. The transaction identity therefore exists BEFORE any
 * broadcast happens — the anchor intent persists it ahead of broadcast().
 *
 * broadcast() may time out with an unknown outcome: the chain may or may not
 * have the transaction. Timeout (BroadcastTimeoutError) and definitive node
 * rejection (BroadcastRejectionError) are distinct error types for exactly this
 * reason — collapsing them is what the incident was.
 *
 * Confirmation comes only from getReceipt().
 *
 * This build has no real keys and no RPC: the wired default implementation is
 * the deterministic fake in fake-chain-client.ts; a production L2 client
 * implements this same interface.
 */

export const CHAIN_CLIENT = 'CHAIN_CLIENT';

/** What the anchored transaction commits on chain. */
export interface AnchorTxPayload {
  kind: 'report_anchor';
  documentId: string;
  version: number;
  contentHash: string;
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

/** A receipt exists only once the transaction is included in a block. */
export interface ChainReceipt {
  txId: string;
  outcome: 'confirmed' | 'failed';
  blockNumber: bigint;
  blockHash: string;
  failureReason?: string;
}

export interface ChainClient {
  /** Local and deterministic; never touches the network. */
  prepare(tx: AnchorTxPayload): Promise<PreparedTx>;
  /** May time out (BroadcastTimeoutError) or be definitively rejected (BroadcastRejectionError). */
  broadcast(signedTx: string): Promise<void>;
  /** The only source of truth for what happened to a transaction: a receipt, or nothing. */
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

/** The broadcast call timed out: the chain may or may not have the transaction. Never "sent", never "failed". */
export class BroadcastTimeoutError extends Error {
  constructor(message = 'broadcast timed out; chain outcome unknown') {
    super(message);
    this.name = 'BroadcastTimeoutError';
  }
}

/** The node definitively rejected the transaction (e.g. invalid signature): it is not on the chain. */
export class BroadcastRejectionError extends Error {
  constructor(readonly reason: string) {
    super(`broadcast rejected by node: ${reason}`);
    this.name = 'BroadcastRejectionError';
  }
}
