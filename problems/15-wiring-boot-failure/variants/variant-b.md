# Variant B — It starts, then dies on one route

A NestJS + Prisma service is in `fixtures/api-fast/`. It starts. The health check
passes. The unit suite is green and the deploy succeeded.

`POST /exports` returns 500 on every call **in the container**:

```
[Nest] ERROR [ExceptionsHandler] Cannot read properties of undefined (reading 'enqueue')
TypeError: Cannot read properties of undefined (reading 'enqueue')
    at ExportsController.create (src/exports/exports.controller.ts:11:25)
```

Locally, with `pnpm start`, the same request works. The difference is real and it
is not the database.

## The task

1. Find why a dependency is `undefined` at request time in an application that
   started cleanly, and why the same source behaves differently under two ways of
   running it.
2. There is **more than one defect**, and one is masking the other. Say which is
   which — that ordering is most of the answer.
3. Fix both. Wiring belongs in wiring; the run-time difference belongs in how the
   container runs the application.
4. Write `DIAGNOSIS.md`: the mechanism per defect, why the boot succeeded anyway,
   why the unit suite could not see either, and why fixing one alone makes the
   application **stop starting**.
5. Add a check that fails when this class is present, and say in one line what it
   does not cover.

## Constraints

Change wiring and how the application is run — not behaviour. No `any`, no
`@ts-ignore`, no `@Inject()` sprinkled to force a resolution that should already
work. If you change how it starts, say what you gave up.
