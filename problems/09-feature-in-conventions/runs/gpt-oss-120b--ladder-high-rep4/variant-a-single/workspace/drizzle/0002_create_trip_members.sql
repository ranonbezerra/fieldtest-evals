CREATE TYPE "member_role" AS ENUM ('owner', 'member');

CREATE TABLE "trip_members" (
  "id" uuid PRIMARY KEY,
  "trip_id" uuid NOT NULL REFERENCES "trips" ("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "role" member_role NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("trip_id", "user_id")
);
