CREATE TYPE "invite_status" AS ENUM ('pending', 'accepted', 'declined');

CREATE TABLE "trips" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "destination" text NOT NULL,
  "start_date" timestamptz NOT NULL,
  "end_date" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "trip_members" (
  "trip_id" uuid NOT NULL REFERENCES "trips" ("id"),
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "role" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("trip_id", "user_id")
);

CREATE TABLE "invites" (
  "id" uuid PRIMARY KEY,
  "token" text NOT NULL UNIQUE,
  "email" text NOT NULL,
  "trip_id" uuid NOT NULL REFERENCES "trips" ("id"),
  "status" "invite_status" NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
