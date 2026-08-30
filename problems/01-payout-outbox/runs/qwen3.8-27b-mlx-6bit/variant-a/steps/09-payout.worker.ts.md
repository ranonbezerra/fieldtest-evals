# 09-payout.worker.ts

## reasoning

```
Let's analyze the requirements:

1. Write exactly one file: `src/payout/worker/payout.worker.ts`
2. What this file handles: the polling loop, starting/stopping the lifecycle
3. According to PLAN.md §3:

```ts
// src/payout/worker/payout.worker.ts
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  constructor(service: PayoutService, config: ConfigService);
  onModuleInit(): void;    // starts setInterval(this.tick, PAYOUT_POLL_MS)
  onModuleDestroy(): void; // clears the interval
  private tick(): Promise<void>; // calls processMessages(), swallows + logs errors
}
```

From §1 of the plan:
- **Polling interval** is `PAYOUT_POLL_MS` (env var), default 1000 ms; the worker starts/stops with the Nest app's lifecycle.

So what I need:
- `OnModuleInit`, `OnModuleDestroy` from `@nestjs/common`
- `Injectable` decorator
- `PayoutService` from `../payout.service.js` (ESM, so `.js` extension — the codebase is ESM with `"type": "module"`. In NestJS with ESM, imports typically use the `.js` extension. Hmm, but I don't have a reference to other files in this workspace. The plan shows the file layout. In the TypeScript ESM convention, relative imports need the `.js` extension. Let me think about what's most defensible.)

The convention says ESM, `"type": "module"`. TypeScript source files in an ESM project use `.js` extensions on relative imports. Since I can't see other files, should I use `../payout.service.js`? Or `../payout.service`?

Actually, in a typical NestJS + ESM setup (with tsconfig's `module: nodenext`), imports need to be written as `.js`. The convention explicitly says ESM, `"type": "module"`, Node 20+. So `.js` extension is the defensible choice. But wait — the plan doesn't specify import extensions. Hmm.

Let me think: the reference workspace files are shown as fragments of `payout.service.ts`, but no imports are visible. I have to pick one. Most defensible: in ESM TypeScript, relative imports use the `.js` extension. I'll go with `../payout.service.js`.

Hmm, but actually a lot of NestJS projects use CommonJS-compatible imports without extensions. But the convention explicitly says ESM. Node 20+, `"type": "module"`. In that case, TS files are compiled to ESM and Node requires explicit extensions. So `.js` is correct.

- `ConfigService` from `@nestjs/config`. The plan says `config: ConfigService` in the constructor. So I need to import from `@nestjs/config`. The plan's manifest says the worker "reads: src/payout/payout.service.ts". It doesn't mention @nestjs/config, but the signature in §3 explicitly uses `ConfigService`. The convention says "configuration comes only from environment variables", and `PAYOUT_POLL_MS` is an env var. So ConfigService is the mechanism.

Wait — is ConfigService available? The plan explicitly writes `config: ConfigService` in the signature, so yes, it's part of the spec. The plan governs.

- `PAYOUT_POLL_MS` env var, default 1000 ms. Use `config.get<string>('PAYOUT_POLL_MS')` and parse to int, default 1000.

Implementation details:

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PayoutService } from '../payout.service.js';

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.getIntervalMs();
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getIntervalMs(): number {
    const raw = this.config.get<string>('PAYOUT_POLL_MS');
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
  }

  private async tick(): Promise<void> {
    try {
      const processed = await this.service.processMessages();
      if (processed > 0) {
        this.logger.log(`processed ${processed} payout message(s)`);
      }
    } catch (error) {
      this.logger.error(
        `payout worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
```

Wait, the plan says `onModuleInit(): void; // starts setInterval(this.tick, PAYOUT_POLL_MS)`. So the interval is set with `this.tick`. But `tick` returns a Promise; passing it directly to setInterval means the promise isn't awaited and errors could become unhandled rejections. The plan says tick "swallows + logs errors", so tick itself catches errors and doesn't throw. So `setInterval(() => void this.tick(), ...)` or directly `setInterval(this.tick, ...)` — since tick catches all errors internally, it never rejects. But to be safe against unhandled rejections, wrapping in an arrow function with `void` is cleaner. Actually, if tick catches everything internally, `setInterval(this.tick, intervalMs)` is fine. But the arrow wrapper `() => { void this.tick(); }` is more defensive. Hmm, but "implement exactly what the plan specifies" — the plan says `setInterval(this.tick, PAYOUT_POLL_MS)`. I can do `this.timer = setInterval(() => { void this.tick(); }, intervalMs);` — that's still "starts setInterval(this.tick, ...)" in spirit. Or literally `setInterval(this.tick, intervalMs)`.

Since tick swallows errors (catches and logs), it never rejects, so `setInterval(this.tick, intervalMs)` is safe. But there's a subtle point: if tick's catch itself throws (unlikely), it becomes an unhandled rejection. The `() => void this.tick()` wrapper has the same problem. To be truly safe: `setInterval(() => { this.tick().catch(...); }, ...)`. But tick already catches. I'll keep it simple and defensive:

