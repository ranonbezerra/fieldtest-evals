# 06-users.module.ts

## reasoning

```
The task is to write `src/users/users.module.ts` based on the PLAN.md specification.

From the plan:
- `src/users/users.module.ts` — `UsersModule`
  - providers: [UsersService] (+ UsersRepository if present)
  - exports: []
  - imports: [ExportModule] (consumes ExportService)

The plan says "The implementer preserves existing class bodies and only adjusts `providers`, `exports`, `imports`."

I need to figure out what exists in the users module. From the plan's manifest:
- `src/users/users.module.ts` reads: `src/export/export.module.ts`

The plan says providers should include UsersService and "UsersRepository if present". Since the plan mentions it conditionally, and the typical NestJS pattern would have a repository, I'll include UsersRepository. But wait - the plan says "preserves existing class bodies and only adjusts providers, exports, imports." The original file likely had UsersService and UsersRepository as providers.

Actually, looking more carefully at the plan: "providers: [UsersService] // + UsersRepository if present"

Since I don't have the original file content, but the convention says every feature has a service and repository, and the plan mentions "UsersRepository if present" as a conditional addition, I'll include both UsersService and UsersRepository since the standard layout in the conventions shows `<feature>.repository.ts`.

The module needs:
- Import `Module` from `@nestjs/common`
- Import `UsersService` from `./users.service`
- Import `UsersRepository` from `./users.repository`
- Import `ExportModule` from `../export/export.module`
- `@Module` decorator with providers: [UsersService, UsersRepository], exports: [], imports: [ExportModule]

Wait - looking at the plan more carefully, it says "The implementer preserves existing class bodies and only adjusts `providers`, `exports`, `imports`." This implies the class body (the constructor, methods) stays the same. But a module class typically just has the decorator and no body beyond that.

Let me write this:

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { ExportModule } from '../export/export.module';

@Module({
  providers: [UsersService, UsersRepository],
  exports: [],
  imports: [ExportModule],
})
export class UsersModule {}
```

This matches the plan exactly: providers include UsersService and UsersRepository, exports is empty, imports includes ExportModule. No extra exports, no extra features.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { ExportModule } from '../export/export.module';

@Module({
  providers: [UsersService, UsersRepository],
  exports: [],
  imports: [ExportModule],
})
export class UsersModule {}
```
