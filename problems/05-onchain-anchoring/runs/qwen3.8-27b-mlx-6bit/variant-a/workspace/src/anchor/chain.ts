import { canonicalize, hashContent } from './canonical';

/**
 * Identity of a prepared transaction: the deterministic `txId` used to query
 * receipts, and the signed payload handed to `broadcast`.
 */
export interface TxIdentity {
  txId: string;
  signedTx: string;
}

/**
 * Result of a receipt query. `found` is false when the chain has no record of
 * the transaction; `blockNumber` is null until the transaction is mined.
 */
export interface Receipt {
  found: boolean;
  txId: string;
  blockNumber: number | null;
}

/**
 * Chain client boundary. `prepare` is local and deterministic; `broadcast` may
 * reject with a timeout of unknown outcome; `getReceipt` reports whether the
 * transaction has been mined.
 */
export interface ChainClient {
  prepare(tx: AnchorTx): TxIdentity;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<Receipt>;
}

/**
 * Deterministic input to `prepare`. Identical inputs always yield the same
 * `txId`, which is what makes crash recovery possible.
 */
export interface AnchorTx {
  documentId: string;
  version: number;
  contentHash: string;
}

/**
 * In-memory fake of {@link ChainClient} for tests. `prepare` derives the
 * `txId` deterministically from the input's canonical hash, `broadcast`
 * rejects when configured with `broadcastFails`, and `getReceipt` returns the
 * configured receipt for a known `txId` or a `found: false` receipt otherwise.
 */
export class FakeChainClient implements ChainClient {
  constructor(
    private readonly config?: {
      broadcastFails?: boolean;
      receipts: Record<string, Receipt>;
    },
  ) {}

  prepare(tx: AnchorTx): TxIdentity {
    const txId = hashContent(tx);
    // ASSUMPTION: the plan fixes the deterministic txId derivation but not the signedTx payload format; the canonical serialization of the tx is used as the deterministic signed payload.
    return { txId, signedTx: canonicalize(tx) };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.config?.broadcastFails) {
      throw new Error(`broadcast timed out; outcome unknown (payload: ${signedTx})`);
    }
  }

  async getReceipt(txId: string): Promise<Receipt> {
    const receipt = this.config?.receipts[txId];
    if (receipt) {
      return receipt;
    }
    return { found: false, txId, blockNumber: null };
  }
}
