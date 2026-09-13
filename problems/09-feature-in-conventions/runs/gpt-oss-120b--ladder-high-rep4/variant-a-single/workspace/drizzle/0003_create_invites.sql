CREATE TYPE "invite_status" AS ENUM ('pending', 'accepted', 'declined');

CREATE TABLE "invites" (
  "id" uuid PRIMARY KEY,
  "trip_id" uuid NOT NULL REFERENCES "trips" ("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "token" text NOT NULL UNIQUE,
  "status" invite_status NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
