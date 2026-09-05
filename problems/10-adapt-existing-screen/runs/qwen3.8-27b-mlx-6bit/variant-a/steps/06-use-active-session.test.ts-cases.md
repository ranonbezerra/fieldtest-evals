# 06-use-active-session.test.ts-cases

## reasoning

```
The user wants me to list test cases for `test/use-active-session.test.ts` based on the PLAN.md and the implementation files shown. I need to produce one line per test case in the specified format, covering behavior that matters, naming what would have to break for each to fail.

Let me analyze the implementation of `useActiveSession`:

1. **Query (GET /api/sessions/active)**:
   - Fetches on mount
   - Returns `ActiveSession | null`
   - On non-OK response, parses error envelope and throws `ApiError`
   - On OK response, parses JSON and returns it (or null)

2. **setActive mutation (PUT /api/sessions/active)**:
   - Sends `{ sessionId }` in body with JSON content-type
   - On success, invalidates the active session query
   - On error, parses error envelope and throws `ApiError`

3. **closeActive mutation (POST /api/sessions/:id/close)**:
   - Uses `active.id` from the query state
   - If no active session, throws `ApiError('no_active_session', ...)`
   - On success, invalidates the active session query
   - On error, parses error envelope and throws `ApiError`

4. **Return shape**:
   - `active: ActiveSession | null` (coalesced with `?? null`)
   - `isFetching: boolean`
   - `setActive: (sessionId: string) => Promise<void>`
   - `closeActive: () => Promise<void>`
   - `isMutating: boolean` (OR of both mutations)

Now let me think about what test cases would be meaningful:

**Query behavior:**
- Returns null when GET resolves with null (no active session)
- Returns populated ActiveSession when GET resolves with a session object
- Propagates ApiError with correct code on non-OK GET response
- `isFetching` is true during initial fetch, false after

**setActive behavior:**
- Sends PUT with correct URL, method, body `{ sessionId }`, content-type header
- On success, invalidates/refetches the active session query (active updates)
- On 404/error, rejects with ApiError having code `session_not_found`
- On network error (non-JSON body), still produces an ApiError (fallback code)

**closeActive behavior:**
- Sends POST to `/api/sessions/:id/close` with the active session's id
- On success, invalidates/refetches → active becomes null
- On error (e.g., 409), rejects with `session_already_closed`
- When no active session, rejects immediately with `no_active_session` (no fetch call)

**Return shape / edge cases:**
- `isMutating` is true while setActive is in flight, false after
- `isMutating` is true while closeActive is in flight, false after
- Both mutations in flight → `isMutating` is true (at least one)

**Error envelope parsing:**
- Correctly extracts code, message, details from the standard error envelope
- Handles non-JSON body gracefully (fallback to `unknown_error`)
- Handles missing fields in the error object

**Concurrency / race conditions:**
- Calling setActive twice rapidly: second call should still work (or the first is overwritten)
- Actually, react-query mutations don't deduplicate by default. Two concurrent setActive calls would both fire. The test might verify that the final state reflects the last one.
- closeActive called while active is null (stale closure) — actually the implementation reads `active` from the closure at call time. If active becomes null between render and click, it would throw `no_active_session`.

**Boundary / awkward cases:**
- GET returns 200 with `{}` (empty object) — would that be treated as an ActiveSession? The code does `(json as ActiveSession | null) ?? null`. An empty object is not null/undefined, so it would pass through as an "ActiveSession" with all undefined fields. This is a potential issue but maybe not what we test here.
- GET returns 200 with `null` explicitly vs `undefined` in JSON — both should yield `active: null`.
- setActive with an empty string id — does the API handle it? The test would verify the fetch is called with `{ sessionId: '' }`.
- Error envelope where `error` field is present but not an object (e.g., a string) — the code checks `typeof (body as Record<string, unknown>).error === 'object'`. If it's a string, it falls through to defaults.

**What I should NOT test:**
- UI rendering (that's `active-session-bar.test.tsx`)
- Navigation behavior
- Dirty flag interaction (that's session-detail tests)
- React Query internals (we test through the hook's public API)

Let me structure the list now:

1. `returns null active when GET /sessions/active resolves with null` — proves the hook correctly represents "no active session" state; would fail if the code didn't coalesce null/undefined to null, or if it threw on a 200-with-null response.

2. `populates active with all fields when GET /sessions/active resolves with a session object` — proves the query data flows through to the `active` return value intact; would fail if a field was renamed, dropped, or the queryFn returned the Response object instead of parsed JSON.

3. `exposes isFetching as true during initial fetch and false after resolution` — proves the loading indicator can be driven by the hook; would fail if `isFetching` was hardcoded, or if the query key was wrong so the fetch never triggered.

4. `rejects setActive with ApiError code "session_not_found" on 404 response` — proves the error contract is honored for invalid session ids; would fail if the error envelope was not parsed, if the code was lowercased/uppercased differently, or if the mutation resolved instead of rejecting.

5. `sends PUT to /api/sessions/active with JSON body { sessionId } and correct content-type header` — proves the wire protocol matches the API contract; would fail if the method was GET, the path was wrong, the body key was `id` instead of `sessionId`, or content-type was missing.

6. `invalidates and refetches active session after successful setActive` — proves the bar updates to show the new session without a manual refresh; would fail if `onSuccess` was missing, used the wrong query key, or only called `queryClient.setQueryData` without a refetch.

7. `rejects closeActive with ApiError code "no_active_session" when active is null` — proves the guard clause prevents a fetch to `/api/sessions/undefined/close`; would fail if the guard was removed, if `active.id` was accessed before the null check, or if the error code differed.

8. `sends POST to /api/sessions/:id/close using the active session's id` — proves the correct endpoint is targeted with the right id; would fail if the path template was wrong (e.g., query param instead of path param), if the id came from a stale closure, or if the method was PUT.

