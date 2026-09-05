# repair1-database.module.ts

## reasoning

```
The user is asking me to fix `src/database/database.module.ts` based on compiler error messages. Let me look at the errors carefully.

All the errors are in `test/invoice.spec.ts` — they're about missing assertion methods like `toMatchObject`, `toMatch`, `toHaveBeenCalled`, `toHaveLength`, `toHaveBeenCalledWith` on the `expect()` return type.

These errors are NOT in `src/database/database.module.ts`. They're in test files. The type of the `expect()` return value is a custom/narrowed type that doesn't include the full Vitest matcher set.

Wait, let me re-read the instruction: "Rewrite `src/database/database.module.ts` complete, fixing what these messages require of this file."

But the errors are all in `test/invoice.spec.ts`. None of the errors reference `src/database/database.module.ts` at all.

This is a tricky situation. The compiler messages don't name anything in `src/database/database.module.ts`. The errors are about the type of `expect()` in test files — they're using a custom or incomplete Vitest type that doesn't include matchers like `toMatchObject`, `toMatch`, `toHaveBeenCalled`, etc.

The instruction says "Change nothing the messages do not name." Since none of the messages name `src/database/database.module.ts`, I should not change it.

But the instruction also says "Rewrite `src/database/database.module.ts` complete, fixing what these messages require of this file." If the messages don't require anything of this file, then I should just output it as-is (or note that nothing needs changing).

Wait, but I don't have the current content of `src/database/database.module.ts`. Let me think about what it should contain based on the PLAN.md.

From the plan:
- `src/database/database.module.ts` — DatabaseModule + DRIZZLE provider (creates PostgresJsDatabase from DATABASE_URL)
- It exports a `DRIZZLE` injection token typed as `PostgresJsDatabase`

The errors are about test files using a custom `expect` type that's too narrow. This is likely because the test file is importing or using a custom expect type, or the vitest types aren't properly set up.

But wait — could `database.module.ts` be exporting something that affects the type of `expect()`? That seems extremely unlikely. The `expect` function comes from vitest.

Let me reconsider. The instruction says "fixing what these messages require of this file." If the messages don't require anything of this file, then I should state that. But the instruction says to "Reply with the complete content of `src/database/database.module.ts` inside one fenced block, and nothing else."

I think the correct answer here is that these errors don't require any changes to `src/database/database.module.ts`. The errors are in test files and relate to the Vitest assertion type definitions. 

But I need to provide the file content. Since I don't have the actual current content, I'll write it based on what the plan specifies. The plan says:

```ts
// database.provider.ts (but the file is database.module.ts)
export class DatabaseModule {}   // exports DrizzleDb token
export const DRIZZLE = Symbol('drizzle');  // injection token, type: PostgresJsDatabase
```

Wait, the plan mentions `database.provider.ts` in section 3 but the manifest says `src/database/database.module.ts`. Let me go with what the manifest and task say: `src/database/database.module.ts`.

Based on the plan:
- It's a NestJS module
- It provides the Drizzle database instance
- The injection token is `DRIZZLE` (a symbol)
- It creates a `PostgresJsDatabase` from `DATABASE_URL`
- It exports the provider so other modules can import it

Let me write this:

```ts
import { Module } from '@nestjs/common';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

export const DRIZZLE = Symbol('drizzle');

@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: () => {
        const client = postgres(process.env.DATABASE_URL!);
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
```

Now, about the compiler errors — they're all in `test/invoice.spec.ts` and relate to the type of `expect()`. These are NOT caused by or fixable in `src/database/database.module.ts`. 

The instruction says "Change nothing the messages do not name." Since none of the messages name `src/database/database.module.ts`, I should not modify it to try to fix those test file errors.

But the instruction also says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

I think the right approach is: output the file as it should be (per the plan), and add an `// ASSUMPTION:` line noting that the compiler errors are in test files and don't pertain to this file.

Actually wait, let me re-read: "fixing what these messages require of this file." If nothing is required of this file, then the file stays as-is. But I don't have the "as-is" version. I'll provide what the plan specifies and note that the errors don't pertain to this file.

Let me just provide the correct implementation of `src/database/database.module.ts` per the plan, with an assumption comment about the errors being unrelated to this file.
```

## reply

```ts
// ASSUMPTION: The compiler errors are all in test/invoice.spec.ts and concern the
// Vitest assertion type (expect() return value). None of them name or require a
// change in this file. The content below is the plan-specified implementation as-is.

import { Module } from '@nestjs/common';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

export const DRIZZLE = Symbol('drizzle');
export type DrizzleDb = PostgresJsDatabase<typeof schema>;

@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): DrizzleDb => {
        const client = postgres(process.env.DATABASE_URL!);
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
```
