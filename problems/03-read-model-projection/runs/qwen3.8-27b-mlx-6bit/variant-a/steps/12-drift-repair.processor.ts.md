# 12-drift-repair.processor.ts

## reasoning

```
Need to write `src/drift-repair/drift-repair.processor.ts` based on the plan.

Plan's specifications for this file:

```ts
class DriftRepairProcessor {
  constructor(projections: ProjectionsService);

  @Cron(CronExpression.EVERY_5_MINUTES)
  run(): Promise<void>;

  /** Manually triggered; the window defaults to the past 1 hour. */
  runForWindow(from: Date, to: Date): Promise<DriftReport>;
}
```

So the processor:
- Imports `Injectable`, `Cron`, `CronExpression` from `@nestjs/schedule`.
- Injects `ProjectionsService`.
- `run()` has the `@Cron(CronExpression.EVERY_5_MINUTES)` decorator and calls `repairDrift` on the past-1-hour window (the plan says about manual trigger that "window defaults to past 1 hour"; it's reasonable for the cron job also to use the past-1-hour window — the plan says "Drift repair schedule? Every 5 minutes via `@nestjs/schedule`", and repair covers a window; the manual trigger's default is past 1 hour, so the cron's `run()` should repair a window that covers at least the past run. Most defensible reading: the cron repairs the past hour (slightly overlapping window; repair is idempotent — it compares source to projection and resets totals, so reprocessing overlaps is safe).

Wait, but repairDrift has a subtle point: if the window overlaps with already-repaired data — repair is idempotent by design (fetches both sides, takes diff, applies corrections). So it's safe to use the past-1-hour window on every 5-minute run.

Actually, hmm — but there's a subtle issue: should `run()` compute the window as [now - 1h, now]? That's most defensible.

Also `runForWindow(from, to): Promise<DriftReport>` — per plan: "manually triggered; window defaults to past 1 hour". This signature takes `from` and `to` as required parameters. Hmm, "window defaults to past 1 hour" — maybe the signature should be `runForWindow(from?: Date, to?: Date)`. The plan's signature block shows `runForWindow(from: Date, to: Date): Promise<DriftReport>;` but the doc comment says defaults to past 1 hour. Most defensible reading: make parameters optional and default to the past 1 hour. Let's do that — this satisfies both the comment and the call with explicit window. Actually, let me re-read:

```
  @Cron(CronExpression.EVERY_5_MINUTES)
  run(): Promise<void>;

  /** Manually triggered; window defaults to past 1 hour. */
  runForWindow(from: Date, to: Date): Promise<DriftReport>;
```

The comment "manually triggered" suggests this method is used for manual triggering (e.g., from a controller or script, though the plan has no controller for this). "Window defaults to past 1 hour" — if both parameters are required, there's no default. To respect the comment, I'll make them optional: `runForWindow(from?: Date, to?: Date)`. This is a compatible superset of the specified signature (callers passing two Dates still work). Most defensible reading.

Or `run()` itself handles the default window and `runForWindow` just delegates. Let me design:

```ts
async run(): Promise<void> {
  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_MS);
  await this.runForWindow(from, to);
}

