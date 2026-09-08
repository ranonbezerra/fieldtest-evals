import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export interface PayoutProvider {
  transfer(params: {
    to: string;
    amount: bigint;
  }): Promise<{ txHash: string }>;
}

export const PAYOUT_PROVIDER = Symbol('PayoutProvider');

export class TransientProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientProviderError';
  }
}

export class PermanentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentProviderError';
  }
}

export function isTransientError(error: Error): boolean {
  if (error instanceof PermanentProviderError) return false;
  if (error instanceof TransientProviderError) return true;
  // ASSUMPTION: Unknown errors are treated as transient for funds-safety.
  // It is safer to retry than to release reserved funds prematurely.
  return true;
}

@Injectable()
export class BlockchainProviderService implements PayoutProvider {
  async transfer(params: {
    to: string;
    amount: bigint;
  }): Promise<{ txHash: string }> {
    // ASSUMPTION: In production this would call the real blockchain SDK.
    // The SDK is assumed to be idempotent or the caller handles deduplication.
    return {
      txHash: `0x${randomBytes(32).toString('hex')}`,
    };
  }
}
