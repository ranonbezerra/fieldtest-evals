import { Injectable } from '@nestjs/common';

export interface TransferDto {
  to: string;
  amount: bigint;
}

/**
 * A very naive stub for the blockchain provider.
 * In production this would call the real SDK.
 */
@Injectable()
export class CryptoProvider {
  async transfer(dto: TransferDto): Promise<{ txHash: string }> {
    // Simulate random transient failures
    const rnd = Math.random();
    if (rnd < 0.2) {
      // timeout / transient error
      throw new Error('Transient provider error');
    }
    // Simulate a small delay
    await new Promise((r) => setTimeout(r, 100));
    // Success
    return { txHash: `0x${Math.floor(Math.random() * 1e16).toString(16)}` };
  }
}
