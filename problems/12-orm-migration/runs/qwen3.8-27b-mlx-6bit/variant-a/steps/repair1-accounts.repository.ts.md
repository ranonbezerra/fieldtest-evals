# repair1-accounts.repository.ts

## reasoning

```
The user says `src/accounts/accounts.repository.ts` does not compile, but looking at the compiler messages provided, they ALL refer to `test/void-invoice.spec.ts` — not to `src/accounts/accounts.repository.ts` at all. The errors are about missing `expect`, `it`, and test runner types in the test file.

None of the compiler messages name `src/accounts/accounts.repository.ts`. The instruction says "Change nothing the messages do not name." So I need to provide the file as it should be (complete and correct per the plan), but the errors shown don't actually require any changes to this file.

Wait, let me re-read: "Rewrite `src/accounts/accounts.repository.ts` complete, fixing what these messages require of this file."

The messages don't name this file at all. They only name `test/void-invoice.spec.ts`. So the instruction is asking me to provide the complete file, fixing what the messages require of THIS file. Since the messages don't name this file, I should just provide the complete correct implementation per the plan without any changes motivated by those errors.

Let me write the complete `src/accounts/accounts.repository.ts` based on the plan:

- It's a `@Injectable()` class
- Constructor injects `DrizzleDb` via `@Inject(DB)`
- Methods: `findById(id: string): Promise<AccountRow | null>`, `findAll(): Promise<AccountRow[]>`, `create(input: AccountInsert): Promise<AccountRow>`
- Uses Drizzle with the schema from `src/db/schema.ts`
- No domain-specific errors; FK/UNIQUE violations propagate as DrizzleError

Let me think about what the schema looks like based on the plan:
- `accounts` table with columns: id (varchar 36, PK), name (text), email (text, unique), credit_limit_cents (bigint), balance_cents (bigint), total_invoiced_cents (bigint), created_at (timestamptz)

The imports would be:
- `Injectable` from `@nestjs/common`
- `Inject` from `@nestjs/common`
- `eq` from `drizzle-orm`
- The schema exports: `accounts`, `AccountRow`, `AccountInsert`
- The DB token and DrizzleDb type

Let me write this:

```ts
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { accounts } from '../db/schema.js';
import type { AccountRow, AccountInsert } from '../db/schema.js';

@Injectable()
export class AccountsRepository {
  constructor(@Inject(DB) private db: DrizzleDb) {}

  async findById(id: string): Promise<AccountRow | null> {
    const rows = await this.db.select().from(accounts).where(eq(accounts.id, id));
    return rows[0] ?? null;
  }

  async findAll(): Promise<AccountRow[]> {
    return this.db.select().from(accounts);
  }

  async create(input: AccountInsert): Promise<AccountRow> {
    const rows = await this.db.insert(accounts).values(input).returning();
    return rows[0];
  }
}
```

This is clean, follows the plan exactly, and the compiler errors shown don't pertain to this file at all. I'll provide this as the complete file.
```

## reply

```ts
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../db/client.js';
import { DB } from '../db/database.module.js';
import { accounts } from '../db/schema.js';
import type { AccountRow, AccountInsert } from '../db/schema.js';

@Injectable()
export class AccountsRepository {
  constructor(@Inject(DB) private db: DrizzleDb) {}

  async findById(id: string): Promise<AccountRow | null> {
    const rows = await this.db.select().from(accounts).where(eq(accounts.id, id));
    return rows[0] ?? null;
  }

  async findAll(): Promise<AccountRow[]> {
    return this.db.select().from(accounts);
  }

  async create(input: AccountInsert): Promise<AccountRow> {
    const rows = await this.db.insert(accounts).values(input).returning();
    return rows[0];
  }
}
```
