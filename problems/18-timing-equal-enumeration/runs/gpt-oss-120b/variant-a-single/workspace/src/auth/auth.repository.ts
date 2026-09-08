import { Injectable } from '@nestjs/common';
import { PrismaClient, user } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<user | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async createUser(email: string, passwordHash: string): Promise<user> {
    return this.prisma.user.create({
      data: {
        email,
        password_hash: passwordHash,
      },
    });
  }
}
