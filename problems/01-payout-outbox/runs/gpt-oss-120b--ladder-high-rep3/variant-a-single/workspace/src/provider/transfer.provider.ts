import { Injectable } from '@nestjs/common';

export interface TransferResult {
  txHash: string;
}

export abstract class TransferProvider {
  abstract transfer(to: string, amount: bigint): Promise<TransferResult>;
}

@Injectable()
export class DummyTransferProvider implements TransferProvider {
  async transfer(to: string, amount: bigint): Promise<TransferResult> {
    // Simulated successful transfer
    return { txHash: `0x${Math.random().toString(16).substr(2, 64)}` };
  }
}
