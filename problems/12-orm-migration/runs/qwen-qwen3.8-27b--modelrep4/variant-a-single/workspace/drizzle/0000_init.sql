-- Canonical DDL for the billing schema. Mirrors the removed prisma/schema.prisma
-- column-for-column: types, nullability, defaults, unique, indexes and FK actions.

CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"invoice_count" integer NOT NULL DEFAULT 0,
	"created_at" timestamp(6) with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text NOT NULL DEFAULT 'draft',
	"total_minor" bigint NOT NULL,
	"issued_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL
);

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_key" UNIQUE ("number");

ALTER TABLE "invoices"
	ADD CONSTRAINT "invoices_account_id_fkey"
	FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
	ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_line_items"
	ADD CONSTRAINT "invoice_line_items_invoice_id_fkey"
	FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
	ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "invoices_account_id_idx" ON "invoices" ("account_id");

CREATE INDEX "invoice_line_items_invoice_id_idx" ON "invoice_line_items" ("invoice_id");
