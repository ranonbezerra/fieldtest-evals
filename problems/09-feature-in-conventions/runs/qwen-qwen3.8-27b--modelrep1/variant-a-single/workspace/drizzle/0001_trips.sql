CREATE TABLE "trips" (
  "id"          uuid PRIMARY KEY,
  "name"        text NOT NULL,
  "destination" text NOT NULL,
  "start_date"  date NOT NULL,
  "end_date"    date NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trip_members" (
  "id"         uuid PRIMARY KEY,
  "trip_id"    uuid NOT NULL,
  "user_id"    uuid NOT NULL,
  "role"       text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trip_invites" (
  "id"         uuid PRIMARY KEY,
  "trip_id"    uuid NOT NULL,
  "email"      text NOT NULL,
  "token"      text NOT NULL,
  "status"     text NOT NULL DEFAULT 'pending',
  "invited_by" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_members_trip_id_user_id_key" ON "trip_members" ("trip_id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_invites_token_key" ON "trip_invites" ("token");
--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "trip_invites" ADD CONSTRAINT "trip_invites_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE "trip_invites" ADD CONSTRAINT "trip_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON UPDATE CASCADE;
