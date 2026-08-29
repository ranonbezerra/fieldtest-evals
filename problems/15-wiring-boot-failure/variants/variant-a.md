# Variant A — The application will not start

A NestJS + Prisma service is in `fixtures/api/`. It typechecks cleanly and its
unit tests pass. It does not start:

```
$ pnpm start
ReferenceError: Cannot access 'QUEUES' before initialization
    at file:///.../dist/notifications/notifications.service.js:5:29
```

Note what is *not* in that output: Nest never logged anything. The process died
before the framework started.

Three features were merged in the same week: a notifications module, an export
service used by the users module, and a queue processor for retries. There is more
than one defect, and fixing each one reveals the next.

## The task

1. Make the application start. Every module that should own a provider owns it;
   every provider used across a module boundary is exported and imported.
2. There is at least one import cycle. Break it structurally — do not reach for
   `forwardRef` unless the cycle is genuine, and say why if you do.
3. Write `DIAGNOSIS.md`: for each defect, what was unresolvable, why neither
   `tsc` nor the unit suite could see it, and the minimal fix.
4. Add a check that **fails when the wiring is wrong**. A passing typecheck is
   not that check, and neither is a unit test with the repository faked.

## Constraints

Change wiring, not behaviour. No `any`, no `@ts-ignore`, no provider replaced by
a stub to get past an error. If a fix requires moving a symbol to its own file,
move it.
