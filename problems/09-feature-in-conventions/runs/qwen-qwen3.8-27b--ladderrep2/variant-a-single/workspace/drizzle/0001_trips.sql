CREATE TABLE "trips" (
  "id"           uuid PRIMARY KEY,
  "name"         text NOT NULL,
  "destination"  text NOT NULL,
  "starts_at"    timestamptz NOT NULL,
  "ends_at"      timestamptz NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trip_members" (
  "id"         uuid PRIMARY KEY,
  "trip_id"    uuid NOT NULL REFERENCES "trips"("id"),
  "user_id"    uuid NOT NULL REFERENCES "users"("id"),
  "role"       text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_members_trip_user_key" ON "trip_members" ("trip_id", "user_id");
--> statement-breakpoint
CREATE INDEX "trip_members_trip_id_idx" ON "trip_members" ("trip_id");
--> statement-breakpoint
CREATE TABLE "trip_invites" (
  "id"         uuid PRIMARY KEY,
  "trip_id"    uuid NOT NULL REFERENCES "trips"("id"),
  "email"      text NOT NULL,
  "token"      text NOT NULL,
  "status"     text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_invites_token_key" ON "trip_invites" ("token");
--> statement-breakpoint
CREATE INDEX "trip_invites_trip_id_idx" ON "trip_invites" ("trip_id");
