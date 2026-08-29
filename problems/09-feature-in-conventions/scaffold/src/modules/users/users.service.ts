import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UserRow } from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { User } from './entities/user.entity.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  /** Row -> entity. The only place the mapping lives. */
  private toEntity(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) {
      throw AppError.conflict('email already registered', { email: dto.email });
    }
    const row = await this.repo.insert({
      id: randomUUID(),
      email: dto.email,
      displayName: dto.displayName,
    });
    return this.toEntity(row);
  }

  async getById(id: string): Promise<User> {
    const row = await this.repo.findById(id);
    if (!row) throw AppError.notFound('user not found', { id });
    return this.toEntity(row);
  }
}
