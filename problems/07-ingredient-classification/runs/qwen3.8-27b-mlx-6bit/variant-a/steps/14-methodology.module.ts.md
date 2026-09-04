# 14-methodology.module.ts

## reasoning

```
Looking at the plan for `src/methodology/methodology.module.ts`:

From the manifest:
- `src/methodology/methodology.module.ts` | reads: - | Declares controller, provides+exports service and repository

So the module needs to:
- Declare the controller: `MethodologyController`
- Provide and export: `MethodologyService`, `MethodologyRepository`

The convention says:
- "A service, repository or processor is listed in its module's `providers`."
- "A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other."
- "A controller is declared by a module."

The file naming convention: `kebab-case.role.ts` → `methodology.module.ts`
Class naming: PascalCase → `MethodologyModule`

The controller is `MethodologyController`, service is `MethodologyService`, repository is `MethodologyRepository`.

Let me write the module file.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { MethodologyController } from './methodology.controller';
import { MethodologyService } from './methodology.service';
import { MethodologyRepository } from './methodology.repository';

@Module({
  controllers: [MethodologyController],
  providers: [MethodologyService, MethodologyRepository],
  exports: [MethodologyService, MethodologyRepository],
})
export class MethodologyModule {}
```
