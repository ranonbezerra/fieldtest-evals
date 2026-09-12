import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Order, Page } from '../../api/types';

export interface OrderQuery {
  status?: string;
  page: number;
}

export const orderKeys = {
  all: ['orders'] as const,
  list: (q: OrderQuery) => ['orders', 'list', q] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
};

export function useOrders(q: OrderQuery) {
  return useQuery({ queryKey: orderKeys.list(q), queryFn: () => api.listOrders(q) });
}

export function useOrder(id: string) {
  return useQuery({ queryKey: orderKeys.detail(id), queryFn: () => api.getOrder(id) });
}

/**
 * Approve / reject from the detail screen. Both write the returned row straight
 * into the caches that hold it. Whatever else needs these actions should reuse
 * this, not re-invalidate the list.
 */
export function useApproveOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.approveOrder(id),
    onSuccess: (updated) => patchOrder(qc, updated),
  });
}

export function useRejectOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rejectOrder(id),
    onSuccess: (updated) => patchOrder(qc, updated),
  });
}

export function patchOrder(qc: ReturnType<typeof useQueryClient>, updated: Order): void {
  qc.setQueryData(orderKeys.detail(updated.id), updated);
  qc.setQueriesData<Page<Order>>({ queryKey: ['orders', 'list'] }, (old) => {
    if (!old) return old;
    if (!old.items.some((o) => o.id === updated.id)) return old;
    return { ...old, items: old.items.map((o) => (o.id === updated.id ? updated : o)) };
  });
}

export function isActionable(order: Order): boolean {
  return order.status === 'pending';
}
