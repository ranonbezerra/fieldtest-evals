# 08-account.controller.ts

## reasoning

```
Let me analyze what I need to write for `src/account/account.controller.ts`.

From the PLAN.md:
- It's the HTTP layer for the account feature
- It handles input validation and error envelope
- It reads from: `src/account/account.service.ts`

From the reference `account.service.ts`:
- `AccountService` has methods:
  - `findById(id: string): Promise<AccountResponse>`
  - `create(data: { name: string }): Promise<AccountResponse>`
- `AccountResponse` interface: `{ id, name, balance_cents, total_invoiced_cents, created_at, updated_at }`

From the conventions:
- Controller validates input and calls the service. Zero business logic.
- Endpoint: kebab-case, plural
- Error envelope: `{ "error": { "code": "snake_case", "message": "...", "details": {} } }`
- `code` is `snake_case` and is the contract
- HTTP status: 404 for not-found, 400/422 for validation

From the PLAN.md errors:
- `resource_not_found` — account or invoice id does not exist (404)
- `validation_error` — request body missing required fields, bad type, or line_items empty (400/422)

The account endpoints would be:
- `GET /accounts/:id` — get account by id
- `POST /accounts` — create account (body: `{ name: string }`)

Looking at the service, it uses `NotFoundException` from NestJS. The controller needs to catch that and format it into the error envelope.

Wait, let me think about this more carefully. The service throws `NotFoundException`. The controller needs to handle errors and produce the single error envelope format.

Actually, in NestJS, you typically use exception filters for this. But the plan says the controller handles "input validation, error envelope". Let me think about what's minimal and correct.

Looking at the plan's manifest:
- `src/account/account.controller.ts` | reads: src/account/account.service.ts | HTTP layer, input validation, error envelope

The controller should:
1. Define routes (kebab-case, plural → `/accounts`, `/accounts/:id`)
2. Validate input (for POST: name must be present and a string)
3. Call the service
4. Handle errors → format into the error envelope

For the error handling, since the service throws NestJS exceptions (like `NotFoundException`), I need to either:
- Use a try/catch in the controller to catch and reformat
- Or rely on a global exception filter

But the plan says the controller handles "error envelope", so I'll handle it in the controller with try/catch.

Actually, looking more carefully at the conventions: "controller validates input and calls the service. Zero business logic." The error envelope is a convention, but the controller is responsible for input validation. For service errors, I think the cleanest approach given no global filter is mentioned in the plan would be to catch exceptions and format them.

Wait, but looking at the service - it throws `NotFoundException` which is a NestJS built-in. If I use a try/catch in the controller, I can convert it to the proper envelope format.

Let me think about what endpoints exist:
- `GET /accounts/:id` → `findById`
- `POST /accounts` → `create`

For POST validation:
- `name` must be present and a string (non-empty)

Let me write the controller:

```typescript
import { Controller, Get, Post, Param, Body, Res } from '@nestjs/common';
import { Response } from 'express';
import { AccountService, AccountResponse } from './account.service';

@Controller('accounts')
export class AccountController {
  constructor(private readonly service: AccountService) {}

  @Get(':id')
  async getById(@Param('id') id: string, @Res() res: Response) {
    try {
      const result = await this.service.findById(id);
      res.status(200).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  }

  @Post()
  async create(@Body() body: { name?: string }, @Res() res: Response) {
    // Input validation
    if (!body || typeof body.name !== 'string' || body.name.length === 0) {
      res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Request body must include a non-empty string "name" field.',
          details: {},
        },
      });
      return;
    }
    try {
      const result = await this.service.create(body);
      res.status(201).json(result);
    } catch (err) {
      this.handleError(res, err);
    }
  }

  private handleError(res: Response, err: unknown): void {
    if (err instanceof NotFoundException) {
      res.status(404).json({
        error: {
          code: 'resource_not_found',
          message: (err as NotFoundException).message,
          details: {},
        },
      });
    } else {
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: 'An unexpected error occurred.',
          details: {},
        },
      });
    }
  }
}
```

Wait, I need to import `NotFoundException` from `@nestjs/common` to check instanceof. Let me also think about whether using `@Res()` is the right approach or if I should use NestJS's built-in response handling.

Actually, using `@Res()` bypasses NestJS's exception filters. That's fine for this controller since we're handling all errors ourselves. But it means I need to handle everything manually.

Alternatively, I could use NestJS's `HttpException` and a global filter, but the plan doesn't mention a global filter. The plan says the controller handles "error envelope", so I'll do it in the controller.

Let me also consider: should I use `@Res()` or return values directly? If I return values, NestJS handles the serialization. But for error handling with a custom envelope, using `@Res()` gives me full control.

Actually, let me reconsider. The convention says the error envelope is the single format. If I use NestJS's built-in exception handling (throwing HttpException), NestJS will format errors in its own way. To get the exact envelope format specified, I either need:
1. A global exception filter (not in the plan)
2. Manual handling with `@Res()`
3. Custom exception classes + filter

Since the plan only names this file and doesn't mention filters or custom exceptions, I'll use `@Res()` for full control.

Let me refine:

```typescript
import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type { Response } from 'express';

