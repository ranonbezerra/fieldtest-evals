import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { AnchoringService } from './anchoring.service';
import { AnchoringRepository } from './anchoring.repository';

@Injectable()
export class AnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnchorWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly pollMs: number;

  constructor(
    private readonly service: AnchoringService,
    private readonly repo: AnchoringRepository,
  ) {
    const raw = process.env.ANCHOR_POLL_MS;
    this.pollMs = raw ? parseInt(raw, 10) : 2000;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.tick().catch((err: Error) => {
        this.logger.error(`Worker tick failed: ${err.message}`);
      });
    }, this.pollMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    const pending = await this.repo.findPending(50);
    for (const anchor of pending) {
      try {
        await this.service.resolvePending(anchor);
      } catch (err) {
        this.logger.error(`Failed to resolve pending anchor ${anchor.id}: ${(err as Error).message}`);
      }
    }

    const broadcast = await this.repo.findBroadcast(50);
    for (const anchor of broadcast) {
      try {
        await this.service.confirmBroadcast(anchor);
      } catch (err) {
        this.logger.error(`Failed to confirm broadcast anchor ${anchor.id}: ${(err as Error).message}`);
      }
    }
  }
}
