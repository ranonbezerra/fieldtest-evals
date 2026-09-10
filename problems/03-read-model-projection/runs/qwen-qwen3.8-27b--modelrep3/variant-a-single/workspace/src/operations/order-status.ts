export const ORDER_STATUSES = ['pending', 'approved', 'rejected'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['approved', 'rejected'],
  approved: ['rejected'],
  rejected: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}
