-- Migration generated from src/drizzle/schema.ts
-- Accounts
CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  invoice_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- Invoices
CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total_minor BIGINT NOT NULL,
  issued_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoices_number_key ON invoices (number);
CREATE INDEX invoices_account_id_idx ON invoices (account_id);

-- Invoice line items
CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_minor BIGINT NOT NULL
);
CREATE INDEX invoice_line_items_invoice_id_idx ON invoice_line_items (invoice_id);
