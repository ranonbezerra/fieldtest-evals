-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('PENDING', 'SENT', 'SETTLED', 'FAILED', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "effective_date" DATE NOT NULL,
    "state" "OrderState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "txid" TEXT,
    "sent_at" TIMESTAMP(3),
    "absent_confirmed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
