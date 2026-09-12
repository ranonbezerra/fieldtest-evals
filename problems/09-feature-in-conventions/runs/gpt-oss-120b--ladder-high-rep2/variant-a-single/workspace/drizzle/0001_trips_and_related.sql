CREATE TYPE "member_role" AS ENUM ('owner', 'member');

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

CREATE TABLE "members" (
  "trip_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" member_role NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("trip_id", "user_id"),
  FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "invites" (
  "id" uuid PRIMARY KEY,
  "trip_id" uuid NOT NULL,
  "email" text NOT NULL,
  "token" text NOT NULL UNIQUE,
  "status" invite_status NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE
);
