import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

const realFetch = globalThis.fetch;

afterEach(() => {
  if (realFetch) {
    globalThis.fetch = realFetch;
  }
  sessionStorage.clear();
  vi.restoreAllMocks();
});
