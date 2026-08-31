# 06-drift-repair.processor.ts

## reasoning

```
Let's analyze the task:

1. Need to write exactly one file: `src/operations/drift-repair.processor.ts`
2. This is a @Cron sliding-window drift repair processor
3. From the plan:
   ```ts
   // src/operations/drift-repair.processor.ts
   export class DriftRepairProcessor {
     constructor(service: OperationReadModelService, config: ConfigService);
     // @Cron — repairs the sliding window [now - lag, now - safety]
     repairDrift(): Promise<number>;
   }
   ```

4. From Section 4 of the plan (control flow):
   - **Drift repair job.** Scheduled by `@Cron`. On each tick, it computes a sliding window `[now - lag, now - safetyMargin]` (both from environment variable configuration) and calls `rederiveWindow`. It must not overlap with the very recent window that live writes are still filling (hence `safetyMargin`), and it must be idempotent so that missed or doubled ticks are harmless. It runs independently of request traffic and does not take locks held by the write path.

5. Environment variable configuration: "Configuration comes only from environment variables." So lag and safety margin should come from `ConfigService` reading environment variables.

Let's think about what the file needs:

- Import `Cron` from `@nestjs/schedule`
- Import `Injectable` from `@nestjs/common`
- Import `ConfigService` from `@nestjs/config`
- Import `OperationReadModelService` from `./operation-read-model.service`
- Import the `DateWindow` type from `./operation-read-model.types`

Class:
```ts
@Injectable()
export class DriftRepairProcessor {
  constructor(
    private readonly service: OperationReadModelService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES) // or a configurable cron?
  async repairDrift(): Promise<number> {
    const now = new Date();
    const lagMs = this.config.get<number>('DRIFT_REPAIR_LAG_MS') ?? default;
    const safetyMs = this.config.get<number>('DRIFT_REPAIR_SAFETY_MARGIN_MS') ?? default;
    const to = new Date(now.getTime() - safetyMs);
    const from = new Date(to.getTime() - lagMs);
    return this.service.rederiveWindow({ from, to });
  }
}
```

Wait — the plan says "on each tick, it computes a sliding window `[now - lag, now - safetyMargin]`". So the window is `[now - lag, now - safetyMargin]`. That means `from = now - lag`, `to = now - safetyMargin`. And lag > safetyMargin.

Hmm, let me re-read: "repairs the sliding window [now - lag, now - safety]". So from = now - lag (older), to = now - safety (newer, but not the very recent part). This is a sliding window that covers the recent past minus the safety margin.

The plan also says "the scheduled job runs on a cron interval (configurable via environment variables) and repairs the sliding window behind the current time."

So the cron expression might also be configurable via environment variable. Let me think about what's most defensible.

The plan signature:
```ts
export class DriftRepairProcessor {
  constructor(service: OperationReadModelService, config: ConfigService);
  // @Cron — repairs the sliding window [now - lag, now - safety]
  repairDrift(): Promise<number>;
}
```

The comment says `// @Cron — repairs the sliding window [now - lag, now - safety]`, suggesting the `@Cron` decorator is applied to `repairDrift`.

The plan says the cron interval is "configurable via environment variables". Hmm, but `@Cron` takes a static expression at decoration time. To make it configurable via environment variables, you'd need to read the env variable at module load time (top-level) or use `@Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')`. Since the plan says "configurable via environment variables", reading `process.env` at decoration time is a common pattern.

But wait — the discipline says "do exactly what the task asks." The plan (my spec) says:

Section 1: "The scheduled job runs on a cron interval (configurable via environment variables) and repairs the sliding window behind the current time."

Section 4: "Scheduled by `@Cron`. On each tick, it computes a sliding window `[now - lag, now - safetyMargin]` (both from environment variable configuration) and calls `rederiveWindow`."

So both lag and safetyMargin are from environment variable configuration. The cron interval is "configurable via environment variables" per Section 1.

For environment variable configuration, the convention is "Configuration comes only from environment variables." Since we have a ConfigService, we can use `this.config.get('DRIFT_REPAIR_LAG_MS')` and so on.

Now, what env variable names? The plan doesn't specify exact names. I need to pick defensible ones. Let me think:

- `DRIFT_REPAIR_LAG_MS` — how far back the window reaches
- `DRIFT_REPAIR_SAFETY_MARGIN_MS` — how much recent time to skip

And for the cron expression: `DRIFT_REPAIR_CRON` with a default like `*/5 * * * *`.

Hmm, but should the cron be configurable? The plan says "configurable via environment variables" about the interval. Using `@Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')` is a defensible reading. Alternatively, use a fixed `CronExpression.EVERY_5_MINUTES`.

