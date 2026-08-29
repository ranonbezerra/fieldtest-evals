# Conventions for this codebase

These always hold. The task statement carries everything else.

## Stack
TypeScript (strict), Node 20+. NestJS for the API. Prisma as the ORM, PostgreSQL as
the database. Vitest for tests. pnpm as the package manager. ESM, `"type": "module"`.

## Layout
```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
test/<feature>.spec.ts
```

## Layers — no exceptions
`controller` validates input and calls the service. Zero business logic.
`service` holds the logic. Zero raw SQL, zero Prisma client calls.
`repository` is the only layer that touches the database.

## Naming
Table and column: `snake_case` (via Prisma `@map`/`@@map`). Endpoint: `kebab-case`,
plural. TS file: `kebab-case.role.ts`. Class: `PascalCase`. Code and comments in
English.

## Errors — one envelope
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```
`code` is `snake_case` and is the contract. `message` is developer-facing English.
`details` is an object, never null.

## Wiring
A service, repository or processor is listed in its module's `providers`. A provider
used by another module is `exports`ed by its own module and that module is `imports`ed
by the other. A controller is declared by a module.

## Migrations
Every schema change ships with a migration.

## Tests
Vitest. Test the behaviour, not the implementation. Never assert only that a call
happened. A test with no assertion, or one that only exercises the happy path, is
worse than no test: it reports coverage that does not exist.

## Environment
Configuration comes from environment variables only. `DATABASE_URL` for Postgres.
No secrets in the repository, no hardcoded connection strings.

## Discipline
Do exactly what the task asks. Do not create a file it does not call for, and do not
improve code you were not asked to change.
