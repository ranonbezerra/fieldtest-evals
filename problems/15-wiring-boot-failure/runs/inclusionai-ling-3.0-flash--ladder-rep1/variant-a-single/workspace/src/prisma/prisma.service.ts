import { Injectable } from '@nestjs/common';

/**
 * Stand-in for the generated Prisma client. It does not connect: this fixture is
 * about resolving the dependency graph, not about the database.
 */
@Injectable()
export class PrismaService {
  readonly delivery = {
    async findMany(): Promise<Array<{ id: string; status: string }>> {
      return [];
    },
    async update(): Promise<void> {},
  };

  readonly user = {
    async findUnique(): Promise<{ id: string; email: string } | null> {
      return null;
    },
    async findMany(): Promise<Array<{ id: string; email: string }>> {
      return [];
    },
  };
}
