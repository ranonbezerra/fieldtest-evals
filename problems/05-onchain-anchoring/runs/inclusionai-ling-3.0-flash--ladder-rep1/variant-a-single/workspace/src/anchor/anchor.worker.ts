import { Injectable, Logger } from '@nestjs/common';
import { ChainClient } from '../../chain/chain.interface.ts';
import { AnchorRepository } from './anchor.repository.ts';

@Injectable()
export class AnchorWorker {
  private readonly logger = new Logger('AnchorWorker');

  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
  ) {}

  async confirmPending(): Promise<number> {
    let confirmedCount = 0;
    const anchors = await this.repository.findAllAnchors();

    for (const anchor of anchors) {
      if (anchor.status === 'CONFIRMED' || anchor.status === 'FAILED') {
        continue;
      }

      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (receipt) {
        const state = receipt.success ? 'CONFIRMED' : 'FAILED';
        await this.repository.updateState(anchor.documentId, anchor.version, state, {
          block: receipt.block,
        });
        confirmedCount++;
        this.logger.log(
          `Anchor ${anchor.documentId}/${anchor.version}: ${state} at block ${receipt.block}`,
        );
      }
    }

    return confirmedCount;
  }
}
