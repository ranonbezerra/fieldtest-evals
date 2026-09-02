# 09-operations.controller.ts

## reasoning

```
Let me analyze the plan and references to write the operations controller.

From PLAN.md:
```ts
// ─── src/operations/operations.controller.ts ───

export class OperationsController {
  constructor(service: OperationsService) {}

  @Get("operations")
  getDashboard(query: DashboardQuery): Promise<DashboardResult>;

  @Post("operations/simulate-write")
  simulateWrite(@Body() input: SimulateWriteInput): Promise<OperationRow>;

  @Get("operations/totals/:companyId")
  getTotals(@Param("companyId") companyId: string): Promise<CompanyTotals>;
}
```

The controller should:
1. Validate input (page, page_size, date ranges) - but wait, looking at the service code, the validation is done in the service. Let me re-read the conventions: "controller validates input and calls the service. Zero business logic."

So the controller should validate input (parse query params, validate types) and then call the service. But looking at the service, it already does validation like `page < 1`, `page_size` bounds, `date_from < date_to`. 

Wait, let me re-read: "controller validates input and calls the service. Zero business logic." The service also does some validation. But the plan says the controller handles "Route handlers with input validation."

Looking at the service, it throws ValidationError for page/page_size and InvalidDateRangeError. These are business-level validations that could be in the controller or service. Since the plan shows the service doing these validations (they're in the service code shown), and the controller's role is "Route handlers with input validation" - I think the controller should handle:
- Parsing query string parameters (converting strings to numbers, dates)
- Basic type validation
- Then delegating to the service

The service handles the business validation (like date_from < date_to, company existence).

Let me look at what the controller needs:
1. `GET /operations` - parse query params: company_id, status (optional), date_from (optional), date_to (optional), page (required, number), page_size (required, number)
2. `POST /operations/simulate-write` - parse body: order_id, company_id, worker_id, status, amount, currency
3. `GET /operations/totals/:companyId` - parse param: companyId

The controller should validate that required fields are present and of correct type, then call the service.

Let me think about what validation belongs in the controller vs service:
- Controller: "is this a valid UUID?", "is this a number?", "is this a valid enum value?" - structural/type validation
- Service: "is date_from < date_to?", "does this company exist?" - business logic

Actually, looking more carefully at the conventions: "controller validates input and calls the service. Zero business logic." This means ALL input validation should be in the controller, and the service just does business logic. But the reference service code shows it doing validation...

The plan is my specification. The plan shows the service doing those validations. But the conventions say controller validates input. I'll put basic structural validation in the controller (parsing, type checking, required fields) and let the service handle the business-level validation it already handles.

Let me write the controller:

```typescript
import { Controller, Get, Post, Body, Query, Param } from "@nestjs/common";
import { OperationsService } from "./operations.service";
import type { DashboardQuery, SimulateWriteInput, OperationRow, DashboardResult, CompanyTotals, OrderStatus } from "./operations.types";
import { ValidationError } from "./operations.types";

