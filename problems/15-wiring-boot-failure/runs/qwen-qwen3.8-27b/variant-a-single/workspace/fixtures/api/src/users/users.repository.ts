import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findAll(): Promise<UserRecord[]> {
    return this.prisma.user.findMany();
  }
}
