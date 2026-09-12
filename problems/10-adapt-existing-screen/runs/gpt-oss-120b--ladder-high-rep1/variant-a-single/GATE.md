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

Done in 769ms using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 2
src/features/sessions/ActiveSessionBar.test.tsx(47,29): error TS2345: Argument of type 'Element' is not assignable to parameter of type 'HTMLElement'.
  Type 'Element' is missing the following properties from type 'HTMLElement': accessKey, accessKeyLabel, autocapitalize, autocorrect, and 129 more.
src/features/sessions/queries.ts(27,5): error TS2769: No overload matches this call.
  Overload 1 of 3, '(options: DefinedInitialDataOptions<unknown, Error, unknown, readonly ["sessions", "detail", string]>, queryClient?: QueryClient | undefined): DefinedUseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'DefinedInitialDataOptions<unknown, Error, unknown, readonly ["sessions", "detail", string]>'.
  Overload 2 of 3, '(options: UndefinedInitialDataOptions<Session, Error, Session, readonly ["sessions", "detail", string]>, queryClient?: QueryClient | undefined): UseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UndefinedInitialDataOptions<Session, Error, Session, readonly ["sessions", "detail", string]>'.
  Overload 3 of 3, '(options: UseQueryOptions<Session, Error, Session, readonly ["sessions", "detail", string]>, queryClient?: QueryClient | undefined): UseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UseQueryOptions<Session, Error, Session, readonly ["sessions", "detail", string]>'.
src/features/sessions/queries.ts(27,17): error TS7006: Parameter 'data' implicitly has an 'any' type.
src/features/sessions/SessionDetailScreen.tsx(18,35): error TS2339: Property 'notes' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(23,52): error TS18047: 'session' is possibly 'null'.
src/features/sessions/SessionDetailScreen.tsx(23,60): error TS2339: Property 'notes' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(32,20): error TS2339: Property 'name' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(33,28): error TS2339: Property 'status' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(33,45): error TS2339: Property 'status' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(50,29): error TS2339: Property 'status' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(65,39): error TS2339: Property 'id' does not exist on type '{}'.


$ tsc --noEmit (attempt 1) -> 2
src/features/sessions/queries.ts(27,5): error TS2769: No overload matches this call.
  Overload 1 of 3, '(options: DefinedInitialDataOptions<Session, Error, Session, readonly unknown[]>, queryClient?: QueryClient | undefined): DefinedUseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'DefinedInitialDataOptions<Session, Error, Session, readonly unknown[]>'.
  Overload 2 of 3, '(options: UndefinedInitialDataOptions<Session, Error, Session, readonly unknown[]>, queryClient?: QueryClient | undefined): UseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UndefinedInitialDataOptions<Session, Error, Session, readonly unknown[]>'.
  Overload 3 of 3, '(options: UseQueryOptions<Session, Error, Session, readonly unknown[]>, queryClient?: QueryClient | undefined): UseQueryResult<Session, Error>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UseQueryOptions<Session, Error, Session, readonly unknown[]>'.


$ tsc --noEmit (attempt 2) -> 2
src/features/sessions/queries.ts(16,5): error TS2769: No overload matches this call.
  Overload 1 of 3, '(options: DefinedInitialDataOptions<Session[], unknown, Session[], readonly unknown[]>, queryClient?: QueryClient | undefined): DefinedUseQueryResult<Session[], unknown>', gave the following error.
    Type '() => Promise<Page<Session>>' is not assignable to type 'QueryFunction<Session[], readonly unknown[]>'.
      Type 'Promise<Page<Session>>' is not assignable to type 'Session[] | Promise<Session[]>'.
        Type 'Promise<Page<Session>>' is not assignable to type 'Promise<Session[]>'.
          Type 'Page<Session>' is missing the following properties from type 'Session[]': length, pop, push, concat, and 29 more.
  Overload 2 of 3, '(options: UndefinedInitialDataOptions<Session[], unknown, Session[], readonly unknown[]>, queryClient?: QueryClient | undefined): UseQueryResult<Session[], unknown>', gave the following error.
    Type '() => Promise<Page<Session>>' is not assignable to type 'unique symbol | QueryFunction<Session[], readonly unknown[], never> | undefined'.
      Type '() => Promise<Page<Session>>' is not assignable to type 'QueryFunction<Session[], readonly unknown[], never>'.
        Type 'Promise<Page<Session>>' is not assignable to type 'Session[] | Promise<Session[]>'.
          Type 'Promise<Page<Session>>' is not assignable to type 'Promise<Session[]>'.
            Type 'Page<Session>' is missing the following properties from type 'Session[]': length, pop, push, concat, and 29 more.
  Overload 3 of 3, '(options: UseQueryOptions<Session[], unknown, Session[], readonly unknown[]>, queryClient?: QueryClient | undefined): UseQueryResult<Session[], unknown>', gave the following error.
    Type '() => Promise<Page<Session>>' is not assignable to type 'unique symbol | QueryFunction<Session[], readonly unknown[], never> | undefined'.
      Type '() => Promise<Page<Session>>' is not assignable to type 'QueryFunction<Session[], readonly unknown[], never>'.
        Type 'Promise<Page<Session>>' is not assignable to type 'Session[] | Promise<Session[]>'.
          Type 'Promise<Page<Session>>' is not assignable to type 'Promise<Session[]>'.
            Type 'Page<Session>' is missing the following properties from type 'Session[]': length, pop, push, concat, and 29 more.
src/features/sessions/queries.ts(30,5): error TS2769: No overload matches this call.
  Overload 1 of 3, '(options: DefinedInitialDataOptions<Session, unknown, Session, readonly unknown[]>, queryClient?: QueryClient | undefined): DefinedUseQueryResult<Session, unknown>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'DefinedInitialDataOptions<Session, unknown, Session, readonly unknown[]>'.
  Overload 2 of 3, '(options: UndefinedInitialDataOptions<Session, unknown, Session, readonly unknown[]>, queryClient?: QueryClient | undefined): UseQueryResult<Session, unknown>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UndefinedInitialDataOptions<Session, unknown, Session, readonly unknown[]>'.
  Overload 3 of 3, '(options: UseQueryOptions<Session, unknown, Session, readonly unknown[]>, queryClient?: QueryClient | undefined): UseQueryResult<Session, unknown>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UseQueryOptions<Session, unknown, Session, readonly unknown[]>'.
src/features/sessions/SessionsListScreen.tsx(19,44): error TS2339: Property 'total' does not exist on type 'Session[]'.
src/features/sessions/SessionsListScreen.tsx(19,57): error TS2339: Property 'pageSize' does not exist on type 'Session[]'.
src/features/sessions/SessionsListScreen.tsx(50,13): error TS2339: Property 'items' does not exist on type 'Session[]'.
src/features/sessions/SessionsListScreen.tsx(62,19): error TS2339: Property 'items' does not exist on type 'Session[]'.
src/features/sessions/SessionsListScreen.tsx(62,30): error TS7006: Parameter 's' implicitly has an 'any' type.
src/features/sessions/SessionsListScreen.tsx(82,22): error TS2339: Property 'page' does not exist on type 'Session[]'.