Actually, let me reconsider. The plan's signature comment just says `// @Cron — repairs the sliding window [now - lag, now - safety]`. The simplest reading: apply `@Cron` with some expression. Section 1 says the interval is configurable via environment variables, so I'll read the cron expression from an environment variable with a sensible default.

But there's a subtlety: `@Cron` is evaluated at class definition time, so `process.env.DRIFT_REPAIR_CRON` is read at module import time. That's fine for a NestJS app where env is set before startup.

Alternatively, I could use `@Cron(CronExpression.EVERY_5_MINUTES)` and only make lag/safety configurable. But the plan explicitly says "cron interval (configurable via environment variables)". I'll go with reading from env with a default.

Hmm wait, let me re-read Section 1: "The scheduled job runs on a cron interval (configurable via environment variables) and repairs the sliding window behind the current time."

Yes, the cron interval is configurable via environment variables. So:

```ts
const DRIFT_REPAIR_CRON = process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *';
```

And then `@Cron(DRIFT_REPAIR_CRON)`.

Hmm, but is it cleaner to inline: `@Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')`. Either works. A module-level constant is cleaner and more testable.

Actually, wait. Let me think about whether to use `CronExpression.EVERY_5_MINUTES` as default. `CronExpression.EVERY_5_MINUTES` equals `'*/5 * * * *'`. Using the enum is more self-documenting. But mixing `process.env` fallback with the enum: `@Cron(process.env.DRIFT_REPAIR_CRON ?? CronExpression.EVERY_5_MINUTES)`. That works.

Now for lag and safety margin: these are read per tick via ConfigService (since the constructor takes ConfigService). The plan signature has `config: ConfigService` in the constructor, strongly suggesting the service reads config at runtime.

What units? Milliseconds is most defensible for env configuration of time windows. Names: `DRIFT_REPAIR_LAG_MS` and `DRIFT_REPAIR_SAFETY_MARGIN_MS`.

Defaults: I need sensible defaults. Lag of, say, 1 hour (3600000 ms), safety margin of 5 minutes (300000 ms)? These are guesses. The plan doesn't specify values. Hmm.

Should I have defaults at all, or throw if missing? The convention says "Configuration comes only from environment variables." It doesn't say all config must be required. Having defaults makes the processor robust; but "no secrets in the repo, no hardcoded connection strings" — these aren't connection strings.

I think defaults are defensible, and I should mark them with an ASSUMPTION comment since the plan doesn't specify names or values. Actually, let me think about whether an ASSUMPTION comment is warranted.

Instructions: "If a symbol you truly need is missing from both the plan and references, don't guess silently or reason around it: write the file using the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment where it matters."

The env variable names for lag and safety margin are missing from the plan. So I should mark with an ASSUMPTION comment. Same for the cron env variable name.

But "a single `// ASSUMPTION:` comment where it matters" — I think one per unresolved point, or one covering them. Let me use one comment covering the env variable names and defaults, placed where they're read. Actually, there are two places: the cron expression (module-level) and the lag/safety (inside repairDrift). I could put one ASSUMPTION comment at each, or consolidate.

Hmm, let me think about the cleanest structure:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { OperationReadModelService } from './operation-read-model.service';
import { DateWindow } from './operation-read-model.types';

