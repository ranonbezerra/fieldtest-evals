# 05-payment.module.ts

## reasoning

```
I need to write a NestJS module file that wires up the providers and exports for the payment system. The `PaymentService` takes a repository, bank client, and injected options, while `PaymentRepository` depends on Prisma's client which comes from the `@prisma/nestjs` package.

Looking at the references, I see the repository uses `@prisma/client` directly with a `PrismaClient` constructor, but that package doesn't automatically provide the client as a NestJS provider — it just exports the class. The actual injection setup would need to come from `@prisma/nestjs`, which isn't explicitly mentioned in the plan or references, so I'll need to handle that assumption when setting up the module. Now I'm realizing there's a tension here: if PrismaModule isn't listed in the imports, how does PaymentRepository get its PrismaClient dependency injected? The manifest only shows reads, so maybe the test file is setting up the PrismaClient mock directly rather than relying on module imports. I need to figure out whether to import PrismaModule or if the dependency injection is handled elsewhere in the test setup. I'll add a comment noting that the PrismaClient provider is expected to be imported from `@prisma/nestjs`'s PrismaModule, since that dependency isn't visible in the provided references. Now I need to set up the PAYMENT_OPTIONS configuration provider using environment variables for publishingLagMs, batchSize, and maxAttempts.

Writing module configuration... I'm second-guessing whether using `process.env` directly violates the plan's intent about avoiding hardcoded values. The environment variables are the right source, but I should double-check if there's a cleaner pattern here or if this approach is actually what's expected for this small utility file. The plan specifies `maxAttempts` should default to 5, and I need to handle the `PUBLISHING_LAG_MS` environment variable with a default of 30 minutes in milliseconds. The `executePayments()` method is a service method called externally, so no controller or task scheduling is needed. I'm ready to write out the full module file now.

Writing module file... Adding environment variable parsing... So the bank client interface is just a TypeScript type with no actual implementation anywhere in the codebase — it's only referenced by the test file which likely mocks it. The real puzzle is where `PrismaModule` and its providers come from, since there's no import path showing how `PrismaClient` gets injected. I think the most sensible approach is to assume this workspace uses `@prisma/nestjs` and import it from there. Finishing the module setup with imports for PrismaModule, then providers for the repository and service along with a factory that reads payment configuration from environment variables, exporting both so other modules can use them. I'm reconsidering whether to import PrismaModule — the plan specifies that app.module only imports PaymentModule, and the manifest shows no reads for this file, which suggests it shouldn't be pulling in external dependencies beyond what's explicitly listed. This creates a circular dependency issue if app.module imports both PaymentModule and PrismaModule separately, since NestJS needs proper provider registration. The safest approach is to keep the module self-contained and avoid adding PrismaModule to imports, letting the parent app handle Prisma setup through dependency injection.

But wait—the repository constructor explicitly injects PrismaClient, so Nest's DI container needs that provider available. Since the plan only specifies imports for app.module and not payment.module, the test file likely constructs the service directly with a mock client rather than using Test.createTestingModule. That's plausible, but for production wiring to actually work in app.module, the PrismaClient provider has to exist somewhere—and if app.module doesn't import PrismaModule either, the whole thing breaks at runtime.

Given the constraint to implement exactly what the plan specifies, I'm leaning toward importing PrismaModule in payment.module. The plan says app.module imports only PaymentModule, which suggests PaymentModule should be self-contained with all its dependencies. I'll add an assumption comment noting this, but the module needs to work stand-alone. Adding the PrismaModule import... I need to verify the module class name is `PaymentModule` and the file should be named `src/payment/payment.module.ts`. Now I'm thinking through the `PAYMENT_OPTIONS` provider setup — the service constructor expects it as an injected token, so I should define a factory that reads from environment variables with sensible defaults: 30 minutes for publishing lag, 100 for batch size, and 5 for max attempts. I'm deciding between `useValue` and `useFactory` — both work in NestJS, but I'll go with `useValue` for simplicity. Since the environment is loaded once at startup anyway, either approach reads the config at import time. I should also consider whether to use `@Inject(PAYMENT_OPTIONS)` for the constructor parameter — yes, that's already in the service reference. For parsing numbers from environment variables, `Number()` with a default is fine for a basic implementation, though I could add validation later if needed.

Now I'm thinking through the imports: `Module` from `@nestjs/common`, and I need to import both `PaymentService` and `PaymentRepository`. The manifest specifies exact read paths, so I'll follow those precisely. There's a question about `PrismaModule` — the plan doesn't explicitly list it, and I'm wondering if the repository's `PrismaClient` dependency is meant to be mocked in tests, or if there's a concrete implementation I'm missing. Since the service takes a `BankClient` interface (not concrete), tests must mock it, which means the `@prisma/nestjs` package's `PrismaModule` is likely the source for `PrismaClient` — I'll import it with a clarifying assumption. Actually, the safest approach is to import PrismaModule from the `@prisma/nestjs` package since it's the standard NestJS wrapper that provides the PrismaClient, and I'll document that assumption. Now I'm settling on the default values: a 30-minute publishing lag, batch size of 100, and a maximum of 5 retry attempts.

Writing the module definition... I'm settling on the standard `@prisma/nestjs` import for PrismaModule since that's the conventional package for this setup, even though it's not explicitly shown in the references. I'll add an assumption comment and stick with that convention rather than trying to work around it.

For the provider, I'm using `useValue` with an inline object literal to keep it concise — no need for a separate config interface. I'll add the necessary import statements and mark the assumption where it matters most, then write out the complete module file.
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '@prisma/nestjs'; // ASSUMPTION: PrismaClient provider is supplied by @prisma/nestjs's PrismaModule; the plan and references do not name the package
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';

export const PAYMENT_OPTIONS = 'PAYMENT_OPTIONS';

/**
 * NestJS module wiring for the payment feature.
 *
 * Registers the repository and service as providers, exports both so other
 * modules can consume them, and provides a `PAYMENT_OPTIONS` injection token
 * driven by environment variables (publishing lag, batch size, max attempts).
 */
@Module({
  imports: [PrismaModule],
  providers: [
    PaymentRepository,
    PaymentService,
    {
      provide: PAYMENT_OPTIONS,
      useValue: {
        publishingLagMs: Number(process.env.PUBLISHING_LAG_MS ?? 30 * 60 * 1000),
        batchSize: Number(process.env.BATCH_SIZE ?? 100),
        maxAttempts: Number(process.env.MAX_ATTEMPTS ?? 5),
      },
    },
  ],
  exports: [PaymentRepository, PaymentService],
})
export class PaymentModule {}
```
