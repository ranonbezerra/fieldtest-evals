CREATE TABLE "trips" (
  "id"           uuid PRIMARY KEY,
  "name"         text NOT NULL,
  "destination"  text NOT NULL,
  "starts_at"    timestamptz NOT NULL,
  "ends_at"      timestamptz NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "trip_members" (
  "id"           uuid PRIMARY KEY,
  "trip_id"      uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "user_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role"         text NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "trip_members_trip_user_key" ON "trip_members" ("trip_id", "user_id");

CREATE TABLE "trip_invites" (
  "id"           uuid PRIMARY KEY,
  "trip_id"      uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "email"        text NOT NULL,
  "token"        text NOT NULL,
  "status"       text NOT NULL DEFAULT 'pending',
  "invited_by"   uuid NOT NULL REFERENCES "users"("id"),
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "trip_invites_token_key" ON "trip_invites" ("token");

CREATE UNIQUE INDEX "trip_invites_pending_key" ON "trip_invites" ("trip_id", "email") WHERE "status" = 'pending';
