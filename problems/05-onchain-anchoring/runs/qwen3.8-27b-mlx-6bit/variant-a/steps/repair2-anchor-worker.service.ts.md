# repair2-anchor-worker.service.ts

## reasoning

```
The error messages for `src/anchoring/anchor-worker.service.ts` are:

```
src/anchoring/anchor-worker.service.ts(2,34): error TS2307: Cannot find module './anchoring.service' or its corresponding type declarations.
src/anchoring/anchor-worker.service.ts(3,37): error TS2307: Cannot find module './anchoring.repository' or its corresponding type declarations.
```

These are "Cannot find module" errors — meaning the files `./anchoring.service` and `./anchoring.repository` don't exist on disk (or aren't being resolved). But the task says "Change nothing the messages do not name." The messages only name `anchor-worker.service.ts` as the file I need to rewrite.

Wait, let me re-read the task: "Rewrite `src/anchoring/anchor-worker.service.ts` complete, fixing what these messages require of this file."

The errors in this file are:
- Line 2, col 34: Cannot find module './anchoring.service'
- Line 3, col 37: Cannot find module './anchoring.repository'

These are import resolution errors. The modules `./anchoring.service` and `./anchoring.repository` can't be found. But I'm only asked to rewrite `anchor-worker.service.ts`. The other files presumably exist (since they have their own errors too), so the issue might be a typo in the import path, or the files genuinely don't exist yet.

Wait, looking at all the errors more carefully — ALL the modules are "Cannot find module" for each other. This suggests the files simply haven't been created yet, or there's a systemic issue. But the task says to fix what "these messages require of this file" — meaning `anchor-worker.service.ts`.

Given the plan, the worker service needs to import:
- `AnchoringService` from `./anchoring.service`
- `AnchoringRepository` and `AnchorRow` from `./anchoring.repository`

The errors are TS2307 "Cannot find module" — these happen when the file doesn't exist or can't be resolved. Since I'm only rewriting this one file, and the task says "fixing what these messages require of this file", I need to write the imports correctly per the plan.

But wait — if the modules truly don't exist, no rewrite of this file will fix it. However, the task says to rewrite this file fixing what the messages require of THIS file. The messages say it can't find those modules. Perhaps the files will be created separately, and my job is just to write this file correctly per the plan.

Let me re-read: "Rewrite `src/anchoring/anchor-worker.service.ts` complete, fixing what these messages require of this file."

I think the intent is: write the complete file correctly per the plan. The TS2307 errors will resolve once all files exist. My job is to produce the correct content for this file.

Let me write `src/anchoring/anchor-worker.service.ts` per the plan:

From the plan:
```ts
export class AnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  constructor(service: AnchoringService, repo: AnchoringRepository);
  // setInterval loop: each tick calls tick()
  tick(): Promise<void>;
}
```

`tick` logic: call `repo.findPending(50)` → for each, `service.resolvePending(anchor)`; call `repo.findBroadcast(50)` → for each, `service.confirmBroadcast(anchor)`.

Polling interval is configurable via env `ANCHOR_POLL_MS` (default 2000).

Errors on individual rows are logged and skipped; the loop continues.

Let me write this:

```ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { AnchoringService } from './anchoring.service';
import { AnchoringRepository, AnchorRow } from './anchoring.repository';

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
      this.tick().catch((err) => {
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
```

Wait, I need to check the naming convention: "TS file: `kebab-case.role.ts`". The plan says `anchor-worker.service.ts` which matches kebab-case.

Also, the import path for `AnchorRow` — looking at the plan, `AnchorRow` is exported from `anchoring.repository.ts`. Let me make sure I import it correctly.

Actually, looking at the plan's repository signature:
```ts
export interface AnchorRow { ... }
```

So `AnchorRow` is an exported interface from the repository file. Good.

Let me also check: do I need `AnchorRow` imported in the worker? Looking at the tick logic, I use the anchors returned from `findPending` and `findBroadcast`. The types are inferred from those return types (`Promise<AnchorRow[]>`), so I don't strictly need to import `AnchorRow` explicitly unless I annotate variables. Let me keep it clean and not import it since TypeScript will infer the type.

Actually, let me be safe and not import `AnchorRow` since it's not directly referenced by name in this file — the types flow through from the repository method return types.

Let me finalize the file.
```

## reply

```ts
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
```
