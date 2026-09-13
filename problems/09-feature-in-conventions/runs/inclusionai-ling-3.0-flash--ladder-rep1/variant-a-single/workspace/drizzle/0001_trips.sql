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
  "trip_id"      uuid NOT NULL,
  "user_id"      uuid NOT NULL,
  "role"         text NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "trip_members_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips" ("id") ON DELETE CASCADE,
  CONSTRAINT "trip_members_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "trip_members_trip_user_unique" UNIQUE ("trip_id", "user_id")
);

CREATE TABLE "invites" (
  "id"           uuid PRIMARY KEY,
  "trip_id"      uuid NOT NULL,
  "email"        text NOT NULL,
  "token"        text NOT NULL,
  "status"       text NOT NULL DEFAULT 'pending',
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invites_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "trips" ("id") ON DELETE CASCADE,
  CONSTRAINT "invites_trip_email_unique" UNIQUE ("trip_id", "email")
);

CREATE UNIQUE INDEX "invites_trip_email_pending_unique" ON "invites" ("trip_id", "email") WHERE "status" = 'pending';
