# 06-operations.types.ts

## reasoning

```
Let me analyze the PLAN.md to understand what `src/operations/operations.types.ts` should contain.

From the plan:

```ts
// ─── src/operations/operations.types.ts ───

export type OrderStatus = "pending" | "approved" | "rejected" | "settled";

export interface OperationRow {
  order_id: string;
  company_id: string;
  status: OrderStatus;
  amount: string;          // Decimal as string for JSON safety
  currency: string;
  worker_name: string;
  worker_role: string;
  last_event_type: string | null;
  created_at: Date;
}

export interface DashboardQuery {
  company_id: string;
  status?: OrderStatus;
  date_from?: Date;
  date_to?: Date;
  page: number;            // 1-based
  page_size: number;       // 1..100
}

export interface DashboardResult {
  data: OperationRow[];
  total_count: number;
  page: number;
  page_size: number;
}

export interface CompanyTotals {
  company_id: string;
  total_amount: string;
  order_count: number;
}

export interface SimulateWriteInput {
  order_id: string;
  company_id: string;
  worker_id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
}

export interface ReDeriveInput {
  date_from: Date;
  date_to: Date;
}

export interface DriftRepairReport {
  window_start: Date;
  window_end: Date;
  rows_checked: number;
  rows_repaired: number;
}

// ─── Errors ───

export class ResourceNotFoundError extends Error {
  code = "resource_not_found" as const;
  constructor(public readonly message: string, public readonly details: Record<string, unknown> = {}) { super(message); }
}

export class InvalidDateRangeError extends Error {
  code = "invalid_date_range" as const;
  constructor(public readonly message: string, public readonly details: Record<string, unknown> = {}) { super(message); }
}

export class ValidationError extends Error {
  code = "validation_error" as const;
  constructor(public readonly message: string, public readonly details: Record<string, unknown> = {}) { super(message); }
}
```

This is exactly what the plan specifies. Let me write it out completely as a TypeScript file. I need to make sure:
- It's complete, first line to last
- No extra exports or features not in the plan
- TypeScript strict mode compatible
- ESM (type module)

The file is straightforward - it's a types file with interfaces, a type alias, and error classes. Let me write it.
```

## reply

```typescript
export type OrderStatus = "pending" | "approved" | "rejected" | "settled";

export interface OperationRow {
  order_id: string;
  company_id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  worker_name: string;
  worker_role: string;
  last_event_type: string | null;
  created_at: Date;
}

export interface DashboardQuery {
  company_id: string;
  status?: OrderStatus;
  date_from?: Date;
  date_to?: Date;
  page: number;
  page_size: number;
}

export interface DashboardResult {
  data: OperationRow[];
  total_count: number;
  page: number;
  page_size: number;
}

export interface CompanyTotals {
  company_id: string;
  total_amount: string;
  order_count: number;
}

export interface SimulateWriteInput {
  order_id: string;
  company_id: string;
  worker_id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
}

export interface ReDeriveInput {
  date_from: Date;
  date_to: Date;
}

export interface DriftRepairReport {
  window_start: Date;
  window_end: Date;
  rows_checked: number;
  rows_repaired: number;
}

export class ResourceNotFoundError extends Error {
  readonly code = "resource_not_found" as const;

  constructor(
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}

export class InvalidDateRangeError extends Error {
  readonly code = "invalid_date_range" as const;

  constructor(
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "InvalidDateRangeError";
  }
}

export class ValidationError extends Error {
  readonly code = "validation_error" as const;

  constructor(
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}
```
