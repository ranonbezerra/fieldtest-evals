import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';

/**
 * Schedules the confirmation worker pass and the recovery sweep. The pass
 * logic lives in AnchorService; the worker only drives them on an interval
 * and isolates failures so one bad pass cannot stop the loop.
 */
@Injectable()
export class AnchorWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnchorWorker.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly anchoring: AnchorService) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.ANCHOR_WORKER_INTERVAL_MS ?? 5000);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      this.logger.log('anchor worker disabled (ANCHOR_WORKER_INTERVAL_MS not positive)');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One confirmation pass + one recovery sweep, each isolated. */
  async tick(): Promise<void> {
    try {
      const summary = await this.anchoring.confirmAnchors();
      if (summary.confirmed > 0 || summary.failed > 0) {
        this.logger.log(`confirmation pass: confirmed=${summary.confirmed} failed=${summary.failed}`);
      }
    } catch (err) {
      this.logger.error(`confirmation pass failed: ${messageOf(err)}`);
    }
    try {
      const summary = await this.anchoring.recoverStuckAnchors();
      if (summary.confirmed > 0 || summary.reBroadcast > 0 || summary.failed > 0) {
        this.logger.log(
          `recovery sweep: confirmed=${summary.confirmed} reBroadcast=${summary.reBroadcast} failed=${summary.failed} stillLimbo=${summary.stillLimbo}`,
        );
      }
    } catch (err) {
      this.logger.error(`recovery sweep failed: ${messageOf(err)}`);
    }
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