async runForWindow(from?: Date, to?: Date): Promise<DriftReport> {
  const toD = to ?? new Date();
  const fromD = from ?? new Date(toD.getTime() - WINDOW_MS);
  return this.projections.repairDrift(fromD, toD);
}
```

This is clean. `run` returns a Promise<void> — it awaits the report but discards it (maybe log). Should I log? The plan says nothing about logging; discipline says implement only what the plan specifies. A minimal `Logger` might be nice, but the plan doesn't mention it. Keep it minimal — no logging, or a simple one? Discipline: "Implement exactly what the plan specifies for this file. Don't add exports, features, or files the plan doesn't name." Logging isn't an export/feature per se, but minimal is safest. I'll skip logging… actually, a cron processor that swallows the result completely is a bit odd, but no tests are specified for this file's behavior (the test file covers the drift repair via service). Stay minimal.

Naming per conventions: file is `drift-repair.processor.ts`, class is `PascalCase` → `DriftRepairProcessor`. Injectable decorator. The module file (not this one) provides it.

Imports:
- `Injectable` from `@nestjs/common`
- `Cron`, `CronExpression` from `@nestjs/schedule`
- `ProjectionsService` from `../projections/projections.service`
- `DriftReport` from `../projections/projections.types`

ESM: per the repo, Node 20+, `"type": "module"`. The shown reference files (projections.service.ts) use extensionless relative imports (`./projections.repository`). Follow that style — no `.js` extensions.

Window constant: past 1 hour = 60 * 60 * 1000 ms. Define a private readonly or module-level const. Module-level const is fine, or private. Should I do `private static readonly REPAIR_WINDOW_MS`? Simpler: a module-level const with a comment.

The class needs `@Injectable()` so Nest's DI works (the module will list it as a provider — the plan's drift-repair.module.ts reads this file).

Also, should `run` handle exceptions? No, keep it minimal. Cron jobs that throw will just log errors via Nest's unhandled; not our concern per the plan.

Now about the "ASSUMPTION" comment: is anything really missing? The signature for `runForWindow` has required parameters in the plan but the comment says "defaults to past 1 hour" — I'm resolving this by making them optional. Is this a guess that should be flagged? The instructions say: "if a symbol you need is really missing from both the plan and the references, don't guess silently… write the file using the most defensible reading and mark it with a single // ASSUMPTION comment at the point where it matters." This isn't a missing symbol, it's an internal tension in the spec. Making parameters optional is the most defensible reading and strictly more permissive. I don't think an ASSUMPTION comment is needed here… but the tension does exist. Hmm. A single short assumption comment might be defensible: e.g., a comment near the optional parameters saying the window defaults to the past 1 hour per plan. That's not an assumption, it's a spec. I'll omit the ASSUMPTION marker — no really missing symbols: `repairDrift(from, to)` exists on ProjectionsService (shown in reference), `DriftReport` type exists (reference), `@Cron`/`CronExpression` from `@nestjs/schedule` is standard and the plan names it.

Actually, one more consideration: the plan says "manually triggered" for `runForWindow`. The plan has no controller or CLI for this; the method just exists to be callable. Fine.

Also, `run(): Promise<void>` — should it return `Promise<DriftReport>`? The plan says `Promise<void>`. Follow the plan: return void (await but don't re-return).

Let me also double-check the layering conventions: "service holds logic. zero raw SQL, zero Prisma client calls." This processor is a "processor" — the convention says "services, repositories, processors are listed in their module's providers." So processor is allowed. The processor calls ProjectionsService — fine, that's the specified dependency (constructor takes projections: ProjectionsService).

Now writing the file:

```ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProjectionsService } from '../projections/projections.service';
import { DriftReport } from '../projections/projections.types';

// Every repair run covers the past hour; overlapping windows are safe because
// repairDrift is a full source-vs-projection comparison for the window.
const REPAIR_WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class DriftRepairProcessor {
  constructor(private readonly projections: ProjectionsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const to = new Date();
    const from = new Date(to.getTime() - REPAIR_WINDOW_MS);
    await this.runForWindow(from, to);
  }

  /** Manually triggered; the window defaults to the past 1 hour. */
  async runForWindow(from?: Date, to?: Date): Promise<DriftReport> {
    const windowEnd = to ?? new Date();
    const windowStart = from ?? new Date(windowEnd.getTime() - REPAIR_WINDOW_MS);
    return this.projections.repairDrift(windowStart, windowEnd);
  }
}
```

Hmm — one question: should the doc comment be preserved? It was in the plan; including it is fine, and English.

Wait, should `run()` use `to = now`? Yes.

Edge: if someone calls `runForWindow(from)` without `to`, default to = now, from as given. If only `to` given, from = to - 1h. Fine.

Comment about overlapping windows — the plan's DESIGN.md rationale isn't here, but a short comment is fine. Actually, discipline says don't add features; comments are OK. Keep it short or delete. I'll keep the constant and a very short comment. Actually, minimal comments only where they add value. The "defaults to past 1 hour" comment is already in the doc. I'll leave one short comment on the constant.

Double-check strict TypeScript: `runForWindow(from?: Date, to?: Date)` — fine.

ESM imports without extensions match the reference style (reference uses `./projections.repository` and `./projections.types`). Good.

One more check: plan's manifest line for this file: "src/drift-repair/drift-repair.processor.ts | reads: src/projections/projections.service.ts, src/projections/projections.types.ts | Cron processor that calls repairDrift". My imports match exactly.

Final answer: a single fenced block with file contents, nothing else.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProjectionsService } from '../projections/projections.service';
import { DriftReport } from '../projections/projections.types';

// Each repair run covers the trailing hour. Overlapping runs are safe because
// repairDrift compares source vs projection for the window and is idempotent.
const REPAIR_WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class DriftRepairProcessor {
  constructor(private readonly projections: ProjectionsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const to = new Date();
    const from = new Date(to.getTime() - REPAIR_WINDOW_MS);
    await this.runForWindow(from, to);
  }

  /** Manual trigger; window defaults to last 1 hour. */
  async runForWindow(from?: Date, to?: Date): Promise<DriftReport> {
    const windowEnd = to ?? new Date();
    const windowStart = from ?? new Date(windowEnd.getTime() - REPAIR_WINDOW_MS);
    return this.projections.repairDrift(windowStart, windowEnd);
  }
}
```
