# 14-app.module.ts

## reasoning

```
Need to create `src/app.module.ts` — a root module that imports all the feature modules.

Looking at PLAN.md's manifest:
```
src/app.module.ts | reads: src/operations/operations.module.ts, src/projections/projections.module.ts, src/writes/writes.module.ts, src/drift-repair/drift-repair.module.ts | Root module that imports all the feature modules
```

So the root module imports OperationsModule, ProjectionsModule, WritesModule, and DriftRepairModule.

Now, considerations:
1. The drift-repair processor uses `@Cron`, so the app module needs to import `ScheduleModule`. Let me check the plan... the plan says "via `@nestjs/schedule` every 5 minutes" for the drift repair schedule. So ScheduleModule is needed. But does the plan explicitly say to include it in app.module? The plan's manifest says "Root module that imports all the feature modules." Hmm.

Wait — the convention says "Wiring: controllers are declared by modules." And the processor is listed as a provider of its own module. For `@Cron` to work, `ScheduleModule.forRoot()` must be imported somewhere — normally the app module. The plan's assumptions table says "What about drift-repair schedule? | Via `@nestjs/schedule` every 5 minutes." So the project uses `@nestjs/schedule`. The root module is where `ScheduleModule.forRoot()` goes.

But the instructions say "implement exactly what the plan specifies about this file. Do not add exports, features, or files that the plan doesn't mention." The plan specifies about this file: "Root module that imports all the feature modules." ScheduleModule is a module, but... it's not a "feature module" in the sense of the plan's features. Hmm.

But without ScheduleModule.forRoot(), the `@Cron` decorator won't fire. The plan explicitly states the drift-repair schedule is "via `@nestjs/schedule` every 5 minutes." So a defensible interpretation would include `ScheduleModule.forRoot()`.

Is there an ASSUMPTION marker needed? The task says: "If a symbol you truly don't find in either the plan or references, don't guess silently... write the file using the most defensible interpretation and mark it with a single `// ASSUMPTION: <what was unresolved>` comment where it matters."

ScheduleModule is a symbol from `@nestjs/schedule` — referenced indirectly via the plan (in the assumptions table "via `@nestjs/schedule`"). So it's defensible to include it. Should I add an assumption comment? The plan doesn't explicitly say "app.module.ts imports ScheduleModule.forRoot()". Hmm, this is a judgment call.

Let me think about what's most defensible: the plan requires cron scheduling to work. `@nestjs/schedule`'s `ScheduleModule.forRoot()` must be imported by a module — by convention, the root. The plan's drift-repair section says "Cron processor that calls repairDrift" and the assumptions state every 5 minutes via `@nestjs/schedule`. The manifest for app.module.ts says "Root module that imports all the feature modules." Strictly, importing ScheduleModule is a necessary wiring for the planned behavior. Since the plan doesn't explicitly name `ScheduleModule` in app.module, include it with an ASSUMPTION comment explaining that ScheduleModule.forRoot() is required for @Cron to work.

Hmm, but the instruction "don't add exports, features, or files that the plan doesn't mention" — ScheduleModule isn't a feature, it's a NestJS framework module. I think it's needed for the plan's behavior (a scheduled job) to work. Actually wait — would the test exercise cron? The tests call `runForWindow` manually, so cron isn't strictly needed for the tests. But for runtime correctness the scheduled job needs to fire, which requires ScheduleModule.forRoot().

Let me reconsider: is it safer to omit ScheduleModule and strictly just import the four feature modules? The task statement for this file says "Root module that imports all the feature modules" — that's a description, not an exhaustive spec. The plan governs overall and the plan assumes `@nestjs/schedule` for the 5-minute schedule. Without forRoot, nothing works in production. The most defensible reading includes it with an assumption comment.

