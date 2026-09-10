-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_reads" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "worker_name" TEXT NOT NULL,
    "status" "order_status" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_event_type" TEXT,
    "last_event_at" TIMESTAMP(3),

    CONSTRAINT "operation_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_totals" (
    "company_id" UUID NOT NULL,
    "status" "order_status" NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "total_cents" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_totals_pkey" PRIMARY KEY ("company_id", "status")
);

-- CreateIndex
CREATE INDEX "ix_payment_orders_created_id" ON "payment_orders"("created_at", "id");
CREATE INDEX "ix_events_order_occurred" ON "events"("order_id", "occurred_at");
CREATE INDEX "ix_operation_reads_company_status_created" ON "operation_reads"("company_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "ix_operation_reads_worker" ON "operation_reads"("worker_id");

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
