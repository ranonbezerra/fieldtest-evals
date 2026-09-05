import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useOrders } from './queries';

const STATUSES = ['', 'pending', 'approved', 'rejected', 'cancelled'] as const;

export function OrdersListScreen() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();

  const { data, isLoading } = useOrders({ status: status || undefined, page });

  if (isLoading) return <p>Loading…</p>;
  if (!data) return <p>Could not load orders.</p>;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <section>
      <h1>Orders</h1>

      <select
        aria-label="Filter by status"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setPage(1);
        }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s === '' ? 'All statuses' : s}
          </option>
        ))}
      </select>

      {data.items.length === 0 ? (
        <p>No orders match these filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Customer</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((o) => (
              <tr key={o.id} onClick={() => navigate(`/orders/${o.id}`)} className="row--clickable">
                <td>{o.reference}</td>
                <td>{o.customer}</td>
                <td>
                  <Badge tone={o.status}>{o.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <nav className="pagination">
        <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span>
          Page {data.page} of {pages}
        </span>
        <Button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </nav>
    </section>
  );
}
