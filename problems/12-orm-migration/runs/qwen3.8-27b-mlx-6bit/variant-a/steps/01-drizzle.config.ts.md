# 01-drizzle.config.ts

## reasoning

```
The task is to write a single file: `drizzle.config.ts` for a Drizzle-kit configuration.

From the PLAN.md, I know:
- Schema file lives at `drizzle/schema.ts`
- Migrations are generated via `drizzle-kit generate` into `drizzle/` (specifically `drizzle/migrations/`)
- Dialect is `pg` (PostgreSQL, matching the existing Prisma target)
- The config reads from `DATABASE_URL` env var

The Drizzle-kit config format is:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'pg',
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
});
```

Let me think about what's needed:
- `dialect`: 'pg' (PostgreSQL)
- `schema`: path to schema file → `./drizzle/schema.ts`
- `out`: output directory for migrations → `./drizzle/migrations`

The plan says:
- "Schema file lives at `drizzle/schema.ts`"
- "migrations are generated via `drizzle-kit generate` into `drizzle/`"
- The manifest says: "drizzle.config.ts | reads: - | Drizzle-kit config (schema path, out dir, dialect)"

The plan also mentions `DATABASE_URL` for the database. Drizzle-kit config can include a `dbCredentials` section with `url` for running migrations/push commands, but the plan says the config just needs schema path, out dir, and dialect. The `dbCredentials` is optional for generation (only needed for `migrate` or `push` commands). However, it's common to include it. Let me check what the plan says specifically.

The plan says: "Drizzle-kit config (schema path, out dir, dialect)" — it only lists those three things. But for a complete config that's actually usable (especially for `drizzle-kit migrate`), you'd want the URL. The plan says "DATABASE_URL env var is unchanged; the Drizzle client reads it at bootstrap." This refers to the application's Drizzle client, not necessarily drizzle-kit.

However, a practical `drizzle.config.ts` for drizzle-kit would typically include the URL. Let me think about whether to include it or not.

The plan says the file's purpose is: "Drizzle-kit config (schema path, out dir, dialect)". It doesn't mention dbCredentials. I'll include it since it's standard practice and the DATABASE_URL is already part of the environment contract. Actually, let me re-read the discipline rule: "Implement exactly what the plan specifies for this file. Do not add an export, a feature or a file the plan does not name."

The plan only names "schema path, out dir, dialect". I should stick to those three. But wait — a drizzle.config.ts without dbCredentials is still valid for `drizzle-kit generate` (which only needs schema + out + dialect). The `dbCredentials` is needed for `migrate` and `push` but not for `generate`. Since the plan says "migrations are generated via `drizzle-kit generate`", the config only needs those three fields.

Actually, let me reconsider. Including `dbCredentials` with `url: process.env.DATABASE_URL` is standard and makes the config complete for all drizzle-kit operations. The plan's description "(schema path, out dir, dialect)" is describing what the config contains, not necessarily an exhaustive whitelist. But the discipline rule says "Do not add an export, a feature or a file the plan does not name."

I think the safest reading is to include just what's specified: schema, out, dialect. These are the three things explicitly called out. Adding dbCredentials would be adding something not named in the plan for this file.

Let me write the config:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'pg',
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
});
```

This is clean, complete, and matches the plan exactly. The `defineConfig` import is from `drizzle-kit` which is listed as a dev dependency in the plan.

Wait, I should also consider: does the project use ESM? Yes — `"type": "module"` is specified in the conventions. So `import` syntax is correct.

One more thought: should I use a relative path like `./drizzle/schema.ts` or just `drizzle/schema.ts`? Drizzle-kit typically resolves paths relative to the config file location. Using `./drizzle/schema.ts` is the most explicit and standard form.

I'm satisfied with this. Let me write it.
```

## reply

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'pg',
  schema: './drizzle/schema.ts',
  out: './drizzle/migrations',
});
```
