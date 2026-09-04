# 18-classification.module.ts

## reasoning

```
Looking at the plan for `src/classification/classification.module.ts`:

From the manifest:
```
src/classification/classification.module.ts | reads: - | Declares controller, provides+exports service and repository
```

From the layout convention:
```
src/<feature>/<feature>.module.ts
```

From the wiring convention:
"A service, repository or processor is listed in its module's `providers`. A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other. A controller is declared by a module."

The classification module needs:
- `controllers`: [ClassificationController]
- `providers`: [ClassificationService, ClassificationRepository]
- `exports`: [ClassificationService, ClassificationRepository]

The service is used by other modules (methodology module imports classification for rescoreAll), so it must be exported. The repository - let me check if any other module needs it directly. Looking at the plan:

- `methodology.service.ts` reads: `src/classification/classification.service.ts` — so methodology imports ClassificationModule for the service.
- No other module directly reads `classification.repository.ts`.

But the plan says "provides+exports service and repository" for this module. So both are exported.

Let me write the file:

```ts
import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ClassificationRepository } from './classification.repository';

@Module({
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService, ClassificationRepository],
})
export class ClassificationModule {}
```

That's it. Clean, follows the plan exactly.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ClassificationRepository } from './classification.repository';

@Module({
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService, ClassificationRepository],
})
export class ClassificationModule {}
```
