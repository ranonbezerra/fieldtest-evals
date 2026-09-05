# 05-database.module.ts

## reasoning

```
Let me analyze what's needed for `src/database/database.module.ts` based on the PLAN.md specification.

From the plan:
- `DatabaseModule` class that exports a `DRIZZLE` provider
- Creates `PostgresJsDatabase` from `DATABASE_URL` environment variable
- The injection token is `DRIZZLE` (a Symbol)
- It should be a NestJS module with providers and exports

From the stack:
- NestJS for the API
- ESM, `"type": "module"`
- TypeScript strict

From the plan section 3:
```ts
// database.provider.ts
export class DatabaseModule {}   // exports DrizzleDb token
export const DRIZZLE = Symbol('drizzle');  // injection token, type: PostgresJsDatabase
```

Wait, the plan mentions `database.provider.ts` in section 3 but the manifest says `src/database/database.module.ts`. Let me re-read...

The manifest says:
```
src/database/database.module.ts | reads: - | DatabaseModule + DRIZZLE provider (creates PostgresJsDatabase from DATABASE_URL)
```

So everything goes in `src/database/database.module.ts`.

The DRIZZLE token is a Symbol. In NestJS, injection tokens can be classes, strings, or symbols. A Symbol works as an injection token.

The provider should create a `PostgresJsDatabase` instance using the `postgres` driver (from the plan: "gains `drizzle-orm`, `postgres` (driver)").

Let me think about the structure:

```ts
import { Module } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const DRIZZLE = Symbol('drizzle');

@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: () => {
        const client = postgres(process.env.DATABASE_URL!);
        return drizzle(client, { schema: ??? });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
```

Wait, do I need to pass a schema to drizzle? The plan says the schema is at `drizzle/schema.ts`. But for a basic setup, you can use `drizzle(client)` without a schema parameter - the schema is only needed for type-safe query builders. Since repositories will import the schema directly for building queries, the drizzle instance itself doesn't strictly need the schema parameter.

Actually, looking at Drizzle docs, you can do:
```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const client = postgres(url);
const db = drizzle(client, { schema });
```

But the schema is optional. Without it, you lose type-safe query inference but can still use raw queries or import the schema in the repository layer.

Since the plan says repositories will use the schema (they import from `drizzle/schema.ts`), I don't think the drizzle instance needs to have the schema bound. Let me keep it simple and just create the client.

Actually, let me reconsider. The plan says:
- "Drizzle client is created in a shared `DatabaseModule`"
- The repositories will use the schema for their queries

I'll create the PostgresJsDatabase without binding the schema, since repositories will import the schema tables directly for building queries. This is a common Drizzle pattern.

Let me also consider: should I use `useFactory` with no dependencies, or should I inject something? The DATABASE_URL comes from environment variables only per the conventions. So `process.env.DATABASE_URL` is the right approach.

For strict TypeScript, I need to handle the possibility that DATABASE_URL might be undefined. But per the conventions: "Configuration comes from environment variables only. DATABASE_URL for Postgres." It's expected to be set. I'll use a non-null assertion or a check.

Let me write the file:

```ts
import { Module } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const DRIZZLE = Symbol('drizzle');

@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): PostgresJsDatabase => {
        const url = process.env.DATABASE_URL!;
        const client = postgres(url);
        return drizzle(client);
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
```

Hmm, but the plan section 3 says:
```ts
export const DRIZZLE = Symbol('drizzle');  // injection token, type: PostgresJsDatabase
```

The type annotation suggests the token should be typed. In NestJS, you can't really add a type to a Symbol directly in a useful way for DI. The typing happens at the injection site with `@Inject(DRIZZLE) db: PostgresJsDatabase`.

Let me keep it clean. The Symbol is the token, and consumers will type their injected property as `PostgresJsDatabase`.

One more thought: should I add a lifecycle hook to close the postgres connection on module teardown? The plan doesn't mention it explicitly, but it's good practice. However, the instructions say "Do not add an export, a feature or a file the plan does not name." So I'll keep it minimal - just what the plan specifies.

Actually, looking again at the plan: "DatabaseModule + DRIZZLE provider (creates PostgresJsDatabase from DATABASE_URL)" - that's it. No mention of lifecycle hooks, no mention of onModuleDestroy. I'll keep it minimal.

Let me finalize.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const DRIZZLE: unique symbol = Symbol('drizzle');

@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): PostgresJsDatabase => {
        const url = process.env.DATABASE_URL!;
        const client = postgres(url);
        return drizzle(client);
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
```
