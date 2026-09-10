import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Builds the connection URL from DATABASE_URL, appending the engine pool size
 * from PRISMA_CONNECTION_LIMIT (default 10) so the write path can sustain
 * concurrent transactions.
 */
function pooledUrl(): string | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  const requested = Number(process.env.PRISMA_CONNECTION_LIMIT ?? 10);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 10;
  const url = new URL(raw);
  url.searchParams.set('connection_limit', String(limit));
  return url.toString();
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = pooledUrl();
    super(url !== null ? { datasources: { db: { url } } } : undefined);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
