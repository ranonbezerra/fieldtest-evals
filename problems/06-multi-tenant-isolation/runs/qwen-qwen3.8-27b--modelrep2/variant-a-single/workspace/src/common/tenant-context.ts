import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from './app-error.js';

const storage = new AsyncLocalStorage<string>();

/**
 * Request-scoped tenant context, backed by AsyncLocalStorage so that
 * concurrent requests (and interleaved in-process work) never share a
 * tenant. Installed once by the tenant-resolution middleware; read by the
 * tenant-scoped Prisma client.
 */
export const tenantContext = {
  run<R>(tenantId: string, fn: () => R): R {
    return storage.run(tenantId, fn);
  },

  current(): string | undefined {
    return storage.getStore();
  },

  require(): string {
    const tenantId = storage.getStore();
    if (!tenantId) {
      throw new AppError(
        500,
        'tenant_context_missing',
        'This operation requires an active tenant context.',
      );
    }
    return tenantId;
  },
};
