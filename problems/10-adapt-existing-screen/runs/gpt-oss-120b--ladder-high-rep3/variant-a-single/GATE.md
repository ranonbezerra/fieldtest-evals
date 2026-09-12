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

Done in 796ms using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 2
src/features/sessions/queries.ts(21,5): error TS2769: No overload matches this call.
  Overload 1 of 3, '(options: DefinedInitialDataOptions<unknown, Error, unknown, readonly ["sessions", "detail", string]>, queryClient?: QueryClient | undefined): DefinedUseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'DefinedInitialDataOptions<unknown, Error, unknown, readonly ["sessions", "detail", string]>'.
  Overload 2 of 3, '(options: UndefinedInitialDataOptions<Session, Error, Session, readonly ["sessions", "detail", string]>, queryClient?: QueryClient | undefined): UseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UndefinedInitialDataOptions<Session, Error, Session, readonly ["sessions", "detail", string]>'.
  Overload 3 of 3, '(options: UseQueryOptions<Session, Error, Session, readonly ["sessions", "detail", string]>, queryClient?: QueryClient | undefined): UseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UseQueryOptions<Session, Error, Session, readonly ["sessions", "detail", string]>'.
src/features/sessions/queries.ts(21,17): error TS7006: Parameter 'session' implicitly has an 'any' type.
src/features/sessions/SessionDetailScreen.tsx(18,35): error TS2339: Property 'notes' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(23,52): error TS18047: 'session' is possibly 'null'.
src/features/sessions/SessionDetailScreen.tsx(23,60): error TS2339: Property 'notes' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(32,20): error TS2339: Property 'name' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(33,28): error TS2339: Property 'status' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(33,45): error TS2339: Property 'status' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(50,29): error TS2339: Property 'status' does not exist on type '{}'.
src/features/sessions/SessionDetailScreen.tsx(65,39): error TS2339: Property 'id' does not exist on type '{}'.


$ tsc --noEmit (attempt 1) -> 2
src/app/router.tsx(5,10): error TS2614: Module '"../features/sessions/SessionDetailScreen"' has no exported member 'SessionDetailScreen'. Did you mean to use 'import SessionDetailScreen from "../features/sessions/SessionDetailScreen"' instead?
src/features/sessions/queries.ts(24,5): error TS2769: No overload matches this call.
  Overload 1 of 3, '(options: DefinedInitialDataOptions<Session | null, Error, Session | null, readonly unknown[]>, queryClient?: QueryClient | undefined): DefinedUseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'DefinedInitialDataOptions<Session | null, Error, Session | null, readonly unknown[]>'.
  Overload 2 of 3, '(options: UndefinedInitialDataOptions<Session | null, Error, Session | null, readonly unknown[]>, queryClient?: QueryClient | undefined): UseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UndefinedInitialDataOptions<Session | null, Error, Session | null, readonly unknown[]>'.
  Overload 3 of 3, '(options: UseQueryOptions<Session | null, Error, Session | null, readonly unknown[]>, queryClient?: QueryClient | undefined): UseQueryResult<...>', gave the following error.
    Object literal may only specify known properties, and 'onSuccess' does not exist in type 'UseQueryOptions<Session | null, Error, Session | null, readonly unknown[]>'.
src/features/sessions/queries.ts(24,17): error TS7006: Parameter 'session' implicitly has an 'any' type.
src/features/sessions/SessionDetailScreen.tsx(1,8): error TS6133: 'React' is declared but its value is never read.
src/features/sessions/SessionDetailScreen.tsx(4,1): error TS6133: 'Session' is declared but its value is never read.
src/features/sessions/SessionDetailScreen.tsx(10,40): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
src/features/sessions/SessionDetailScreen.tsx(11,45): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.
src/features/sessions/SessionDetailScreen.tsx(20,24): error TS2339: Property 'notes' does not exist on type 'NonNullable<TQueryFnData>'.
src/features/sessions/SessionDetailScreen.tsx(37,46): error TS2339: Property 'id' does not exist on type 'NonNullable<TQueryFnData>'.
src/features/sessions/SessionDetailScreen.tsx(44,20): error TS2339: Property 'name' does not exist on type 'NonNullable<TQueryFnData>'.
src/features/sessions/SessionDetailScreen.tsx(45,27): error TS2339: Property 'status' does not exist on type 'NonNullable<TQueryFnData>'.


$ tsc --noEmit (attempt 2) -> 2
src/app/router.tsx(2,31): error TS2307: Cannot find module '../features/sessions/SessionListScreen' or its corresponding type declarations.
src/app/router.tsx(4,25): error TS2307: Cannot find module '../features/auth/authHooks' or its corresponding type declarations.
src/features/sessions/queries.ts(28,3): error TS2686: 'React' refers to a UMD global, but the current file is a module. Consider adding an import instead.
src/main.tsx(7,10): error TS2614: Module '"./app/router"' has no exported member 'router'. Did you mean to use 'import router from "./app/router"' instead?
src/test/render.tsx(7,10): error TS2614: Module '"../app/router"' has no exported member 'routes'. Did you mean to use 'import routes from "../app/router"' instead?

