// The check that fails when the wiring is wrong.
//
// It builds the *real* application context, so it is sensitive to everything
// a typecheck and a faked-repository unit test are blind to:
//   - an import cycle that crashes module evaluation
//       -> the dynamic imports below reject with the same ReferenceError as pnpm start
//   - a provider missing from its module's `providers`
//       -> NestFactory.create rejects ("Nest can't resolve dependencies ...")
//   - a provider not exported across a module boundary
//       -> same
//
// It runs against `dist/` (tsc output) on purpose. tsc emits the
// `design:paramtypes` metadata that Nest's DI relies on; vitest's esbuild
// transform does not support `emitDecoratorMetadata`, so a vitest boot test
// would instantiate every provider with no constructor dependencies and pass
// even on broken wiring.

import assert from 'node:assert/strict';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

function fail(message, err) {
  console.error(`wiring check failed: ${message}`);
  if (err) console.error(err);
  process.exit(1);
}

let dist;
try {
  dist = await Promise.all([
    import('../dist/app.module.js'),
    import('../dist/exports/exports.controller.js'),
    import('../dist/users/export.service.js'),
    import('../dist/users/users.service.js'),
    import('../dist/notifications/notifications.service.js'),
    import('../dist/jobs/retry.processor.js'),
  ]);
} catch (err) {
  fail('the module graph did not evaluate', err);
}

const [
  { AppModule },
  { ExportsController },
  { ExportService },
  { UsersService },
  { NotificationsService },
  { RetryProcessor },
] = dist;

let app;
try {
  app = await NestFactory.create(AppModule);
} catch (err) {
  fail('the application context did not boot', err);
}

try {
  // Every cross-module dependency must resolve to a real instance.
  assert.ok(app.get(UsersService) instanceof UsersService, 'UsersService is not in the context');
  assert.ok(app.get(ExportService) instanceof ExportService, 'ExportService is not in the context');
  assert.ok(app.get(NotificationsService) instanceof NotificationsService, 'NotificationsService is not in the context');
  assert.ok(app.get(RetryProcessor) instanceof RetryProcessor, 'RetryProcessor is not in the context');
  assert.ok(app.get(ExportsController) instanceof ExportsController, 'ExportsController is not in the context');

  // Behaviour through the wired graph, not just resolution.
  const job = await app.get(ExportService).enqueue('wiring-check');
  assert.match(job.id, /^exp_wiring-check_\d+$/);
  assert.ok(Number.isInteger(job.rows));

  assert.equal(await app.get(RetryProcessor).sweep(), 0);
} catch (err) {
  await app.close().catch(() => {});
  fail('the booted context misbehaved', err);
}

await app.close();
console.log('wiring check passed: real application context booted and resolved');
