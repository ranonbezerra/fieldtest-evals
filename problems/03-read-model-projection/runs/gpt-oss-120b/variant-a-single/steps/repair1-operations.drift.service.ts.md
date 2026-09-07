# repair1-operations.drift.service.ts

## reasoning

```
We need to write the file operations.drift.service.ts to compile. The errors: cannot find module '@nestjs/schedule' and './operations.repository'. Likely need to import ScheduleModule or Injectable etc. We don't have other files, but we need to reference existing ones. Since we cannot see other files, we need to make assumptions.

Goal: implementation of drift service that fits plan. At minimum, define class OperationsDriftService, exported, with @Injectable() decorator, use @Cron from @nestjs/schedule. Also inject OperationsRepository.

We need to import necessary types from repository; unknown shape, we can import as any.

Define method repairDrift(): Promise<void> that calls repository.repairDrift()? We'll assume repository has method repairDrift.

Also schedule with @Cron('0 * * * *') for hourly.

Add constructor injecting repository.

Add any other needed method for re-derivation.

Also export provider.

Make sure imports resolve: we need to import { Injectable } from '@nestjs/common'; import { Cron } from '@nestjs/schedule'; import { OperationsRepository } from './operations.repository';

Define class.

Add stub methods with any.

Make sure TypeScript types not error: repository type any.

Add // ASSUMPTION comments for unknown repository methods.

Implement.

Let's produce file.
```

## reply

```typescript
// src/operations/operations.drift.service.ts
//
// This service encapsulates the scheduled “drift‑repair” logic for the
// operations read‑model projection. It is deliberately lightweight – it only
// coordinates calls to the repository layer where the actual SQL resides.
// The design follows the plan that prefers **sync hooks** (immediate updates
// from the write side) plus a periodic repair job to fix any missed updates.
//
// NOTE: The repository implementation is not visible in this repository snapshot.
// The service therefore treats the repository as an opaque dependency and calls
// methods that are *assumed* to exist. If the real repository differs, the
// corresponding methods must be added there.
//
// ---------------------------------------------------------------------------
// ASSUMPTION: `OperationsRepository` provides:
//   - `repairDrift(start: Date, end: Date): Promise<void>` – recomputes the
//     projection for the given window.
//   - `getStaleWindows(limit: number): Promise<Array<{ start: Date; end: Date }>>`
//     – returns date windows that need repair.
//   - `markWindowRepaired(start: Date, end: Date): Promise<void>` – records that
//     a window has been successfully repaired.
// Adjust the method signatures here if the real repository differs.
// ---------------------------------------------------------------------------

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OperationsRepository } from './operations.repository';

@Injectable()
export class OperationsDriftService {
  private readonly logger = new Logger(OperationsDriftService.name);

  constructor(private readonly repository: OperationsRepository) {}

  /**
   * Public entry point that can be invoked manually (e.g., from tests) to
   * trigger a full drift‑repair run for a specific time window.
   *
   * @param start - inclusive start of the window to re‑derive.
   * @param end   - exclusive end of the window to re‑derive.
   */
  async repairWindow(start: Date, end: Date): Promise<void> {
    this.logger.debug(`Starting drift repair for window ${start.toISOString()} – ${end.toISOString()}`);
    // Delegate the heavy lifting to the repository (raw SQL / transaction).
    await this.repository.repairDrift(start, end);
    await this.repository.markWindowRepaired(start, end);
    this.logger.debug(`Completed drift repair for window ${start.toISOString()} – ${end.toISOString()}`);
  }

  /**
   * Scheduled job that periodically (every hour) scans for stale windows and
   * repairs them. The schedule value follows the plan’s “drift‑repair job”.
   *
   * The job is intentionally resilient: any failure for a given window is logged
   * and the job continues with the next window, preventing a single bad window
   * from halting the whole process.
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'operations-drift-repair',
  })
  async scheduledRepair(): Promise<void> {
    this.logger.log('Scheduled drift‑repair job started');

    // Limit the number of windows per run to avoid runaway DB load.
    const windows = await this.repository.getStaleWindows(10);

    for (const { start, end } of windows) {
      try {
        await this.repairWindow(start, end);
      } catch (err) {
        // Log but do not re‑throw – we want the job to continue.
        this.logger.error(
          `Drift repair failed for window ${start.toISOString()} – ${end.toISOString()}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    this.logger.log('Scheduled drift‑repair job finished');
  }
}
```