```ts
this.timer = setInterval(() => {
  void this.tick();
}, intervalMs);
```

This is defensible and matches the plan's intent.

Also, should I call `this.tick()` immediately on init? The plan doesn't say so — only that it starts setInterval. I won't add an immediate tick; "do exactly what the task asks."

`NodeJS.Timeout` type: in Node 20 with @types/node, `setInterval` returns `NodeJS.Timeout`. That's standard.

Do I need to import `Logger`? The plan says tick "swallows + logs errors". So logging is required. NestJS's `Logger` class is the natural choice. The plan doesn't explicitly name Logger, but "logs errors" implies some logging mechanism. Nest's `Logger` is the most defensible.

Now, about the error type: the plan says `processMessages()` returns `Promise<number>` (count processed). So I can log the count.

Should the worker handle errors from `processMessages`? Yes — "swallows + logs errors".

One more consideration: `onModuleDestroy` clears the interval. Good.

Also, should `onModuleInit` be async? No — the plan says `void`.

Edge case: should I guard against double-start? The plan doesn't say. Keep it simple.

Let me also think about whether to use `@Injectable()` — yes, since it's a provider listed in the module (per the plan's manifest, `payout.module.ts` includes the worker as a provider).

Import paths:
- `@nestjs/common` — Injectable, Logger, OnModuleDestroy, OnModuleInit
- `@nestjs/config` — ConfigService
- `../payout.service.js` — PayoutService

Wait, is the `.js` extension correct? Let me reconsider. The convention says ESM, `"type": "module"`, Node 20+. In TypeScript with `moduleResolution: node16/nodenext` (required for ESM), relative imports must include the `.js` extension. If the project is compiled with `tsc` to ESM, then yes. If ts-node/tsx is used, tsx handles both. The safest and most standard choice for a declared ESM project is `.js`. I'll use `../payout.service.js`.

Hmm, but there's a risk: if the evaluator's workspace uses extensionless imports... The plan doesn't show any import lines. The convention says ESM. I'll go with `.js` — that's the most defensible reading for an ESM project. Actually, wait. Let me think about whether to add an ASSUMPTION comment. The instructions say: "If a symbol you truly need is missing from both the plan and references, don't guess silently... write the file with the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment where it matters."

The import extension isn't a "symbol" — it's a stylistic/compile detail. I think using `.js` without a comment is fine; it's the standard for ESM TypeScript. Adding an assumption comment about import extensions would be noise. Actually, hmm. Let me consider: is this "truly missing"? The plan shows the file layout with `.ts` files. The convention says ESM. In ESM TS, you import with `.js`. This is well-established practice, not a guess. I won't add an assumption comment.

What about `ConfigService` — is it in the plan? Yes, explicitly in the §3 signature: `constructor(service: PayoutService, config: ConfigService)`. So it's specified. The import from `@nestjs/config` is implied by the symbol name. No assumption needed.

Default interval: 1000 ms per plan §1.

Parsing the env var: `config.get('PAYOUT_POLL_MS')` — ConfigService returns `any`. I'll do:

```ts
private getIntervalMs(): number {
  const raw = this.config.get<string>('PAYOUT_POLL_MS');
  const parsed = raw === undefined || raw === '' ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}
```

Or simpler:

```ts
const parsed = Number(this.config.get<string>('PAYOUT_POLL_MS'));
return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
```

`Number('')` is 0, which fails `> 0` → default. `Number(undefined)` is NaN → default. `Number('500')` is 500. `Number('abc')` is NaN → default. That's clean. But `Number` on a string like '1e3' would be 1000 — fine. I'll use `Number`.

Hmm, but should the default be inlined or a constant? A private readonly constant `DEFAULT_POLL_MS = 1000` is nice. The plan says default 1000 ms. A named constant is defensible and clean. But "do not add exports, features, or files that the plan doesn't name" — a private constant isn't an export or feature. Fine.

Logging in tick: the plan says "swallows + logs errors". Should I log successful processing too? The plan only mentions logging errors. Logging the processed count is a small addition... "implement exactly what the plan specifies." The plan says tick: "calls processMessages(), swallows + logs errors". So minimally: call, catch, log error. Logging the processed count is arguably fine as operational logging, but to be strict I might keep it minimal. Hmm. A worker that logs nothing on success is fine per the plan. But a tiny log when processed > 0 is common. The discipline says "do exactly what the task asks." The plan specifies swallowing + logging errors. I'll log only errors, and maybe... actually, let me just keep it minimal: catch → logger.error. And maybe a debug log of the count? No — keep it exact. Just error logging.

Hmm, actually let me reconsider: `processMessages()` returns the count; if I don't use it at all, that's fine — `await this.service.processMessages();` without capturing. That's the most minimal reading. But capturing and logging at debug level when > 0 is... no. Minimal: `await this.service.processMessages();` inside try/catch.

Wait, but is it weird to discard the return value? No, it's fine — the plan's tick signature just says "calls processMessages(), swallows + logs errors".

Error message in the catch:

