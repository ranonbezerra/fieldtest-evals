# repair2-drift-repair.processor.ts

## reasoning

```
Let me analyze the compiler errors that affect `src/drift-repair/drift-repair.processor.ts`:

1. `src/drift-repair/drift-repair.processor.ts(3,38): error TS2307: Cannot find module '@nestjs/schedule' or its corresponding type declarations.`
2. `src/drift-repair/drift-repair.processor.ts(5,36): error TS2307: Cannot find module '../projections/projections.service' or its corresponding type declarations.`
3. `src/drift-repair/drift-repair.processor.ts(6,34): error TS2307: Cannot find module '../projections/projections.types' or its corresponding type declarations.`

These are "Cannot find module" errors. The issue is that the other files (like `projections.service.ts` and `projections.types.ts`) themselves have compilation errors (they can't find their own imports). So TypeScript can't resolve them.

Wait, but the task says "Change nothing the messages do not name." and "Rewrite `src/drift-repair/drift-repair.processor.ts` complete, fixing what these messages require of this file."

The errors in this file are all TS2307 (Cannot find module). These are caused by:
1. `@nestjs/schedule` not being installed
2. `../projections/projections.service` - this file exists but has its own errors (can't find `./projections.repository` and `./projections.types`)
3. `../projections/projections.types` - this file exists but has its own errors (can't find `./projections.repository`)

Wait, looking more carefully at the errors:
- `src/projections/projections.types.ts` is NOT in the error list as having errors itself. Let me re-check...

Actually looking at the errors again:
- `src/projections/projections.repository.ts(3,58): error TS2307: Cannot find module './projections.types'`
- `src/projections/projections.service.ts(2,39): error TS2307: Cannot find module './projections.repository'`
- `src/projections/projections.service.ts(9,8): error TS2307: Cannot find module './projections.types'`
- `src/projections/projections.service.ts(121,47): error TS7006: Parameter 'r' implicitly has an 'any' type.`
- etc.

So `projections.types.ts` doesn't have errors itself - it's that other files can't find it. This suggests the file might not exist yet, or there's a path issue.

Wait, but the manifest says these files should exist:
- `src/projections/projections.types.ts`
- `src/projections/projections.repository.ts`
- `src/projections/projections.service.ts`

The fact that `projections.repository.ts` can't find `./projections.types` and `projections.service.ts` can't find `./projections.repository` and `./projections.types` suggests these files don't exist yet or are empty.

But the task says to only fix `src/drift-repair/drift-repair.processor.ts`. The other errors will remain.

Now, the key question: what does "fixing what these messages require of this file" mean? The errors in this file are all TS2307 "Cannot find module" errors. These are because:
1. `@nestjs/schedule` isn't installed as a dependency
2. The referenced modules don't compile (because their own dependencies are missing)

I can't fix the other files. I can't install `@nestjs/schedule`. So what can I do?

The instruction says: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

And: "If satisfying the compiler seems to require abandoning something the plan specified, keep the plan and add one `// ASSUMPTION:` line saying what you could not reconcile."

So the approach should be:
- Keep the file as the plan specifies it (Cron processor calling repairDrift)
- Add `// ASSUMPTION:` comments for the modules that can't be resolved because their dependencies aren't available

Actually wait - let me re-read the instruction more carefully. "Rewrite `src/drift-repair/drift-repair.processor.ts` complete, fixing what these messages require of this file."

The messages for this file are:
1. Cannot find module '@nestjs/schedule'
2. Cannot find module '../projections/projections.service'
3. Cannot find module '../projections/projections.types'

These are all "cannot find module" errors. The modules either don't exist or don't compile. Since I can only change this one file, and the other files have their own errors that I'm not asked to fix, the best I can do is:

1. Write the file correctly as per the plan
2. Add `// ASSUMPTION:` lines explaining that the unresolved modules are due to their own compilation errors / missing dependencies

Actually, I think the right approach is simpler. The file just needs to be written correctly per the plan. The TS2307 errors are a consequence of other files not compiling or packages not being installed. I should write the file as the plan specifies, and add ASSUMPTION lines for things I can't reconcile.

Let me write the processor per the plan:

```ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProjectionsService } from '../projections/projections.service';
import { DriftReport, OperationRow } from '../projections/projections.types';

@Injectable()
export class DriftRepairProcessor {
  constructor(private readonly projections: ProjectionsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60 * 1000); // last 1 hour
    await this.runForWindow(from, to);
  }

  async runForWindow(from: Date, to: Date): Promise<DriftReport> {
    return this.projections.repairDrift(from, to);
  }
}
```

Now, the `// ASSUMPTION:` lines I need:
- `@nestjs/schedule` is not installed → ASSUMPTION
- `../projections/projections.service` can't be resolved because that file has its own unresolved imports → ASSUMPTION
- `../projections/projections.types` - actually this file might exist but the error is from other files importing it. Let me check... The error says `src/drift-repair/drift-repair.processor.ts(6,34): error TS2307: Cannot find module '../projections/projections.types'`. So this file also can't be found from the processor's perspective.

Actually, I think all three are the same class of problem: the modules either don't exist yet or don't compile. Since I'm only asked to fix this file, I'll write it correctly per the plan and add ASSUMPTION lines.

Let me keep it concise - one ASSUMPTION line for `@nestjs/schedule` (not installed) and one for the projections modules (they have their own compilation errors that prevent resolution).
```

## reply

```ts
import { Injectable } from '@nestjs/common';
// ASSUMPTION: @nestjs/schedule is not installed in the workspace; the import will resolve once the dependency is added.
import { Cron, CronExpression } from '@nestjs/schedule';
// ASSUMPTION: ../projections/projections.service and ../projections/projections.types cannot be resolved because those files have their own unresolved imports; they will resolve once the rest of the workspace compiles.
import { ProjectionsService } from '../projections/projections.service';
import type { DriftReport } from '../projections/projections.types';

@Injectable()
export class DriftRepairProcessor {
  constructor(private readonly projections: ProjectionsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60 * 1000);
    await this.runForWindow(from, to);
  }

  async runForWindow(from: Date, to: Date): Promise<DriftReport> {
    return this.projections.repairDrift(from, to);
  }
}
```
