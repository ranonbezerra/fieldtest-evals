# repair2-handlers.ts

## reasoning

```
Let me analyze the compiler errors that specifically relate to `src/mocks/handlers.ts`:

1. `src/mocks/handlers.ts(1,36): error TS2307: Cannot find module 'msw' or its corresponding type declarations.`
2. `src/mocks/h
```

## reply

```typescript
import { http, HttpResponse } from 'msw';

const sessions = [
  { id: 's-1', name: 'Onboarding call', status: 'active', startedAt: '2025-01-10T09:00:00Z', notes: '' },
  { id: 's-2', name: 'Follow-up review', status: 'active', startedAt: '2025-01-10T10:00:00Z', notes: '' },
];

export const handlers = [
  http.get('/api/sessions', () => {
    return HttpResponse.json(sessions);
  }),

  http.get('/api/sessions/active', () => {
    return HttpResponse.json(sessions[0]);
  }),

  http.get('/api/sessions/:id', ({ params }) => {
    const session = sessions.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ error: { code: 'resource_not_found', message: 'Session not found', details: {} } }, { status: 404 });
    return HttpResponse.json(session);
  }),

  http.patch('/api/sessions/:id', async ({ params, request }) => {
    const session = sessions.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ error: { code: 'resource_not_found', message: 'Session not found', details: {} } }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(session, body);
    return HttpResponse.json(session);
  }),

  http.post('/api/sessions/:id/close', ({ params }) => {
    const session = sessions.find((s) => s.id === params.id);
    if (!session) return HttpResponse.json({ error: { code: 'resource_not_found', message: 'Session not found', details: {} } }, { status: 404 });
    session.status = 'closed';
    return HttpResponse.json(session);
  }),

  http.post('/api/logout', () => {
    return HttpResponse.json({ ok: true });
  }),
];
```
