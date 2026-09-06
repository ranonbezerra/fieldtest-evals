# 09-auth.repository.ts

## reasoning

```
The user wants me to write exactly one file: `src/auth/auth.repository.ts`.

From the plan, I need to implement:
- `findByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string } | null>`
- `createUser(email: string, passwordHash: string): Promise<{ id: string }>`
- `touchUser(id: string): Promise<void>` — UPDATE … SET created_at = created_at WHERE id

The repository is the only layer that touches the database. It uses PrismaService.

Let me look at the plan details:
- Table `users` with columns: `id` (uuid), `email` (String @unique), `password_hash` (String, mapped from `passwordHash`), `created_at` (DateTime, mapped from `createdAt`)
- The Prisma model is `User` with `@@map("users")`

The plan says:
```ts
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string } | null>;
  createUser(email: string, passwordHash: string): Promise<{ id: string }>;
  touchUser(id: string): Promise<void>;   // UPDATE … SET created_at = created_at WHERE id
}
```

Now, I need to think about `PrismaService`. The plan doesn't explicitly define it, but the convention is that in a Prisma + NestJS setup, you have a `PrismaService` that extends `PrismaClient`. The plan's manifest says `src/auth/auth.repository.ts | reads: - | findByEmail, createUser, touchUser (Prisma)`.

Wait, the manifest says "reads: -" for auth.repository.ts. That's interesting — it means this file doesn't read other files? But it needs to import PrismaService and the Injectable decorator. Let me re-read...

Actually, looking more carefully at the manifest format: `src/auth/auth.repository.ts | reads: - | findByEmail, createUser, touchUser (Prisma)` — the "reads" column might mean what other project files it depends on. But it says "-". However, it clearly needs `PrismaService` and `Injectable`.

Hmm, but the convention in NestJS is that `PrismaService` is typically defined in a shared location like `src/prisma/prisma.service.ts`. The plan doesn't explicitly name this file in the manifest, but the repository clearly needs to inject a Prisma client.

Looking at the plan more carefully, the manifest lists these files:
- prisma/schema.prisma
- prisma/migrations/0001_init/migration.sql
- src/main.ts
- src/app.module.ts
- src/auth/auth.module.ts
- src/auth/auth.dto.ts
- src/auth/auth.controller.ts
- src/auth/auth.service.ts
- src/auth/auth.repository.ts
- test/auth.spec.ts
- SECURITY.md

There's no explicit `src/prisma/prisma.service.ts` file. But the repository needs to use Prisma. In many NestJS + Prisma setups, `PrismaService` is a thin wrapper around `PrismaClient`. Since the plan doesn't explicitly define where it comes from, but the repository clearly needs it, I'll import it from a conventional path.

Actually wait — let me re-read the instructions: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION: <what was unresolved>` comment at the point it matters."

The `PrismaService` is referenced in the plan's signature (`constructor(private readonly prisma: PrismaService) {}`) but its import path isn't specified. The most defensible reading in a NestJS project would be `../prisma/prisma.service` or similar. But since the plan doesn't name a file for it, I should use an assumption comment.

Actually, looking at this more carefully — the plan's section 3 explicitly shows:
```ts
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}
  ...
}
```

So `PrismaService` is the type to inject. The import path isn't given. In a typical NestJS + Prisma project, this would be at `src/prisma/prisma.service.ts`. I'll use that as the most defensible path and add an assumption comment.

Now for the implementations:

1. `findByEmail(email: string)`:
   - Prisma query: `this.prisma.user.findUnique({ where: { email } })`
   - Returns `{ id, email, passwordHash } | null`
   - The Prisma model fields are: `id`, `email`, `passwordHash` (mapped to `password_hash` column)

2. `createUser(email: string, passwordHash: string)`:
   - Prisma query: `this.prisma.user.create({ data: { email, passwordHash } })`
   - Returns `{ id }` — so I should use `select: { id: true }` or just return the full result (which includes id)

3. `touchUser(id: string)`:
   - Prisma query: `this.prisma.user.update({ where: { id }, data: { createdAt: ??? } })`
   - Wait, the plan says "UPDATE … SET created_at = created_at WHERE id" — this is a no-op update.
   - In Prisma, to do a no-op update, I could do: `this.prisma.user.update({ where: { id }, data: {} })` — but Prisma might not allow empty data.
   - Actually, looking at the plan: "touchUser(id: string): Promise<void>; // UPDATE … SET created_at = created_at WHERE id"
   - In Prisma, setting a field to its own value isn't straightforward. The most common approach for a no-op update in Prisma would be to use `update` with some data that doesn't change the value, or use `$executeRaw`.
   - Actually, the simplest approach: `this.prisma.user.update({ where: { id }, data: {} })` — but Prisma requires at least one field in `data`.
   - Alternative: Since `created_at` has a default of `now()`, I can't just set it to `now()` because that would change the value. 
   - The plan explicitly says "no-op write to equalise DB round-trip" and the comment says "UPDATE … SET created_at = created_at WHERE id".
   - In Prisma, the cleanest way to achieve this without raw SQL would be... hmm. Actually, Prisma doesn't have a great way to do `SET col = col`. 
   - Options:
     1. Use `$executeRaw`: `this.prisma.$executeRaw\`UPDATE users SET created_at = created_at WHERE id = ${id}\``
     2. Use `update` with some trick — but there's no clean way.
   
   Wait, but the convention says "repository is the only layer that touches the database" and "Zero raw SQL, zero Prisma client calls" is for the service layer. The repository CAN use raw SQL via Prisma's `$executeRaw`.

   Actually, re-reading the conventions: "service holds the logic. Zero raw SQL, zero Prisma client calls." and "repository is the only layer that touches the database." So the repository can use Prisma client including raw queries.

   I'll use `$executeRaw` for the touch operation since it's the most faithful to "SET created_at = created_at".

   Actually, wait. Let me reconsider. Prisma's `update` with empty data `{}` — does it actually work? In recent versions of Prisma, I believe you can pass an empty object to `data` and it will still execute the UPDATE. Let me think... Actually no, Prisma will throw if `data` is empty.

   Another option: I could set `createdAt` to the current value by first reading it, but that adds an extra query. The plan says "one SELECT + one write" for the existing branch.

   I think `$executeRaw` is the most appropriate here. It's a single write, it's a true no-op semantically, and it matches the plan exactly.

   Let me use: `await this.prisma.$executeRaw\`UPDATE users SET created_at = created_at WHERE id = ${id}\``

   This returns a number (rows affected) which I can ignore, making the function return `Promise<void>`.

Let me also think about the return types:
- `findByEmail` returns `Promise<{ id: string; email: string; passwordHash: string } | null>` — I'll use `select` to only return these fields.
- `createUser` returns `Promise<{ id: string }>` — I'll use `select: { id: true }`.

Now let me write the file:

```ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service"; // ASSUMPTION: import path for PrismaService

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

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

Wait, I need to double-check the Prisma model field names. From the plan:
- Model: `User`
- Fields: `id`, `email`, `passwordHash` (mapped to `password_hash`), `createdAt` (mapped to `created_at`)

So in Prisma queries, I use the model field names: `passwordHash`, `createdAt`.

For `$executeRaw`, I use the actual SQL column names: `created_at`, and the table name `users`.

This looks correct. Let me finalize.
```

## reply

```ts
import { Injectable } from "@nestjs/common";
// ASSUMPTION: import path for PrismaService; the plan references it by name but does not list a file defining it
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(
    email: string,
  ): Promise<{ id: string; email: string; passwordHash: string } | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
  }

  async createUser(email: string, passwordHash: string): Promise<{ id: string }> {
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
