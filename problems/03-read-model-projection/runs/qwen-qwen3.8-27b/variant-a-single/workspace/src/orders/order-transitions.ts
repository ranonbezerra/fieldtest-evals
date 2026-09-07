// ASSUMPTION: Prisma client types are not generated in this environment; the OrderStatus enum is defined locally to match the schema's enum values.

export enum OrderStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.APPROVED, OrderStatus.REJECTED, OrderStatus.CANCELLED],
  [OrderStatus.APPROVED]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.REJECTED]: [OrderStatus.PENDING],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
