import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { AnchorState } from '@prisma/client';

/**
 * Confirmation worker that polls pending anchors, queries receipts,
 * and updates state. Also acts as the recovery sweep at startup.
 */
@Injectable()
export class AnchorWorker implements OnModuleInit {
  private readonly logger = new Logger(AnchorWorker.name);
  private readonly intervalMs = 5000; // 5 seconds for demo

  constructor(
    private readonly repo: AnchorRepository,
    private readonly chain: ChainClient,
  ) {}

  onModuleInit() {
    this.startPolling();
  }

  private startPolling() {
    setInterval(() => this.processPending(), this.intervalMs);
    // also run once at startup (recovery sweep)
    this.processPending().catch((e) =>
      this.logger.error('Error during recovery sweep', e),
    );
  }

  private async processPending() {
    const pending = await this.repo.findPending();
    for (const anchor of pending) {
      try {
        const receipt = await this.chain.getReceipt(anchor.txId);
        if (receipt) {
          // Transaction landed – confirm
          await this.repo.updateState(
            anchor.txId,
            AnchorState.CONFIRMED,
            receipt.blockNumber,
          );
          this.logger.log(`Anchor ${anchor.id} confirmed at block ${receipt.blockNumber}`);
          continue;
        }

        // No receipt yet
        if (anchor.state === AnchorState.UNKNOWN) {
          // outcome unknown – re‑broadcast same signedTx
          await this.chain.broadcast(anchor.signedTx);
          await this.repo.updateState(anchor.txId, AnchorState.BROADCASTED);
          this.logger.log(`Re‑broadcasted tx ${anchor.txId}`);
        } else if (anchor.state === AnchorState.PREPARED) {
          // broadcast not yet attempted (e.g., crash before broadcast)
          await this.chain.broadcast(anchor.signedTx);
          await this.repo.updateState(anchor.txId, AnchorState.BROADCASTED);
          this.logger.log(`Broadcasted pending tx ${anchor.txId}`);
        }
        // otherwise keep waiting
      } catch (err: any) {
        // If broadcast fails again, keep state UNKNOWN
        if (anchor.state !== AnchorState.UNKNOWN) {
          await this.repo.updateState(anchor.txId, AnchorState.UNKNOWN);
        }
        this.logger.warn(`Error processing anchor ${anchor.id}: ${err}`);
      }
    }
  }
}
