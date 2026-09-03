# 07-anchor-worker.service.ts

## reasoning

```
Let me analyze the plan for `anchor-worker.service.ts`:

From the plan:
```ts
export class AnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  constructor(service: AnchoringService, repo: AnchoringRepository);
  // setInterval loop: each tick calls tick()
  tick(): Promise<void>;
}
```

`tick` logic: call `repo.findPending(50)` → for each, `service.resolvePending(anchor)`; call `repo.findBroadcast(50)` → for each, `service.confirmBroadcast(anchor)`.

From the plan:
- Worker runs as an in-process `setInterval` loop (not a separate process); polling interval is configurable via env `ANCHOR_POLL_MS` (default 2000).
- Worker tick (every `ANCHOR_POLL_MS`): Sequential within a tick: process all pending rows, then all broadcast rows. Rows are processed one at a time (no parallelism) to keep the chain client interface simple. Errors on individual rows are logged and skipped; the loop continues.

From the module section:
- Providers: `AnchoringRepository`, `AnchoringService`, `AnchorWorkerService`, `ChainClient`

So the file needs:
1. Import `OnModuleInit`, `OnModuleDestroy` from `@nestjs/common`
2. Import `AnchoringService` from `./anchoring.service`
3. Import `AnchoringRepository` from `./anchoring.repository`
4. Class `AnchorWorkerService` implementing `OnModuleInit`, `OnModuleDestroy`
5. Constructor taking `service: AnchoringService, repo: AnchoringRepository`
6. `onModuleInit()` - starts the interval
7. `onModuleDestroy()` - clears the interval
8. `tick(): Promise<void>` - processes pending then broadcast rows

Let me write this:

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AnchoringService } from './anchoring.service';
import { AnchoringRepository } from './anchoring.repository';

@Injectable()
export class AnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly service: AnchoringService,
    private readonly repo: AnchoringRepository,
  ) {}

  onModuleInit(): void {
    const interval = parseInt(process.env.ANCHOR_POLL_MS ?? '2000', 10);
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
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
        console.error(`[anchor-worker] resolvePending failed for ${anchor.id}:`, err);
      }
    }

    const broadcast = await this.repo.findBroadcast(50);
    for (const anchor of broadcast) {
      try {
        await this.service.confirmBroadcast(anchor);
      } catch (err) {
        console.error(`[anchor-worker] confirmBroadcast failed for ${anchor.id}:`, err);
      }
    }
  }
}
```

Wait, the plan says "errors on individual rows are logged and skipped; the loop continues." So I should catch errors per row. Using `console.error` is reasonable for a NestJS service (NestJS has a logger, but the plan doesn't specify using `@nestjs/common`'s `Logger`). Let me use a simple console.error since the plan doesn't mention injecting a Logger. Actually, in NestJS, it's common to use `Logger` from `@nestjs/common`. But the plan doesn't mention it, so I'll use `console.error` to keep it simple and not add something the plan doesn't name.

Actually, let me reconsider. The plan says "Errors on individual rows are logged and skipped; the loop continues." It doesn't specify how to log. I'll use `console.error` since it's the simplest and the plan doesn't call for a Logger dependency.

The file name should be `anchor-worker.service.ts` (kebab-case). The class is `AnchorWorkerService` (PascalCase). Good.

Let me also make sure I'm not adding anything the plan doesn't specify. The plan says:
- `@Injectable()` decorator (implied by NestJS convention for providers)
- `OnModuleInit`, `OnModuleDestroy` lifecycle hooks
- Constructor with service and repo
- `tick()` method
- setInterval loop with configurable interval via `ANCHOR_POLL_MS` env var, default 2000

This all checks out. Let me finalize.
```

## reply

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AnchoringService } from './anchoring.service';
import { AnchoringRepository } from './anchoring.repository';

@Injectable()
export class AnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly service: AnchoringService,
    private readonly repo: AnchoringRepository,
  ) {}

  onModuleInit(): void {
    const interval = parseInt(process.env.ANCHOR_POLL_MS ?? '2000', 10);
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
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
        console.error(`[anchor-worker] resolvePending failed for anchor ${anchor.id}:`, err);
      }
    }

    const broadcast = await this.repo.findBroadcast(50);
    for (const anchor of broadcast) {
      try {
        await this.service.confirmBroadcast(anchor);
      } catch (err) {
        console.error(`[anchor-worker] confirmBroadcast failed for anchor ${anchor.id}:`, err);
      }
    }
  }
}
```