9. `invalidates and refetches after successful closeActive, resulting in active becoming null` — proves the bar empties after close; would fail if the invalidation used a different query key, or if the refetch didn't actually re-GET the endpoint.

10. `rejects closeActive with ApiError code "session_already_closed" on 409 response` — proves the error contract for double-close; would fail if the error was swallowed, the code was wrong, or the mutation resolved on non-OK.

11. `sets isMutating to true while setActive is in flight and false after completion` — proves the UI can disable buttons during mutation; would fail if `isMutating` was always false, or only tracked one of the two mutations.

12. `sets isMutating to true while closeActive is in flight and false after completion` — proves the close path also drives the mutating flag; would fail if only `setActiveMutation.isMutating` was checked.

13. `produces a fallback ApiError with code "unknown_error" when the error response body is not JSON` — proves graceful degradation on malformed error responses; would fail if `parseErrorEnvelope` threw on non-JSON, or if the fallback code was something else.

14. `parses code, message, and details from a well-formed error envelope` — proves the standard `{ error: { code, message, details } }` contract is correctly extracted; would fail if any field was read from the wrong nesting level, or if `details` defaulted to undefined instead of `{}`.

15. `handles an error envelope where the "error" field is a string instead of an object` — proves the defensive type check prevents a crash on malformed responses; would fail if the code unconditionally accessed `body.error.code` without the `typeof === 'object'` guard.

16. `setActive resolves successfully on a 200 response with no body` — proves the success path doesn't require a response body; would fail if `queryFn` or `mutationFn` called `.json()` unconditionally on the success path.

Wait, actually looking at the code more carefully:

The `setActive` mutation's `mutationFn` is:
```ts
const res = await fetch('/api/sessions/active', { method: 'PUT', ... });
if (!res.ok) throw await parseErrorEnvelope(res);
```

It doesn't call `res.json()` on success. Good. So a 204 or empty 200 would work.

The `closeActive` mutation's `mutationFn` is:
```ts
if (active === null) throw new ApiError('no_active_session', ...);
const res = await fetch(`/api/sessions/${active.id}/close`, { method: 'POST', ... });
if (!res.ok) throw await parseErrorEnvelope(res);
```

Same — no `.json()` on success.

The query's `queryFn` IS:
```ts
const res = await fetch('/api/sessions/active', { credentials: 'include' });
if (!res.ok) throw await parseErrorEnvelope(res);
const json: unknown = await res.json();
return (json as ActiveSession | null) ?? null;
```

This DOES call `.json()`. So a 204 on GET would throw. But the API contract says GET returns JSON (either an object or null), so this is fine.

Let me also think about:
- What if `active` is non-null but has a `startedAt` that's not parseable? That's more of a bar concern, not hook concern.
- What about `credentials: 'include'` — should we test that? It's a detail of the fetch config. I'll include one case for it since auth depends on it.

Actually, let me reconsider. The task says "One line per case, in this shape." Let me be precise about what each proves and what would break.

Let me also think about whether I should include a test for `isFetching` being false initially (before the query starts). Actually in react-query, on first render `isFetching` is true immediately (the query is in "pending" state). So it's always true from the start. The meaningful test is that it becomes false after resolution.

