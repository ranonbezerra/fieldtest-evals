import { describe, expect, it } from 'vitest';
import type { NewUserRow, UserRow } from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import { UsersService } from './users.service.js';
import type { UsersRepository } from './users.repository.js';

/**
 * The repository is faked at its interface. Services are tested against a fake
 * repository, never against a mocked Drizzle -- one spec per module, named
 * `<name>.service.spec.ts`.
 */
function fakeRepo(rows: UserRow[] = []): UsersRepository {
  return {
    async findById(id: string) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async findByEmail(email: string) {
      return rows.find((r) => r.email === email) ?? null;
    },
    async insert(row: NewUserRow) {
      const created = {
        ...row,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      } as UserRow;
      rows.push(created);
      return created;
    },
  } as unknown as UsersRepository;
}

const row = (over: Partial<UserRow> = {}): UserRow =>
  ({
    id: 'u1',
    email: 'ada@example.com',
    displayName: 'Ada',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  }) as UserRow;

describe('UsersService', () => {
  it('creates a user and returns the entity shape', async () => {
    const svc = new UsersService(fakeRepo());
    const user = await svc.create({ email: 'ada@example.com', displayName: 'Ada' });
    expect(user.email).toBe('ada@example.com');
    expect(typeof user.createdAt).toBe('string');
  });

  it('rejects a duplicate email with a conflict', async () => {
    const svc = new UsersService(fakeRepo([row()]));
    await expect(
      svc.create({ email: 'ada@example.com', displayName: 'Ada' }),
    ).rejects.toThrow(AppError);
  });

  it('raises not_found for an unknown id', async () => {
    const svc = new UsersService(fakeRepo());
    await expect(svc.getById('nope')).rejects.toThrow(AppError);
  });
});
