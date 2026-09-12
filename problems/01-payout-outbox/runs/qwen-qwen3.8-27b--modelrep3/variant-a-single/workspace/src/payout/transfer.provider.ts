import { Injectable } from '@nestjs/common';

// The blockchain provider SDK is assumed to expose only:
//   provider.transfer({ to, amount }) -> Promise<{ txHash }>
// which may throw, time out, or succeed slowly.
// ASSUMPTION: definitive rejections (the transfer provably did NOT happen)
// are signalled by the SDK throwing DefinitiveTransferError; any other throw
// (timeouts, network errors, unknown results) is treated as transient/unknown.

export interface TransferProvider {
  transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

export const TRANSFER_PROVIDER = 'TRANSFER_PROVIDER';

export class DefinitiveTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitiveTransferError';
  }
}

/**
 * Stand-in for the real blockchain provider SDK until it is wired up.
 */
@Injectable()
export class InMemoryTransferProvider implements TransferProvider {
  private sequence = 0;

  transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    this.sequence += 1;
    const txHash = `0x${args.amount.toString(16)}${this.sequence.toString(16).padStart(8, '0')}`;
    return Promise.resolve({ txHash });
  }
}
