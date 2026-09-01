# 05-projections.module.ts

## reasoning

```
The task is to write `src/projections/projections.module.ts` based on the plan.

From the plan's manifest:
```
src/projections/projections.module.ts | reads: src/projections/projections.service.ts, src/projections/projections.repository.ts | Module wiring; exports ProjectionsService
```

So this module should:
- Be named `ProjectionsModule` (PascalCase class)
- Providers: `ProjectionsService`, `ProjectionsRepository`
- Exports: `ProjectionsService`

The plan says "A service, repository or processor is listed in its module's `providers`. A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other."

The manifest says this file reads service and repository. The module wiring exports ProjectionsService.

Also, PrismaModule — wait, do we have a prisma module? The plan's manifest doesn't mention a prisma module. References show `WritesService` uses `PrismaClient` directly, and the repositories take `PrismaClient` in their constructor. The plan does not list a PrismaModule. So we can't import one that doesn't exist in the plan. The discipline says "Do not create a file it does not call for" and "Implement exactly what the plan specifies for this file."

The module file's read list is only projections.service.ts and projections.repository.ts. So the imports are:
- `Module` from `@nestjs/common`
- `ProjectionsService` from `./projections.service`
- `ProjectionsRepository` from `./projections.repository`

Providers: [ProjectionsService, ProjectionsRepository]
Exports: [ProjectionsService]

Do we need to provide PrismaClient somewhere? That would be in app.module, which isn't this file. I shouldn't worry about it here — the plan doesn't list PrismaClient as a provider in this module, and the manifest's read list confirms only service and repository are read.

So the file is:

```ts
import { Module } from '@nestjs/common';
import { ProjectionsService } from './projections.service';
import { ProjectionsRepository } from './projections.repository';

@Module({
  providers: [ProjectionsService, ProjectionsRepository],
  exports: [ProjectionsService],
})
export class ProjectionsModule {}
```

That's it. No assumptions needed — everything is present in the plan. The class name `ProjectionsModule` is inferred from the file name and naming convention (PascalCase), and matches what other modules import (`ProjectionsModule` per the manifest: "Module wiring; imports ProjectionsModule").

Reply with just one fenced block, nothing else.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { ProjectionsService } from './projections.service';
import { ProjectionsRepository } from './projections.repository';

@Module({
  providers: [ProjectionsService, ProjectionsRepository],
  exports: [ProjectionsService],
})
export class ProjectionsModule {}
```
