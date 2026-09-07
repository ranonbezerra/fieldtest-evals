
The first line is truncated: `d member named 'useOrder'. Did you mean 'useOrders'?` — this looks like it's the tail end of an error from some file, likely `src/features/orders/OrderDetailScreen.tsx` or similar. The full message would be something like `error TS2305: Module '"./queries"' has no exported member named 'useOrder'. Did you mean 'useOrders'?`

Now, the key question: **Are any of these errors in `src/auth/auth-context.tsx`?**

Looking through every single error message... **None of them reference `src/auth/auth-context.tsx`**. The errors are in:
- `src/features/orders/OrderDetailScreen.tsx`
- `src/features/orders/OrdersListScreen.tsx`
- `src/features/orders/queries.ts`
- `src/features/sessions/queries.ts`
- `src/features/sessions/SessionDetailScreen.tsx`
- `src/features/sessions/SessionsListScreen.test.tsx`
- `src/features/sessions/SessionsListScreen.tsx`
- `src/mocks/browser.ts`
- `src/mocks/handlers.ts`
- `src/mocks/server.ts`

The first line is truncated but it's clearly about a `useOrder` vs `useOrders` export mismatch, likely in `src/features/orders/OrderDetailScreen.tsx`.

So the task says: "Rewrite `src/auth/auth-context.tsx` complete, fixing what these messages require of this file."

But none of the compiler messages reference `src/auth/auth-context.tsx`. The instruction says "Change nothing the messages do not name."

Since no error message names `src/auth/auth-context.tsx`, the file doesn't need to be changed based on these compiler errors. But the user is asking me to rewrite it "complete" — meaning they want me to produce the complete file content.

Wait, let me re-read: "Rewrite `src/auth/auth-context.tsx` complete, fixing what these messages require of this file."

The key phrase is "fixing what these messages require of this file." Since none of the messages reference this file, there's nothing to fix. But the user still wants me to produce the complete file.

The problem is: I don't have the content of `src/auth/auth-context.tsx`. I need to infer what it should contain based on the context:

From the variant description:
- It's a React + TS app with react-query and router
- There's a login screen, sessions list, session detail
- There's an auth context (login/logout)
- "logout clearing all state" is an existing behavior that must not regress

From the errors, I can see:
- `src/features/sessions/queries.ts` imports `get`, `post`, `patch` from `../../api/client`
- The app uses react-query (useQuery, useMutation patterns)
- There's an `api/client` module

Since no compiler error references `src/auth/auth-context.tsx`, and the instruction says "Change nothing the messages do not name," I should produce a file that is consistent with the rest of the codebase but doesn't need any specific changes from these errors.

Actually wait — I need to think about this more carefully. The user says "Rewrite `src/auth/auth-context.tsx` complete, fixing what these messages require of this file." If the messages don't require anything of this file, then I should just produce a reasonable complete file. But I don't have the original content...

Let me think about what a typical auth context would look like in this codebase:

1. It provides an `AuthContext` with user state and login/logout functions
2. It likely uses the API client to authenticate
3. It provides a `useAuth()` hook
4. Logout should clear all state (react-query cache, etc.)

Given the codebase structure and conventions:
- TypeScript strict
- ESM
- React with hooks
- react-query for data fetching
- The API client is at `../../api/client` (from the features perspective, so from auth it would be `../api/client`)

Wait, the layout is:
