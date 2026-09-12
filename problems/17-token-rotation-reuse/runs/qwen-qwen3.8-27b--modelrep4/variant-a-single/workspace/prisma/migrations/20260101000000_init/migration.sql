CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "predecessor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "retired_at" TIMESTAMP(3),
    "reused_at" TIMESTAMP(3),
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

CREATE TABLE "refresh_audit" (
    "id" TEXT NOT NULL,
    "token_id" TEXT,
    "family_id" TEXT,
    "user_id" TEXT,
    "event" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refresh_audit_family_id_idx" ON "refresh_audit"("family_id");

CREATE INDEX "refresh_audit_reason_idx" ON "refresh_audit"("reason");
