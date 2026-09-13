import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

@Injectable()
export class TenantContext {
  private readonly asyncLocalStorage = new AsyncLocalStorage<number>();

  /**
   * Executes a function within a tenant‑scoped async context.
   * @param tenantId Resolved tenant identifier.
   * @param fn Function to execute.
   */
  run<T>(tenantId: number, fn: () => T): T {
    return this.asyncLocalStorage.run(tenantId, fn);
  }

  /**
   * Retrieves the tenant identifier for the current async execution context.
   */
  getTenantId(): number | undefined {
    return this.asyncLocalStorage.getStore();
  }
}
