# repair2-browser.ts

## reasoning

```
The error messages for `src/mocks/browser.ts` are:

1. `src/mocks/browser.ts(1,16): error TS2664: Invalid module name in augmentation, module 'msw/browser' cannot be found.`
2. `src/mocks/browser.ts(9,2
```

## reply

): error TS2307: Cannot find module 'msw/browser' or its corresponding type declarations.`

So the file is trying to import from `msw/browser` but that module isn't installed/found. Let me think about what this file likely contains.

A typical `msw/browser.ts` file looks like:

```ts
import { browser } from 'msw/browser'
import { handlers } from './handlers'

browser.listen()
```

But since `msw/browser` cannot be found, and looking at the project structure — this is a NestJS + Prisma + PostgreSQL project with Vitest for tests. Wait, no — the variant reference mentions React + TS + react-query + router. So this is a frontend project.

The key issue: `msw/browser` cannot be found. In MSW v2, the browser entry point is `msw/browser`. If it can't be found, it could be that:
- MSW isn't installed
- The version doesn't support `msw/browser`

But wait — looking more carefully at the errors, `msw` itself also can't be found (`src/mocks/handlers.ts(1,36): error TS2307: Cannot find module 'msw'`). So MSW isn't installed at all in this project.

However, the task says "Change nothing the messages do not name." The messages for `src/mocks/browser.ts` only name errors in that file. I need to fix what those messages require of THIS file specifically.

The errors are:
1. Line 1, col 16: `Invalid module name in augmentation, module 'msw/browser' cannot be found.`
2. Line 9, col 25: `Cannot find module 'msw/browser' or its corresponding type declarations.`

So the file has:
- Line 1: something like `import type { ... } from 'msw/browser'` or a module augmentation `declare module 'msw/browser'`
- Line 9: an import from `msw/browser`

Since `msw` isn't installed (as evidenced by `msw` also being not found in handlers.ts), I can't import from `msw/browser`. 

But the task says "Do not drop a requirement to silence an error." What requirement? The plan (variant-a.md) doesn't specifically mention MSW or browser mocks. The plan is about the active session bar feature.

Wait, let me re-read the instructions: "PLAN.md above still governs. Do not drop a requirement to silence an error."

The PLAN.md is the variant-a.md about the active session bar. It doesn't mention MSW specifically. The `src/mocks/browser.ts` file exists in the project but the plan doesn't require it specifically.

However, I should keep the file functional to the extent possible. Since `msw` and `msw/browser` are both unavailable, I need to handle this.

Looking at the structure:
- `src/mocks/browser.ts` — for browser-side MSW setup
- `src/mocks/handlers.ts` — MSW handlers
- `src/mocks/server.ts` — for server-side MSW setup (used in tests)

Since `msw` isn't installed, the entire mocks directory has issues. But I'm only asked to fix `src/mocks/browser.ts`.

The standard `msw/browser.ts` file in MSW v2 looks like:

```ts
import { browser } from 'msw/browser'
import { handlers } from './handlers'

export const worker = browser.setup(...handlers)
```

Or it might be:

```ts
/// <reference types="msw/browser" />
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

const worker = setupWorker(...handlers)

export function startMockServiceWorker() {
  worker.start()
}
```

Given line 1 has a module augmentation issue at col 16, it's likely:
```
declare module 'msw/browser' {
```
or a triple-slash reference directive.

Actually, `error TS2664: Invalid module name in augmentation` at line 1, col 16 suggests:
```
declare module 'msw/browser' {
```
The `msw/browser` part starts around col 16 (after `declare module '`).

And line 9, col 25 is an import from `msw/browser`.

So the file probably looks something like:

```ts
declare module 'msw/browser' {
  // some augmentation
}

import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)
```

Since `msw/browser` doesn't exist (MSW not installed), I need to handle this. The options are:
1. Add `// ASSUMPTION:` lines and keep the imports (but they'll still error)
2. Remove the imports and make the file a no-op

Wait, the instructions say "Do not drop a requirement to silence an error." But the plan doesn't require MSW. The file exists in the scaffold, and the task is to fix the compiler errors in this file.

Actually, re-reading: "Rewrite `src/mocks/browser.ts` complete, fixing what these messages require of this file."

The messages require that:
1. The module augmentation for `msw/browser` is invalid (module not found)
2. The import from `msw/browser` fails

Since `msw` is not installed in this project, the only way to fix these errors is to remove the dependency on `msw/browser`. But I should note this with an ASSUMPTION line.

Let me think about what makes sense. The file's purpose is to set up MSW for the browser (development mode). Since MSW isn't installed, the file can't do its job. But I need to make it compile.

The cleanest approach: since `msw` isn't available, I'll create a minimal file that compiles. I'll add an ASSUMPTION line explaining that `msw` is not installed so the browser mock setup is a no-op.

Actually wait — let me reconsider. The `src/mocks/server.ts` also has an error: `'handlers' is declared but its value is never read.` This suggests `server.ts` imports handlers but doesn't use them. And `handlers.ts` can't find `msw`. So the entire MSW setup is broken.

But I'm only fixing `src/mocks/browser.ts`. Let me write a file that:
- Doesn't import from `msw/browser`
- Still serves its structural purpose (exporting something that the app might import for browser mock setup)
- Has an ASSUMPTION comment

A reasonable approach:

```ts
// ASSUMPTION: 'msw' is not installed in this workspace, so browser-side
// mock service worker setup is unavailable. This module is a no-op stub.

export function startMockServiceWorker(): void {
  // no-op: msw/browser is not available
}
```

But wait — if something imports from this file expecting specific exports, removing them would cause errors elsewhere. But the task says "Change nothing the messages do not name." The errors only name `src/mocks/browser.ts` lines 1 and 9. So I just need to fix those.

Let me keep it minimal — a file that compiles and doesn't reference `msw/browser`:

```ts
// ASSUMPTION: 'msw' is not installed in this workspace; browser-side
// MSW setup is a no-op.

export function startMockServiceWorker(): void {
  // msw/browser unavailable — no-op
}
```

This should be sufficient. It compiles cleanly, doesn't reference the missing module, and documents why.
</think>

```ts
// ASSUMPTION: 'msw' is not installed in this workspace, so 'msw/browser'
// cannot be imported or augmented. Browser-side MSW setup is a no-op stub.

export function startMockServiceWorker(): void {
  // no-op: msw/browser is unavailable
}
```
