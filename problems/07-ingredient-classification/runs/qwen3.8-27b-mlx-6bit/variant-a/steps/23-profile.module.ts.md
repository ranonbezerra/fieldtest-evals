# 23-profile.module.ts

## reasoning

```
Let me look at the plan to understand what `src/profile/profile.module.ts` needs to contain.

From the PLAN.md:
- The profile module declares controller, provides+exports service and repository.
- From the manifest: `src/profile/profile.module.ts` — Declares controller, provides+exports service and repository
- Controllers: `src/profile/profile.controller.ts` (GET /profiles/:id)
- Service: `src/profile/profile.service.ts`
- Repository: `src/profile/profile.repository.ts`

From the wiring conventions:
- A service, repository or processor is listed in its module's `providers`.
- A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other.
- A controller is declared by a module.

From the layout:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

The classification service imports the profile repository (from the manifest: `src/classification/classification.service.ts` reads `src/profile/profile.repository.ts`). So the profile module needs to export both the service and repository, and the classification module imports the profile module.

Now let me write the module file. The classes would be:
- `ProfileModule` (PascalCase)
- `ProfileController` (from `src/profile/profile.controller.ts`)
- `ProfileService` (from `src/profile/profile.service.ts`)
- `ProfileRepository` (from `src/profile/profile.repository.ts`)

The module should:
- Declare the controller (ProfileController)
- Provide ProfileService and ProfileRepository
- Export ProfileService and ProfileRepository (since classification needs the repository)

Wait, does classification need the service? Looking at the plan: `src/classification/classification.service.ts` reads `src/profile/profile.repository.ts`. So it directly uses the repository, not the service. But the plan says "provides+exports service and repository" for the profile module.

So I'll export both. Let me write it.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { ProfileRepository } from './profile.repository';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, ProfileRepository],
  exports: [ProfileService, ProfileRepository],
})
export class ProfileModule {}
```