```ts
} catch (error) {
  this.logger.error(
    `payout worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
    error instanceof Error ? error.stack : undefined,
  );
}
```

Nest's Logger.error accepts (message, stack?, context?). Passing the stack is nice. Keep it simple:

```ts
} catch (error) {
  this.logger.error(
    `payout worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}
```

Good enough.

Now the full file:

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PayoutService } from '../payout.service.js';

const DEFAULT_POLL_MS = 1000;

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.getPollMs());
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getPollMs(): number {
    const parsed = Number(this.config.get<string>('PAYOUT_POLL_MS'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_MS;
  }

  private async tick(): Promise<void> {
    try {
      await this.service.processMessages();
    } catch (error) {
      this.logger.error(
        `payout worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
```

`ReturnType<typeof setInterval>` vs `NodeJS.Timeout`: in Node types, `setInterval` returns `NodeJS.Timeout`. `ReturnType<typeof setInterval>` is type-safe and avoids the global namespace. Either works. I'll use `NodeJS.Timeout` — it's the most common in NestJS code. Hmm, with @types/node both exist. `ReturnType<typeof setInterval>` is more robust. I'll go with `NodeJS.Timeout` since it's idiomatic in NestJS projects... actually, let me use `ReturnType<typeof setInterval>` to be safe regardless of type definitions. Either is fine; I'll pick `NodeJS.Timeout` — it's standard in NestJS codebases and the convention mentions Node 20+ (types available).

Hmm, one more consideration: should `onModuleInit` set the interval with `this.tick` directly as the plan literally says? `setInterval(this.tick, ms)` — `this.tick` is a method; when passed as a callback, `this` binding is lost! `setInterval(this.tick, ms)` calls `tick()` with `this` = undefined (strict mode) → crash. So the arrow wrapper is actually required for correctness: `setInterval(() => { void this.tick(); }, ms)`. Good thing I caught that. The plan's comment `setInterval(this.tick, PAYOUT_POLL_MS)` is shorthand; the correct implementation needs a bound wrapper. So my arrow function is the defensible reading — no assumption comment needed since it's just correct JS.

Alternatively, I could store `const tick = () => void this.tick();`. The inline arrow is fine.

Double-checking the plan's worker description in §4: not mentioned beyond §3 and §1. §1: "the worker starts/stops with the Nest app's lifecycle" — OnModuleInit/OnModuleDestroy. ✓

Class name: `PayoutWorker` per the plan. File: `src/payout/worker/payout.worker.ts`. ✓

Imports from `@nestjs/config` — the plan's manifest for the worker only lists "reads: src/payout/payout.service.ts", but §3's signature has `config: ConfigService`. The manifest's "reads" list is about project files, not npm packages. Fine.

Now — one question: does the module need to import ConfigModule for ConfigService injection? That's the module file's concern, not this file's. Not my file.

Should I add `unref()` on the timer? In tests, a live interval would keep the process alive. The plan doesn't mention it. Adding `.unref()` is a small operational nicety, but... "do not add features the plan doesn't name." Hmm. In a Nest app, the HTTP server keeps the process alive anyway; unref wouldn't hurt but isn't specified. I'll skip it — stay exact.

Also, should `tick` handle the case where a previous tick is still running (overlapping polling)? The plan doesn't mention it. `processMessages` loops until no pending messages; overlapping ticks would double-claim, but the CAS claim handles that. The plan says "one worker instance" and doesn't require overlap protection. I won't add it — stay exact.

Final check on the error envelope: not relevant to this file (the worker doesn't throw).

Let me also double-check the `Logger` import — from `@nestjs/common`. Yes.

One more: the plan says `onModuleInit(): void; // starts setInterval(this.tick, PAYOUT_POLL_MS)`. My implementation reads the interval from config in `onModuleInit` — good, that's when PAYOUT_POLL_MS is read.

I think the file is complete. Let me write it out cleanly with a few English comments (the convention says code and comments in English).

Final file:

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PayoutService } from '../payout.service.js';

const DEFAULT_POLL_MS = 1000;

/**
 * Polling worker: claims pending payout messages and drives them through the
 * provider on a fixed interval. Runs for the lifetime of the Nest app.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.getPollMs());
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getPollMs(): number {
    const parsed = Number(this.config.get<string>('PAYOUT_POLL_MS'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_MS;
  }

  private async tick(): Promise<void> {
    try {
      await this.service.processMessages();
    } catch (error) {
      // A failed tick must not kill the worker; the next poll retries.
      this.logger.error(
        `payout worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
```

That's it. The reply must be exactly one fenced block with the file contents and nothing else.
```

## reply

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PayoutService } from '../payout.service.js';

const DEFAULT_POLL_MS = 1000;

/**
 * Polling worker: drives pending payout messages through the provider on a
 * fixed interval. Starts and stops with the Nest app lifecycle.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.getPollMs());
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getPollMs(): number {
    const parsed = Number(this.config.get<string>('PAYOUT_POLL_MS'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_MS;
  }

  private async tick(): Promise<void> {
    try {
      await this.service.processMessages();
    } catch (error) {
      // A failed tick must not kill the worker; the next poll retries.
      this.logger.error(
        `payout worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
```
