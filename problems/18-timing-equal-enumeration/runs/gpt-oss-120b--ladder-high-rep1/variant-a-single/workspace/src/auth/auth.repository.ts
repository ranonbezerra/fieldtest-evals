import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { User } from '@prisma/client';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async createUser(email: string, passwordHash: string): Promise<User> {
    return this.prisma.user.create({
      data: {
        email,
        password: passwordHash,
      },
    });
  }
}
