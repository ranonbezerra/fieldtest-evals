import { Injectable, Logger } from '@nestjs/common';
import { ChainClient } from '../../chain/chain.interface.ts';
import { AnchorRepository } from './anchor.repository.ts';

@Injectable()
export class AnchorRecovery {
  private readonly logger = new Logger('AnchorRecovery');

  constructor(
    private readonly chainClient: ChainClient,
    private readonly repository: AnchorRepository,
  ) {}

  async recoverStuck(): Promise<number> {
    let recovered = 0;
    const anchors = await this.repository.findAllAnchors();

    for (const anchor of anchors) {
      if (anchor.status !== 'PREPARED' && anchor.status !== 'BROADCAST_TIMEOUT') {
        continue;
      }

      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (receipt) {
        const state = receipt.success ? 'CONFIRMED' : 'FAILED';
        await this.repository.updateState(anchor.documentId, anchor.version, state, {
          block: receipt.block,
        });
        this.logger.log(
          `Recovery: anchor ${anchor.documentId}/${anchor.version} ${state} at block ${receipt.block}`,
        );
        recovered++;
        continue;
      }

      try {
        await this.chainClient.broadcast(anchor.signedTx);
        await this.repository.updateState(anchor.documentId, anchor.version, 'BROADCAST_SENT');
        this.logger.log(`Recovery: re-broadcast anchor ${anchor.documentId}/${anchor.version}`);
        recovered++;
      } catch {
        this.logger.warn(
          `Recovery: re-broadcast timed out for ${anchor.documentId}/${anchor.version}`,
        );
      }
    }

    return recovered;
  }
}
