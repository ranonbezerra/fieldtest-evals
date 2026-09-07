// src/prisma/prisma.module.ts

import { Module, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService wraps the generated PrismaClient and manages its lifecycle.
 * It is exported so that other modules (repositories, services, etc.) can
 * inject it and use the typed client.
 *
 * // ASSUMPTION: The Prisma schema defines a `Message` model (and any other
 * // models referenced elsewhere). The generated `@prisma/client` therefore
 * // exports a `Message` type, satisfying the imports in other files.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * PrismaModule makes PrismaService available to the rest of the application.
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
