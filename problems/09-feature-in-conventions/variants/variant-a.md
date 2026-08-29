# Variant A — Group trip creation with member invites

You are joining a group-travel planning product. The API scaffold exists with
one reference module (`users`) demonstrating all conventions. Implement the
**trips** feature.

## Repo conventions (contract — graded separately from correctness)

- NestJS modules: `src/modules/<name>/` with `<name>.controller.ts`,
  `<name>.service.ts`, `<name>.repository.ts`, `dto/`, `entities/`.
- Controllers call services; services call repositories; ONLY repositories
  import Drizzle. Controllers never receive ORM types.
- All endpoints return the shared envelope `{ ok, data | error }` via the
  existing `ApiResult<T>` helpers; errors use the existing `AppError` codes.
- Schema changes via Drizzle migrations in `drizzle/`; snake_case columns,
  `created_at`/`updated_at` on every table.
- Tests in `<name>.service.spec.ts` per module, repository faked at interface.

## Feature spec

1. `POST /trips` — create trip (name, destination, date range). Creator becomes
   `owner` member.
2. `POST /trips/:id/invites` — owner invites by email; invite has a token and
   `pending/accepted/declined` status; inviting the same email twice returns the
   existing pending invite.
3. `POST /invites/:token/accept` — accepting adds the user as `member`;
   accepting twice is a no-op returning the membership.
4. `GET /trips/:id` — trip with members and pending invites; only members can
   see it (use the existing auth guard + current-user decorator).

Deliver: module, migrations, tests, and nothing outside `src/modules/trips` +
`drizzle/` except the module registration line.
