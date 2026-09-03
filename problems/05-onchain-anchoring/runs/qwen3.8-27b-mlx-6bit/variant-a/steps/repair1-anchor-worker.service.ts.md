# repair1-anchor-worker.service.ts

## reasoning

```
Let me analyze the compiler errors carefully. The user asks me to fix `src/anchoring/anchor-worker.service.ts` specifically, but the errors listed are from multiple files. Let me re-read the instruction:

"Rewrite `src/anchoring/anchor-worker.service.ts` complete, fixing what these messages require of this file."

So I need to focus on what's required of `src/anchoring/anchor-worker.service.ts` specifically. Let me look at the errors:

1. `src/anchoring/anchor-worker.service.ts` does not compile - but the specific errors listed don't directly mention `anchor-worker.service.ts` by name. Let me look again...

Wait, the errors listed are:
- `src/anchoring/anchoring.repository.ts` - status type incompatibility (4 errors)
- `src/anchoring/anchoring.service.ts` - Cannot find module './chain-client.interface'
- `src/anchoring/anchoring.service.ts` - Cannot find module './anchoring.repository'
- `src/app.module.ts` - Cannot find module './anchoring/anchoring.module'
- `test/anchoring.spec.ts` - Multiple Cannot find module errors

But the user says "src/anchoring/anchor-worker.service.ts does not compile" and asks me to rewrite it. The errors from the test file reference `../src/anchoring/anchor-worker.service` (line 7), which is a "Cannot find module" error - meaning the file might not exist or has issues that prevent it from being resolved.

Wait, but the instruction says "Change nothing the messages do not name." The messages reference `anchor-worker.service.ts` indirectly through the test file's import. But the primary issue is that the file doesn't exist or has compilation errors of its own.

Actually, looking more carefully at the error list, I don't see a direct error FROM `anchor-worker.service.ts`. The errors are:
- The test imports it but can't find it (module resolution error)
- The repository has status type issues
- The service can't find its dependencies

So the file `anchor-worker.service.ts` likely either doesn't exist yet or has errors. Since the user says "does not compile" and asks me to rewrite it complete, I need to write it from scratch based on the PLAN.md.

But wait - "Change nothing the messages do not name." This means I should only fix what's needed for `anchor-worker.service.ts` to compile. The other errors (repository status type, missing modules) are in OTHER files that I'm not asked to fix.

However, for `anchor-worker.service.ts` to compile, it needs to import from:
- `./anchoring.service` (which exists but has its own errors - can't find chain-client.interface and anchoring.repository)
- `./anchoring.repository` (which exists but has status type errors)

The "Cannot find module" errors for `./chain-client.interface` and `./anchoring.repository` in the service file suggest those modules don't exist or can't be resolved. But the repository file IS shown as reference material and exists. The `chain-client.interface.ts` is NOT shown as existing in the workspace.

Wait, let me re-read. The reference material shows:
- `src/anchoring/anchoring.repository.ts` - exists (shown)
- `src/anchoring/anchoring.controller.ts` - exists (shown)

The PLAN mentions:
- `src/anchoring/chain-client.interface.ts` - should exist but might not
- `src/anchoring/anchoring.service.ts` - has errors (can't find its deps)
- `src/anchoring/anchor-worker.service.ts` - doesn't compile (the file I'm asked to write)
- `src/anchoring/anchoring.module.ts` - can't be found

So the situation is: I need to write `anchor-worker.service.ts` that compiles. For it to compile, its imports need to resolve. The service and repository exist (they're in the workspace), so importing them should work as long as they themselves can be resolved by the compiler.

Actually, in TypeScript, if file A imports from file B, and file B has type errors, file A will still get the types from B (the errors in B don't prevent A from resolving the import). The "Cannot find module" errors are different - they mean the file doesn't exist.

So for `anchor-worker.service.ts`:
- It imports from `./anchoring.service` - this file exists (it's in the workspace, has errors but exists)
- It imports from `./anchoring.repository` - this file exists (shown as reference)

These should resolve fine. The errors in those files won't prevent my file from compiling (TypeScript will report errors in those files separately).

Now let me write the worker based on PLAN.md:

```
export class AnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  constructor(service: AnchoringService, repo: AnchoringRepository);
  // setInterval loop: each tick calls tick()
  tick(): Promise<void>;
}
```

`tick` logic: call `repo.findPending(50)` → for each, `service.resolvePending(anchor)`; call `repo.findBroadcast(50)` → for each, `service.confirmBroadcast(anchor)`.

From the plan:
- Worker runs as in-process `setInterval` loop
- Polling interval configurable via env `ANCHOR_POLL_MS` (default 2000)
- Sequential within a tick
- Errors on individual rows are logged and skipped; loop continues

Let me write this:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { AnchoringService } from './anchoring.service';
import { AnchoringRepository, AnchorRow } from './anchoring.repository';

@Injectable()
export class AnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnchorWorkerService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly service: AnchoringService,
    private readonly repo: AnchoringRepository,
  ) {}

  onModuleInit(): void {
    const pollMs = Number(process.env.ANCHOR_POLL_MS) || 2000;
    this.interval = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error(`Worker tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, pollMs);
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async tick(): Promise<void> {
    const pending = await this.repo.findPending(50);
    for (const anchor of pending) {
      try {
        await this.service.resolvePending(anchor);
      } catch (err) {
        this.logger.error(`Failed to resolve pending anchor ${anchor.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const broadcast = await this.repo.findBroadcast(50);
    for (const anchor of broadcast) {
      try {
        await this.service.confirmBroadcast(anchor);
      } catch (err) {
        this.logger.error(`Failed to confirm broadcast anchor ${anchor.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
```

Now, will this compile? Let me check:
- `@Injectable()` - needs `@nestjs/common` which is in the project
- `OnModuleInit`, `OnModuleDestroy` - from `@nestjs/common`
- `AnchoringService` - from `./anchoring.service` which exists
- `AnchoringRepository`, `AnchorRow` - from `./anchoring.repository` which exists

The `resolvePending` and `confirmBroadcast` methods are defined in the service per the plan. The `findPending` and `findBroadcast` methods are in the repository (shown in reference).

This should compile. The other errors (repository status type, missing chain-client.interface, etc.) are in other files and won't affect this file's compilation directly - they'll be reported separately.

Wait, actually I need to think about this more carefully. If `anchoring.service.ts` has errors (can't find its imports), does that mean the types it exports are broken? In TypeScript, if a file has errors, the types it exports might be `any` or `error` types. But the import resolution itself should still work - the module exists, it just has internal errors.

Actually, in TypeScript's module resolution, if `anchoring.service.ts` exists and exports `AnchoringService`, then importing it from another file will resolve. The internal errors in `anchoring.service.ts` don't prevent the import from resolving - they just mean the types might be partially broken. But for the purpose of `anchor-worker.service.ts` compiling, as long as `AnchoringService` is a valid class name exported from that module, the import will work.

Let me also make sure I'm not importing `AnchorRow` if I don't need it. Actually, I do use it as a type annotation implicitly through the array elements. But I don't explicitly reference `AnchorRow` in my code - the `for...of` loops will infer the type. So I don't need to import `AnchorRow`.

Let me finalize my answer.
```

## reply

```typescript
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AnchoringService } from './anchoring.service';
import { AnchoringRepository } from './anchoring.repository';

@Injectable()
export class AnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnchorWorkerService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly service: AnchoringService,
    private readonly repo: AnchoringRepository,
  ) {}

  onModuleInit(): void {
    const pollMs = Number(process.env.ANCHOR_POLL_MS) || 2000;
    this.interval = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error(
          `Worker tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, pollMs);
  }

  onModuleDestroy(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async tick(): Promise<void> {
    const pending = await this.repo.findPending(50);
    for (const anchor of pending) {
      try {
        await this.service.resolvePending(anchor);
      } catch (err) {
        this.logger.error(
          `Failed to resolve pending anchor ${anchor.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const broadcast = await this.repo.findBroadcast(50);
    for (const anchor of broadcast) {
      try {
        await this.service.confirmBroadcast(anchor);
      } catch (err) {
        this.logger.error(
          `Failed to confirm broadcast anchor ${anchor.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
```
