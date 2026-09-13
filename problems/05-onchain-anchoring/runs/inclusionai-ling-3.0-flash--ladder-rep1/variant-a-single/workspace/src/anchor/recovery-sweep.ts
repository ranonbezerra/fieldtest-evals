import { Injectable } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import type { ChainClient } from '../chain/chain-client.interface.js';
import type { AnchorRecord } from './anchor.types.js';

@Injectable()
export class RecoverySweep {
  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
  ) {}

  async run(): Promise<AnchorRecord[]> {
    const limboAnchors = await this.repository.findLimbo();
    const preparedAnchors = await this.repository.findStuck();

    const toProcess = new Map<string, AnchorRecord>();
    for (const a of [...preparedAnchors, ...limboAnchors]) {
      if (a.status === 'CONFIRMED' || a.status === 'FAILED') continue;
      toProcess.set(a.id, a);
    }

    const processed: AnchorRecord[] = [];

    for (const anchor of toProcess.values()) {
      const receipt = await this.chainClient.getReceipt(anchor.txId);

      if (receipt) {
        await this.repository.confirm(anchor.id, receipt.block, receipt.status);
        const updated = await this.repository.findById(anchor.id);
        if (updated) processed.push(updated);
        continue;
      }

      let newStatus: 'BROADCAST_SENT' | 'BROADCAST_LIMBO';
      try {
        await this.chainClient.broadcast(anchor.signedTx);
        newStatus = 'BROADCAST_SENT';
      } catch {
        newStatus = 'BROADCAST_LIMBO';
      }
      await this.repository.updateStatus(anchor.id, newStatus);
      const updated = await this.repository.findById(anchor.id);
      if (updated) processed.push(updated);
    }

    return processed;
  }
}
