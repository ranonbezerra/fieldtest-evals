# repair1-methodologies.module.ts

## reasoning

```
Let me analyze the compiler errors to understand what's wrong with `src/methodologies/methodologies.module.ts`.

Looking at the error messages, none of them directly reference `src/methodologies/methodologies.module.ts`. The errors are in:
- `src/profiles/profile.repository.ts`
- `src/profiles/profile
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { MethodologyController } from './methodology.controller.js';
import { MethodologyService } from './methodology.service.js';
import { MethodologyRepository } from './methodology.repository.js';

@Module({
  imports: [PrismaModule, ProfilesModule],
  controllers: [MethodologyController],
  providers: [MethodologyService, MethodologyRepository],
  exports: [MethodologyService],
})
export class MethodologiesModule {}
```
