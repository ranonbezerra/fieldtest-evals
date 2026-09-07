import { useOrders } from './queries';
import type { Order, OrderStatus } from '../../api/types';
import { OrderStatusBadge } from './OrderStatusBadge';
import { OrderDetailPanel } from './OrderDetailPanel';

type OrderFilter = {
  status?: OrderStatus;
  search?: string;
};

type OrderPage = {
  page: number;
  pageSize: number;
  sort?: string;
};

export function OrdersListScreen() {
  const [filter, setFilter] = useState<OrderFilter>({});
  const [page, setPage] = useState<OrderPage>({ page: 1, pageSize: 20 });
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const { data, isLoading, isError, error } = useOrders({
    ...filter,
    ...page,
  });

  const handleFilterChange = (newFilter: Partial<OrderFilter>) => {
    setFilter((prev) => ({ ...prev, ...newFilter }));
    setPage((prev) => ({ ...prev, page: 1 }));
  };

  const handlePageChange = (newPage: number) => {
    setPage((prev) => ({ ...prev, page: newPage }));
  };

  const handleSelectOrder = (order: Order) => {
    setSelectedOrder(order);
  };

  if (isLoading) {
    return <div className="orders-list-loading">Loading orders…</div>;
  }

  if (isError) {
    return (
      <div className="orders-list-error">
        <p>Failed to load orders.</p>
        <pre>{error.message}</pre>
      </div>
    );
  }

  const { items, total } = data ?? { items: [], total: 0 };
  const totalPages = Math.ceil(total / page.pageSize);

  return (
    <div className="orders-list-screen">
      <h1>Orders</h1>

      <div className="orders-list-filters">
        <select
          value={filter.status ?? ''}
          onChange={(e) => handleFilterChange({ status: e.target.value || undefined })}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input
          type="search"
          placeholder="Search orders…"
          value={filter.search ?? ''}
          onChange={(e) => handleFilterChange({ search: e.target.value || undefined })}
        />
      </div>

      <table className="orders-list-table">
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
          {items.map((order) => (
            <tr key={order.id} onClick={() => handleSelectOrder(order)}>
              <td>{order.id}</td>
              <td>{order.customerName}</td>
              <td>
                <OrderStatusBadge status={order.status} />
              </td>
              <td>{order.total}</td>
              <td>{new Date(order.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="orders-list-pagination">
        <button disabled={page.page <= 1} onClick={() => handlePageChange(page.page - 1)}>
          Previous
        </button>
        <span>
          Page {page.page} of {totalPages}
        </span>
        <button disabled={page.page >= totalPages} onClick={() => handlePageChange(page.page + 1)}>
          Next
        </button>
      </div>

      {selectedOrder && (
        <OrderDetailPanel order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  );
}
