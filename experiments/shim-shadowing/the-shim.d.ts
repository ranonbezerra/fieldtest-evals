// Canonical fixture shims. Copied verbatim into each fixture so it typechecks on
// its own, without node_modules. The run workspace installs the real packages.
// Change here, then re-copy: harness/ft-sync-shims
declare module 'vitest' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toThrow(expected?: unknown): void;
    toBeCloseTo(expected: number, digits?: number): void;
    toContain(expected: unknown): void;
    not: { toThrow(expected?: unknown): void; toBe(expected: unknown): void };
    rejects: { toThrow(expected?: unknown): Promise<void> };
  };
}