import { AccountService } from './account.service';

@Controller('accounts')
export class AccountController {
  constructor(private readonly service: AccountService) {}

  @Get(':id')
  async getById(@Param('id') id: string, @Res() res: Response): Promise<void> {
    try {
      const result = await this.service.findById(id);
      res.status(200).json(result);
    } catch (err: unknown) {
      this.sendError(res, err);
    }
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    if (!body || typeof body.name !== 'string' || (body.name as string).trim().length === 0) {
      res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Body must contain a non-empty string field "name".',
          details: {},
        },
      });
      return;
    }

    try {
      const result = await this.service.create({ name: body.name as string });
      res.status(201).json(result);
    } catch (err: unknown) {
      this.sendError(res, err);
    }
  }

  private sendError(res: Response, err: unknown): void {
    if (err instanceof NotFoundException) {
      res.status(404).json({
        error: {
          code: 'resource_not_found',
          message: err.message,
          details: {},
        },
      });
      return;
    }

    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        details: {},
      },
    });
  }
}
```

Hmm, wait. Let me check the conventions again:
- "Endpoint: kebab-case, plural" → `/accounts` is already kebab-case and plural. ✓
- "Class: PascalCase" → `AccountController` ✓
- "TS file: kebab-case.role.ts" → `account.controller.ts` ✓

The plan says for the account controller: "HTTP layer, input validation, error envelope"

I think this is good. Let me also make sure I'm not adding anything the plan doesn't specify. The plan mentions:
- GET /accounts/:id (test 1, 2)
- POST /accounts (implied by the service having a create method)

Wait, does the plan explicitly list a POST /accounts endpoint? Let me check...

The plan's test table mentions:
- Test 1: GET /accounts/:id returns 200
- Test 2: GET /accounts/:id returns 404
- Test 13: account with zero balance

The service has both `findById` and `create`. So there should be a POST endpoint.

The plan's data model shows accounts have an `id` with default `gen_random_uuid()`, so creation makes sense.

I think my implementation is correct. Let me finalize it.

One more thought: the `@Res()` decorator requires importing from express. In a NestJS project with the conventions shown, this should be available. Let me use `import type { Response } from 'express';` to avoid a runtime import.

Actually, in NestJS, the typical pattern is to either:
1. Use `@Res()` from `@nestjs/common` (which is a re-export)
2. Import from 'express' directly

Let me use the NestJS re-export to be safe: actually, `@Res()` is from `@nestjs/common` but the type `Response` is from 'express'. I'll import the type from express.

Let me finalize.
```

## reply

```typescript
import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type { Response } from 'express';

import { AccountService } from './account.service';

@Controller('accounts')
export class AccountController {
  constructor(private readonly service: AccountService) {}

  @Get(':id')
  async getById(@Param('id') id: string, @Res() res: Response): Promise<void> {
    try {
      const result = await this.service.findById(id);
      res.status(200).json(result);
    } catch (err: unknown) {
      this.sendError(res, err);
    }
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    if (!body || typeof body.name !== 'string' || (body.name as string).trim().length === 0) {
      res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Body must contain a non-empty string field "name".',
          details: {},
        },
      });
      return;
    }

    try {
      const result = await this.service.create({ name: body.name as string });
      res.status(201).json(result);
    } catch (err: unknown) {
      this.sendError(res, err);
    }
  }

  private sendError(res: Response, err: unknown): void {
    if (err instanceof NotFoundException) {
      res.status(404).json({
        error: {
          code: 'resource_not_found',
          message: err.message,
          details: {},
        },
      });
      return;
    }

    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        details: {},
      },
    });
  }
}
```
