import { Injectable } from '@nestjs/common';

export type TransferInput = {
  to: string;
  amount: bigint;
};

export type TransferResult = {
  txHash: string;
};

@Injectable()
export class ProviderService {
  // In real life this would call the blockchain SDK.
  // For this implementation we simulate with a deterministic stub.
  async transfer(input: TransferInput): Promise<TransferResult> {
    // Simulate possible transient failures based on destination address
    if (input.to.startsWith('fail-')) {
      // Random failure
      if (Math.random() < 0.7) {
        throw new Error('Transient provider error');
      }
    }

    // Simulate async delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Return a dummy txHash
    return { txHash: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}` };
  }
}
