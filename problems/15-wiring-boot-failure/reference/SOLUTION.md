# Reference solution — answer key (KEEP OUT of the model's context)

## Fixtures

`fixtures/api/` — variants A and C. Compiles clean, unit suite green, **does not
boot**. Three defects, seeded to fail in the order a real merge week produces them.

**The chain, verified by running it.** Each fix reveals the next; a run that stops
at the first green has not finished.

| Stage | What you see | Defect |
|---|---|---|
| 0 | `ReferenceError: Cannot access 'QUEUES' before initialization` — **and no Nest log at all** | the import cycle |
| 1 | `Nest can't resolve dependencies of the NotificationsService (?, ConfigService) … argument DeliveryRepository at index [0]` | repository not in `providers` |
| 2 | `Nest can't resolve dependencies of the ExportsController (?) … argument ExportService at index [0]` | provider not exported |
| 3 | `listening on 3000` | done |

| # | Defect | Where | Why nothing catches it |
|---|---|---|---|
| 1 | Import cycle through a constant | `QUEUES` is declared in `jobs.module.ts`; `notifications.service.ts` reads it **at module scope**; `jobs.module.ts` imports `NotificationsModule` | `notifications.service → jobs.module → notifications.module → notifications.service`. It is an ES-module evaluation failure, so it happens **before Nest starts** — which is the tell, and which is why the stack points at a file unrelated to any of the three merged features |
| 2 | `DeliveryRepository` is never in `providers` | `notifications.module.ts` lists only `NotificationsService` | The import resolves at compile time; Nest fails at *construction*, and the message names `NotificationsService` — not the repository — so the error points at the wrong file |
| 3 | `ExportService` is registered but not exported | `users.module.ts` has it in `providers` and `exports` only `UsersService`. `ExportsModule` imports `UsersModule` and its controller injects `ExportService` | Both files typecheck. The consumer looks correct; the missing line is in a module the error does not mention. Registering `ExportService` a second time in `ExportsModule` "fixes" it and silently creates two instances |

---

## `fixtures/api-fast/` — variant B

The same service with the cycle already broken and `DeliveryRepository` registered,
so exactly **two** things are wrong, and the order between them is the answer:

| # | Defect | Effect |
|---|---|---|
| 1 | `Dockerfile` runs `pnpm start:container`, which is `tsx src/main.ts` — swapped in "to cut cold-start time" | esbuild-based loaders do not emit `design:paramtypes`. Nest sees no constructor types, **injects nothing, and reports a successful start.** Every injected dependency is `undefined` |
| 2 | `ExportService` is still not in `UsersModule.exports` | Masked entirely by (1): with no metadata there is no resolution to fail |

Verified end to end: under `tsx` the application logs `Nest application successfully
started`, and `POST /exports` answers **HTTP 500** with `Cannot read properties of
undefined (reading 'enqueue')`. Compile the same source with `tsc` and it does not
start at all — it fails with the `ExportService` resolution error, which is defect 2
finally becoming visible.

**That inversion is the graded insight.** Fixing the loader alone makes the
application *stop starting*, which reads like a regression and is actually the first
honest signal the service has produced. A run that reverts the loader change because
"it broke the app" has drawn exactly the wrong conclusion, and the transcript will
show it.

The expected fixes: run the compiled output in the container (or add the swc plugin
that does emit the metadata, with the trade-off stated), **and** export
`ExportService`. Either alone is incomplete.

**A note on the toolchain, which is itself a finding.** The fixture's `start` script
compiles with `tsc` deliberately. Run the same source under an esbuild-based loader
(`tsx`, or swc without the decorator plugin) and it **boots cleanly with every defect
present**: those loaders do not emit `design:paramtypes`, so Nest sees no constructor
types, injects `undefined` into everything, and fails later at the first method call.
Verified here. If a run reports that the application starts, check what it started it
with before believing it.

### The expected fixes

1. Move `QUEUES` and `QueueName` into `src/jobs/queues.ts`, a file that **imports
   nothing**, and update both importers. A constant half the application imports does
   not belong in a module definition. `forwardRef` is the wrong answer here twice
   over: it addresses Nest's module graph, and this cycle is in the *ES module* graph,
   which `forwardRef` cannot reach at all.
2. Add `DeliveryRepository` to `NotificationsModule.providers`.
3. Add `ExportService` to `UsersModule.exports`. **Not** a second registration in
   `ExportsModule` — that is the wrong fix that passes.

### The boot check M6 asks for

The deliverable must contain something that fails when the wiring is wrong. The
reference shape:

```ts
// test/boot.spec.ts
it('resolves the whole dependency graph', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();          // this is the line that fails, not `compile()`
  expect(moduleRef.get(ExportsController)).toBeDefined();
  await moduleRef.close();
});
```

Accept any equivalent that genuinely instantiates the application context.
**Reject:** a `tsc --noEmit` offered as proof; a unit test with the repository faked
(which is precisely the test that stayed green throughout); a check that only asserts
the modules import each other.

## What separates a strong run

**Reading the error correctly.** The message names the class Nest could not
*construct*, not the provider it could not *find*. A run that opens
`notifications.service.ts` and starts editing has misread it; a run that opens
`notifications.module.ts` has read it.

**Not accepting the first green.** Fixing defect 1 makes the boot fail differently,
on defect 2. A run that stops at the first successful `tsc` after one fix has learned
nothing about why it was broken.

**Structural cycle breaking.** `forwardRef` makes the symptom go away and leaves the
cycle. The transcript should show the model working out *what* the cycle is before
choosing how to break it.

## Common wrong answers

- Registering a cross-module provider twice instead of exporting it once — the
  application starts, and any state in that provider is now split between two
  instances. This is the spurious solution this problem exists to catch.
- `forwardRef` on defect 3 with no justification (M7).
- A `DIAGNOSIS.md` that reports the edits made rather than the mechanism (M5).
- Offering the green unit suite as proof of boot (M6) — that suite was green while
  the application could not start, which is the entire point of the problem.
- Refactoring the modules while in there (graded 4).
