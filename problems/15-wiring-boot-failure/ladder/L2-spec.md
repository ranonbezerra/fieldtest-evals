# Issue #274 — The API will not start after last week's merges

**Repo:** `platform-api` · **Labels:** `bug` `blocker`
**Reported by:** whoever deployed last · **Diagnosed by:** platform

---

## What is happening

    $ pnpm start
    ReferenceError: Cannot access 'QUEUES' before initialization
        at file:///.../dist/notifications/notifications.service.js:5:29

**Nest never logged anything.** The process died before the framework began wiring
anything, which rules out dependency injection as the first cause and points at
module evaluation order.

It typechecks cleanly and the unit tests pass — which is the interesting part and the
reason this took a while to understand. `tsc` resolves the import graph as types; it
says nothing about the order in which modules execute at runtime. The unit tests fake
the repositories and never build the real module graph, so they never evaluate it.

Three features merged the same week: a notifications module, an export service used by
the users module, and a queue processor for retries. There is **more than one defect**,
and they are stacked — fixing the first reveals the second, and the second reveals the
third. Expect to go around three times.

## What we need

### 1. The application starts

Every provider that a module owns is in that module's `providers`. Every provider used
across a module boundary is in the owner's `exports` and the consumer's `imports`.

### 2. Break the cycle structurally

There is at least one import cycle. Break it by moving what is shared into a file that
imports nothing — a constants module is usually the answer — rather than by teaching
the framework to tolerate the cycle.

**Do not reach for `forwardRef` unless the cycle is genuine**, meaning two modules
really do need each other at runtime. If you use it, say why in the diagnosis.

### 3. `DIAGNOSIS.md`

For each defect: what was unresolvable, **why neither `tsc` nor the unit suite could
see it**, and the minimal fix.

That middle question is the one worth answering carefully. These defects survived a
green build and a green test run, and the next person needs to know what class of
problem their tools are blind to.

### 4. A check that fails when the wiring is wrong

Add one. A passing typecheck is not that check, and neither is a unit test with the
repository faked — both of those are green right now.

What would fail today and pass after the fix is something that **builds the real
application context**. Make it part of the suite so the next merge cannot reintroduce
this quietly.

### 5. Nothing silenced

No `any`, no `@ts-ignore`, no provider replaced by a stub to get past an error. If a
fix requires moving a symbol to its own file, move it — that is a real fix, and it is
probably the one §2 needs.

## Acceptance

- `pnpm start` reaches the point where Nest logs
- No `forwardRef` unless justified in writing
- `DIAGNOSIS.md` covers every defect, including why the tooling missed it
- A check exists that fails on the broken wiring and passes on the fixed wiring
- No `any`, no `@ts-ignore`, no stubbed provider

## Notes

TypeScript, NestJS, Prisma. The service is in `fixtures/api/`.
