# 11-invoice.controller.ts

## reasoning

```
Let me analyze what I need to write for `src/invoice/invoice.controller.ts`.

From the PLAN.md:
- The controller is the HTTP layer, input validation, error envelope
- It validates body shape (account_id present, line_items non-empty array, each item has description + amount_cents)
- Calls InvoiceService methods
- Endpoints:
  - POST /invoices (create)
  - GET /invoices/:id (get by id)
  - GET /invoices?account_id=... (list by account with pagination params page, pageSize)

From the plan:
- Endpoint: `kebab-case`, plural → `/invoices`
- TS file: `kebab-case.role.ts` → `invoice.controller.ts`
- Class: `PascalCase` → `InvoiceController`

From the service file (reference):
- `CreateInvoiceBody`: `{ account_id: string; line_items: { description: string; amount_cents: string }[] }`
- `InvoiceResponse`: full invoice with nested line_items
- `InvoiceListResponse`: `{ data, page, page_size }`
- Service methods: `create(body)`, `getById(id)`, `listByAccount(accountId, page?, pageSize?)`

From the plan's control flow:
- Controller validates body shape (account_id present, line_items non-empty array, each item has description + amount_cents). Calls `InvoiceService.create`.
- POST returns 201
- GET /invoices/:id returns the invoice or 404 (service throws NotFoundException)
- GET /invoices with pagination params

Error handling:
- The plan says errors use the single envelope `{ error: { code, message, details } }`
- `resource_not_found` for 404
- `validation_error` for 400/422

Now, looking at the conventions:
- Controller validates input and calls the service. Zero business logic.
- The controller should handle validation of input shapes.

Let me think about what the controller needs:

1. `@Controller('invoices')` - kebab-case, plural
2. `POST /` (or just `@Post()`) - create invoice, validates body, calls service.create
3. `GET /:id` - get by id, calls service.getById
4. `GET /` with query params `account_id`, `page`, `page_size` - list by account

For validation, the controller should:
- Check that `account_id` is present and is a string
- Check that `line_items` is a non-empty array
- Check each item has `description` (string) and `amount_cents` (string)

For errors, I need to throw NestJS exceptions that map to the error envelope. Looking at the plan:
- `resource_not_found` → 404
- `validation_error` → 400

In NestJS, I can use `NotFoundException` and `BadRequestException`. But the plan specifies a specific error envelope format. I should check if there's a global exception filter or if the controller should handle it.

Looking at the plan more carefully:
- "All errors use the single envelope `{ error: { code, message, details } }`."
- The service throws `NotFoundException` for not-found cases.

Since the plan says the controller has "zero business logic" and just validates input and calls the service, and the error envelope is a convention, I think the controller should:
1. Validate input (throw BadRequestException with appropriate details for validation errors)
2. Call the service
3. Let NotFoundException propagate (handled by a global filter presumably)

But wait - I only see the controller file being asked for. Let me think about what exceptions to throw:
- For validation errors in the controller: `BadRequestException` with message
- The service already throws `NotFoundException` for not-found

Actually, looking at the conventions again: "Errors — one envelope" with `code` being the contract. In NestJS, I'd typically use a custom exception or configure an exception filter. But since I'm only writing the controller, I should throw appropriate NestJS exceptions.

Let me look at what makes sense:
- For validation: `BadRequestException` - but I need to include the error code in the response
- For not-found: the service throws `NotFoundException`

Actually, in NestJS the standard exceptions produce a `{ statusCode, message, error }` format by default. The plan wants `{ error: { code, message, details } }`. This would typically be handled by a global exception filter. Since I'm only writing the controller, I should just throw the appropriate exceptions and assume a filter handles formatting.

But wait - the plan says the controller does "input validation." Let me think about how to structure this.

For the POST body validation:
- Check `account_id` is a non-empty string
- Check `line_items` is an array with at least one element
- Check each item has `description` (non-empty string) and `amount_cents` (string, valid number)

Let me write the controller:

```typescript
import { Controller, Post, Get, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { InvoiceService, CreateInvoiceBody } from './invoice.service';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  async create(@Body() body: CreateInvoiceBody) {
    // validate
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body is required');
    }
    if (typeof body.account_id !== 'string' || body.account_id.length === 0) {
      throw new BadRequestException('account_id must be a non-empty string');
    }
    if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
      throw new BadRequestException('line_items must be a non-empty array');
    }
    for (const item of body.line_items) {
      if (!item || typeof item.description !== 'string' || item.description.length === 0) {
        throw new BadRequestException('Each line item must have a non-empty description');
      }
      if (typeof item.amount_cents !== 'string') {
        throw new BadRequestException('Each line item must have amount_cents as a string');
      }
    }

    return this.invoiceService.create(body);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.invoiceService.getById(id);
  }

  @Get()
  async listByAccount(
    @Query('account_id') accountId: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    if (!accountId) {
      throw new BadRequestException('account_id query parameter is required');
    }

    const p = page ? Number(page) : undefined;
    const ps = pageSize ? Number(pageSize) : undefined;

    return this.invoiceService.listByAccount(accountId, p, ps);
  }
}
```

Wait, I need to think about the `@HttpCode` for POST. By default NestJS POST returns 201, which matches the plan ("Controller returns 201 with the response body"). So that's fine.

Let me also think about whether I need to validate pagination params. The plan says the controller validates input. If page/page_size are provided but not valid numbers, that should be a validation error. Let me add that.

Actually, let me re-read the plan's control flow:
- "Controller validates body shape (account_id present, line_items non-empty array, each item has description + amount_cents). Calls InvoiceService.create."

So the controller's validation is specifically about the body shape for POST. For GET endpoints, it just passes through to the service.

For the list endpoint, I should validate that `account_id` is present since it's required for the query.

Let me also consider: should I validate that `amount_cents` is a valid numeric string? The plan says the service does `BigInt(item.amount_cents)` which would throw if it's not a valid number. But the controller should catch this early. Let me add a check that it's a valid integer string.

Actually, the plan says "Zero business logic" in the controller. Validating that a string represents a valid number could be considered input validation (shape/type checking) rather than business logic. I'll keep it to type checking: is it a string? That's shape validation. Whether the BigInt conversion works is more business logic.

Hmm, but if I don't validate it and it's "abc", the BigInt conversion in the service will throw a generic Error which won't map to the error envelope nicely. Let me add a basic check that it's a valid numeric string. That's input validation, not business logic.

Let me refine:

```typescript
import { Controller, Post, Get, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { InvoiceService, CreateInvoiceBody } from './invoice.service';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  async create(@Body() body: CreateInvoiceBody) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body must be a JSON object');
    }

    if (typeof body.account_id !== 'string' || body.account_id.length === 0) {
      throw new BadRequestException('account_id is required and must be a non-empty string');
    }

    if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
      throw new BadRequestException('line_items is required and must be a non-empty array');
    }

    for (const item of body.line_items) {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException('Each line item must be an object');
      }
      if (typeof item.description !== 'string' || item.description.length === 0) {
        throw new BadRequestException('Each line item must have a non-empty string description');
      }
      if (typeof item.amount_cents !== 'string' || !/^-?\d+$/.test(item.amount_cents)) {
        throw new BadRequestException('Each line item must have amount_cents as an integer string');
      }
    }

    return this.invoiceService.create(body);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.invoiceService.getById(id);
  }

  @Get()
  async listByAccount(
    @Query('account_id') accountId: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    if (!accountId) {
      throw new BadRequestException('account_id query parameter is required');
    }

    let parsedPage: number | undefined;
    if (page !== undefined) {
      parsedPage = Number(page);
      if (!Number.isInteger(parsedPage) || parsedPage < 1) {
        throw new BadRequestException('page must be a positive integer');
      }
    }

    let parsedPageSize: number | undefined;
    if (pageSize !== undefined) {
      parsedPageSize = Number(pageSize);
      if (!Number.isInteger(parsedPageSize) || parsedPageSize < 1) {
        throw new BadRequestException('page_size must be a positive integer');
      }
    }

    return this.invoiceService.listByAccount(accountId, parsedPage, parsedPageSize);
  }
}
```

This looks good. Let me double-check against the plan:
- ✅ HTTP layer only
- ✅ Body validation (account_id, line_items non-empty, each item has description + amount_cents)
- ✅ Pagination params (page, page_size as query params)
- ✅ Calls service methods
- ✅ Zero business logic
- ✅ POST returns 201 (NestJS default for @Post)
- ✅ GET /:id and GET / with query params

The plan mentions the endpoint as kebab-case plural, so `invoices` is correct.

I think this is complete. Let me finalize it.
```

