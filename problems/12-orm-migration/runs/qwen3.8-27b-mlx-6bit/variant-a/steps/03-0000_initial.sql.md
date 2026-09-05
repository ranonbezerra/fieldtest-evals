# 03-0000_initial.sql

## reasoning

```
The user wants me to write the initial SQL migration file for Drizzle. Let me analyze what's needed based on the PLAN.md and the drizzle/schema.ts reference.

From the plan:
- Three tables: accounts, invoices, line_items
- All snake_case column names
- UUID primary keys with gen_random_uuid() defaults
- BigInt columns (stored as string in Drizzle)
- Timestamptz columns with now() defaults
- FK constraints: invoices.account_id → accounts.id (ON DELETE RESTRICT), line_items.invoice_id → invoices.id (ON DELETE CASCADE)
- Indexes: invoices(account_id), invoices(status), line_items(invoice_id)

Looking at the Drizzle schema:
- accounts: id (uuid PK defaultRandom), name (text NOT NULL), balance_cents (bigint NOT NULL default 0), total_invoiced_cents (bigint NOT NULL default 0), created_at (timestamptz NOT NULL default now()), updated_at (timestamptz NOT NULL default now())
- invoices: id (uuid PK defaultRandom), account_id (uuid NOT NULL references accounts.id onDelete restrict), amount_cents (bigint NOT NULL), status (text NOT NULL default 'pending'), created_at (timestamptz NOT NULL default now()), updated_at (timestamptz NOT NULL default now())
  - indexes: invoices_account_id_idx on account_id, invoices_status_idx on status
- line_items: id (uuid PK defaultRandom), invoice_id (uuid NOT NULL references invoices.id onDelete cascade), description (text NOT NULL), amount_cents (bigint NOT NULL), created_at (timestamptz NOT NULL default now())
  - index: line_items_invoice_id_idx on invoice_id

For Drizzle migrations, the typical format uses `DO` blocks for idempotency and specific Drizzle migration style. Let me write it in the standard Drizzle migration SQL format.

Drizzle migrations typically look like:

```sql
CREATE TABLE "accounts" (...);
--SQL
CREATE INDEX "invoices_account_id_idx" ON "invoices" ("account_id");
```

The Drizzle migration format uses `--SQL` as a separator between DDL and statements that need to be idempotent. Actually, looking at typical drizzle-kit generated migrations:

The format is usually:
```sql
CREATE TABLE ...;
--> statement-breakpoint
CREATE TABLE ...;
--> statement-breakpoint
CREATE INDEX ...;
```

Wait, let me think about the exact drizzle-kit migration format. Drizzle migrations use `--> statement-breakpoint` as separators between SQL statements. Each section between breakpoints is a single statement.

Let me write it in the standard drizzle-kit format:

```sql
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"total_invoiced_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts" ("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices" ("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "invoices_account_id_idx" ON "invoices" ("account_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" ("status");--> statement-breakpoint
CREATE INDEX "line_items_invoice_id_idx" ON "line_items" ("invoice_id");
```

Actually, looking at real drizzle-kit generated migrations more carefully, the format is:

Each statement is separated by `--> statement-breakpoint`. The last statement doesn't have a trailing breakpoint. Indexes are often grouped or separated.

Let me be precise about the drizzle migration format. In practice, drizzle-kit generates:

```sql
CREATE TABLE "accounts" (
  ...
);
--> statement-breakpoint
CREATE TABLE "invoices" (
  ...
);
--> statement-breakpoint
CREATE TABLE "line_items" (
  ...
);
--> statement-breakpoint
CREATE INDEX "invoices_account_id_idx" ON "invoices" ("account_id");
--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" ("status");
--> statement-breakpoint
CREATE INDEX "line_items_invoice_id_idx" ON "line_items" ("invoice_id");
```

The FK constraint naming in drizzle typically follows the pattern: `{table}_{column}_{ref_table}_{ref_column}_fk`. So:
- `invoices_account_id_accounts_id_fk`
- `line_items_invoice_id_invoices_id_fk`

Let me write the complete file now.
```

## reply

```sql
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"total_invoiced_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts" ("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices" ("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "invoices_account_id_idx" ON "invoices" ("account_id");
--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" ("status");
--> statement-breakpoint
CREATE INDEX "line_items_invoice_id_idx" ON "line_items" ("invoice_id");
```
