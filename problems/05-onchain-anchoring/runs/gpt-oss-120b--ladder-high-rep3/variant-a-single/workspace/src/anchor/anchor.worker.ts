import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { AnchorState } from './anchor.model.js';

@Injectable()
export class AnchorWorker implements OnModuleInit, OnModuleDestroy {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private readonly pollIntervalMs = 5000; // 5 seconds

  constructor(
    private readonly anchorRepository: AnchorRepository,
    @Inject('CHAIN_CLIENT') private readonly chainClient: ChainClient,
  ) {}

  onModuleInit() {
    this.intervalId = setInterval(() => this.processPendingAnchors(), this.pollIntervalMs);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  /**
   * Public method for manual triggering (tests or admin commands).
   */
  async processPendingAnchors() {
    const pendingAnchors = await this.anchorRepository.findByStates([
      AnchorState.PREPARED,
      AnchorState.BROADCASTED,
      AnchorState.UNKNOWN,
    ]);

    for (const anchor of pendingAnchors) {
      // First, check if a receipt already exists on-chain
      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (receipt) {
        await this.anchorRepository.updateState(anchor.txId, AnchorState.CONFIRMED, receipt.blockNumber);
        continue;
      }

      // No receipt yet; attempt broadcast if needed
      if (anchor.state === AnchorState.PREPARED || anchor.state === AnchorState.UNKNOWN) {
        try {
          await this.chainClient.broadcast(anchor.signedTx);
          // After a successful broadcast, check again for receipt
          const postReceipt = await this.chainClient.getReceipt(anchor.txId);
          if (postReceipt) {
            await this.anchorRepository.updateState(anchor.txId, AnchorState.CONFIRMED, postReceipt.blockNumber);
          } else {
            await this.anchorRepository.updateState(anchor.txId, AnchorState.BROADCASTED);
          }
        } catch (e) {
          // Keep as unknown; a future sweep may retry
          await this.anchorRepository.updateState(anchor.txId, AnchorState.UNKNOWN);
        }
      }
      // If state is BROADCASTED, we simply wait for receipt in subsequent polls
    }
  }

  /**
   * Explicit sweep (e.g., on startup) to resolve any limbo anchors.
   */
  async sweepStuckAnchors() {
    await this.processPendingAnchors();
  }
}
