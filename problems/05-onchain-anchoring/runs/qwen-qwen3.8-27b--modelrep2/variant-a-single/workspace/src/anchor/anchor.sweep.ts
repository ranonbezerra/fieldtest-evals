import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AnchorState, type Anchor } from '@prisma/client';
import { loadConfig } from '../config';
import { AnchorRepository } from './anchor.repository';
import { CHAIN_CLIENT, type ChainClient, buildAnchorTxInput } from './chain.client';

/**
 * Resolves anchors stuck in broadcast limbo (state PENDING: the intent is
 * durable but the broadcast outcome is unknown — never sent, in flight, or
 * timed out).
 *
 * The chain is always queried FIRST: if the tx landed, the anchor is
 * confirmed from the chain's own receipt. Only when the chain does not have
 * it is the tx re-sent — re-derived through the deterministic prepare, so it
 * carries the same identity as the original and can never become a second
 * anchor.
 */
@Injectable()
export class AnchorRecoverySweep implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnchorRecoverySweep.name);
  private readonly config = loadConfig();
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    @Inject(AnchorRepository) private readonly anchors: AnchorRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((err: unknown) =>
        this.logger.error(`sweep tick failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }, this.config.sweepIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One recovery pass; timer-driven in production, direct in tests. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const stuck = await this.anchors.listByStates([AnchorState.PENDING], this.config.batchSize);
      for (const anchor of stuck) {
        try {
          await this.resolveOne(anchor);
        } catch (err) {
          this.logger.warn(
            `sweep could not resolve ${anchor.documentId}@v${anchor.version}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async resolveOne(anchor: Anchor): Promise<void> {
    // 1. Ask the chain first: the tx may have landed despite the unknown outcome.
    const receipt = await this.chain.getReceipt(anchor.txId);
    if (receipt) {
      const { count } = await this.anchors.confirm(anchor.id, receipt.blockNumber, receipt.blockHash);
      if (count > 0) {
        this.logger.log(`recovered ${anchor.documentId}@v${anchor.version} from chain state (block ${receipt.blockNumber})`);
      }
      return;
    }

    // 2. The chain does not have this tx. Re-derive the signed tx; prepare is
    //    deterministic, so it must carry the same identity as the one that
    //    was persisted before the original broadcast.
    const { txId, signedTx } = await this.chain.prepare(
      buildAnchorTxInput(anchor.documentId, anchor.version, anchor.contentHash),
    );
    if (txId !== anchor.txId) {
      // The client broke its determinism contract. Broadcasting under an
      // unknown identity could mint a second anchor; refuse and leave the row
      // for operator attention.
      this.logger.error(
        `re-prepared tx ${txId} does not match stored tx ${anchor.txId} for ${anchor.documentId}@v${anchor.version}; refusing to re-broadcast an unknown identity`,
      );
      return;
    }

    try {
      await this.chain.broadcast(signedTx);
      await this.anchors.markBroadcasting(anchor.id);
    } catch (err) {
      await this.anchors.bumpAttempts(anchor.id).catch(() => undefined);
      this.logger.warn(
        `re-broadcast for ${anchor.documentId}@v${anchor.version} failed again (${
          err instanceof Error ? err.message : String(err)
        }); will retry on the next sweep`,
      );
    }
  }
}
