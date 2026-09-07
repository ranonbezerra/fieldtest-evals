CREATE TABLE accounts (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    credit_limit_cents BIGINT NOT NULL DEFAULT 0,
    balance_cents BIGINT NOT NULL DEFAULT 0,
    total_invoiced_cents BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    account_id VARCHAR(36) NOT NULL REFERENCES accounts(id),
    status TEXT NOT NULL DEFAULT 'draft',
    subtotal_cents BIGINT NOT NULL DEFAULT 0,
    tax_cents BIGINT NOT NULL DEFAULT 0,
    total_cents BIGINT NOT NULL DEFAULT 0,
    due_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'sent', 'paid', 'void'))
);

CREATE TABLE line_items (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    invoice_id VARCHAR(36) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    unit_price_cents BIGINT NOT NULL,
    quantity INTEGER NOT NULL,
    line_total_cents BIGINT NOT NULL,
    CONSTRAINT line_items_quantity_check CHECK (quantity > 0)
);

CREATE INDEX invoices_account_id_idx ON invoices (account_id);
CREATE INDEX line_items_invoice_id_idx ON line_items (invoice_id);
