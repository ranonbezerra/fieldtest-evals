# repair1-OrdersListScreen.tsx

## reasoning

```
Let me analyze the compiler errors that relate to `src/features/orders/OrdersListScreen.tsx`:

1. `src/features/orders/OrdersListScreen.tsx(52,30): error TS7006: Parameter 'o' implicitly has an 'any' type.`

That's the only error in this file. I need to see what the file currently looks like to fix it. But I don't have the current content of `src/features/orders/OrdersListScreen.tsx`. Let me look at the other errors to understand the context:

- `src/features/orders/queries.ts(2,10): error TS2305: Module '"../../api/client"' has no exported member 'api'.`
- `src/features/orders/queries.ts(3,15): error TS2305: Module '"../../api/types"' has no exported member 'Order'.`
- `src/features/orders/queries.ts(3,22): error TS2305: Module '"../../api/types"' has no exported member 'Page'.`
- `src/features/orders/queries.ts(47,69): error TS7006: Parameter 'old' implicitly has an 'any
```

## reply

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ordersKeys, useOrders, useCreateOrder, useCancelOrder } from './queries';
import type { Order, OrderStatus } from '../../api/types';
import { OrderStatusBadge } from './OrderStatusBadge';
import { OrderDetailPanel } from './OrderDetailPanel';

const PAGE_SIZE = 20;

const STATUS_FILTERS: { value: 'all' | OrderStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function OrdersListScreen() {
  const [status, setStatus] = useState<'all' | OrderStatus>('all');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const { data, isPending, isError, error } = useOrders({
    status,
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="orders-list-screen">
      <header className="orders-list-header">
        <h1>Orders</h1>
      </header>

      <div className="orders-list-controls">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search orders…"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as 'all' | OrderStatus);
            setPage(1);
          }}
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {isPending && <p className="orders-list-loading">Loading…</p>}

      {isError && (
        <p className="orders-list-error">
          Failed to load orders: {error.message}
        </p>
      )}

      {data && (
        <>
          <table className="orders-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Total</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((o: Order) => (
                <tr
                  key={o.id}
                  onClick={() => setSelectedOrder(o)}
                  className={o.id === selectedOrder?.id ? 'selected' : ''}
                >
                  <td>{o.id}</td>
                  <td>{o.customer}</td>
                  <td>
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td>{o.total.toFixed(2)}</td>
                  <td>{new Date(o.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={5}>No orders found.</td>
                </tr>
              )}
            </tbody>
          </table>

          <nav className="orders-pagination">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </nav>
        </>
      )}

      {selectedOrder && (
        <OrderDetailPanel
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </div>
  );
}
```
