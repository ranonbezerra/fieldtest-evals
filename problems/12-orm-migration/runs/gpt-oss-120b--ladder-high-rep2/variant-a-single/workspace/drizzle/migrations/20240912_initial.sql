-- Migration: create billing tables

CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  invoice_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  total_minor BIGINT NOT NULL,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_minor BIGINT NOT NULL
);

CREATE INDEX invoices_account_id_idx ON invoices(account_id);
CREATE INDEX invoice_line_items_invoice_id_idx ON invoice_line_items(invoice_id);
