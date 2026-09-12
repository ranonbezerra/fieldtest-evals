export interface TransferResult {
  txHash: string;
}

export interface CryptoProvider {
  transfer(to: string, amount: bigint): Promise<TransferResult>;
}

// Placeholder implementation – replace with real SDK in production.
export class CryptoProviderService implements CryptoProvider {
  async transfer(to: string, amount: bigint): Promise<TransferResult> {
    // Simulate async provider call
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ txHash: `0x${Math.floor(Math.random() * 1e16).toString(16)}` });
      }, 100);
    });
  }
}