// ASSUMPTION: the plan names no env keys or defaults for the schedule and window
// bounds; reading them from these variables with these fallbacks.
const DRIFT_REPAIR_CRON = process.env.DRIFT_REPAIR_CRON ?? CronExpression.EVERY_5_MINUTES;
const DRIFT_REPAIR_LAG_MS = Number(process.env.DRIFT_REPAIR_LAG_MS ?? 3_600_000);
const DRIFT_REPAIR_SAFETY_MARGIN_MS = Number(process.env.DRIFT_REPAIR_SAFETY_MARGIN_MS ?? 300_000);
```

Wait, but the constructor takes ConfigService — if I read everything at module level via process.env, ConfigService goes unused. That contradicts the plan signature which explicitly includes `config: ConfigService` in the constructor. So lag and safety should be read via `this.config.get(...)` inside `repairDrift`. The cron expression can't easily be read via ConfigService (decoration happens before DI... actually, you could inject ConfigService and use it in a factory, but @Cron needs the value at decoration time).

So: cron expression from `process.env` at module level (defensible — decorators run at class definition time), lag/safety from `this.config.get()` per tick.

Actually, hmm, could I read the cron expression via process.env? The convention says configuration comes from environment variables — `process.env.DRIFT_REPAIR_CRON` is still an environment variable. Fine.

Alternatively, I could skip the configurable cron and just use `CronExpression.EVERY_5_MINUTES`. But the plan says configurable via env. I'll keep it configurable.

Now, let me reconsider: is reading the cron from process.env at module scope a problem for tests? In tests, the processor would be instantiated directly and `repairDrift()` called manually — the @Cron decorator doesn't fire in unit tests without a ScheduleModule. So it's fine.

Now the `repairDrift` method:

```ts
@Cron(DRIFT_REPAIR_CRON)
async repairDrift(): Promise<number> {
  const now = Date.now();
  const lagMs = this.config.get<number>('DRIFT_REPAIR_LAG_MS') ?? DEFAULT_LAG_MS;
  const safetyMs = this.config.get<number>('DRIFT_REPAIR_SAFETY_MARGIN_MS') ?? DEFAULT_SAFETY_MS;
  const to = new Date(now - safetyMs);
  const from = new Date(to.getTime() - lagMs); // or now - lagMs
  return this.service.rederiveWindow({ from, to });
}
```

Wait: the plan says window `[now - lag, now - safety]`. So `from = new Date(now - lagMs)`, `to = new Date(now - safetyMs)`. Equivalent to `from = to - lag` only if... no: `now - lag` vs `(now - safety) - lag = now - safety - lag`. Different. The plan literally says `[now - lag, now - safety]`, so from = now - lag, to = now - safety. I'll implement exactly that.

Hmm, but semantically: "lag" is how far back we look, "safety" is the recent gap we skip. Window = [now - lag, now - safety]. So the window length is lag - safety. OK, I'll implement literally: from = now - lagMs, to = now - safetyMs.

Should I validate that lag > safety? If misconfigured with lag <= safety, the window is empty or inverted. `rederiveWindow` on an inverted window... the repository probably handles it (deleteInWindow with from > to would delete nothing, insert nothing). The plan says an empty window is a valid idempotent no-op returning 0 (per the service's ASSUMPTION note). I could guard: if lag <= safety, log a warning and return 0? That adds behavior not in the plan. The discipline says do exactly what the plan asks. I'll skip extra validation, but... hmm, actually a misconfigured window with from > to could be harmful depending on the repository implementation (e.g., if it does `occurred_at >= from AND occurred_at <= to`, an inverted range matches nothing — safe). I'll not add the guard; keep it minimal. Actually, let me reconsider — should I clamp? No. Keep it minimal and literal to the plan.

Now, about `DateWindow` type: `{ from: Date; to: Date }`. Good.

Should the processor log anything? The plan doesn't mention logging. I could add a Logger for observability ("runs independently of request traffic"). Hmm, the plan's signature doesn't include a logger. Adding `private readonly logger = new Logger(...)` is a small addition, but the discipline says don't add features the plan doesn't name. Logging could be argued as standard for a cron job, but... the plan's signature is explicit: `constructor(service: OperationReadModelService, config: ConfigService)`. I'll stick to exactly that. No logger.

Wait, but should `repairDrift` be public? The plan signature lists it as a method; tests call `repairDrift()` directly (per test manifest: "drift repair recovers divergence and is idempotent" — the test file reads the processor). So yes, public.

Now imports:
- `@nestjs/common`: Injectable
- `@nestjs/config`: ConfigService
- `@nestjs/schedule`: Cron, CronExpression

Is `@nestjs/schedule` available? The plan says `@Cron`, which comes from `@nestjs/schedule`. It's not in the stack list (NestJS, Prisma, Postgres, Vitest), but the plan explicitly specifies `@Cron`, so `@nestjs/schedule` is implied. I'll import from there.

Is `@nestjs/config` available? The plan signature has `ConfigService`, which comes from `@nestjs/config`. Yes.

Now, the module wiring: the plan's operations.module.ts lists drift-repair.processor as a provider. The processor needs `ScheduleModule` registered somewhere — that's the module's concern, not this file's. I won't touch that (I'm only writing this file).

Let me also double-check the types import: `DateWindow` from `./operation-read-model.types`. The reference types file has:

```ts
export interface DateWindow {
  from: Date;
  to: Date;
}
```

Good.

Now, the service import path: `./operation-read-model.service` — the reference file exists at that path. Good.

Let me also think about whether `repairDrift` should catch errors. If rederiveWindow throws (e.g., DB down), the cron tick fails — Nest's scheduler logs unhandled rejections... actually, an async @Cron method that throws will produce an unhandled promise rejection in some Nest versions. Should I wrap in try/catch? The plan doesn't specify error handling for the processor. The discipline says do exactly what the task asks. I'll not add try/catch. Hmm, but "runs independently of request traffic and does not take locks held by the write path" — nothing about error handling. Keep it simple: no try/catch.

Now defaults. Let me pick:
- Default cron: every 5 minutes (`CronExpression.EVERY_5_MINUTES` = `*/5 * * * *`).
- Default lag: 1 hour = 3600_000 ms.
- Default safety margin: 5 minutes = 300_000 ms.

These are defensible: repair looks back an hour, skipping the most recent 5 minutes that live writes are still filling.

Hmm wait, actually let me reconsider the semantics of "lag" vs "safety". "Repairs the sliding window behind the current time" and "must not overlap with the very recent window that live writes are still filling (hence safetyMargin)". So safetyMargin is the gap between now and the end of the repair window. Lag is how far back the window reaches. Window = [now - lag, now - safetyMargin]. Yes, matches the plan comment `[now - lag, now - safety]`.

Now, one more consideration: `config.get<number>('DRIFT_REPAIR_LAG_MS')` — ConfigService.get with a string key reads from the config object, which by default is `process.env` in NestJS's ConfigModule. So `config.get('DRIFT_REPAIR_LAG_MS')` reads the env variable `DRIFT_REPAIR_LAG_MS`. The value will be a string; I need to convert with Number(). So:

```ts
const lagMs = Number(this.config.get<string>('DRIFT_REPAIR_LAG_MS') ?? DEFAULT_LAG_MS);
```

Hmm, typing: `this.config.get('DRIFT_REPAIR_LAG_MS')` returns `any`. Better to be explicit:

```ts
private readWindowBounds(): DateWindow {
  const now = Date.now();
  const lagMs = Number(this.config.get('DRIFT_REPAIR_LAG_MS') ?? DEFAULT_LAG_MS);
  const safetyMs = Number(this.config.get('DRIFT_REPAIR_SAFETY_MARGIN_MS') ?? DEFAULT_SAFETY_MARGIN_MS);
  return { from: new Date(now - lagMs), to: new Date(now - safetyMs) };
}
```

Should I extract a private helper? The plan signature only lists `repairDrift` as a method. Adding a private helper is an implementation detail, not an exported feature — the instruction says "don't add exports, features, or files the plan doesn't name." A private helper isn't an export. But to be safe and minimal, I could inline everything in `repairDrift`. Inlining is fine and keeps the surface exactly as planned.

Let me write it:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { OperationReadModelService } from './operation-read-model.service';
import { DateWindow } from './operation-read-model.types';

// ASSUMPTION: the plan specifies no env keys, defaults or schedule for the
// sliding window; using DRIFT_REPAIR_CRON (default: every 5 minutes),
// DRIFT_REPAIR_LAG_MS (default: 1 hour) and DRIFT_REPAIR_SAFETY_MARGIN_MS
// (default: 5 minutes).
const DRIFT_REPAIR_CRON = process.env.DRIFT_REPAIR_CRON ?? CronExpression.EVERY_5_MINUTES;

const DEFAULT_LAG_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_SAFETY_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class DriftRepairProcessor {
  constructor(
    private readonly service: OperationReadModelService,
    private readonly config: ConfigService,
  ) {}

  // Repairs the sliding window [now - lag, now - safetyMargin] from the source
  // tables. The safety margin keeps the job clear of the very recent window that
  // live writes are still filling; re-derivation is idempotent, so a missed or
  // doubled tick converges to the same rows.
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
```

