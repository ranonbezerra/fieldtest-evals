# 25-profile.service.ts

## reasoning

```
Let me analyze what's needed for `src/profile/profile.service.ts`.

From the plan:
- It's in the `profile` feature module
- Service signature: `findById(id: number): Promise<Profile | null>` — raises ResourceNotFound
- It reads from `src/profile/profile.repository.ts`

From the plan's control flow and types:
- `ResourceNotFound` is a domain error defined in `src/classification/types.ts`
- The service is thin — it delegates to the repository and raises `ResourceNotFound` if not found

Wait, let me re-read. The plan says:
- `ProfileService.findById(id: number): Promise<Profile | null>` — raises ResourceNotFound

But if it returns `Promise<Profile | null>`, when does it raise? Let me look more carefully.

Actually, looking at the error table:
- `ResourceNotFound` — "product id, profile id, or version id not found in DB"

And the service signature says: `findById(id: number): Promise<Profile | null>` — raises ResourceNotFound

This is a bit contradictory. If it returns `null`, it doesn't raise. But the plan says it "raises ResourceNotFound". 

Looking at the controller endpoint: `GET /profiles/:id` returns `200 Profile`. If the profile isn't found, it should return a 404 with the error envelope. So the service must raise `ResourceNotFound` when not found, meaning it should return `Promise<Profile>` (not null).

Wait, but the plan explicitly says `Promise<Profile | null>`. Let me re-read...

The plan says:
```
class ProfileService {
  findById(id: number): Promise<Profile | null>;
}
```

And the error table says profile id not found raises ResourceNotFound.

Hmm, but if it returns null, who raises the error? The controller? But the convention says "controller validates input and calls the service. Zero business logic." and errors are raised by services.

Actually, I think the most defensible reading is: `findById` raises `ResourceNotFound` when the profile is not found, so it effectively returns `Promise<Profile>` (never null in practice, since it throws). The `| null` in the type might be there for TypeScript's sake (the repository can return null), but the service transforms that into a thrown error.

Let me go with: the service calls `this.profileRepository.findById(id)`, and if the result is null, it throws `ResourceNotFound`. The return type would be `Promise<Profile>` since it never actually returns null.

Wait, but the plan explicitly types it as `Promise<Profile | null>`. Let me just follow the plan exactly. The type says `Promise<Profile | null>` but it raises ResourceNotFound. That's a bit odd but I'll implement it as: call repository, if null throw ResourceNotFound. The return type in the plan is `Promise<Profile | null>` but since we throw, it'll never actually be null. I'll keep the type as stated in the plan to be faithful.

Actually, re-reading more carefully: "This file: findById; raises ResourceNotFound". So the primary behavior is that it raises. The `| null` might just be the TypeScript signature acknowledging the repository can return null, but the service contracts that it throws before returning null.

Let me write it:

```ts
import { Injectable } from '@nestjs/common';
import { ProfileRepository } from './profile.repository';
import { ResourceNotFound } from '../classification/types';

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  async findById(id: number): Promise<Profile | null> {
    const profile = await this.profileRepository.findById(id);
    if (!profile) {
      throw new ResourceNotFound(`Profile with id ${id} was not found`);
    }
    return profile;
  }
}
```

Wait, I need to import `Profile` type. Where does it come from? In Prisma, types are generated. The convention is to use Prisma-generated types. So `Profile` would be from `@prisma/client`.

Let me also check: the plan says the service file reads `src/profile/profile.repository.ts`. And `ResourceNotFound` is from `src/classification/types.ts`.

The import for Prisma types: `import { Profile } from '@prisma/client';`

Let me finalize:

```ts
import { Injectable } from '@nestjs/common';
import { Profile } from '@prisma/client';
import { ProfileRepository } from './profile.repository';
import { ResourceNotFound } from '../classification/types';

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  async findById(id: number): Promise<Profile | null> {
    const profile = await this.profileRepository.findById(id);
    if (!profile) {
      throw new ResourceNotFound(`Profile with id ${id} was not found`);
    }
    return profile;
  }
}
```

This looks correct. It's minimal, delegates to the repository, and raises ResourceNotFound when not found. The return type matches the plan's signature. No extra features, no extra exports.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { Profile } from '@prisma/client';
import { ProfileRepository } from './profile.repository';
import { ResourceNotFound } from '../classification/types';

@Injectable()
export class ProfileService {
  constructor(private readonly profileRepository: ProfileRepository) {}

  async findById(id: number): Promise<Profile | null> {
    const profile = await this.profileRepository.findById(id);
    if (!profile) {
      throw new ResourceNotFound(`Profile with id ${id} was not found`);
    }
    return profile;
  }
}
```
