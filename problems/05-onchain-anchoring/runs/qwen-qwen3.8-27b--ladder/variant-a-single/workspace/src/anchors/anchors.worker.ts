import { Injectable, Logger } from '@nestjs/common';
import { AnchorsRepository, AnchorRecord } from './anchors.repository.js';
import { AnchorReceipt } from '../chain/chain-client.js';

// ASSUMPTION: AnchorReceipt (from '../chain/chain-client.js') has at least `status: 'CONFIRMED' | 'FAILED'` and `blockNumber: number | null`.

@Injectable()
export class AnchorsWorker {
  private readonly logger = new Logger(AnchorsWorker.name);

  constructor(
    private readonly anchors: AnchorsRepository,
  ) {}

  /**
   * Confirmation worker: polls receipts for anchors that have been broadcast
   * and advances their state once the chain reports a terminal outcome.
   */
  async confirmBroadcastSent(): Promise<void> {
    const records = await this.anchors.findBroadcastSent();
    for (const record of records) {
      await this.resolveRecord(record);
    }
  }

  /**
   * Recovery sweep: resolves anchors stuck in broadcast-limbo (OUTCOME_UNKNOWN)
   * by querying the chain for a definitive receipt.
   */
  async recoverOutcomeUnknown(): Promise<void> {
    const records = await this.anchors.findOutcomeUnknown();
    for (const record of records) {
      await this.resolveRecord(record);
    }
  }

  private async resolveRecord(record: AnchorRecord): Promise<void> {
    if (!record.txId) {
      this.logger.warn(
        `Anchor ${record.id} (doc=${record.documentId} v=${record.version}) has no txId; skipping.`,
      );
      return;
    }

    const receipt: AnchorReceipt | null = await this.anchors.getReceipt(record.txId);

    if (receipt === null) {
      // No receipt available yet — the transaction may still be in-flight.
      // Leave the record in its current state; a subsequent poll will retry.
      return;
    }

    if (receipt.status === 'CONFIRMED' && receipt.blockNumber != null) {
      await this.anchors.markConfirmed(record.id, receipt.blockNumber);
      this.logger.log(
        `Anchor ${record.id} (doc=${record.documentId} v=${record.version}) confirmed at block ${receipt.blockNumber}.`,
      );
    } else if (receipt.status === 'FAILED') {
      await this.anchors.markFailed(record.id);
      this.logger.warn(
        `Anchor ${record.id} (doc=${record.documentId} v=${record.version}) reported failed on-chain.`,
      );
    }
    // If receipt exists but is neither CONFIRMED nor FAILED (e.g. still
    // pending in mempool), leave the record unchanged and retry on next poll.
  }
}