@Controller()
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @Get("operations")
  async getDashboard(
    @Query("company_id") companyId: string,
    @Query("status") status?: string,
    @Query("date_from") dateFrom?: string,
    @Query("date_to") dateTo?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ): Promise<DashboardResult> {
    if (!companyId) {
      throw new ValidationError("company_id is required", { field: "company_id" });
    }

    const pageNum = Number(page);
    if (page === undefined || page === "" || Number.isNaN(pageNum)) {
      throw new ValidationError("page is required and must be a number", { field: "page" });
    }

    const pageSizeNum = Number(pageSize);
    if (pageSize === undefined || pageSize === "" || Number.isNaN(pageSizeNum)) {
      throw new ValidationError("page_size is required and must be a number", { field: "page_size" });
    }

    let parsedStatus: OrderStatus | undefined;
    if (status !== undefined && status !== "") {
      const validStatuses: string[] = ["pending", "approved", "rejected", "settled"];
      if (!validStatuses.includes(status)) {
        throw new ValidationError("status must be one of: pending, approved, rejected, settled", { field: "status", value: status });
      }
      parsedStatus = status as OrderStatus;
    }

    let parsedDateFrom: Date | undefined;
    if (dateFrom !== undefined && dateFrom !== "") {
      parsedDateFrom = new Date(dateFrom);
      if (Number.isNaN(parsedDateFrom.getTime())) {
        throw new ValidationError("date_from must be a valid ISO date", { field: "date_from", value: dateFrom });
      }
    }

    let parsedDateTo: Date | undefined;
    if (dateTo !== undefined && dateTo !== "") {
      parsedDateTo = new Date(dateTo);
      if (Number.isNaN(parsedDateTo.getTime())) {
        throw new ValidationError("date_to must be a valid ISO date", { field: "date_to", value: dateTo });
      }
    }

    const query: DashboardQuery = {
      company_id: companyId,
      status: parsedStatus,
      date_from: parsedDateFrom,
      date_to: parsedDateTo,
      page: pageNum,
      page_size: pageSizeNum,
    };

    return this.service.getDashboard(query);
  }

  @Post("operations/simulate-write")
  async simulateWrite(@Body() body: SimulateWriteInput): Promise<OperationRow> {
    if (!body?.order_id) {
      throw new ValidationError("order_id is required", { field: "order_id" });
    }
    if (!body?.company_id) {
      throw new ValidationError("company_id is required", { field: "company_id" });
    }
    if (!body?.worker_id) {
      throw new ValidationError("worker_id is required", { field: "worker_id" });
    }
    if (!body?.status) {
      throw new ValidationError("status is required", { field: "status" });
    }
    const validStatuses: string[] = ["pending", "approved", "rejected", "settled"];
    if (!validStatuses.includes(body.status)) {
      throw new ValidationError("status must be one of: pending, approved, rejected, settled", { field: "status", value: body.status });
    }
    if (!body?.amount) {
      throw new ValidationError("amount is required", { field: "amount" });
    }
    if (!body?.currency) {
      throw new ValidationError("currency is required", { field: "currency" });
    }

    return this.service.simulateWrite(body);
  }

  @Get("operations/totals/:companyId")
  async getTotals(@Param("companyId") companyId: string): Promise<CompanyTotals> {
    if (!companyId) {
      throw new ValidationError("companyId is required", { field: "companyId" });
    }
    return this.service.getCompanyTotals(companyId);
  }
}
```

Wait, I need to think about whether the error handling is properly set up. The plan mentions a single error envelope:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

The error classes already have `code` and `details`. But I need a global exception filter or something to handle the formatting. However, the plan doesn't mention creating an exception filter file. The plan's manifest only lists specific files. Let me check...

The manifest lists:
- src/operations/operations.controller.ts

No exception filter is listed. So the error classes as defined (with `code`, `message`, `details` properties) will be thrown, and presumably NestJS's default error handling or some other mechanism handles the formatting. Since I'm only writing this one file, I'll just throw the errors and trust that the rest of the system handles formatting.

Actually wait - I should think about this more carefully. The conventions say "Errors — one envelope" but don't specify where the filter goes. Since I'm only writing the controller, I'll throw the typed errors and they'll be handled elsewhere. The controller's job is to validate and delegate.

Let me also reconsider: should I use `@ValidateNested` or class-validator? The plan doesn't mention class-validator, and the types are plain interfaces. I'll stick with manual validation in the controller since that's what the plan implies ("Route handlers with input validation").

One more thought: the `SimulateWriteInput` has `amount` as a string. Should I validate it's a valid number? The plan says "All monetary amounts use numeric(14,2) / Prisma Decimal." I'll add a check that it parses as a valid number.

Let me finalize my implementation.
```

## reply

