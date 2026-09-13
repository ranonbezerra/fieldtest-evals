# repair1-set

## reasoning

```
We need to add jest globals types. Usually tsconfig includes "types": ["node", "jest"] . Probably missing. Fix by adding a reference at top of test file? But cannot edit test. Instead add a global declaration file. Create src/types/jest.d.ts? But must be included. Add a file with declare var describe... but easier: install @types/jest not possible. We can add a tsconfig include. But can't modify config? We can add a file test/global.d.ts with declare const describe: any; etc. That will satisfy compiler. Provide file path test/jest-setup.ts? However test file imports nothing. Adding a declaration file anywhere will be picked up. So create a new file test/jest-globals.d.ts.

We must output only changed files. Add that file.
```

## reply

### test/jest-globals.d.ts
```ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal Jest global declarations to satisfy TypeScript compilation in the test suite.
 * This file provides the basic testing functions used in the repository's tests.
 * It is intentionally lightweight and does not interfere with runtime behavior.
 */

declare const describe: (...args: any[]) => void;
declare const it: (...args: any[]) => void;
declare const expect: (...args: any[]) => any;
declare const beforeAll: (...args: any[]) => void;
declare const afterAll: (...args: any[]) => void;
declare const beforeEach: (...args: any[]) => void;
declare const afterEach: (...args: any[]) => void;
```
