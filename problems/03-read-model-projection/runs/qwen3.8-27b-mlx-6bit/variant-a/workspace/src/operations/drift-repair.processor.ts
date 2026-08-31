import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { OperationReadModelService } from './operation-read-model.service';
import { DateWindow } from './operation-read-model.types';

// ASSUMPTION: the plan does not name env keys or defaults for the schedule and
// the window bounds; using DRIFT_REPAIR_CRON (default: every 5 minutes),
// DRIFT_REPAIR_LAG_MS (default: 1 hour) and DRIFT_REPAIR_SAFETY_MARGIN_MS
// (default: 5 minutes).
const DRIFT_REPAIR_CRON = process.env.DRIFT_REPAIR_CRON ?? CronExpression.EVERY_5_MINUTES;

const DEFAULT_LAG_MS = 60 * 60 * 1000;
const DEFAULT_SAFETY_MARGIN_MS = 5 * 60 * 1000;

@Injectable()
export class DriftRepairProcessor {
  constructor(
    private readonly service: OperationReadModelService,
    private readonly config: ConfigService,
  ) {}

  // Sliding-window drift repair: re-derives [now - lag, now - safetyMargin] from
  // the source tables. The safety margin keeps the job clear of the very recent
  // window that live writes are still filling; re-derivation is idempotent, so a
  // missed or doubled tick converges to the same rows.
  @Cron(DRIFT_REPAIR_CRON)
  async repairDrift(): Promise<number> {
    const now = Date.now();
    const lagMs = Number(this.config.get('DRIFT_REPAIR_LAG_MS') ?? DEFAULT_LAG_MS);
    const safetyMarginMs = Number(
      this.config.get('DRIFT_REPAIR_SAFETY_MARGIN_MS') ?? DEFAULT_SAFETY_MARGIN_MS,
    );
    const window: DateWindow = {
      from: new Date(now - lagMs),
      to: new Date(now - safetyMarginMs),
    };
    return this.service.rederiveWindow(window);
  }
}
