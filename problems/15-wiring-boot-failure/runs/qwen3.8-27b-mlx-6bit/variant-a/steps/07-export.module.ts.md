# 07-export.module.ts

## reasoning

```
Let me analyze the plan to determine what `src/export/export.module.ts` should contain.

From the plan:

**`src/export/export.module.ts` — `ExportModule`**
```
providers: [ExportService]                 // + ExportRepository if present
exports:   [ExportService]
imports:   []
```

The manifest says:
```
src/export/export.module.ts | reads: src/export/export.service.ts | ExportModule providing and exporting ExportService
```

So the module:
- Provides `ExportService`
- Exports `ExportService`
- Has no imports (empty)
- Imports `ExportService` from `src/export/export.service.ts`

The convention says:
- TS file: `kebab-case.role.ts` — so the file is `src/export/export.module.ts`
- Class: `PascalCase` — so the class is `ExportModule`
- A provider used by another module is `exports`ed by its own module

The import path for ExportService: the manifest says it reads `src/export/export.service.ts`. Since we're in `src/export/export.module.ts`, the relative import would be `./export.service`.

Wait, looking at the layout convention:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

So for the "export" feature, the service would be at `src/export/export.service.ts`. The relative import from `src/export/export.module.ts` would be `./export.service`.

Now, the plan says "providers: [ExportService] // + ExportRepository if present". The manifest only mentions `ExportService` as the read for this module. There's no mention of an ExportRepository in the manifest for this file. I'll just include ExportService.

Let me write the complete file:

```typescript
import { Module } from '@nestjs/common';
import { ExportService } from './export.service';

@Module({
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
```

That's it. No imports (empty array or omitted). The plan says `imports: []` explicitly, so I could include it. But in NestJS, if you don't list `imports`, it defaults to empty. However, the plan explicitly lists `imports: []`. Let me include it for clarity and to match the plan exactly.

Actually, looking more carefully at NestJS conventions - it's common to omit empty arrays. But the plan explicitly states `imports: []`. I'll include it to be explicit and match the plan.

Let me finalize.
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { ExportService } from './export.service';

@Module({
  providers: [ExportService],
  exports: [ExportService],
  imports: [],
})
export class ExportModule {}
```
