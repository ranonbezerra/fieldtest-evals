import { Injectable } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import type { ChainClient } from '../chain/chain-client.interface.js';
import type { AnchorRecord } from './anchor.types.js';

@Injectable()
export class ConfirmationWorker {
  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
  ) {}

  async run(): Promise<AnchorRecord[]> {
    const anchors = await this.repository.findStuck();
    const processed: AnchorRecord[] = [];

    for (const anchor of anchors) {
      if (anchor.status !== 'BROADCAST_SENT' && anchor.status !== 'BROADCAST_LIMBO') {
        continue;
      }

      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (!receipt) continue;

      await this.repository.confirm(anchor.id, receipt.block, receipt.status);
      const updated = await this.repository.findById(anchor.id);
      if (updated) processed.push(updated);
    }

    return processed;
  }
}
