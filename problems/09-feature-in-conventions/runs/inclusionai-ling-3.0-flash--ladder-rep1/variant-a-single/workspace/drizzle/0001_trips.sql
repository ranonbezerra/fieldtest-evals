CREATE TABLE "trips" (
  "id"           uuid PRIMARY KEY,
  "name"         text NOT NULL,
  "destination"  text NOT NULL,
  "starts_at"    timestamptz NOT NULL,
  "ends_at"      timestamptz NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "members" (
  "id"        uuid PRIMARY KEY,
  "trip_id"   uuid NOT NULL REFERENCES "trips" ("id"),
  "user_id"   uuid NOT NULL REFERENCES "users" ("id"),
  "role"      text NOT NULL DEFAULT 'member',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "members_trip_id_user_id_unique" UNIQUE ("trip_id", "user_id")
);

CREATE TABLE "invites" (
  "id"          uuid PRIMARY KEY,
  "trip_id"     uuid NOT NULL REFERENCES "trips" ("id"),
  "email"       text NOT NULL,
  "token"       text NOT NULL UNIQUE,
  "status"      text NOT NULL DEFAULT 'pending',
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
