import { hashContent } from './canonical.js';

export interface TxIdentity {
  txId: string;
  signedTx: string;
}

export interface Receipt {
  found: boolean;
  txId: string;
  blockNumber: number | null;
}

export interface AnchorTx {
  documentId: string;
  version: number;
  contentHash: string;
}

export interface ChainClient {
  prepare(tx: AnchorTx): TxIdentity;
  broadcast(signedTx: string): Promise<void>;
  getReceipt(txId: string): Promise<Receipt>;
}

export interface FakeChainClientConfig {
  broadcastFails?: boolean;
  receipts: Record<string, Receipt>;
}

export class FakeChainClient implements ChainClient {
  private readonly config: FakeChainClientConfig;

  constructor(config?: FakeChainClientConfig) {
    this.config = config ?? { receipts: {} };
  }

  prepare(tx: AnchorTx): TxIdentity {
    const txId = hashContent(tx);
    return { txId, signedTx: `signed:${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.config.broadcastFails) {
      throw new Error('broadcast timed out with unknown outcome');
    }
  }

  async getReceipt(txId: string): Promise<Receipt> {
    const receipt = this.config.receipts[txId];
    if (receipt !== undefined) {
      return receipt;
    }
    return { found: false, txId, blockNumber: null };
  }
}
