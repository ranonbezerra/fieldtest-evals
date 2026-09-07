import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useOrder, orderKeys, useCancelOrder } from './queries';
import { OrderStatus } from '../../api/types';

export function OrderDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: order, isLoading } = useOrder(id ?? undefined);

  const rejectMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`/api/orders/${orderId}/reject`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reject order');
      return res.json() as Promise<{ id: string; status: OrderStatus }>;
    },
    onSuccess: (_data, orderId) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.setQueryData(orderKeys.detail(orderId), (old: any) =>
        old ? { ...old, status: 'rejected' as OrderStatus } : old,
      );
    },
  });

  const cancelOrder = useCancelOrder();

  if (isLoading) return <div>Loading…</div>;
  if (!order) return <div>Order not found</div>;

  return (
    <div className="order-detail">
      <h1>Order {order.id}</h1>
      <p>Status: {order.status}</p>
      <p>Total: {order.total}</p>

      {order.status === 'pending' && (
        <div className="order-actions">
          <button
            onClick={() => rejectMutation.mutate(order.id)}
            disabled={rejectMutation.isPending}
          >
            Reject
          </button>
          <button
            onClick={() => cancelOrder.mutate(order.id)}
            disabled={cancelOrder.isPending}
          >
            Cancel
          </button>
        </div>
      )}

      <button onClick={() => navigate(-1)}>Back to list</button>
    </div>
  );
}