## reply

```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { InvoiceService, CreateInvoiceBody } from './invoice.service';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  async create(@Body() body: CreateInvoiceBody) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body must be a JSON object');
    }

    if (typeof body.account_id !== 'string' || body.account_id.length === 0) {
      throw new BadRequestException(
        'account_id is required and must be a non-empty string',
      );
    }

    if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
      throw new BadRequestException(
        'line_items is required and must be a non-empty array',
      );
    }

    for (const item of body.line_items) {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException('Each line item must be an object');
      }
      if (
        typeof item.description !== 'string' ||
        item.description.length === 0
      ) {
        throw new BadRequestException(
          'Each line item must have a non-empty string description',
        );
      }
      if (
        typeof item.amount_cents !== 'string' ||
        !/^-?\d+$/.test(item.amount_cents)
      ) {
        throw new BadRequestException(
          'Each line item must have amount_cents as an integer string',
        );
      }
    }

    return this.invoiceService.create(body);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.invoiceService.getById(id);
  }

  @Get()
  async listByAccount(
    @Query('account_id') accountId: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    if (!accountId) {
      throw new BadRequestException('account_id query parameter is required');
    }

    let parsedPage: number | undefined;
    if (page !== undefined) {
      parsedPage = Number(page);
      if (!Number.isInteger(parsedPage) || parsedPage < 1) {
        throw new BadRequestException('page must be a positive integer');
      }
    }

    let parsedPageSize: number | undefined;
    if (pageSize !== undefined) {
      parsedPageSize = Number(pageSize);
      if (!Number.isInteger(parsedPageSize) || parsedPageSize < 1) {
        throw new BadRequestException('page_size must be a positive integer');
      }
    }

    return this.invoiceService.listByAccount(
      accountId,
      parsedPage,
      parsedPageSize,
    );
  }
}
```
