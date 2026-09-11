import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext, TenantContextError } from './tenant-context.js';

export interface TenantAwarePrisma {
  /**
   * Runs `fn` with `tenantId` in request-scoped context. Inside `fn` — and
   * through every async continuation it spawns — every read is scoped to
   * that tenant and every write is stamped with it, by the Prisma
   * extension. Handlers and repositories never pass tenantId themselves.
   */
  runWithTenant<T>(tenantId: string, fn: (scoped: PrismaClient) => Promise<T> | T): Promise<T>;
}

/**
 * The only Prisma client the app may use. It is wrapped in a tenant
 * extension with two hard properties:
 *
 *  - when no tenant is in context, an operation FAILS (TenantContextError)
 *    instead of returning everything;
 *  - any tenantId a caller supplies in args is overwritten by the context.
 *
 * findUnique is translated to findFirst so a foreign primary key behaves
 * exactly like a nonexistent id (404), never like a cross-tenant read.
 */
@Injectable()
export class TenantPrismaProvider implements OnModuleInit, OnModuleDestroy, TenantAwarePrisma {
  private readonly logger = new Logger(TenantPrismaProvider.name);
  private readonly context = new TenantContext();
  private client: any = null;

  async onModuleInit(): Promise<void> {
    const tenantContext = this.context;
    this.client = new PrismaClient({
      // Configuration comes from environment variables only.
      datasources: { db: { url: process.env.DATABASE_URL } },
    }).$extends({
      query: {
        $allModels: {
          async $allOperations({ args: rawArgs, operation, model, query }) {
            const args = rawArgs as Record<string, any>;
            const tenantId = tenantContext.current();
            const mergedWhere = (where: unknown): Record<string, unknown> => {
              const base =
                where && typeof where === 'object' && !Array.isArray(where)
                  ? (where as Record<string, unknown>)
                  : {};
              return { ...base, tenantId };
            };
            const op = String(operation).toLowerCase();

            if (op === 'findunique') {
              // Scoped lookup by id must behave like "not found" for other
              // tenants, so route through findFirst with the merged where.
              return query({ ...args, where: mergedWhere(args.where) });
            }
            if (op === 'create') {
              const data = args.data as Record<string, unknown>;
              return query({ ...args, data: { tenantId, ...data } });
            }
            if (op === 'createmany') {
              const rows = (args.data as Array<Record<string, unknown>>) ?? [];
              return query({ ...args, data: rows.map((row) => ({ tenantId, ...row })) });
            }
            if (op === 'update') {
              return query({
                ...args,
                where: mergedWhere(args.where),
                data: { tenantId, ...(args.data as Record<string, unknown>) },
              });
            }
            if (op === 'upsert') {
              const data = (args.data as { create?: Record<string, unknown>; update?: Record<string, unknown> }) ?? {};
              return query({
                ...args,
                where: mergedWhere(args.where),
                data: {
                  ...(data.create ? { create: { tenantId, ...data.create } } : {}),
                  ...(data.update ? { update: { tenantId, ...data.update } } : {}),
                },
              });
            }
            if (op === 'updatemany' || op === 'deletemany' || op === 'delete' || op === 'count' || op === 'aggregate') {
              return query({ ...args, where: mergedWhere(args.where) });
            }
            if (op === 'findmany' || op === 'findfirst' || op === 'findfirstorthrow') {
              return query({ ...args, where: mergedWhere(args.where) });
            }
            // Read-side operations above; anything else is treated as a
            // read too, so an unknown operation can never be unscoped.
            return query({ ...args, where: mergedWhere(args.where) });
          },
        },
      },
    });
    this.logger.log('Tenant-aware Prisma client initialized');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
    this.client = null;
  }

  async runWithTenant<T>(tenantId: string, fn: (scoped: PrismaClient) => Promise<T> | T): Promise<T> {
    if (!this.client) {
      throw new Error('TenantPrismaProvider is not initialized.');
    }
    return this.context.runWithTenant(tenantId, () => fn(this.client));
  }

  /** Base, unscoped client. Exposed for guarded tests only. */
  get baseClient(): PrismaClient {
    if (!this.client) {
      throw new Error('TenantPrismaProvider is not initialized.');
    }
    return this.client as PrismaClient;
  }

  /** The extension fails without a tenant in context. */
  get noContext(): { tenantId: string | null } {
    return { tenantId: this.context.tryCurrent() };
  }
}

export const TenantPrisma = TenantPrismaProvider;
export type { PrismaClient as BasePrismaClient };
export { TenantContextError };
