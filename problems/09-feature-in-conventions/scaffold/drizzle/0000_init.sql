CREATE TABLE "users" (
  "id"           uuid PRIMARY KEY,
  "email"        text NOT NULL,
  "display_name" text NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");
