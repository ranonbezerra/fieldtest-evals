# 03-database.module.ts

## reasoning

```
The user wants me to write `src/db/database.module.ts` based on the plan specification.

From the plan:
- `@Global()` NestJS module providing + exporting a provider token `DB: DrizzleDb`
- `export const DB = Symbol('DB')` — injection token
- The module provides and exports a provider that creates the Drizzle database instance using `createDb()` from `src/db/client.ts`

Let me look at the plan's signature:
```ts
@Injectable()
export class DatabaseModule { … }   // @Global(); provides + exports a provider token DB: DrizzleDb
export const DB = Symbol('DB')     // injection token
```

Wait, the plan says `@Injectable()` on the class but also `@Global()`. In NestJS, modules use `@Module()` not `@Injectable()`. The plan's notation is a bit loose — it says `@Global()` NestJS module providing + exporting. So it should be a `@Module` decorator with `global: true`.

The module needs to:
1. Be `@Global()`
2. Provide a token `DB` that resolves to a `DrizzleDb` instance (via `createDb()`)
3. Export that same token

So the structure would be:

```ts
import { Global, Module } from '@nestjs/common';
import { createDb } from './client.js';
import type { DrizzleDb } from './client.js';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: () => createDb(),
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
```

This is clean, complete, and matches the plan. The `createDb` function reads `DATABASE_URL` internally (as shown in client.ts reference), so no additional configuration needed here.

Let me make sure I'm not adding anything the plan doesn't name. The plan says:
- `@Global()` NestJS module
- provides + exports a provider token `DB: DrizzleDb`
- `export const DB = Symbol('DB')` — injection token

That's it. The file is straightforward.
```

## reply

```ts
import { Global, Module } from '@nestjs/common';
import { createDb } from './client.js';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: () => createDb(),
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
```