Also to consider: does app.module need `PrismaModule`? The repository references `PrismaClient` directly (per the plan: `constructor(prisma: PrismaClient)`). There's no mention of a prisma module in the plan or in the shown module references. The reference modules (operations.module.ts, projections.module.ts) do not provide PrismaClient. So DI should fail at runtime... but that's the reference files' problem, not mine. The plan has no prisma module in the manifest. I shouldn't invent a PrismaModule — it's not named in the plan. The shown references do provide `PrismaClient`... no, they don't. They just declare providers like OperationsRepository that presumably inject PrismaClient. That would break at runtime, but that's existing reference code I must not modify and the plan doesn't mention a prisma module. So out of my scope — I write exactly what's named: import the four feature modules.

So my file:

```ts
import { Module } from '@nestjs/common';
import { OperationsModule } from './operations/operations.module.js';
import { ProjectionsModule } from './projections/projections.module.js';
import { WritesModule } from './writes/writes.module.js';
import { DriftRepairModule } from './drift-repair/drift-repair.module.js';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ScheduleModule.forRoot(), // ASSUMPTION: ...
    OperationsModule,
    ProjectionsModule,
    WritesModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
```

Import style: the codebase convention is ESM `"type": "module"`. The reference files are mixed: operations.module.ts uses `.js` extensions (`./operations.controller.js`), projections/writes/drift-repair use no extension. Per the convention, ESM with type: module requires file extensions for relative imports... actually TypeScript with NodeNext needs `.js`. The references are inconsistent. For app.module.ts, which style? The plan has no explicit directive. Hmm.

The references: operations.module.ts uses `.js` extensions. projections.module.ts, writes.module.ts, drift-repair.module.ts don't use extensions. Mixed. Since the codebase is ESM ("type": "module"), NodeNext resolution requires extensions. Safest bet: use `.js` extension like the operations module does? Or match the majority (3 of 4 have no extension)?

Actually, 3 of the 4 reference modules omit extensions, and 1 (operations) includes them. In a strict ESM + NodeNext TypeScript setup, extensionless imports would fail to compile... but since it's in the given references, presumably the project works (or doesn't — not my concern). What I should pick... hmm.

I think it's cleanest to be consistent with the dominant reference style: no extension. But `.js` is the "correct" ESM way. Ugh.

Let me think: the convention block says "ESM, `"type": "module"`". For a root file I'm creating from scratch, using `.js` extensions is the technically correct choice under NodeNext. But matching sibling files is more important for consistency? The siblings are inconsistent, so there's no single sibling style to match.

I'll go with `.js` extensions — defensible under ESM/NodeNext, and at least one reference does that. Actually wait, let me reconsider — if the project's tsconfig uses `"moduleResolution": "bundler"`, then extensionless works. If NodeNext, `.js` required. With type: module and Node 20+, most likely NodeNext → `.js` extension required. Going with `.js`.

Now the ScheduleModule question again. Let me re-read the plan's manifest line: "src/app.module.ts | reads: src/operations/operations.module.ts, src/projections/projections.module.ts, src/writes/writes.module.ts, src/drift-repair/drift-repair.module.ts | Root module that imports all the feature modules".

The "reads" column lists exactly four module files. So strictly, the plan says app.module.ts reads only those 4 files — i.e., imports only those 4 modules. Adding ScheduleModule means reading a 5th symbol not in the reads list. But without it, the plan's cron assumption is dead. The drift-repair.processor presumably has `@Cron(CronExpression.EVERY_5_MINUTES)` on it (from plan section 3). For that to work, ScheduleModule.forRoot() must be registered.

Given the instruction "if a symbol you truly don't find in either the plan or references... write the file using the most defensible interpretation and mark it with a single `// ASSUMPTION:` comment where it matters" — ScheduleModule isn't truly absent: the plan names `@nestjs/schedule` in the assumptions table. It's the location (app.module) that's unresolved. So an ASSUMPTION comment about placing ScheduleModule.forRoot() in the root module is appropriate and follows the directive.

