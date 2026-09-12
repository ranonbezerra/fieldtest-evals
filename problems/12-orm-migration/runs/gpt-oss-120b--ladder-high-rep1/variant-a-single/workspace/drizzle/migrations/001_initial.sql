CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  name varchar NOT NULL,
  currency char(3) NOT NULL,
  invoice_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  number varchar NOT NULL UNIQUE,
  status varchar NOT NULL DEFAULT 'draft',
  total_minor bigint NOT NULL,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invoice_account_id_idx ON invoices(account_id);

CREATE TABLE invoice_line_items (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position integer NOT NULL,
  description varchar NOT NULL,
  quantity integer NOT NULL,
  unit_price_minor bigint NOT NULL
);

CREATE INDEX invoice_line_item_invoice_id_idx ON invoice_line_items(invoice_id);
