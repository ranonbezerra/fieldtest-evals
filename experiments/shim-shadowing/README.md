# The fixture shim shadowed the real types

Evidence for FINDINGS §4.12, kept after the run it came from was discarded.

Fixtures ship `_shims.d.ts` so they can typecheck standalone. Its own header states
the intent:

    // Canonical fixture shims. Copied verbatim into each fixture so it typechecks on
    // its own, without node_modules. The run workspace installs the real packages.

The workspace does install them. Nothing removed the shim on the way in, and an
ambient `declare module 'vitest'` overrides a package's own types even when the
package is present.

The shim declares four functions — `describe`, `it`, `beforeEach`, `afterEach` — and
an `expect()` with `toBe`, `toBeCloseTo` and `not`. Anything past that surface is
reported as the model's mistake.

## What it cost

Problem 12 wrote ordinary vitest and drew **15 of its 23 compile errors** from the
shim:

    Module '"vitest"' has no exported member 'vi'
    Module '"vitest"' has no exported member 'beforeAll'
    Property 'toHaveLength' does not exist on type '{ toBe(expected: unknown): void … }'
    Property 'toBeDefined' does not exist on type '{ toBe(expected: unknown): void … }'

Of the remaining eight, six are packages the scaffold does not supply
(`@nestjs/testing`, `supertest`, `@nestjs/common`, `drizzle-orm`). **Twenty-one of
twenty-three errors were the environment.**

## Why only one run

Three problems carry a shim — 11, 12 and 14. Problem 11 escaped with zero shim errors
because its tests use only `describe`, `it` and `expect().toBe`, inside the declared
surface. It is a landmine that fires only when a model reaches past four functions and
three matchers, which is why nine runs passed over it without noticing.

## Fixed

`ft-go` now deletes every `_shims.d.ts` from the workspace right after seeding it from
the fixture, and logs that it did. The gate installs the real packages; the shim has
no job there.
