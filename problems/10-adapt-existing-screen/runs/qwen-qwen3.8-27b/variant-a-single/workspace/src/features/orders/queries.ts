import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// ASSUMPTION: The orders API functions and their module path are inferred from the project's feature-per-folder convention; the exact export names are chosen to match the mutation/query names used by this file.
import { getOrders, getOrder, createOrder, cancelOrder, rejectOrder } from '../../api/orders';
// ASSUMPTION: `Order` and `Page` are assumed to be exported from `../../api/types`; the compiler error about missing `Order` appears only in `OrdersListScreen.tsx`, not here, so the import path for this file is assumed valid.
import type { Order, Page } from '../../api/types';

export const ordersKeys = {
  all: ['orders'] as const,
  lists: () => [...ordersKeys.all, 'list'] as const,
  list: (params: Record<string, unknown>) => [...ordersKeys.lists(), params] as const,
  details: () => [...ordersKeys.all, 'detail'] as const,
  detail: (id: string) => [...ordersKeys.details(), id] as const,
};

export function useOrders(params: Record<string, unknown>) {
  return useQuery({
    queryKey: ordersKeys.list(params),
    queryFn: () => getOrders(params),
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ordersKeys.detail(id),
    queryFn: () => getOrder(id),
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => createOrder(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ordersKeys.all });
    },
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ordersKeys.all });
    },
  });
}

export function useRejectOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rejectOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ordersKeys.all });
    },
  });
}
