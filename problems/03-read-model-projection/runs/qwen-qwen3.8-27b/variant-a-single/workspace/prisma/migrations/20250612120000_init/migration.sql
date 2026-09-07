-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "worker_id" TEXT,
    "event_id" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations_read_model" (
    "id" TEXT NOT NULL,
    "payment_order_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "worker_id" TEXT,
    "worker_name" TEXT,
    "event_id" TEXT,
    "event_name" TEXT,
    "event_started_at" TIMESTAMP(3),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operations_read_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_order_totals" (
    "company_id" TEXT NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "approved_count" INTEGER NOT NULL DEFAULT 0,
    "approved_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_order_totals_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "payment_orders_company_id_idx" ON "payment_orders"("company_id");
CREATE INDEX "payment_orders_company_id_created_at_idx" ON "payment_orders"("company_id", "created_at" DESC);
CREATE INDEX "payment_orders_company_id_updated_at_idx" ON "payment_orders"("company_id", "updated_at" DESC);
CREATE INDEX "operations_read_model_payment_order_id_key" ON "operations_read_model"("payment_order_id");
CREATE INDEX "operations_read_model_company_id_status_created_at_idx" ON "operations_read_model"("company_id", "status", "created_at" DESC, "payment_order_id" DESC);
CREATE INDEX "operations_read_model_company_id_created_at_idx" ON "operations_read_model"("company_id", "created_at" DESC, "payment_order_id" DESC);
CREATE INDEX "operations_read_model_created_at_idx" ON "operations_read_model"("created_at");

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations_read_model" ADD CONSTRAINT "operations_read_model_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_order_totals" ADD CONSTRAINT "company_order_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
