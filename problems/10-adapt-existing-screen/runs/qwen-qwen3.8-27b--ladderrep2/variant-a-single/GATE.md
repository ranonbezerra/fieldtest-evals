$ pnpm install -> 0
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +234
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 234, reused 234, downloaded 0, added 234, done

dependencies:
+ @tanstack/react-query 5.102.8
+ react 18.3.1
+ react-dom 18.3.1
+ react-router-dom 6.30.6

devDependencies:
+ @testing-library/jest-dom 6.10.0
+ @testing-library/react 16.3.3
+ @testing-library/user-event 14.6.6
+ @types/react 18.3.31
+ @types/react-dom 18.3.7
+ @vitejs/plugin-react 4.7.0
+ jsdom 25.0.1
+ msw 2.15.0
+ typescript 5.9.3
+ vite 5.4.21
+ vitest 2.1.9

Done in 812ms using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 2
src/features/sessions/ActiveSessionBar.test.tsx(129,67): error TS2314: Generic type 'HttpResponse<BodyType>' requires 1 type argument(s).
src/features/sessions/queries.ts(22,5): error TS2769: No overload matches this call.
  Overload 1 of 3, '(options: DefinedInitialDataOptions<unknown, Error, unknown, readonly ["sessions", "detail", string]>, queryClient?: QueryClient | undefined): DefinedUseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'DefinedInitialDataOptions<unknown, Error, unknown, readonly ["sessions", "detail", string]>'.
  Overload 2 of 3, '(options: UndefinedInitialDataOptions<Session, Error, Session, readonly ["sessions", "detail", string]>, queryClient?: QueryClient | undefined): UseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UndefinedInitialDataOptions<Session, Error, Session, readonly ["sessions", "detail", string]>'.
  Overload 3 of 3, '(options: UseQueryOptions<Session, Error, Session, readonly ["sessions", "detail", string]>, queryClient?: QueryClient | undefined): UseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UseQueryOptions<Session, Error, Session, readonly ["sessions", "detail", string]>'.
src/features/sessions/queries.ts(22,17): error TS7006: Parameter 'session' implicitly has an 'any' type.
src/features/sessions/SessionDetailScreen.tsx(18,35): error TS2339: Property 'notes' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(23,52): error TS18047: 'session' is possibly 'null'.
src/features/sessions/SessionDetailScreen.tsx(23,60): error TS2339: Property 'notes' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(32,20): error TS2339: Property 'name' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(33,28): error TS2339: Property 'status' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(33,45): error TS2339: Property 'status' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(50,29): error TS2339: Property 'status' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(65,39): error TS2339: Property 'id' does not exist on type '{}'.


$ tsc --noEmit (attempt 1) -> 0

