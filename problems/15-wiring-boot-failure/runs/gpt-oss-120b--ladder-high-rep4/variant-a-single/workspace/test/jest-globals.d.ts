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
