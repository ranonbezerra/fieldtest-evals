# repair1-client.ts

## reasoning

```
The user is asking me to rewrite `src/db/client.ts` to fix compilation errors. However, looking at the error messages carefully, they are ALL from `test/void-invoice.spec.ts` — not from `src/db/client.ts`. The errors are about missing `expect`, `it`, `describe` etc. from the test runner (Vitest types not being found).

The user says "These are the compiler's exact messages for the whole workspace" and asks me to rewrite `src/db/client.ts` fixing "what these messages require of this file."

But the errors don't name `src/db/client.ts` at all. They're all from `test/void-invoice.spec.ts`. The issue is that the tsconfig doesn't include Vitest types.

The instruction says: "Change nothing the messages do not name." and "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

So the errors don't actually require any change to `src/db/client.ts`. The fix would be in the tsconfig (adding `"types": ["vitest/globals"]` or similar) or in the test files (importing from 'vitest' explicitly).

But the user is specifically asking me to rewrite `src/db/client.ts`. The errors don't name this file. I should produce the file as it should be according to the plan, and add an `// ASSUMPTION:` line noting that the compiler errors don't actually reference this file — they reference `test/void-invoice.spec.ts` and are about missing Vitest type definitions, which would be fixed in `tsconfig.json` (adding `"types": ["vitest/globals"]`) not in this file.

Let me write `src/db/client.ts` according to the plan:
- Reads `DATABASE_URL` from environment
- Creates a `pg.Pool`
- Returns a Drizzle instance via `drizzle(pool, { schema })`
- Exports the type `DrizzleDb` and function `createDb`

Let me write this properly:

```ts
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type DrizzleDb = NodePgDatabase<typeof schema>;

export function createDb(): DrizzleDb {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema });
}
```

This is straightforward and matches the plan. The compiler errors are about test files missing Vitest types, not about this file. I'll add an ASSUMPTION comment noting this.
```

## reply

```ts
// ASSUMPTION: The compiler errors provided do not reference src/db/client.ts.
// They are all from test/void-invoice.spec.ts and indicate that Vitest global
// types (describe, it, expect) are not resolved. The fix belongs in tsconfig.json
// (add "types": ["vitest/globals"] to compilerOptions) or in the test files
// (import { describe, it, expect } from 'vitest'). No change to this file is
// required by those messages. This file is provided as the plan specifies.

import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type DrizzleDb = NodePgDatabase<typeof schema>;

export function createDb(): DrizzleDb {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema });
}
```
