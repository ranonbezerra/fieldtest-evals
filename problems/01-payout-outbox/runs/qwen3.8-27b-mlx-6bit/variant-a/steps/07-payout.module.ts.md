# 07-payout.module.ts

## reasoning

```
Let me analyze what's needed for `src/payout/payout.module.ts` based on the plan.

From PLAN.md section 3:
- `src/payout/payout.module.ts`
- Providers: `PayoutRepository`, `PayoutService`.
- Exports: `PayoutService`, `PayoutRepository` (outbox module needs the repo).
- Declares: `PayoutController`.
- Imports: none (PrismaModule is global or imported in AppModule).

From the references, I can see:
- `PayoutController` is in `./payout.controller.js`
- `PayoutService` is in `./payout.service.js`
- `PayoutRepository` is in `./payout.repository.js`

The file naming convention says: TS file: `kebab-case.role.ts`. The file is `payout.module.ts`.

Now, the plan says "Imports: none (PrismaModule is global or imported in AppModule)." So I don't need to import any other modules.

The module needs:
- `@Module` decorator
- `controllers: [PayoutController]`
- `providers: [PayoutRepository, PayoutService]`
- `exports: [PayoutService, PayoutRepository]`

Let me write the imports using `.js` extension since the project is ESM (`"type": "module"`), consistent with the reference files that use `./payout.types.js` etc.

Let me write the complete file:

```ts
import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';

@Module({
  controllers: [PayoutController],
  providers: [PayoutRepository, PayoutService],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
```

This matches the plan exactly. No additional imports needed since PrismaModule is handled at the app level. No extra features added.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';

@Module({
  controllers: [PayoutController],
  providers: [PayoutRepository, PayoutService],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
```
