$ pnpm install -> 0
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +234
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 234, reused 72, downloaded 92, added 142
Progress: resolved 234, reused 72, downloaded 161, added 231
Progress: resolved 234, reused 72, downloaded 162, added 234, done

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

Done in 2.3s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 2
src/features/sessions/ActiveSessionBar.test.tsx(162,37): error TS1005: ',' expected.
src/features/sessions/ActiveSessionBar.test.tsx(162,39): error TS1005: ',' expected.
src/features/sessions/ActiveSessionBar.test.tsx(162,44): error TS1005: ',' expected.
src/features/sessions/ActiveSessionBar.test.tsx(162,48): error TS1005: ',' expected.
src/features/sessions/ActiveSessionBar.test.tsx(162,55): error TS1005: ',' expected.
src/features/sessions/ActiveSessionBar.test.tsx(162,63): error TS1003: Identifier expected.
src/features/sessions/ActiveSessionBar.test.tsx(162,66): error TS1002: Unterminated string literal.
src/features/sessions/ActiveSessionBar.test.tsx(163,5): error TS1005: ',' expected.
src/features/sessions/ActiveSessionBar.test.tsx(163,93): error TS1005: ')' expected.


$ tsc --noEmit (attempt 1) -> 0

