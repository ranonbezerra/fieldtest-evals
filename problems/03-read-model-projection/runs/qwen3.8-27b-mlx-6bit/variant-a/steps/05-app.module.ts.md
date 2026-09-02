# 05-app.module.ts

## reasoning

```
The task is to write `src/app.module.ts` — the root NestJS module that imports OperationsModule, ReDerivationModule, and DriftRepairModule.

From the plan:
- `src/app.module.ts` — Root module importing OperationsModule, ReDerivationModule, DriftRepairModule
- Module files are at:
  - `src/operations/operations.module.ts` → class `OperationsModule`
  - `src/re-derivation/re-derivation.module.ts` → class `ReDerivationModule`
  - `src/drift-repair/drift-repair.module.ts` → class `DriftRepairModule`

The naming convention says: TS file: `kebab-case.role.ts`. Class: `PascalCase`.

So the module classes would be:
- `OperationsModule` in `src/operations/operations.module.ts`
- `ReDerivationModule` in `src/re-derivation/re-derivation.module.ts`
- `DriftRepairModule` in `src/drift-repair/drift-repair.module.ts`

The root module is straightforward: import those three modules. No controllers of its own, no providers of its own (unless we need a global PrismaModule or similar). 

Wait — the plan mentions `PrismaClient` is injected into repositories. In NestJS with Prisma, typically you'd have a `PrismaModule` that provides `PrismaService`. But the plan doesn't mention a separate PrismaModule. Let me re-read...

The plan says:
- `src/operations/operations.repository.ts` — constructor takes `PrismaClient`
- The module wiring files exist for each feature

The plan doesn't explicitly mention a `PrismaModule` or `PrismaService`. However, for the modules to work, they need access to a Prisma client. In a typical NestJS+Prisma setup, you'd have a global PrismaModule that provides a PrismaService.

But the plan says: "Implement exactly what the plan specifies for this file. Do not add an export, a feature or a file the plan does not name."

The plan only says: "Root module importing OperationsModule, ReDerivationModule, DriftRepairModule"

So I should just import those three modules. The Prisma provisioning would be handled within each feature module (they'd provide their own PrismaService or the repositories would get it from somewhere). Since the plan doesn't name a PrismaModule or PrismaService file, I shouldn't add one.

Actually, looking more carefully at the conventions: "A service, repository or processor is listed in its module's `providers`." and "A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other."

So each feature module would handle its own Prisma provisioning internally. The root module just imports the three feature modules.

Let me write the file:

```ts
import { Module } from "@nestjs/common";
import { OperationsModule } from "./operations/operations.module";
import { ReDerivationModule } from "./re-derivation/re-derivation.module";
import { DriftRepairModule } from "./drift-repair/drift-repair.module";

@Module({
  imports: [OperationsModule, ReDerivationModule, DriftRepairModule],
})
export class AppModule {}
```

That's it. Clean, minimal, exactly what the plan specifies. No extra providers, no extra imports.
```

## reply

```ts
import { Module } from "@nestjs/common";
import { OperationsModule } from "./operations/operations.module";
import { ReDerivationModule } from "./re-derivation/re-derivation.module";
import { DriftRepairModule } from "./drift-repair/drift-repair.module";

@Module({
  imports: [OperationsModule, ReDerivationModule, DriftRepairModule],
})
export class AppModule {}
```
