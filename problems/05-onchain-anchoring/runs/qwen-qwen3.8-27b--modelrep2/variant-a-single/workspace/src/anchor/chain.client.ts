/**
 * L2 chain-client abstraction.
 *
 * - `prepare` is local and DETERMINISTIC: the same input always yields the
 *   same { txId, signedTx }. That determinism is what makes re-prepare after
 *   a crash safe — the re-derived tx carries the same identity as the
 *   original, so retries can never mint a second on-chain anchor.
 * - `broadcast` may fail with an UNKNOWN outcome: a failure does not mean
 *   the tx did not reach the chain. Only `getReceipt` is authoritative.
 *
 * No real keys or RPC in this repo: `FakeChainClient` is the implementation
 * for local runs and tests; a production deployment injects a real client
 * behind this same interface.
 */

export interface AnchorTxInput {
  action: 'anchor_report';
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
}

export interface ChainClient {
  prepare(input: AnchorTxInput): Promise<PreparedTx>;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<ChainReceipt | null>;
}

/** DI token. */
export const CHAIN_CLIENT = 'CHAIN_CLIENT';

/**
 * The only derivation of the tx payload: pure, total, stable — no clocks,
 * no randomness. The same (document, version, contentHash) always yields the
 * same tx, so a retry can never create a second anchor.
 */
export function buildAnchorTxInput(documentId: string, version: number, contentHash: string): AnchorTxInput {
  return { action: 'anchor_report', documentId, version, contentHash };
}
