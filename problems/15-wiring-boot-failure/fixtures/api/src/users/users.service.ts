import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(_email: string): Promise<{ id: string; email: string } | null> {
    return this.prisma.user.findUnique();
  }

  async count(): Promise<number> {
    return (await this.prisma.user.findMany()).length;
  }
}
