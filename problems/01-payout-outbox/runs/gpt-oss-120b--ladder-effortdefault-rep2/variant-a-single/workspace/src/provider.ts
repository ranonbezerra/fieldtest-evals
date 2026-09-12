import { Injectable } from '@nestjs/common';

export interface TransferResult {
  txHash: string;
}

/**
 * Mock of an external blockchain provider.
 * The real implementation would talk to the blockchain SDK.
 */
@Injectable()
export class Provider {
  async transfer(params: {
    to: string;
    amount: bigint;
  }): Promise<TransferResult> {
    // Simulate async behavior; in real life this would call the SDK.
    // For the purpose of the task we assume it may:
    // - resolve with a txHash
    // - throw an error (transient)
    // - hang / timeout (handled by caller via timeout wrapper)
    // Here we just return a dummy hash.
    return { txHash: `0x${Date.now().toString(16)}` };
  }
}
