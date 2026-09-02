-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "order_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "worker_name" TEXT NOT NULL,
    "worker_role" TEXT NOT NULL,
    "last_event_type" TEXT,
    "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "company_financial_totals" (
    "company_id" UUID NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),

    CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "operations_company_id_status_created_at_idx" ON "operations"("company_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "operations_company_id_created_at_idx" ON "operations"("company_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id");

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id");
