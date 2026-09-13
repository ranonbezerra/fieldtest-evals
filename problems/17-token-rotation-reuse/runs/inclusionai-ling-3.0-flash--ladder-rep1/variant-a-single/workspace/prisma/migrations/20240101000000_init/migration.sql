CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" VARCHAR(255) NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "family_id" VARCHAR(255) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "is_retired" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

CREATE TABLE IF NOT EXISTS "auth_audit" (
    "id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(255) NOT NULL,
    "token_hash" VARCHAR(255),
    "family_id" VARCHAR(255),
    "user_id" VARCHAR(255),
    "ip" VARCHAR(255),
    "user_agent" VARCHAR(255),
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "auth_audit_pkey" PRIMARY KEY ("id")
);
