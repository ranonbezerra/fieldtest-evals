import { Injectable, Logger } from "@nestjs/common";
import { PayoutService } from "../payout/payout.service";
import { ReconcileWindow } from "./reconcile.types";

@Injectable()
export class ReconcileJob {
  private readonly logger = new Logger(ReconcileJob.name);

  constructor(private readonly payoutService: PayoutService) {}

  // Runs every 15 minutes.
  async run(): Promise<void> {
    const window: ReconcileWindow = {
      start: new Date(Date.now() - 60 * 60 * 1000),
      end: new Date(),
    };
    this.logger.verbose(
      `Reconciling window ${window.start.toISOString()} → ${window.end.toISOString()}`,
    );
    await this.payoutService.reconcile(window);
  }
}
