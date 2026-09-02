# 14-re-derivation.module.ts

## reasoning

```
Let me analyze what's needed for `src/re-derivation/re-derivation.module.ts` based on the PLAN.md.

From the plan:
- The file is `src/re-derivation/re-derivation.module.ts`
- Description: "Module wiring; imports OperationsModule for the repository"
- The manifest says it reads: `-` (nothing)

From the control flow and types sections, I can see:
- `ReDerivationService` is in `src/re-derivation/re-derivation.service.ts`
- `ReDerivationController` is in `src/re-derivation/re-derivation.controller.ts`
- The service needs `OperationsRepository` from the operations module

Looking at the conventions:
- TS file: `kebab-case.role.ts` → `re-derivation.module.ts` ✓
- Class: `PascalCase` → `ReDerivationModule`
- The module needs to:
  - Import `OperationsModule` (to get access to `OperationsRepository`)
  - Provide `ReDerivationService`
  - Declare `ReDerivationController`

From the plan's types section:
```ts
export class ReDerivationService {
  constructor(repo: OperationsRepository) {}
  reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }>;
}

export class ReDerivationController {
  constructor(service: ReDerivationService) {}
  @Post("operations/re-derive")
  reDerive(@Body() input: ReDeriveInput): Promise<{ rows_rewritten: number }>;
}
```

The `OperationsRepository` is provided by `OperationsModule`. The plan says "imports OperationsModule for the repository".

Looking at the wiring conventions:
- A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other.
- A controller is declared by a module.

So the operations module must export `OperationsRepository`. The re-derivation module imports `OperationsModule` to get it.

Now, does the plan mention a separate `re-derivation.repository.ts`? Looking at the manifest:
```
src/re-derivation/re-derivation.repository.ts | reads: src/operations/operations.types.ts | Reuses OperationsRepository (type-level only); no separate repo needed
```

Wait, it says "no separate repo needed" but the file is listed in the manifest. Hmm, but the task says "Write exactly one file: `src/re-derivation/re-derivation.module.ts`". So I just need to write the module file.

The module should:
1. Import `Module` from `@nestjs/common`
2. Import `OperationsModule` from `../operations/operations.module`
3. Import `ReDerivationService` from `./re-derivation.service`
4. Import `ReDerivationController` from `./re-derivation.controller`
5. Declare the controller, provide the service, import OperationsModule

Let me think about whether `OperationsRepository` needs to be listed in providers. No — it's imported from `OperationsModule`. The `ReDerivationService` depends on `OperationsRepository`, which is provided by `OperationsModule` and must be exported there.

The module structure:
```ts
import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { ReDerivationService } from './re-derivation.service';
import { ReDerivationController } from './re-derivation.controller';

@Module({
  imports: [OperationsModule],
  controllers: [ReDerivationController],
  providers: [ReDerivationService],
})
export class ReDerivationModule {}
```

This looks correct. The plan says:
- "Module wiring; imports OperationsModule for the repository"
- The controller is declared by the module
- The service is a provider
- OperationsModule is imported (to get the repository)

I don't see a need for `exports` since nothing else imports from this module based on the plan.

Let me also check: does the plan list `re-derivation.repository.ts` as a file to create? Yes it does in the manifest, but it says "no separate repo needed". Since I'm only writing the module file, I won't reference it. The service directly uses `OperationsRepository`.

This is straightforward. Let me write it.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { ReDerivationService } from './re-derivation.service';
import { ReDerivationController } from './re-derivation.controller';

@Module({
  imports: [OperationsModule],
  controllers: [ReDerivationController],
  providers: [ReDerivationService],
})
export class ReDerivationModule {}
```
