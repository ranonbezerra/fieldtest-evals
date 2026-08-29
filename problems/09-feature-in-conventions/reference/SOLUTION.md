# Reference solution — annotated core

## The scaffold

Built, under `scaffold/`. Copy it into each run workspace before the run; `pnpm
install` there once, then keep `node_modules` out of the artifact.

Verified: `tsc --noEmit` clean against real dependencies, and the module's three
specs pass. That matters — a convention the scaffold states but does not compile is
a convention every run inherits as noise.

The conventions are **real**, not prose:

| Rule | Where it is embodied |
|---|---|
| Layering | `users.controller.ts` has no Drizzle import and no ORM type in any signature; `users.repository.ts` is the only file importing `drizzle/schema.js` |
| Envelope | `ApiResult.ok` / `ApiResult.err` in `src/common/api-result.ts`, with `ErrorFilter` registered globally so the error path keeps the shape too |
| Error codes | `AppError` with a closed `AppErrorCode` union and its status map |
| Row vs entity | `UsersService.toEntity` is the only mapping; `User` is deliberately not `UserRow` |
| Auth | `AuthGuard` attaches the caller, `@CurrentUser()` reads it and never touches the database |
| Global modules | `DbModule` is `@Global()`; nothing else is. A feature injects `DB` without importing it |
| Migrations | `drizzle/0000_init.sql` **plus its entry in `drizzle/meta/_journal.json`** — a migration missing from the journal is not applied, whatever the tool prints |
| Tests | `users.service.spec.ts`, repository faked at its interface, never a mocked Drizzle |
| Registration | `app.module.ts` — the one line a feature is expected to add outside its own directory |

**The reference module is the answer key for style.** Judge new code by diffing it
against these idioms.

Typical convention failures worth hunting: ORM types in controller signatures; the
service importing the schema "just for one query"; the envelope skipped on an error
path; a hand-written migration that never reaches `_journal.json`; a new module
marked `@Global()` to avoid thinking about imports.

## Crux 1: the layering that gets violated

```ts
// trips.controller.ts — thin: auth, DTO, service call, envelope. No Drizzle.
@Post()
async create(@CurrentUser() user: User, @Body() dto: CreateTripDto) {
  return ApiResult.ok(await this.trips.create(user.id, dto));
}

// trips.repository.ts — the ONLY file importing drizzle/schema.
```

Typical convention failures to hunt in judging: ORM types leaking into
controller signatures; service importing the schema "just for one query";
envelope skipped on error paths; migration edited instead of appended.

## Crux 2: the spec's hidden correctness points (variant A)

- Re-invite same email → return existing pending invite (unique
  `(trip_id, email) WHERE status = 'pending'` partial index, not app-level check).
- Accept twice → no-op returning membership (guarded insert, unique
  `(trip_id, user_id)`).
- `GET /trips/:id` for non-member → the conventions' `AppError.NOT_FOUND`, not
  403 (don't reveal existence).

## Crux 3: variant C — what good assumption-surfacing looks like

`ASSUMPTIONS.md` entries in the shape *decision → alternative rejected → why*:
tokenized share links (32+ random bytes, no enumeration), optional expiry
default 30d, owner-revocable, read-only scope = itinerary without member emails
or costs, shares survive edits (live view) — each one is defensible; the point
is that it's *written down*. A run that silently picks any of these is scored
down on graded-3 even if the code is fine.

## Common wrong answers

- Working feature, own architecture — the exact PR a team rejects; gate M1/M2.
- "Improving" the scaffold while in there (renames, reformat) — M4.
- Uniqueness enforced by SELECT-then-INSERT instead of constraints.
- Variant C: inventing an elaborate ACL system nobody asked for instead of the
  smallest safe thing + recorded assumptions.
