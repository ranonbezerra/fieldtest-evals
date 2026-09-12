import { Injectable } from '@nestjs/common';

export interface TransferParams {
  to: string;
  amount: bigint;
}

export interface TransferResult {
  txHash: string;
}

/**
 * Stub for the blockchain provider SDK.
 * In production this would call the real provider.
 */
@Injectable()
export class ProviderService {
  async transfer(params: TransferParams): Promise<TransferResult> {
    // Simulated async success – tests can mock this method to throw or delay.
    return {
      txHash: `tx_${Math.random().toString(36).substring(2, 15)}`,
    };
  }
}
