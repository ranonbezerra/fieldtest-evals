# 24-profile.controller.ts

## reasoning

```
Let me analyze what I need to write for `src/profile/profile.controller.ts`.

From the plan:
- The file is `src/profile/profile.controller.ts`
- It reads: `src/profile/profile.service.ts`
- Endpoint: `GET /profiles/:id` returns `200 Profile`

From the conventions:
- Controller validates input and calls the service. Zero business logic.
- Class name: PascalCase → `ProfileController`
- File naming: `kebab-case.role.ts` → `profile.controller.ts` ✓
- Endpoints: kebab-case, plural. Wait, the endpoint is `/profiles/:id` — "profiles" is already plural.

From the plan's controller endpoints table:
- GET | `/profiles/:id` | — | `200 Profile`

From the plan's service signatures:
- `ProfileService.findById(id: number): Promise<Profile | null>`

Wait, the plan says `findById` returns `Promise<Profile | null>`. But the controller should raise `ResourceNotFound` if not found. Let me re-read...

Actually, looking at the plan more carefully:
- The service signature is `findById(id: number): Promise<Profile | null>` — returns null if not found.
- But the errors table says: `ResourceNotFound` | product id, profile id, or version id not found in DB

So the controller should check if the result is null and raise ResourceNotFound. Wait, but the convention says "controller validates input and calls the service. Zero business logic." Raising an error when a resource isn't found is arguably validation, not business logic. But looking at the plan's section on Product: "create, getWithIngredients; raises ResourceNotFound" — so the service raises it.

Hmm, let me look again. The plan says for ProfileService: `findById(id: number): Promise<Profile | null>`. It returns null. The error table says ResourceNotFound is raised when "profile id not found in DB". 

Looking at the product service: `getWithIngredients(id: number): Promise<Product | null>` — also returns null. But the plan says product service "raises ResourceNotFound".

Actually wait, let me re-read. The plan's service signatures section says:
```
// profile.service.ts
class ProfileService {
  findById(id: number): Promise<Profile | null>;
}
```

And in the errors section:
| Raiser | Condition |
|--------|-----------|
| `ResourceNotFound` | product id, profile id, or version id not found in DB |

The "Raiser" column just says which layer raises it, but the column header is "Raiser" — meaning the service raises it. But the signature returns null...

Actually, I think the controller should handle this: call the service, if null is returned, throw ResourceNotFound. This is input validation (ensuring the referenced resource exists), not business logic. The convention says "controller validates input and calls the service."

But wait — looking at the manifest more carefully:
```
src/profile/profile.controller.ts | reads: src/profile/profile.service.ts | GET /profiles/:id
```

The controller reads from the service. The simplest and most defensible approach: the controller calls `profileService.findById(id)`, if the result is null, throw ResourceNotFound. This keeps zero business logic in the controller (it's just validation that the resource exists).

Actually, re-reading the convention: "controller validates input and calls the service. Zero business logic." — checking if a resource exists and raising 404 is validation, not business logic.

Let me also think about the parameter validation: `:id` should be a number. I'll use `ParseIntPipe` for that.

Now let me write the controller:

```ts
import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ResourceNotFound } from '../classification/types';

@Controller('profiles')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get(':id')
  async findById(@Param('id', ParseIntPipe) id: number) {
    const profile = await this.profileService.findById(id);
    if (!profile) {
      throw new ResourceNotFound(`Profile with id ${id} was not found`);
    }
    return profile;
  }
}
```

Wait, I need to check the import path for ResourceNotFound. The plan says it's in `src/classification/types.ts`. So from `src/profile/profile.controller.ts`, the relative path would be `../classification/types`.

Let me verify: the plan's types section says:
```ts
export class ResourceNotFound extends Error { code = 'resource_not_found'; }
```

This is in `src/classification/types.ts`. So the import would be `import { ResourceNotFound } from '../classification/types';`

This looks correct. Let me finalize.
```

## reply

```ts
import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ResourceNotFound } from '../classification/types';

@Controller('profiles')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get(':id')
  async findById(@Param('id', ParseIntPipe) id: number) {
    const profile = await this.profileService.findById(id);
    if (!profile) {
      throw new ResourceNotFound(`Profile with id ${id} was not found`);
    }
    return profile;
  }
}
```
