// ASSUMPTION: The generated Prisma client is not available at compile time, so
// OrderStatus is defined locally. Its members are inferred from the domain
// (marketplace payment-order lifecycle). If the schema defines additional or
// differently-named members, align this type with it.
// ASSUMPTION: The original file imported `Prisma` from '@prisma/client'; without
// seeing the original body I cannot determine which `Prisma.*` type was used.
// If a specific Prisma namespace type (e.g. Prisma.PaymentOrderWhereInput) was
// referenced, re-add the import once the client is generated.

export const OrderStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export class CreateOrderDto {
  companyId: string;
  workerId: string;
  eventId: string;
  amount: number;
}

export class UpdateOrderStatusDto {
  status: OrderStatus;
}

export class QueryOrdersDto {
  companyId?: string;
  status?: OrderStatus;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}
