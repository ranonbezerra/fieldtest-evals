-- 0001_trips.sql
-- Drizzle migration for the trips feature: trips, trip_members, trip_invites.
-- The `users` table is created by an earlier migration.

create table "trips" (
  "id" uuid primary key default gen_random_uuid(),
  "name" text not null,
  "destination" text not null,
  "start_date" date not null,
  "end_date" date not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now()
);

create table "trip_members" (
  "id" uuid primary key default gen_random_uuid(),
  "trip_id" uuid not null,
  "user_id" uuid not null,
  "role" text not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "trip_members_trip_user_uq" unique ("trip_id", "user_id"),
  constraint "trip_members_role_check" check ("role" in ('owner', 'member'))
);

create table "trip_invites" (
  "id" uuid primary key default gen_random_uuid(),
  "trip_id" uuid not null,
  "email" text not null,
  "token" text not null,
  "status" text not null default 'pending',
  "invited_by" uuid not null,
  "created_at" timestamp with time zone not null default now(),
  "updated_at" timestamp with time zone not null default now(),
  constraint "trip_invites_token_key" unique ("token"),
  constraint "trip_invites_status_check" check ("status" in ('pending', 'accepted', 'declined'))
);

alter table "trip_members"
  add constraint "trip_members_trip_id_fkey"
  foreign key ("trip_id") references "trips" ("id")
  on delete cascade on update cascade;

alter table "trip_members"
  add constraint "trip_members_user_id_fkey"
  foreign key ("user_id") references "users" ("id")
  on delete cascade on update cascade;

alter table "trip_invites"
  add constraint "trip_invites_trip_id_fkey"
  foreign key ("trip_id") references "trips" ("id")
  on delete cascade on update cascade;

alter table "trip_invites"
  add constraint "trip_invites_invited_by_fkey"
  foreign key ("invited_by") references "users" ("id")
  on delete cascade on update cascade;

create index "trip_members_trip_id_idx" on "trip_members" ("trip_id");
create index "trip_invites_trip_id_idx" on "trip_invites" ("trip_id");
create index "trip_invites_trip_email_idx" on "trip_invites" ("trip_id", "email");
