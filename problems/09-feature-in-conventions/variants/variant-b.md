# Variant B — Saved-items collections with tagging

You are joining a recipe-box product. The API scaffold exists with one
reference module (`accounts`) demonstrating all conventions. Implement the
**collections** feature.

## Repo conventions (contract — graded separately from correctness)

- NestJS modules: `src/modules/<name>/` with controller, service, repository,
  `dto/`, `entities/`; controllers → services → repositories; ONLY repositories
  import Drizzle.
- Shared response envelope `{ ok, data | error }` via `ApiResult<T>`; errors
  through existing `AppError` codes; pagination via the existing
  `PageQuery`/`PageResult` helpers.
- Drizzle migrations in `drizzle/`; snake_case; `created_at`/`updated_at`
  everywhere; soft delete via `deleted_at` (the scaffold's repositories filter
  it — yours must too).
- Tests in `<name>.service.spec.ts`, repository faked at interface.

## Feature spec

1. `POST /collections` — create (name unique per user, case-insensitive).
2. `POST /collections/:id/items` — save an item (url, title) with up to 5 tags;
   saving the same url to the same collection twice updates tags instead of
   duplicating.
3. `GET /collections/:id/items?tag=&page=` — paginated, filterable by tag,
   soft-deleted items excluded.
4. `DELETE /collections/:id` — soft delete; items become inaccessible but not
   erased.
5. Only the owner accesses their collections (existing guard + decorator).

Deliver: module, migrations, tests; nothing outside `src/modules/collections` +
`drizzle/` except the module registration line.
