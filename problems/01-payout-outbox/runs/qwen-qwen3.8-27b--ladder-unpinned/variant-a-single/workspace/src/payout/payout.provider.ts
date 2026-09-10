import { randomUUID } from 'node:crypto';

/**
 * The on-chain provider as specified: one async call that may throw, time
 * out, or succeed slowly. Nothing else is assumed about it.
 */
export interface BlockchainProvider {
  transfer(input: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

// ASSUMPTION: the specified SDK surface is `transfer` only, but settlement
// requires observing chain state. That observation is modelled as a separate
// narrow collaborator rather than inventing SDK behaviour.
export interface TransactionConfirmer {
  isConfirmed(txHash: string): Promise<boolean>;
}

export const BLOCKCHAIN_PROVIDER = 'BLOCKCHAIN_PROVIDER';
export const TX_CONFIRMER = 'TX_CONFIRMER';

// ASSUMPTION: the raw SDK has no error taxonomy, so by default every thrown
// error is treated as an uncertain outcome. Only an adapter that can prove the
// transfer did not happen wraps the error in this class.
export class DefinitiveTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitiveTransferError';
  }
}

// ASSUMPTION: the concrete provider SDK is not part of this repository. These
// stubs keep the service bootable locally; a deployment overrides the
// BLOCKCHAIN_PROVIDER / TX_CONFIRMER tokens with the real chain.
export class StubBlockchainProvider implements BlockchainProvider {
  async transfer(_input: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    return { txHash: `stub-${randomUUID()}` };
  }
}

export class StubTransactionConfirmer implements TransactionConfirmer {
  async isConfirmed(_txHash: string): Promise<boolean> {
    return true;
  }
}
