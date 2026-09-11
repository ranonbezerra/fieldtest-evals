# repair1-set

## reasoning

```
Let me look at the errors carefully. They're all in `src/features/sessions/ActiveSessionBar.test.tsx` at line 162.

Let me look at the file content provided in the reference:

Line 162 would be in the test file. Let me count the lines...

Actually, let me look at the file more carefully. The file is provided in full. Let me count lines to find line 162.

Looking at the file:
```
1: import { screen, waitFor, within } from '@testing-library/react';
2: import userEvent from '@testing-library/user-event';
3: import { HttpResponse, http } from 'msw';
4: import { describe, expect, it } from 'vitest';
5: import { sessions, state } from '../../mocks/db';
6: import { server } from '../../mocks/server';
7: import { renderApp, renderWithProviders } from '../../test/render';
8: import { ActiveSessionBar } from './ActiveSessionBar';
9: 
10: const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };
11: 
12: function activeBar() {
13:   return screen.getByRole('region', { name: 'Active session' });
14: }
15: 
16: describe('ActiveSessionBar', () => {
17:   it('shows the active session on another screen, and resume goes to its detail', async () => {
18:     state.user = OPERATOR;
19:     state.activeSessionId = 's-001';
20:     renderApp('/orders');
21: 
22:     const bar = await screen.findByRole('region', { name: 'Active session' });
23:     expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
24:     expect(within(bar).getByText('open')).toBeInTheDocument();
25:     expect(within(bar).getByText(/Active for \d+d \d+h \d+m \d+s/)).toBeInTheDocument();
26: 
27:     await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
28:     await screen.findByRole('heading', { name: 'Inspection 1' });
29:   });
30: 
31:   it('ticks the elapsed time on its own', async () => {
32:     state.user = OPERATOR;
33:     state.activeSessionId = 's-002';
34:     renderWithProviders(<ActiveSessionBar />);
35: 
36:     const readElapsed = () => screen.queryByText(/Active for \d+d \d+h \d+m \d+s/)?.textContent ?? '';
37:     const before = await waitFor(() => {
38:       const text = readElapsed();
39:       expect(text).not.toBe('');
40:       return text;
41:     });
42: 
43:     await new Promise((r) => setTimeout(r, 2_200));
44:     expect(readElapsed()).not.toBe(before);
45:   });
46: 
47:   it('closes the active session behind a confirm and empties the bar on success', async () => {
48:     state.user = OPERATOR;
49:     state.activeSessionId = 's-004';
50:     const row = sessions.find((s) => s.id === 's-004')!;
51:     renderApp('/sessions');
52: 
53:     const bar = await screen.findByRole('region', { name: 'Active session' });
54:     expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
55: 
56:     // Cancel first: nothing changes.
57:     await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
58:     const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
59:     await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
60:     expect(activeBar()).toBeInTheDocument();
61: 
62:     // Confirm: the endpoint is called and the bar empties.
63:     await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
64:     const secondDialog = await screen.findByRole('dialog', { name: 'Close this session?' });
65:     await userEvent.click(within(secondDialog).getByRole('button', { name: 'Close session' }));
66: 
67:     await waitFor(() =>
68:       expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
69:     );
70:     expect(row.status).toBe('closed');
71:     expect(row.closedAt).not.toBeNull();
72: 
73:     row.status = 'open';
74:     row.closedAt = null;
75:   });
76: 
77:   it('confirms before a session with unsaved notes is replaced by another', async () => {
78:     state.user = OPERATOR;
79:     state.activeSessionId = 's-001';
80:     renderApp('/sessions/s-001');
81: 
82:     await screen.findByRole('heading', { name: 'Inspection 1' });
83:     await screen.findByRole('region', { name: 'Active session' });
84: 
85:     // Dirty it: the detail screen's own flag, no second source of truth.
86:     await userEvent.type(screen.getByLabelText('Notes'), 'checking the belt');
87: 
88:     // Leaving the detail is the only way to open another session: the dirty
89:     // flag must gate it.
90:     await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
91:     await screen.findByText('Leave with unsaved notes?');
92: 
93:     await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
94:     await screen.findByRole('heading', { name: 'Sessions' });
95:     // Leaving did not end the session: it is still the active one.
96:     expect(within(activeBar()).getByText('Inspection 1')).toBeInTheDocument();
97: 
98:     // Opening another session replaces it (no second confirm: the notes were
99:     // consciously discarded above).
100:    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
101:    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
102:  });
103:
104:  it('replaces the active session without a confirm when nothing is unsaved', async () => {
105:    state.user = OPERATOR;
106:    state.activeSessionId = 's-001';
107:    renderApp('/sessions/s-001');
108:
109:    await screen.findByRole('heading', { name: 'Inspection 1' });
110:    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
111:    expect(screen.queryByText('Leave with unsaved notes?')).not.toBeInTheDocument();
112:    await screen.findByRole('heading', { name: 'Sessions' });
113:
114:    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
115:    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
116:  });
117:
118:  it('brings the bar back from GET /sessions/active after a full reload', async () => {
119:    state.user = OPERATOR;
120:    state.activeSessionId = null;
121:    const beforeReload = renderApp('/sessions');
122:
123:    await userEvent.click(await screen.findByRole('link', { name: 'Inspection 1' }));
124:    await screen.findByRole('region', { name: 'Active session' });
125:    beforeReload.unmount();
126:
127:    // A fresh client: a new query cache, the same server. The bar must come
128:    // back from the API, not from anything the first client kept.
129:    renderApp('/sessions');
130:    const bar = await screen.findByRole('region', { name: 'Active session' });
131:    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
132:  });
133:
134:  it('makes a deep-linked detail session active', async () => {
135:    state.user = OPERATOR;
136:    state.activeSessionId = null;
137:    renderApp('/sessions/s-004');
138:
139:    await screen.findByRole('heading', { name: 'Inspection 4' });
140:    const bar = await screen.findByRole('region', { name: 'Active session' });
141:    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
142:  });
143:
144:  it('shows a pending state while the active session is still loading', async () => {
145:    state.user = OPERATOR;
146:    state.activeSessionId = 's-001';
147:    server.use(http.get('/api/sessions/active', () => new Promise<never>(() => {})));
148:    renderApp('/sessions');
149:
150:    await screen.findByText('Loading active session…');
151:    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
152:  });
153:
154:  it('shows a failed fetch as an error, not as "no active session"', async () => {
155:    state.user = OPERATOR;
156:    state.activeSessionId = 's-001';
157:    server.use(
158:      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
159:    );
160:    renderApp('/sessions');
161:
162:    await screen.findByText('Couldn't load the active session.');
163:    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
164:  });
165:
166:  it('is absent on the login screen', async () => {
167:    state.user = null;
168:    renderApp('/login');
169:
170:    await screen.findByRole('button', { name: 'Sign in' });
171:    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
172:    expect(screen.queryByText(/Active for/)).not.toBeInTheDocument();
173:  });
174:
175:  it('is cleared by logout', async () => {
176:    state.user = OPERATOR;
177:    state.activeSessionId = 's-001';
178:    renderApp('/sessions');
179:
180:    await screen.findByRole('region', { name: 'Active session' });
181:    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
182:
183:    await screen.findByRole('button', { name: 'Sign in' });
184:    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
185:  });
186:});
```

Line 162: `    await screen.findByText('Couldn't load the active session.');`

The problem is clear: the string `'Couldn't load the active session.'` contains an unescaped single quote (`'` in "Couldn't"). This breaks the string literal.

The fix is to escape the apostrophe: `'Couldn\'t load the active session.'`

Or use double quotes: `"Couldn't load the active session."`

Let me go with the escaped version since the rest of the file uses single quotes.

Wait, let me look at the errors more carefully:
- (162,37): ',' expected — this is at the `t` in `Couldn't`
- (162,39): ',' expected
- (162,44): ',' expected
- (162,48): ',' expected
- (162,55): ',' expected
- (162,63): Identifier expected
- (162,66): Unterminated string literal
- (163,5): ',' expected
- (163,93): ')' expected

Yes, the issue is the unescaped apostrophe in `Couldn't`. The string starts with `'`, then at `Couldn` the `'` is interpreted as closing the string, then `t` is an unexpected identifier, etc.

The fix: change `'Couldn't load the active session.'` to `'Couldn\'t load the active session.'`

This is a single distinct mistake in one file. Let me write the complete file with that fix.
```

## reply

Looking at the errors, they're all on line 162:

```
await screen.findByText('Couldn't load the active session.');
```

The apostrophe in `Couldn't` terminates the string literal prematurely. There is **one** distinct mistake: an unescaped single quote inside a single-quoted string.

### src/features/sessions/ActiveSessionBar.test.tsx
```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { sessions, state } from '../../mocks/db';
import { server } from '../../mocks/server';
import { renderApp, renderWithProviders } from '../../test/render';
import { ActiveSessionBar } from './ActiveSessionBar';

const OPERATOR = { id: 'u-1', name: 'Ada', roles: ['operator'] };

function activeBar() {
  return screen.getByRole('region', { name: 'Active session' });
}

describe('ActiveSessionBar', () => {
  it('shows the active session on another screen, and resume goes to its detail', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/orders');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
    expect(within(bar).getByText('open')).toBeInTheDocument();
    expect(within(bar).getByText(/Active for \d+d \d+h \d+m \d+s/)).toBeInTheDocument();

    await userEvent.click(within(bar).getByRole('button', { name: 'Resume' }));
    await screen.findByRole('heading', { name: 'Inspection 1' });
  });

  it('ticks the elapsed time on its own', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-002';
    renderWithProviders(<ActiveSessionBar />);

    const readElapsed = () => screen.queryByText(/Active for \d+d \d+h \d+m \d+s/)?.textContent ?? '';
    const before = await waitFor(() => {
      const text = readElapsed();
      expect(text).not.toBe('');
      return text;
    });

    await new Promise((r) => setTimeout(r, 2_200));
    expect(readElapsed()).not.toBe(before);
  });

  it('closes the active session behind a confirm and empties the bar on success', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-004';
    const row = sessions.find((s) => s.id === 's-004')!;
    renderApp('/sessions');

    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();

    // Cancel first: nothing changes.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(activeBar()).toBeInTheDocument();

    // Confirm: the endpoint is called and the bar empties.
    await userEvent.click(within(bar).getByRole('button', { name: 'Close session' }));
    const secondDialog = await screen.findByRole('dialog', { name: 'Close this session?' });
    await userEvent.click(within(secondDialog).getByRole('button', { name: 'Close session' }));

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument(),
    );
    expect(row.status).toBe('closed');
    expect(row.closedAt).not.toBeNull();

    row.status = 'open';
    row.closedAt = null;
  });

  it('confirms before a session with unsaved notes is replaced by another', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    await screen.findByRole('region', { name: 'Active session' });

    // Dirty it: the detail screen's own flag, no second source of truth.
    await userEvent.type(screen.getByLabelText('Notes'), 'checking the belt');

    // Leaving the detail is the only way to open another session: the dirty
    // flag must gate it.
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    await screen.findByText('Leave with unsaved notes?');

    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { name: 'Sessions' });
    // Leaving did not end the session: it is still the active one.
    expect(within(activeBar()).getByText('Inspection 1')).toBeInTheDocument();

    // Opening another session replaces it (no second confirm: the notes were
    // consciously discarded above).
    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('replaces the active session without a confirm when nothing is unsaved', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions/s-001');

    await screen.findByRole('heading', { name: 'Inspection 1' });
    await userEvent.click(screen.getByRole('link', { name: 'Sessions' }));
    expect(screen.queryByText('Leave with unsaved notes?')).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Sessions' });

    await userEvent.click(screen.getByRole('link', { name: 'Inspection 4' }));
    await waitFor(() => expect(within(activeBar()).getByText('Inspection 4')).toBeInTheDocument());
  });

  it('brings the bar back from GET /sessions/active after a full reload', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    const beforeReload = renderApp('/sessions');

    await userEvent.click(await screen.findByRole('link', { name: 'Inspection 1' }));
    await screen.findByRole('region', { name: 'Active session' });
    beforeReload.unmount();

    // A fresh client: a new query cache, the same server. The bar must come
    // back from the API, not from anything the first client kept.
    renderApp('/sessions');
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 1')).toBeInTheDocument();
  });

  it('makes a deep-linked detail session active', async () => {
    state.user = OPERATOR;
    state.activeSessionId = null;
    renderApp('/sessions/s-004');

    await screen.findByRole('heading', { name: 'Inspection 4' });
    const bar = await screen.findByRole('region', { name: 'Active session' });
    expect(within(bar).getByText('Inspection 4')).toBeInTheDocument();
  });

  it('shows a pending state while the active session is still loading', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(http.get('/api/sessions/active', () => new Promise<never>(() => {})));
    renderApp('/sessions');

    await screen.findByText('Loading active session…');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('shows a failed fetch as an error, not as "no active session"', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    server.use(
      http.get('/api/sessions/active', () => HttpResponse.json({ code: 'boom' }, { status: 500 })),
    );
    renderApp('/sessions');

    await screen.findByText('Couldn\'t load the active session.');
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });

  it('is absent on the login screen', async () => {
    state.user = null;
    renderApp('/login');

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Active for/)).not.toBeInTheDocument();
  });

  it('is cleared by logout', async () => {
    state.user = OPERATOR;
    state.activeSessionId = 's-001';
    renderApp('/sessions');

    await screen.findByRole('region', { name: 'Active session' });
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByRole('region', { name: 'Active session' })).not.toBeInTheDocument();
  });
});
```
