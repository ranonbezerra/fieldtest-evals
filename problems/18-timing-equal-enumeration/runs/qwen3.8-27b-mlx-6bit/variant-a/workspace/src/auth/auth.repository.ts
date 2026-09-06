import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(
    email: string,
  ): Promise<{ id: string; email: string; passwordHash: string } | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
  }

  async createUser(
    email: string,
    passwordHash: string,
  ): Promise<{ id: string }> {
    return this.prisma.user.create({
      data: { email, passwordHash },
      select: { id: true },
    });
  }

  async touchUser(id: string): Promise<void> {
    await this.prisma.$executeRaw`UPDATE users SET created_at = created_at WHERE id = ${id}`;
  }
}