Alternatively, I could omit it and strictly import only the four feature modules. Hmm. Which is more defensible? The task statement for this file: "Root module that imports all the feature modules." A minimal strict reading: just 4 imports. The plan overall says a scheduled job every 5 minutes — but the processor could be registered via other means... no, @Cron requires the schedule module.

I'll include it with an assumption comment. It makes the app actually behave per plan, and the directive explicitly provides a mechanism (ASSUMPTION marker) for exactly this kind of gap. The "don't add features the plan doesn't mention" rule — ScheduleModule isn't a feature, and the plan does mention @nestjs/schedule.

Wait, but could ScheduleModule belong in drift-repair.module.ts instead? Yes — a module can call ScheduleModule.forRoot() itself. In fact, in NestJS, forRoot can be called in any module; typically the root. Since drift-repair.module.ts is a read-only reference I can't modify, and it does not import ScheduleModule, the only place left is app.module.ts. Good — that reinforces the decision: for the cron to work, root must register it.

Let me draft:

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { OperationsModule } from './operations/operations.module.js';
import { ProjectionsModule } from './projections/projections.module.js';
import { WritesModule } from './writes/writes.module.js';
import { DriftRepairModule } from './drift-repair/drift-repair.module.js';

@Module({
  imports: [
    // ASSUMPTION: The plan schedules DriftRepairProcessor with @nestjs/schedule
    // but no module in the references registers it; the root module is the
    // only remaining place for ScheduleModule.forRoot().
    ScheduleModule.forRoot(),
    OperationsModule,
    ProjectionsModule,
    WritesModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
```

Hmm, the directive says a "single" `// ASSUMPTION:` comment. I should keep it to one line:

`// ASSUMPTION: ScheduleModule.forRoot() is registered here (not named in the plan) so the @nestjs/schedule cron on DriftRepairProcessor fires; no reference module registers it.`

Class name: `AppModule` (PascalCase, standard). The file is `src/app.module.ts`, so class `AppModule`.

Should I include blank lines between import groups? Minor stylistic. Keep it simple: Nest imports, schedule import, then feature imports. Or alphabetical? Let me match a typical Nest style. I'll do:

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DriftRepairModule } from './drift-repair/drift-repair.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { ProjectionsModule } from './projections/projections.module.js';
import { WritesModule } from './writes/writes.module.js';

@Module({
  imports: [
    // ASSUMPTION: ...
    ScheduleModule.forRoot(),
    DriftRepairModule,
    OperationsModule,
    ProjectionsModule,
    WritesModule,
  ],
})
export class AppModule {}
```

Ordering: the manifest lists operations, projections, writes, drift-repair. Match that order (or alphabetical). Manifest order is: operations, projections, writes, drift-repair. Use that for readability against the plan.

Final:

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OperationsModule } from './operations/operations.module.js';
import { ProjectionsModule } from './projections/projections.module.js';
import { WritesModule } from './writes/writes.module.js';
import { DriftRepairModule } from './drift-repair/drift-repair.module.js';

@Module({
  imports: [
    // ASSUMPTION: Plan schedules DriftRepairProcessor via @nestjs/schedule but no reference module registers it, so ScheduleModule.forRoot() goes in the root module.
    ScheduleModule.forRoot(),
    OperationsModule,
    ProjectionsModule,
    WritesModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
```

That's the complete file. The reply should be just a fenced code block, nothing else.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OperationsModule } from './operations/operations.module.js';
import { ProjectionsModule } from './projections/projections.module.js';
import { WritesModule } from './writes/writes.module.js';
import { DriftRepairModule } from './drift-repair/drift-repair.module.js';

@Module({
  imports: [
    // ASSUMPTION: The plan schedules DriftRepairProcessor via @nestjs/schedule but names no module that registers it, so ScheduleModule.forRoot() is placed in the root module to make the @Cron job fire.
    ScheduleModule.forRoot(),
    OperationsModule,
    ProjectionsModule,
    WritesModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
```
