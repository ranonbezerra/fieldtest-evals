/**
 * L2 chain client contract.
 *
 * No real keys or RPC are involved in this solution: all code is written
 * against this interface. The app wires a local deterministic implementation
 * by default (see local-chain-client.ts); the tests wire a fake
 * (test/fakes/chain-client.fake.ts).
 */

export interface AnchorTxInput {
  documentId: string;
  version: number;
  contentHash: string;
}

export interface PreparedTx {
  txId: string;
  signedTx: string;
}

export interface ChainTxReceipt {
  txId: string;
  blockNumber: number;
}

export interface ChainClient {
  /** Local and deterministic: builds and signs the anchor tx without network access. */
  prepare(tx: AnchorTxInput): Promise<PreparedTx>;
  /** May time out with an unknown outcome: after a timeout the tx may or may not be on chain. */
  broadcast(signedTx: string): Promise<void>;
  /** Resolves to the receipt if the tx is mined, otherwise null. */
  getReceipt(txId: string): Promise<ChainTxReceipt | null>;
}

export const CHAIN_CLIENT = 'CHAIN_CLIENT';
