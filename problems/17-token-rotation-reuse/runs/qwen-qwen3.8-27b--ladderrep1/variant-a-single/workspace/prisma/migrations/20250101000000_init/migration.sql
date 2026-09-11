-- CreateEnum
CREATE TYPE "RefreshTokenStatus" AS ENUM ('ACTIVE', 'RETIRED', 'REVOKED');

CREATE TYPE "RefreshAuditReason" AS ENUM ('REJECTED_MALFORMED', 'REJECTED_UNKNOWN', 'REJECTED_EXPIRED', 'REJECTED_REUSED');

CREATE TYPE "RefreshTokenSource" AS ENUM ('BODY', 'COOKIE');

-- CreateTable
CREATE TABLE "token_families" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "token_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "status" "RefreshTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "retired_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_audit_events" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" "RefreshAuditReason" NOT NULL,
    "token_id" TEXT,
    "family_id" TEXT,
    "user_id" TEXT,
    "via" "RefreshTokenSource",
    "tokens_revoked" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "refresh_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

CREATE INDEX "refresh_tokens_family_id_status_idx" ON "refresh_tokens"("family_id", "status");

CREATE INDEX "refresh_audit_events_family_id_created_at_idx" ON "refresh_audit_events"("family_id", "created_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "token_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
