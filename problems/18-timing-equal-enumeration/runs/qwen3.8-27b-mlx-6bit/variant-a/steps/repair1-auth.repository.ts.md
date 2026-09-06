# repair1-auth.repository.ts

## reasoning

```
The compiler errors that pertain to `src/auth/auth.repository.ts` are:

1. `src/auth/auth.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.`

That's the only error that directly names `src/auth/auth.repository.ts`. The other errors are in other files.

The issue is that the file imports from `'../prisma/prisma.service'` but that module doesn't exist. I need to figure out what `PrismaService` looks like and either:
- Import it from the correct path
- Or define/use it in a way that compiles

Looking at the plan, the layout says:
```
src/main.ts
src/app.module.ts
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

There's no `src/prisma/` directory in the layout. The Prisma service is typically a common pattern in NestJS + Prisma projects where you create a `PrismaService` that extends `PrismaClient`. 

Since the file layout doesn't include a `src/prisma/` directory, and the plan's manifest doesn't list a prisma service file as a deliverable, I need to think about what to do.

The error says `Cannot find module '../prisma/prisma.service'`. The file is at `src/auth/auth.repository.ts`, so `../prisma/prisma.service` would resolve to `src/prisma/prisma.service`.

Looking at the plan's manifest:
```
prisma/schema.prisma
prisma/migrations/0001_init/migration.sql
src/main.ts
src/app.module.ts
src/auth/auth.module.ts
src/auth/auth.dto.ts
src/auth/auth.controller.ts
src/auth/auth.service.ts
src/auth/auth.repository.ts
test/auth.spec.ts
SECURITY.md
```

There's no `src/prisma/prisma.service.ts` in the manifest. So this file was not planned to exist as a deliverable.

However, the repository needs access to the Prisma client. The standard NestJS + Prisma pattern is to have a `PrismaService` that extends `PrismaClient` and is provided/injected.

Since I can only fix `src/auth/auth.repository.ts` and cannot create other files, I have a few options:

1. Import `PrismaClient` directly from `@prisma/client` and use it instead of a custom `PrismaService`.
2. Use a type-only import or interface to define what I need from the prisma service.

Wait, but the instructions say "Change nothing the messages do not name." The message names `src/auth/auth.repository.ts` and says it can't find `'../prisma/prisma.service'`. So I need to fix this file so it compiles.

The simplest fix that stays true to the plan: import `PrismaClient` from `@prisma/client` directly and use that instead of a custom `PrismaService`. The repository's methods in the plan are:
- `findByEmail(email)` 
- `createUser(email, passwordHash)`
- `touchUser(id)`

These are standard Prisma operations on the `User` model.

Let me write the file using `PrismaClient` directly from `@prisma/client`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
  }

  async createUser(email: string, passwordHash: string) {
    return this.prisma.user.create({
      data: { email, passwordHash },
      select: { id: true },
    });
  }

  async touchUser(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { createdAt: this.prisma.user.update({ where: { id }, select: { createdAt: true } }), },
    });
  }
}
```

Wait, `touchUser` needs to be a no-op write. The plan says: "In the 'existing' branch, issue a no-op `UPDATE users SET created_at = created_at WHERE id = ?`". 

With Prisma, doing a true no-op is tricky because `update` requires a `data` field. One common approach is to update a field to its current value. But we can't read the current value without an extra query.

Actually, a simpler approach: we could use `$executeRaw` to do `UPDATE users SET created_at = created_at WHERE id = $1`. But wait, the layers rule says "repository is the only layer that touches the database" — raw SQL in the repository should be fine since the rule says "service holds the logic. Zero raw SQL, zero Prisma client calls." It doesn't say the repository can't use raw SQL.

Actually, re-reading: "service holds the logic. Zero raw SQL, zero Prisma client calls." This means the service layer can't use raw SQL. The repository CAN use raw SQL since it's the DB layer.

But actually, a simpler approach with Prisma: just update `createdAt` to itself. We can do:

```typescript
async touchUser(id: string): Promise<void> {
  await this.prisma.$executeRaw`UPDATE users SET created_at = created_at WHERE id = ${id}`;
}
```

Or we could use the Prisma update with a field set to its own value. But that's not straightforward without reading first.

Actually, let me reconsider. The simplest no-op update in Prisma would be to just set a field to its current value. We could do:

```typescript
async touchUser(id: string): Promise<void> {
  await this.prisma.user.update({
    where: { id },
    data: { passwordHash: { set: undefined } }, // no, this won't work
  });
}
```

That won't work. Let me use `$executeRaw` for the no-op update since it's the cleanest way to do `SET created_at = created_at`.

Actually wait - another option. We can just do an update that sets a field to itself using Prisma's `update` with a raw expression, but that's complex. The cleanest is `$executeRaw`.

Let me also consider: the plan says the `PrismaService` is injected. But since `src/prisma/prisma.service.ts` doesn't exist and isn't in the manifest, I should just use `PrismaClient` from `@prisma/client` directly. The module would then need to provide `PrismaClient`, but that's a concern for the module file, not the repository file.

Actually, I realize I should think about this more carefully. The module needs to provide the dependency. If I use `PrismaClient` directly, the module would need to provide it. A common pattern is:

```typescript
providers: [
  {
    provide: PrismaClient,
    useValue: new PrismaClient(),
  },
]
```

But I'm only fixing the repository file. The module file isn't named in the errors (well, actually it might be implicitly broken because it imports the repository which is broken, but the error messages don't name the module file directly).

Let me just use `PrismaClient` from `@prisma/client` in the repository. This is the standard approach and avoids the missing module issue.

Let me write the complete file:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, User } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(
    email: string,
  ): Promise<Pick<User, 'id' | 'email' | 'passwordHash'> | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
  }

  async createUser(
    email: string,
    passwordHash: string,
  ): Promise<{ id: string }> {
    return this.prisma.user.create({
      data: { email, passwordHash },
      select: { id: true },
    });
  }

  async touchUser(id: string): Promise<void> {
    await this.prisma.$executeRaw`UPDATE users SET created_at = created_at WHERE id = ${id}`;
  }
}
```

This should compile fine. The `User` type is generated by Prisma from the schema. The `PrismaClient` is from `@prisma/client`.

Wait, I should double-check: does the plan's signature for `findByEmail` match? The plan says:
```
findByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string } | null>;
```

My version returns `Promise<Pick<User, 'id' | 'email' | 'passwordHash'> | null>` which is equivalent since the User model has those fields with those types.

Actually, to be safe and match the plan exactly, let me use the explicit type:

```typescript
async findByEmail(
  email: string,
): Promise<{ id: string; email: string; passwordHash: string } | null> {
  return this.prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true },
  });
}
```

This is cleaner and matches the plan's signature exactly.

Let me finalize. The only error in this file is the missing module `'../prisma/prisma.service'`. By replacing it with `PrismaClient` from `@prisma/client`, I fix that error without changing any other behavior.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(
    email: string,
  ): Promise<{ id: string; email: string; passwordHash: string } | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
  }

  async createUser(
    email: string,
    passwordHash: string,
  ): Promise<{ id: string }> {
    return this.prisma.user.create({
      data: { email, passwordHash },
      select: { id: true },
    });
  }

  async touchUser(id: string): Promise<void> {
    await this.prisma.$executeRaw`UPDATE users SET created_at = created_at WHERE id = ${id}`;
  }
}
```
