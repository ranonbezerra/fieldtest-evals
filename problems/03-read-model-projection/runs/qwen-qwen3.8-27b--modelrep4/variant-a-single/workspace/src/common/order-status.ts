/**
 * Canonical order lifecycle values. The array order also matches the column
 * order of `company_operation_totals`; both stay in lockstep.
 */
export const ORDER_STATUSES = ['pending', 'approved', 'rejected', 'completed', 'cancelled'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}
