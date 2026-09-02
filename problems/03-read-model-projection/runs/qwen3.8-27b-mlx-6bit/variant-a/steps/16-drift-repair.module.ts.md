# 16-drift-repair.module.ts

## reasoning

```
Let me analyze what's needed for `src/drift-repair/drift-repair.module.ts`.

From the PLAN.md:
- The drift-repair module wires up the DriftRepairService
- It imports OperationsModule for the repository (OperationsRepository)
- From the plan's control flow, DriftRepairService has `@Cron` decorator for scheduling

From the conventions:
- A service, repository or processor is listed in its module's `providers`
- A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other
- A controller is declared by a module

From the plan:
- `src/drift-repair/drift-repair.module.ts` | reads: - | Module wiring; imports OperationsModule for the repository
- `src/drift-repair/drift-repair.service.ts` | reads: src/operations/operations.repository.ts, src/operations/operations.types.ts | Scheduled drift check and repair logic with @Cron

So the module needs to:
1. Import OperationsModule (to get OperationsRepository)
2. Provide DriftRepairService
3. The plan says "imports OperationsModule for the repository" - this means OperationsModule exports the OperationsRepository

Wait, let me check. The plan says:
- `src/operations/operations.module.ts` | reads: - | NestJS module wiring controller, service, repository; exports service

Hmm, it says "exports service" but the drift-repair module needs the repository. Let me re-read...

The plan says for the operations module: "NestJS module wiring controller, service, repository; exports service"

But the drift-repair needs OperationsRepository. So OperationsModule must also export the repository, or the drift-repair module imports it differently.

Actually, looking more carefully at the plan's manifest:
- `src/drift-repair/drift-repair.module.ts` | reads: - | Module wiring; imports OperationsModule for the repository

This says it imports OperationsModule "for the repository". So OperationsModule must export the OperationsRepository. The plan's description of the operations module says "exports service" but that might be a simplification - it likely exports both the service and repository, or at least the repository.

Given that the drift-repair module needs to "import OperationsModule for the repository", I'll assume OperationsModule exports `OperationsRepository`. This is the most defensible reading.

Now, for the drift-repair module itself:
- It provides `DriftRepairService` (which uses @Cron)
- It imports `OperationsModule` to get access to `OperationsRepository`
- There's no controller mentioned for drift-repair in the plan ("No user-facing endpoint")

The file naming convention is `kebab-case.role.ts`, so `drift-repair.module.ts` matches.

Let me write the module:

```ts
import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { DriftRepairService } from './drift-repair.service';

@Module({
  imports: [OperationsModule],
  providers: [DriftRepairService],
})
export class DriftRepairModule {}
```

This is clean and matches the plan. The module:
- Imports OperationsModule (for the repository)
- Provides DriftRepairService
- No controller (plan says no user-facing endpoint)

I don't need to add `exports` since no other module imports from DriftRepairModule.

Let me verify the import path. The layout shows:
```
src/<feature>/<feature>.module.ts
```

So from `src/drift-repair/drift-repair.module.ts`, the operations module would be at `../operations/operations.module`. That's correct.

The class name follows PascalCase: `DriftRepairModule`. Correct.

I think this is complete and correct.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { DriftRepairService } from './drift-repair.service';

@Module({
  imports: [OperationsModule],
  providers: [DriftRepairService],
})
export class DriftRepairModule {}
```
