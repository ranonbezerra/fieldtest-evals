import { HttpResponse, http } from 'msw';
import type { Order, Session } from '../api/types';
import { PAGE_SIZE, orders, sessions, state } from './db';

function page<T>(items: T[], p: number) {
  const start = (p - 1) * PAGE_SIZE;
  return { items: items.slice(start, start + PAGE_SIZE), page: p, pageSize: PAGE_SIZE, total: items.length };
}

function authed() {
  return state.user !== null;
}

const unauthorized = () => HttpResponse.json({ code: 'unauthenticated' }, { status: 401 });

export const handlers = [
  http.post('/api/auth/login', async ({ request }) => {
    const { name } = (await request.json()) as { name: string };
    state.user = { id: 'u-1', name, roles: name === 'reviewer' ? ['operator', 'reviewer'] : ['operator'] };
    return HttpResponse.json(state.user);
  }),
  http.post('/api/auth/logout', () => {
    state.user = null;
    state.activeSessionId = null;
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/auth/me', () => (authed() ? HttpResponse.json(state.user) : unauthorized())),

  http.get('/api/sessions/active', () => {
    if (!authed()) return unauthorized();
    const s = sessions.find((x) => x.id === state.activeSessionId) ?? null;
    return HttpResponse.json(s);
  }),
  http.get('/api/sessions', ({ request }) => {
    if (!authed()) return unauthorized();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const q = url.searchParams.get('q')?.toLowerCase();
    let items: Session[] = sessions;
    if (status) items = items.filter((s) => s.status === status);
    if (q) items = items.filter((s) => s.name.toLowerCase().includes(q));
    return HttpResponse.json(page(items, Number(url.searchParams.get('page') ?? 1)));
  }),
  http.get('/api/sessions/:id', ({ params }) => {
    if (!authed()) return unauthorized();
    const s = sessions.find((x) => x.id === params.id);
    if (!s) return HttpResponse.json({ code: 'not_found' }, { status: 404 });
    state.activeSessionId = s.status === 'closed' ? state.activeSessionId : s.id;
    return HttpResponse.json(s);
  }),
  http.patch('/api/sessions/:id', async ({ params, request }) => {
    if (!authed()) return unauthorized();
    const s = sessions.find((x) => x.id === params.id);
    if (!s) return HttpResponse.json({ code: 'not_found' }, { status: 404 });
    const { notes } = (await request.json()) as { notes: string };
    s.notes = notes;
    return HttpResponse.json(s);
  }),
  http.post('/api/sessions/:id/close', ({ params }) => {
    if (!authed()) return unauthorized();
    const s = sessions.find((x) => x.id === params.id);
    if (!s) return HttpResponse.json({ code: 'not_found' }, { status: 404 });
    s.status = 'closed';
    s.closedAt = new Date().toISOString();
    if (state.activeSessionId === s.id) state.activeSessionId = null;
    return HttpResponse.json(s);
  }),

  http.get('/api/orders', ({ request }) => {
    if (!authed()) return unauthorized();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    let items: Order[] = orders;
    if (status) items = items.filter((o) => o.status === status);
    return HttpResponse.json(page(items, Number(url.searchParams.get('page') ?? 1)));
  }),
  http.get('/api/orders/:id', ({ params }) => {
    if (!authed()) return unauthorized();
    const o = orders.find((x) => x.id === params.id);
    return o ? HttpResponse.json(o) : HttpResponse.json({ code: 'not_found' }, { status: 404 });
  }),
  http.post('/api/orders/:id/approve', ({ params }) => {
    if (!authed()) return unauthorized();
    const o = orders.find((x) => x.id === params.id);
    if (!o) return HttpResponse.json({ code: 'not_found' }, { status: 404 });
    if (o.status !== 'pending') return HttpResponse.json({ code: 'conflict' }, { status: 409 });
    o.status = 'approved';
    return HttpResponse.json(o);
  }),
  http.post('/api/orders/:id/reject', ({ params }) => {
    if (!authed()) return unauthorized();
    const o = orders.find((x) => x.id === params.id);
    if (!o) return HttpResponse.json({ code: 'not_found' }, { status: 404 });
    if (o.status !== 'pending') return HttpResponse.json({ code: 'conflict' }, { status: 409 });
    o.status = 'rejected';
    return HttpResponse.json(o);
  }),
];
