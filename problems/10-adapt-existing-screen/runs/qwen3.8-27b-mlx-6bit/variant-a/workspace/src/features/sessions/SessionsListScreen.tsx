import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useSessions } from './queries';

const STATUSES = ['', 'open', 'paused', 'closed'] as const;

export function SessionsListScreen() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useSessions({ status: status || undefined, q: q || undefined, page });

  if (isLoading) return <p>Loading…</p>;
  if (!data) return <p>Could not load sessions.</p>;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <section>
      <h1>Sessions</h1>

      <div className="filters">
        <input
          aria-label="Search sessions"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
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
      </div>

      {data.items.length === 0 ? (
        <p>No sessions match these filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Operator</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to={`/sessions/${s.id}`}>{s.name}</Link>
                </td>
                <td>{s.operator}</td>
                <td>
                  <Badge tone={s.status}>{s.status}</Badge>
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