Wait — one issue: `this.config.get('DRIFT_REPAIR_LAG_MS')` returns `any`, and if the env variable is set to an empty string, `??` won't kick in (empty string isn't nullish), and `Number('')` is 0. Edge case; not worth handling per the plan's silence. Keep it simple.

Also, `Number(this.config.get(...))` — if config returns undefined, the fallback applies. Good.

Now about the ASSUMPTION comment: the instructions say "mark it with a single `// ASSUMPTION: <what was unresolved>` comment where it matters." There are two places where I'm making assumptions: the cron env key/default (module-level constant) and the lag/safety env keys/defaults. I have one comment covering all three at the top. But the lag/safety defaults are used inside `repairDrift` via the constants. The top comment references them, which is fine. Actually, let me make sure the ASSUMPTION comment is "where it matters" — the constants are where the assumption materializes. A single comment above the constants block covers it.

Hmm, but is the cron env variable truly an assumption? The plan says "cron interval (configurable via environment variables)" — so configurability is specified, but the key name and default aren't. Yes, assumption.

Alternatively, I could avoid the cron env variable entirely and use a fixed `CronExpression.EVERY_5_MINUTES`, treating "configurable via environment variables" as... no, the plan explicitly says configurable. I'll keep it.

Let me double-check the `@Cron` import: `import { Cron, CronExpression } from '@nestjs/schedule';`. Yes.

