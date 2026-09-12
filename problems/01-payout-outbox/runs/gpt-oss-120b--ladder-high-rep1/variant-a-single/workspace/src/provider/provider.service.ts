import { Injectable } from '@nestjs/common';

export interface TransferParams {
  to: string;
  amount: bigint;
}

export interface TransferResult {
  txHash: string;
}

/**
 * Simulates an external stablecoin provider SDK.
 * In production this would wrap the real SDK; in tests it can be mocked.
 */
@Injectable()
export class ProviderService {
  async transfer(params: TransferParams): Promise<TransferResult> {
    // Simulate a successful transfer after a short delay.
    // Replace with real SDK call as needed.
    const fakeTxHash = `0x${Math.floor(Math.random() * 1e16).toString(16)}`;
    return { txHash: fakeTxHash };
  }
}
