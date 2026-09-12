CREATE TABLE "accounts" (
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"invoice_count" integer NOT NULL DEFAULT 0,
	"created_at" timestamp(6) with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text NOT NULL DEFAULT 'draft',
	"total_minor" bigint NOT NULL,
	"issued_at" timestamp(6) with time zone,
	"created_at" timestamp(6) with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices" ("number");
--> statement-breakpoint
CREATE INDEX "invoices_account_id_idx" ON "invoices" ("account_id");
--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_id_idx" ON "invoice_line_items" ("invoice_id");