TypeScript strict: `process.env.DRIFT_REPAIR_CRON` is `string | undefined`; `?? CronExpression.EVERY_5_MINUTES` yields `string`. `@Cron` accepts `string | CronOptions`. Good.

`Number(...)` returns number. `new Date(number)` is fine.

One more thought: should `repairDrift` take an optional window argument for testability? The plan signature: `repairDrift(): Promise<number>` — no parameters. Tests per the manifest: "drift repair recovers divergence and is idempotent" — the test would call `repairDrift()` directly, which computes a window relative to now. For the test to corrupt a row and have it fall within [now - lag, now - safety], the test would set the row's occurred_at to, say, now - 10 minutes (within the default 1h lag, outside the 5min safety). That works with defaults. So no parameter needed. Good — I'll keep the signature exact.

Also, should the class be `@Injectable()`? Yes, it's a provider in the module.

Let me also verify naming conventions: file `drift-repair.processor.ts`, class `DriftRepairProcessor` — matches the plan. Code and comments in English. Good.

One more consideration: the plan's control flow says "does not take locks held by the write path" — that's a property of rederiveWindow (the repository), not something this file does. Fine.

Also "runs independently of request traffic" — cron, yes.

Let me also reconsider whether to read the cron via `process.env` at module scope vs a fixed expression. There's a risk: if the grader expects exactly `@Cron(CronExpression.EVERY_5_MINUTES)`. But the plan says configurable via env. My reading is defensible and marked with ASSUMPTION. I'll keep it.

Hmm, actually, wait. Let me re-read the plan line: "The scheduled job runs on a cron interval (configurable via environment variables) and repairs the sliding window behind the current time."

Yes — configurable via env. My implementation honors that.

Now, the final file. Let me also make sure I don't import anything unused. Imports: Injectable (used), ConfigService (used in constructor), Cron (used), CronExpression (used in default), OperationReadModelService (used), DateWindow (used as type annotation). All used.

Should I annotate `const window: DateWindow`? It's a nice touch to use the imported type. Alternatively, inline the object literal in the call: `return this.service.rederiveWindow({ from: ..., to: ... });` — then the DateWindow import is unused, and I'd remove it. Which is better? The plan's manifest says the processor "reads: src/operations/operation-read-model.service.ts, src/operations/operation-read-model.types.ts" — so the types file is a declared dependency. Using `DateWindow` explicitly aligns with the manifest. I'll keep the typed local variable.

Let me finalize:

```ts
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
```

Wait, one more check on the window semantics. "Repairs the sliding window [now - lag, now - safety]". from = now - lag (the older bound), to = now - safety (the newer bound). In my code: from = new Date(now - lagMs) — older, to = new Date(now - safetyMarginMs) — newer (assuming lag > safety). Correct.

Also, the repository's rederiveWindow probably treats the window as [from, to) per the plan ("delete projection rows whose occurred_at is in [from, to)"). Fine.

Is there any issue with `this.config.get('DRIFT_REPAIR_LAG_MS')` returning a string and `Number()` on it? No, that's intended.

Edge: `config.get` with no generic returns `any`; `?? DEFAULT` — if the env variable is set, it's a string; Number(string) is fine.

I think this is complete and minimal. Let me also double-check that I'm not adding any exports beyond the class. Only `DriftRepairProcessor` is exported. The constants are module-private (not exported). Good.

The response should be only a single fenced code block, nothing else.
```

## reply

```ts
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
```
