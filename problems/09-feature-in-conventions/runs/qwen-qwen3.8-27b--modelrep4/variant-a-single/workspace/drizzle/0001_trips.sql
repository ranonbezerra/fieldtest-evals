CREATE TABLE "trips" (
  "id"           uuid PRIMARY KEY,
  "name"         text NOT NULL,
  "destination"  text NOT NULL,
  "start_date"   date NOT NULL,
  "end_date"     date NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "memberships" (
  "id"         uuid PRIMARY KEY,
  "trip_id"    uuid NOT NULL REFERENCES "trips"("id"),
  "user_id"    uuid NOT NULL REFERENCES "users"("id"),
  "role"       text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "memberships_trip_id_user_id_key" ON "memberships" ("trip_id", "user_id");

CREATE TABLE "invites" (
  "id"         uuid PRIMARY KEY,
  "trip_id"    uuid NOT NULL REFERENCES "trips"("id"),
  "email"      text NOT NULL,
  "token"      text NOT NULL,
  "status"     text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "invites_trip_id_email_key" ON "invites" ("trip_id", "email");

CREATE UNIQUE INDEX "invites_token_key" ON "invites" ("token");
