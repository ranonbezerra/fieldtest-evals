# repair2-export.module.ts

## reasoning

```
Let me analyze the compiler errors:

1. `src/export/export.module.ts(2,31): error TS2307: Cannot find module './export.service.js' or its corresponding type declarations.`

This means line 2 of `src/export/export.module.ts` imports from `./export.service.js`, but that file doesn't exist (or isn't found).

According to the PLAN.md, `ExportService` should be in `src/export/export.service.ts`. The plan says:

```
**`src/export/export.module.ts` — `ExportModule`**
providers: [ExportService]                 // + ExportRepository if present
exports:   [ExportService]
imports:   []
```

And the manifest says:
```
src/export/export.module.ts | reads: src/export/export.service.ts | ExportModule providing and exporting ExportService
```

So the module imports `ExportService` from `./export.service.js`. The error says that module can't be found. This means the file `src/export/export.service.ts` doesn't exist yet, or there's a path issue.

But wait - the task says "Rewrite `src/export/export.module.ts` complete, fixing what these messages require of this file." and "Change nothing the messages do not name."

The message for `src/export/export.module.ts` is:
- Line 2, column 31: Cannot find module './export.service.js'

So the file `src/export/export.service.ts` doesn't exist. The task is to fix `src/export/export.module.ts` only. But the issue is that it's importing a file that doesn't exist.

Wait, let me re-read the constraints: "Change nothing the messages do not name." The messages name `src/export/export.module.ts` at line 2, column 31. The fix for this file is to make it not import a non-existent module... but the plan requires `ExportService` to be provided and exported.

Hmm, but the task says "Do not drop a requirement to silence an error." The plan requires `ExportService` in providers and exports. If the file doesn't exist, I can't just remove the import.

Wait - let me re-read more carefully. The task says "Rewrite `src/export/export.module.ts` complete, fixing what these messages require of this file." The message is that `./export.service.js` cannot be found. 

Looking at the other errors:
- `test/wiring.spec.ts(6,31): error TS2307: Cannot find module '../src/export/export.service.js'`

This confirms that `src/export/export.service.ts` doesn't exist.

But the task says "Change nothing the messages do not name." The only message that names `src/export/export.module.ts` is the one about `./export.service.js` not being found.

The plan says `ExportService` should be provided and exported by this module. The file `src/export/export.service.ts` needs to exist for the import to work. But I'm only asked to rewrite `src/export/export.module.ts`.

I think the correct interpretation is: the file `src/export/export.service.ts` will be created (or already exists) by another part of the work, and my job is just to make `src/export/export.module.ts` correct according to the plan. The compiler error will be resolved once `export.service.ts` exists.

Actually wait - re-reading the task: "Rewrite `src/export/export.module.ts` complete, fixing what these messages require of this file." 

The message says `./export.service.js` cannot be found. The fix "of this file" would be to ensure the import path is correct. But if the file genuinely doesn't exist, there's no fix I can make to this file alone.

However, looking at the conventions: "TS file: `kebab-case.role.ts`". So the file should be `export.service.ts`. The import `./export.service.js` is correct for ESM with TypeScript (the `.js` extension resolves to `.ts`).

I think the situation is that `export.service.ts` doesn't exist yet (it's a separate task to create it), and my job is just to write the module file correctly. The error will go away once `export.service.ts` is created.

But wait - "fixing what these messages require of this file" - maybe the issue is that the current file has a wrong import path? Let me think about what the current file might look like. If it's importing from `./export.service.js` and that's the correct path per conventions, then the file just doesn't exist yet.

I'll write the module file as the plan specifies, importing `ExportService` from `./export.service.js`. This is correct per the plan and conventions. The error will resolve once `export.service.ts` exists.

Let me write it:

```ts
import { Module } from '@nestjs/common';
import { ExportService } from './export.service.js';

@Module({
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
```

This matches the plan exactly:
- providers: [ExportService]
- exports: [ExportService]
- imports: [] (none needed)

The import path `./export.service.js` is correct per the ESM convention (TypeScript with `"type": "module"` uses `.js` extensions in import specifiers that resolve to `.ts` files).

The error will be resolved once `src/export/export.service.ts` is created. Since the task says "Change nothing the messages do not name" and only asks me to fix this file, I'll write it correctly per the plan. The assumption is that `export.service.ts` will exist (or be created separately).

Actually, I should add an `// ASSUMPTION:` line since the file `./export.service.js` (i.e., `./export.service.ts`) doesn't exist yet and I can't create it as part of this task. The plan requires the import, so I keep it but note the assumption.

Wait, let me reconsider. The task says "fixing what these messages require of this file." If the message is that the module can't be found, and the fix is to ensure the file exists... but I can only change this file. 

I think the most reasonable interpretation: write the file correctly per the plan, and add an ASSUMPTION note that `./export.service.ts` must exist for this to compile. The "fix" of this file is that its content is correct per the plan (it was perhaps previously malformed or had wrong imports).

Let me just write it cleanly per the plan with an assumption comment.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { ExportService } from './export.service.js';

// ASSUMPTION: ./export.service.ts must exist (providing ExportService) for this import to resolve; it is not created by this file.
@Module({
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
```
