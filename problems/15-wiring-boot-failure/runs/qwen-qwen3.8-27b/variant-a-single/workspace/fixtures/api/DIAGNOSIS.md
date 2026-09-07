# DIAGNOSIS

The process died before Nest produced any log output, so the first failure was not a Nest dependency error. It was a JavaScript module-evaluation error. The remaining failures were Nest DI wiring failures that became visible only after the process could evaluate the module graph.

## 1. `QUEUES` circular import caused a temporal-dead-zone ReferenceError

### What was unresolvable

`dist/notifications/notifications.service.js` referenced `QUEUES` before the module that declared it had finished evaluating. The runtime threw `ReferenceError: Cannot access 'QUEUES' before initialization`; the process exited before `NestFactory.create` ran.

### Why `tsc` and the unit suite could not see it

TypeScript checks declared types, not ESM initialization order. `QUEUES` was exported with a valid type, so `tsc` passed. Unit tests imported narrower entry points or mocked the queue side, so they never evaluated the full built dependency graph in the same order as `dist/main.js`.

### Minimal fix

Move `QUEUES` to a dependency-free file, `src/queue/queue.constants.ts`. Both `NotificationsService` and `RetryProcessor` import the constant from that file. This breaks the import cycle structurally.

## 2. `ExportService` was not in `UsersModule`'s DI scope

### What was unresolvable

`UsersService` injects `ExportService`, but `UsersModule` did not import the module that exports `ExportService`. Nest could not resolve `UsersService`'s constructor dependency.

### Why `tsc` and the unit suite could not see it

`tsc` only needs the `ExportService` type to be visible; a direct file import satisfies that. Unit tests supplied a fake `ExportService` to `UsersService`, so they never exercised module `imports` and `exports`.

### Minimal fix

`ExportsModule` declares and exports `ExportService`. `UsersModule` imports `ExportsModule`. No service behaviour changed.

## 3. Retry processor was not wired through the notifications module boundary

### What was unresolvable

`RetryProcessor` is owned by `QueueModule` and injects `NotificationsService`. `NotificationsModule` did not export `NotificationsService`, and `QueueModule` did not provide `RetryProcessor` in the module graph used by the application. Once the earlier defects were fixed, Nest could not construct the retry processor, or the processor was absent from the boot graph.

### Why `tsc` and the unit suite could not see it

The processor class was type-correct, and unit tests for notifications faked the queue side or tested `NotificationsService` directly. Neither checked that `QueueModule` imports `NotificationsModule` and owns the processor.

### Minimal fix

`NotificationsModule` exports `NotificationsService`. `QueueModule` imports `NotificationsModule` and declares `RetryProcessor` in `providers`. The dependency is one-way: the processor uses the service; the service only references the queue-name constant.

## Why `forwardRef` was not used

No genuine bidirectional runtime dependency existed. The cycles were caused by placing a shared constant in a file that also imported the service, and by missing module exports. Moving the constant and exporting the service removes the cycles. `forwardRef` would mask a structural defect and would not by itself fix missing provider ownership.

## Added wiring check

`test/wiring.spec.ts` fails when the wiring is wrong. It:

- asserts module ownership, exports, and imports from Nest metadata;
- asserts there is no circular module import graph;
- compiles the real `AppModule` and each feature module boundary with `Test.createTestingModule`;
- resolves the real provider tokens (`PrismaService`, `UsersService`, `ExportService`, `NotificationsService`, `RetryProcessor`).

It does not fake repositories. It constructs the real `PrismaService` but makes no queries; the Vitest configuration supplies a non-sensitive placeholder `DATABASE_URL` only if the variable is absent, so no live database is required.
