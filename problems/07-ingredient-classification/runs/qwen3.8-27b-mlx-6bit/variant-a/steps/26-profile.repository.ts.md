# 26-profile.repository.ts

## reasoning

```
Let me analyze what's needed for `src/profile/profile.repository.ts`.

From the PLAN.md, the repository interface is:

```ts
// profile.repository.ts
class ProfileRepository {
  findById(id: number): Promise<Profile | null>;
  getModifiers(profileId: number): Promise<ProfileModifier[]>;
}
```

The data model tells me:
- `profiles` table: `id` INT PK AI, `name` TEXT NOT NULL, `description` TEXT NULL, `created_at` TIMESTAMPTZ DEFAULT now()
- `profile_modifiers` table: `id` INT PK AI, `profile_id` INT FK NOT NULL, `ingredient_id` INT FK NOT NULL, `severity` SEV_ENUM NOT NULL, `flag` TEXT NOT NULL, `source_citation` TEXT NOT NULL; UNIQUE(`profile_id`, `ingredient_id`)

The Prisma schema would have models like:
- `Profile` with fields: id, name, description, createdAt
- `ProfileModifier` with fields: id, profileId, ingredientId, severity, flag, sourceCitation

From the plan's manifest:
- `src/profile/profile.repository.ts | reads: - | Prisma queries for profiles + modifiers`

So it only reads (depends on) the Prisma client. No other file dependencies listed.

Let me write the repository:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
```

Wait, the plan doesn't mention a `PrismaService`. Let me look at the conventions. The stack says "Prisma as the ORM". In NestJS + Prisma, typically you have a `PrismaService` that extends `PrismaClient`. But the plan doesn't explicitly name this file. However, it's standard NestJS + Prisma pattern.

Actually, looking more carefully at the manifest, it says `src/profile/profile.repository.ts | reads: -` meaning no other files it reads. But it must use Prisma somehow. In a typical NestJS + Prisma setup, you'd inject `PrismaService` or `PrismaClient`. Since the plan doesn't specify a `prisma.service.ts`, but the convention is clear, I'll use `PrismaClient` directly or a `PrismaService`.

Actually, the most common pattern in NestJS + Prisma is to have a `PrismaService`. But since the plan doesn't name it, let me think about what's most defensible. The plan says "Prisma queries for profiles + modifiers" - it's a repository that uses Prisma. I'll inject `PrismaService` as that's the standard NestJS + Prisma pattern, and it's implied by the stack choice.

Wait, but the manifest says `reads: -` for this file. That means it doesn't read any other source file. But it still needs to import Prisma somehow. The `reads` field in the manifest likely refers to other source files in the project, not npm packages or generated Prisma client types. So importing `PrismaClient` from `@prisma/client` and `PrismaService` from a shared module would be fine.

Let me go with `PrismaService` as the standard NestJS + Prisma approach. I'll import it from a common location. Actually, since the plan doesn't specify where PrismaService lives, I'll use `@prisma/client` directly and inject it. Or better, use the standard pattern of a `PrismaService`.

Hmm, let me reconsider. The most minimal and defensible approach: inject `PrismaClient` directly via a token, or use a `PrismaService`. Given the plan doesn't specify, I'll go with `PrismaService` imported from `'../prisma/prisma.service'` as that's the most common NestJS + Prisma pattern. But wait - that file isn't in the manifest either.

Actually, looking at this more carefully - the plan's layout section shows:
```
src/main.ts
src/app.module.ts
src/<feature>/<feature>.module.ts
...
```

There's no `src/prisma/` directory listed. But the stack says Prisma. The most common approach in NestJS is to create a `PrismaService`. Since it's not in the manifest but is implied by the stack, I'll reference it.

Let me just use `PrismaClient` from `@prisma/client` and create/inject it. Actually, the cleanest approach that doesn't assume a file not in the plan: use `PrismaService` which is the standard companion to Prisma in NestJS. I'll import it from a reasonable location.

I'll go with importing `PrismaService` from `'../prisma/prisma.service'`. This is the standard pattern and while not explicitly in the manifest, it's a shared infrastructure file that every repository would use.

Now for the Prisma model names - from the schema:
- Table `profiles` → Prisma model likely `Profile` (with `@@map("profiles")`)
- Table `profile_modifiers` → Prisma model likely `ProfileModifier` (with `@@map("profile_modifiers")`)

Fields:
- Profile: `id`, `name`, `description` (nullable), `createdAt`
- ProfileModifier: `id`, `profileId`, `ingredientId`, `severity`, `flag`, `sourceCitation`

The severity enum: `BANNED`, `RESTRICTED`, `WATCH` - in Prisma this would be an enum type.

Let me write the file:
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: number): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { id } });
  }

  async getModifiers(profileId: number): Promise<ProfileModifier[]> {
    return this.prisma.profileModifier.findMany({
      where: { profileId },
    });
  }
}
```
