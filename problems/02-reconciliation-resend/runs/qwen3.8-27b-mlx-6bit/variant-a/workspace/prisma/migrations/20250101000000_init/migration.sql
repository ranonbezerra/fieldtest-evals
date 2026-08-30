CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "effective_date" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "send_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reconcile_runs" (
    "id" TEXT NOT NULL,
    "window_from" TIMESTAMP(3) NOT NULL,
    "window_to" TIMESTAMP(3) NOT NULL,
    "matched_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconcile_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "send_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "raw_response" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_txid_key" ON "orders"("txid");

CREATE INDEX "orders_state_effective_date_idx" ON "orders"("state", "effective_date");

ALTER TABLE "send_events" ADD CONSTRAINT "send_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
