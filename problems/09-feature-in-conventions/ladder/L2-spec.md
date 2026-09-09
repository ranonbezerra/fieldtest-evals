# Issue #58 — Trips: creation, invites, membership

**Repo:** `grouptravel-api` · **Labels:** `feature`
**Reported by:** product · **Diagnosed by:** platform

---

## Context

The API scaffold exists and `src/modules/users/` is the reference module: it
demonstrates every convention this repo has, and it is there to be copied from rather
than described. **Read it before writing anything.**

The conventions are a contract and are reviewed separately from whether the feature
works:

- modules live at `src/modules/<name>/` with `<name>.controller.ts`,
  `<name>.service.ts`, `<name>.repository.ts`, `dto/`, `entities/`
- controllers call services, services call repositories, and **only repositories
  import Drizzle**. A controller never receives an ORM type.
- every endpoint returns the shared envelope through the existing `ApiResult<T>`
  helpers; errors use the existing `AppError` codes. Do not introduce a second
  result type, and check what `ApiResult` actually exposes rather than assuming a
  `Result` API from elsewhere.
- schema changes ship as **Drizzle migrations in `drizzle/`**. Editing the schema
  without a migration is the failure mode here — the schema file is not the
  deployment.
- snake_case columns, `created_at` and `updated_at` on every table
- tests at `<name>.service.spec.ts`, repository faked at the interface

## The feature

**`POST /trips`** — name, destination, date range. The creator becomes a member with
role `owner`.

**`POST /trips/:id/invites`** — an owner invites by email. An invite carries a token
and a status of `pending`, `accepted` or `declined`. Inviting the same email twice
returns the **existing pending invite** rather than creating a second one or erroring.

**`POST /invites/:token/accept`** — adds the user as a member with role `member`.
Accepting twice is a **no-op that returns the membership**, not an error and not a
duplicate row. Make that structural: a unique constraint on (trip, user) is worth more
than a check-then-insert, which has a race.

**`GET /trips/:id`** — the trip with its members and pending invites. **Only members
may see it**, via the existing auth guard and current-user decorator. A non-member
gets the same response a nonexistent trip gets.

## Scope

`src/modules/trips/` and `drizzle/`, plus the one line that registers the module.
**Nothing else.** A diff that touches another module has gone wrong.

## Acceptance

- All four endpoints, returning the shared envelope
- Inviting the same email twice → the same pending invite
- Accepting the same token twice → one membership, returned both times
- A non-member requesting `GET /trips/:id` → not-found, not forbidden
- A migration exists in `drizzle/` for every schema change
- `trips.service.spec.ts` with the repository faked at its interface
- No Drizzle import outside the repository

## Notes

TypeScript, NestJS, Drizzle, PostgreSQL — as the scaffold has them. The `users` module
answers most questions this issue does not.
