# repair1-payout.controller.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payout/payout.controller.ts`.

Looking at the error list, I see:
- `src/payout/payout.module.ts(3,34): error TS2307: Cannot find module './payout.controller' or its corresponding type declarations.`

This is the only error that directly names `src/payout/payout.controller.ts` — the module file can't find it. But wait, the task says "These are the compiler's exact messages for the whole workspace" and asks me to rewrite `src/payout/payout.controller.ts` fixing what these messages require of this file.

The error is that `payout.module.ts` imports from `'./payout.controller'` but can't find it. This means the file either doesn't exist or doesn't export what's expected.

Looking at the other errors, I can infer what the controller needs:
- The module imports `PayoutController` from `./payout.controller`
- The controller likely imports from `./payout.service` (which is imported by the service file errors)
- The test file imports `PayoutController` from `../src/payout/payout.controller`

From the module file errors, I can see the module imports:
- `PrismaModule` from `'../prisma/prisma.module'`
- `PayoutController` from `'./payout.controller'`
- `PayoutRepository` from `'./payout.repository'`
- `PayoutService` from `'./payout.service'`
- `PayoutWorker` from `'./payout.worker'`
- Something from `'./payout.provider'` (line 12, column 8)

The controller needs to:
1. Be a NestJS controller with `@Controller('payouts')` (kebab-case, plural endpoint)
2. Have a `POST /` endpoint that accepts `{ accountId, amount, destinationAddress, idempotencyKey }`
3. Call the service (zero business logic)
4. Validate input

From the test file, line 5 imports `PayoutController` from `../src/payout/payout.controller`.

Now, looking at the layer rules:
- Controller validates input and calls the service. Zero business logic.
- The endpoint is kebab-case, plural: `payouts`

The controller needs to:
- Import `PayoutService` from `./payout.service`
- Import validation decorators
- Have a POST endpoint at `/payouts`
- Accept a body with `accountId`, `amount`, `destinationAddress`, `idempotencyKey`
- Validate the input
- Call the service method
- Return the result

Let me think about what the service method might be called. Looking at the service errors:
- `src/payout/payout.service.ts(3,34): error TS2307: Cannot find module './payout.repository'`
- `src/payout/payout.service.ts(4,29): error TS2307: Cannot find module './payout.types'`
- `src/payout/payout.service.ts(5,53): error TS2307: Cannot find module './payout.types'`

So the service imports from `payout.repository` and `payout.types`. The types file likely has the DTO/input types.

For the controller, I need to know:
1. What method to call on the service
2. What input type to use

Since I can't see the service file or types file, I need to make reasonable assumptions. The standard pattern would be:
- Service has a `create` method (or `request`)
- Input type is something like `CreatePayoutInput` or `CreatePayoutDto`

Looking at the error on line 3 of payout.module.ts, column 34 — that's the import of PayoutController. The module likely does:
```typescript
import { PayoutController } from './payout.controller';
```

So I need to export a class called `PayoutController`.

For the input validation, the controller should use class-validator or manual validation. Given the conventions say "controller validates input", I'll use class-validator with a DTO.

Wait, but the types file is `payout.types` — maybe the input type is defined there. Let me think about what makes sense.

The controller needs to:
1. Export `PayoutController`
2. Have `@Controller('payouts')`
3. Have a POST endpoint
4. Validate input (accountId: string, amount: number/string, destinationAddress: string, idempotencyKey: string)
5. Call the service

Since I can't see the service's method signature, I'll assume it's `create` taking an input object. I'll use a DTO class for validation.

Actually, let me reconsider. The task says "fixing what these messages require of this file." The only message that names this file is:
- `src/payout/payout.module.ts(3,34): error TS2307: Cannot find module './payout.controller'`

This just means the file doesn't exist or doesn't export what's needed. The module expects to import `PayoutController` from it.

The test also imports it: `test/payout.spec.ts(5,34): error TS2307: Cannot find module '../src/payout/payout.controller'`

So the file needs to exist and export `PayoutController`.

Let me write a proper controller that:
- Validates input with class-validator
- Calls the service
- Has zero business logic

I'll assume the service method is `create` and takes the input. I'll define a DTO for the request body.

Actually, looking more carefully at the types file being imported by both repository and service, the input type is probably defined in `payout.types`. But the controller should have its own DTO for validation purposes (or it could import from types).

Let me go with a DTO defined inline in the controller (or I could import from types). Given the conventions, I think defining the DTO in the controller is cleanest since the controller's job is input validation.

Let me write this:

```typescript
import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { IsString, IsInt, Min } from 'class-validator';
import { PayoutService } from './payout.service';

class CreatePayoutDto {
  accountId: string;
  amount: number;
  destinationAddress: string;
  idempotencyKey: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreatePayoutDto) {
    return this.payoutService.create(body);
  }
}
```

Wait, but I need to think about what the service method is called. Let me look at the test file imports more carefully. The test imports `PayoutController` but I can't see the test body.

I'll go with `create` as the method name since that's the most conventional for a POST endpoint creating a resource.

Actually, let me reconsider the amount type. The requirement says "Amounts are in minor units. Do not use floating point for money." So amount should be an integer (or string representing an integer). I'll use `IsInt` and `Min(1)` or similar.

Let me also think about whether I need `ValidationPipe`. In NestJS, you can use `@UsePipes(ValidationPipe)` at the controller level, or the app can have a global validation pipe. Since I can't see `main.ts`, I'll add it at the controller level to be safe.

Actually, the convention says "controller validates input" — this could mean using ValidationPipe or manual validation. Let me use the standard NestJS approach with class-validator and ValidationPipe.

Let me finalize:

```typescript
import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsInt, IsString, Min, IsNotEmpty } from 'class-validator';
import { PayoutService } from './payout.service';

class CreatePayoutDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  destinationAddress!: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePayoutDto) {
    return this.payoutService.create(dto);
  }
}
```

Hmm, but I'm not 100% sure the service method is called `create`. Let me think about what's most conventional and what the test would likely call.

Given the problem statement says "Creates a payout", `create` is the most natural method name.

I'll add an `// ASSUMPTION:` note about the service method name since I can't see the service file.

Actually wait — the instructions say "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly." The error messages don't directly refer to the service method name, but the controller needs to call something on the service. I'll add one assumption line.

Let me finalize my answer.
```

## reply

```typescript
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { PayoutService } from './payout.service';

class CreatePayoutDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  destinationAddress!: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

// ASSUMPTION: The service method is named `create` and accepts an object with
// the same shape as the request body; this is inferred from the module wiring
// and the problem's "Creates a payout" requirement.

@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePayoutDto) {
    return this.payoutService.create(dto);
  }
}
```
