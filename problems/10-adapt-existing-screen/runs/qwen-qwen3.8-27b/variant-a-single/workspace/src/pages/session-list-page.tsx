import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useActiveSession } from '../active-session/active-session-store';
import { listSessions } from '../api/sessions';

const PAGE_SIZE = 10;

export function SessionListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activate, activateError } = useActiveSession();

  const rawStatus = searchParams.get('status');
  const status: 'all' | 'open' | 'closed' =
    rawStatus === 'open' || rawStatus === 'closed' ? rawStatus : 'all';
  const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const { data, isPending } = useQuery({
    queryKey: ['sessions', { status, page, pageSize: PAGE_SIZE }],
    queryFn: () => listSessions({ status, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function openSession(id: string) {
    const activated = await activate(id);
    if (activated) {
      navigate(`/sessions/${id}`);
    }
  }

  function applyFilter(nextStatus: string) {
    const params = new URLSearchParams(searchParams);
    if (nextStatus === 'all') {
      params.delete('status');
    } else {
      params.set('status', nextStatus);
    }
    params.delete('page');
    setSearchParams(params);
  }

  function goPage(next: number) {
    const clamped = Math.min(pageCount, Math.max(1, next));
    const params = new URLSearchParams(searchParams);
    if (clamped === 1) {
      params.delete('page');
    } else {
      params.set('page', String(clamped));
    }
    setSearchParams(params);
  }

  return (
    <div className="session-list">
      <div className="session-list__toolbar">
        <h1>Sessions</h1>
        <label>
          Status{' '}
          <select value={status} onChange={(e) => applyFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      </div>

      <table className="session-list__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Started</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>
                <button type="button" onClick={() => void openSession(s.id)}>
                  {s.name}
                </button>
              </td>
              <td>{s.status}</td>
              <td>{new Date(s.started_at).toLocaleString()}</td>
              <td>
                <Link to={`/sessions/${s.id}`}>View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="session-list__pagination">
        <button type="button" disabled={page <= 1} onClick={() => goPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {pageCount}
        </span>
        <button type="button" disabled={page >= pageCount} onClick={() => goPage(page + 1)}>
          Next
        </button>
      </div>

      {isPending ? <p>Loading…</p> : null}
      {activateError !== null ? (
        <p role="alert" className="session-list__error">
          {activateError}
        </p>
      ) : null}
    </div>
  );
}
