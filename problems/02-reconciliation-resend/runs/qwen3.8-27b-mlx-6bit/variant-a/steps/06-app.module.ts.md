# 06-app.module.ts

## reasoning

```
We need answer with only fenced code block for src/app.module.ts. Need analyze task thoroughly.

User wants write exactly one file: src/app.module.ts. PLAN.md governs: Root module importing PaymentModule. References: payment.module.ts exists and is a NestJS module with exports PaymentRepository, PaymentService. app.module.ts per layout: src/app.module.ts. Need implement exactly plan for this file. Do not add export, feature or file plan does not name.

We need infer imports from plan/references. Convention: ESM, type module, NestJS. Need root module. Usually import Module from @nestjs/common, PaymentModule from './payment/payment.module'. @Module({ imports: [PaymentModule] }). export class AppModule. Need maybe controllers? No. Do not add controller. No extra files.

Need consider if NestJS root module needs main.ts? no only app.module. Could include global validation? No plan says root module importing PaymentModule. Do not add.

Need ensure no default export? NestJS convention named export class AppModule. Use import { Module } from '@nestjs/common'; import { PaymentModule } from './payment/payment.module';

Should we include comments? Code and comments English. Could include none. Need complete file first line to last. One fenced block. Nothing else.

Potential issue: ESM with .js extensions? TypeScript NestJS typical uses relative import without extension? In strict ESM Node maybe TS uses moduleResolution bundler? Conventions say ESM type module but examples in references use import from './payment.repository' without .js. So follow no extension.

Could there be need to import PrismaModule? No payment module imports it. Root only PaymentModule. If app.module doesn't import PrismaModule, DI across module? PaymentModule exports repository/service but PrismaModule not re-exported. But we don't need PrismaService outside. If tests boot AppModule, payment.module imports PrismaModule so provider available. No need root. If other modules need Prisma they'd import themselves.

Need maybe @Module({ imports: [PaymentModule], controllers: [] })? No.

Need consider the file is root module; in Nest main.ts does createNestApplication(AppModule). Good.

Need maybe import { APP_GUARD } etc no.

So final:
```ts
import { Module } from '@nestjs/common';
import { PaymentModule } from './payment/payment.module';

@Module({
  imports: [PaymentModule],
})
export class AppModule {}
```

No ASSUMPTION needed because all symbols present. Ensure no explanation. Final only fenced block.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { PaymentModule } from './payment/payment.module';

@Module({
  imports: [PaymentModule],
})
export class AppModule {}
```
