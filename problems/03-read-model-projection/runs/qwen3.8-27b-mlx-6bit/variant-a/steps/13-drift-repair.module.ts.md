# 13-drift-repair.module.ts

## reasoning

```
I need to write a NestJS module for the drift-repair feature. Looking at the plan, `DriftRepairModule` should wire together `DriftRepairProcessor`, import `ProjectionsModule` since the processor depends on `ProjectionsService`, and follow the standard NestJS module pattern with a controller and service layout.

Writing the module file...
```

## reply

```ts
import { Module } from '@nestjs/common';
import { ProjectionsModule } from '../projections/projections.module';
import { DriftRepairProcessor } from './drift-repair.processor';

@Module({
  imports: [ProjectionsModule],
  providers: [DriftRepairProcessor],
})
export class DriftRepairModule {}
```