Let me finalize my list. I'll aim for ~15-18 cases that cover all branches.
```

## reply

- `returns null when GET /sessions/active resolves 200 with body null` — proves the "no active session" state is represented as `active: null`, not as an empty object or undefined; would fail if the queryFn returned the parsed JSON without the `?? null` coalescing, or if a 200-with-null was treated as an error.

- `returns the full ActiveSession object (id, name, status, startedAt) when GET /sessions/active resolves 200 with a session` — proves every field the bar needs flows through the hook intact; would fail if a field was renamed in the interface, dropped by a transform, or the queryFn returned the `Response` instead of `await res.json()`.

- `exposes isFetching true during the initial GET and false once it settles` — proves the layout can show a skeleton/indicator while restoring state after a page refresh; would fail if `isFetching` was hardcoded to false, the query key was mistyped so the fetch never fired, or the hook returned a stale `isFetching` from a prior render.

- `sends PUT to /api/sessions/active with Content-Type application/json and body { "sessionId": "<id>" }` — proves the wire contract (method, path, header, key name) matches what the server expects; would fail if the method was POST, the path lacked the `/api` prefix, the body key was `id` instead of `sessionId`, or the JSON header was omitted causing a 415.

- `includes credentials: "include" on every fetch call` — proves cookie-based auth is preserved across all requests; would fail if the option was dropped from one of the three fetch sites, silently breaking auth in a cross-origin or subpath deployment.

- `rejects setActive with ApiError whose code is "session_not_found" when the server responds 404` — proves the error contract for an invalid or deleted session id; would fail if `parseErrorEnvelope` was not called, the mutation resolved on non-OK status, or the code string differed (e.g. `SESSION_NOT_FOUND`).

- `rejects closeActive with ApiError whose code is "session_already_closed" when the server responds 409` — proves the double-close guard surfaces the correct code to the caller; would fail if the non-OK path was skipped for POST, or the envelope parser read `body.code` instead of `body.error.code`.

- `rejects closeActive with ApiError code "no_active_session" and does not issue a fetch when active is null` — proves the guard clause prevents a request to `/api/sessions/undefined/close`; would fail if the null check was removed, placed after the fetch, or if `active.id` was accessed before the guard causing a TypeError instead of a controlled ApiError.

- `invalidates and refetches the active-session query after successful setActive so active updates to the new session` — proves the bar reflects the newly-active session without a full page reload; would fail if `onSuccess` was missing, used a different query key (e.g. `['sessions']` without `'active'`), or called `setQueryData` with a stale snapshot instead of triggering a refetch.

- `invalidates and refetches after successful closeActive so active becomes null` — proves the bar empties on close; would fail if the invalidation key was wrong, or if only `setQueryData(key, null)` was called without a refetch (leaving the server's truth unverified).

- `sets isMutating to true while setActive is in flight and false once the promise settles (success or error)` — proves the UI can disable buttons and prevent double-submits during activation; would fail if `isMutating` was always false, only tracked `closeMutation`, or remained true after a rejected mutation.

- `sets isMutating to true while closeActive is in flight and false once settled` — proves the close path independently drives the mutating flag; would fail if `setActiveMutation.isMutating` was the only term in the OR, or if the flag reset happened before the promise actually resolved.

- `parses code, message, and details from a well-formed { error: { code, message, details } } envelope` — proves the standard error shape is correctly unpacked into the ApiError fields; would fail if the parser read `body.code` instead of `body.error.code`, or if `details` defaulted to `undefined` instead of `{}`.

- `produces a fallback ApiError with code "unknown_error" when the error response body is not valid JSON` — proves graceful degradation when the server returns a plain-text 500 or an HTML error page; would fail if `res.json()` threw an unhandled exception inside `parseErrorEnvelope`, or if the catch block re-threw instead of returning a default ApiError.

- `handles an error envelope where the top-level "error" field is a string rather than an object without throwing` — proves the defensive `typeof === 'object'` guard prevents a TypeError on malformed responses; would fail if the code unconditionally accessed `body.error.code` and crashed, or if the guard was `instanceof Object` which misses frozen/sealed objects.

- `returns active as null (not undefined) when the query has not yet resolved and data is in its initial state` — proves consumers can rely on a stable `null | ActiveSession` type without optional chaining or undefined checks; would fail if the hook returned `data` directly (which is `undefined` before first fetch) instead of `data ?? null`.

- `resolves setActive (does not reject) when the server responds 204 No Content` — proves the success path does not unconditionally call `res.json()` and crash on an empty body; would fail if the mutationFn parsed the response body on success.

Not testing: UI rendering or DOM interactions (covered by `active-session-bar.test.tsx`), navigation side-effects, dirty-flag interaction with the detail screen (covered by session-detail tests), react-query retry/caching internals (framework concern, not hook logic), or the server's own behaviour on `PUT /sessions/active` (integration, not unit).