```typescript
import { Controller, Get, Post, Body, Query, Param } from "@nestjs/common";
import { OperationsService } from "./operations.service";
import type {
  DashboardQuery,
  DashboardResult,
  OperationRow,
  SimulateWriteInput,
  CompanyTotals,
  OrderStatus,
} from "./operations.types";
import { ValidationError } from "./operations.types";

const VALID_STATUSES: readonly string[] = ["pending", "approved", "rejected", "settled"] as const;

@Controller()
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @Get("operations")
  async getDashboard(
    @Query("company_id") companyId: string | undefined,
    @Query("status") status: string | undefined,
    @Query("date_from") dateFrom: string | undefined,
    @Query("date_to") dateTo: string | undefined,
    @Query("page") page: string | undefined,
    @Query("page_size") pageSize: string | undefined,
  ): Promise<DashboardResult> {
    if (!companyId) {
      throw new ValidationError("company_id is required", { field: "company_id" });
    }

    if (page === undefined || page === "") {
      throw new ValidationError("page is required", { field: "page" });
    }
    const pageNum = Number(page);
    if (!Number.isInteger(pageNum)) {
      throw new ValidationError("page must be an integer", { field: "page", value: page });
    }

    if (pageSize === undefined || pageSize === "") {
      throw new ValidationError("page_size is required", { field: "page_size" });
    }
    const pageSizeNum = Number(pageSize);
    if (!Number.isInteger(pageSizeNum)) {
      throw new ValidationError("page_size must be an integer", { field: "page_size", value: pageSize });
    }

    let parsedStatus: OrderStatus | undefined;
    if (status !== undefined && status !== "") {
      if (!VALID_STATUSES.includes(status)) {
        throw new ValidationError(
          "status must be one of: pending, approved, rejected, settled",
          { field: "status", value: status },
        );
      }
      parsedStatus = status as OrderStatus;
    }

    let parsedDateFrom: Date | undefined;
    if (dateFrom !== undefined && dateFrom !== "") {
      parsedDateFrom = new Date(dateFrom);
      if (Number.isNaN(parsedDateFrom.getTime())) {
        throw new ValidationError("date_from must be a valid ISO-8601 date", {
          field: "date_from",
          value: dateFrom,
        });
      }
    }

    let parsedDateTo: Date | undefined;
    if (dateTo !== undefined && dateTo !== "") {
      parsedDateTo = new Date(dateTo);
      if (Number.isNaN(parsedDateTo.getTime())) {
        throw new ValidationError("date_to must be a valid ISO-8601 date", {
          field: "date_to",
          value: dateTo,
        });
      }
    }

    const query: DashboardQuery = {
      company_id: companyId,
      status: parsedStatus,
      date_from: parsedDateFrom,
      date_to: parsedDateTo,
      page: pageNum,
      page_size: pageSizeNum,
    };

    return this.service.getDashboard(query);
  }

  @Post("operations/simulate-write")
  async simulateWrite(@Body() body: SimulateWriteInput): Promise<OperationRow> {
    if (!body?.order_id) {
      throw new ValidationError("order_id is required", { field: "order_id" });
    }
    if (!body?.company_id) {
      throw new ValidationError("company_id is required", { field: "company_id" });
    }
    if (!body?.worker_id) {
      throw new ValidationError("worker_id is required", { field: "worker_id" });
    }
    if (!body?.status) {
      throw new ValidationError("status is required", { field: "status" });
    }
    if (!VALID_STATUSES.includes(body.status)) {
      throw new ValidationError(
        "status must be one of: pending, approved, rejected, settled",
        { field: "status", value: body.status },
      );
    }
    if (!body?.amount) {
      throw new ValidationError("amount is required", { field: "amount" });
    }
    if (Number.isNaN(Number(body.amount))) {
      throw new ValidationError("amount must be a valid numeric string", {
        field: "amount",
        value: body.amount,
      });
    }
    if (!body?.currency) {
      throw new ValidationError("currency is required", { field: "currency" });
    }

    return this.service.simulateWrite(body);
  }

  @Get("operations/totals/:companyId")
  async getTotals(@Param("companyId") companyId: string): Promise<CompanyTotals> {
    if (!companyId) {
      throw new ValidationError("companyId is required", { field: "companyId" });
    }

    return this.service.getCompanyTotals(companyId);
  }
}
```
