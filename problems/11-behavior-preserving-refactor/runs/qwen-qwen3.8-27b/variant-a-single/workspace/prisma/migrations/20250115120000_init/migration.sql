-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "provider_status" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider_status" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);
