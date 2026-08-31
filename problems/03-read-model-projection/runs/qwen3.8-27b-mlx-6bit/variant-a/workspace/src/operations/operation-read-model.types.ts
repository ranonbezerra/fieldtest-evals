export type OperationStatus = string;

export interface OperationReadModel {
  id: bigint;
  orderId: bigint;
  companyId: bigint;
  workerId: bigint | null;
  eventId: bigint | null;
  status: string;
  amountCents: bigint;
  currency: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Input the write service hands to maintenance for one order.
export interface OperationUpsertInput {
  orderId: bigint;
  companyId: bigint;
  workerId: bigint | null;
  eventId: bigint | null;
  status: string;
  amountCents: bigint;
  currency: string;
  occurredAt: Date;
}

export interface OperationDeleteInput {
  orderId: bigint;
}

// Dashboard query input.
export interface OperationsQueryInput {
  companyId: bigint;
  status?: string;
  fromDate?: Date;
  toDate?: Date;
  page: number;
  pageSize: number;
}

export interface OperationsPage {
  items: OperationReadModel[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CompanyTotals {
  companyId: bigint;
  totalAmountCents: bigint;
  orderCount: number;
}

export interface DateWindow {
  from: Date;
  to: Date;
}

// Error contract: the snake_case `code` is the stable API surface. The service
// raises these errors; the controller / exception filter maps them to the single
// error envelope `{ "error": { code, message, details } }`.
export type OperationErrorCode = 'resource_not_found' | 'invalid_parameter';

export class ResourceNotFoundError extends Error {
  readonly code: OperationErrorCode = 'resource_not_found';

  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}

export class InvalidParameterError extends Error {
  readonly code: OperationErrorCode = 'invalid_parameter';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidParameterError';
  }
}
